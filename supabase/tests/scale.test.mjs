// Query-plan tests at volume: seeds thousands of schools and 100k+ users, then
// checks that the hot paths use indexes (no full-table scans), as they must at
// 5,000,000 users / 50,000 schools. Plans, not timings, so results are stable.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "./harness.mjs";

const TENANTS = Number(process.env.SCALE_TENANTS ?? 2000);
const USERS_PER_TENANT = Number(process.env.SCALE_USERS ?? 60);
const BIG = ["users", "notifications", "lessons", "audit_logs", "session_participants", "class_members", "classes", "tenants", "quiz_attempts"];

let db;
const S = {};

// Walks an EXPLAIN (FORMAT JSON) tree and returns every full-table scan of a big table.
function seqScans(plan) {
  const out = [];
  const walk = (n) => {
    if (n["Node Type"] === "Seq Scan" && BIG.includes(n["Relation Name"])) out.push(n["Relation Name"]);
    for (const c of n.Plans ?? []) walk(c);
  };
  walk(plan[0].Plan);
  return out;
}
async function explainAs(user, sql, params = []) {
  const rows = await db.as(user, `explain (format json) ${sql}`, params);
  return rows[0]["QUERY PLAN"];
}
async function explainAdmin(sql, params = []) {
  const rows = await db.admin(`explain (format json) ${sql}`, params);
  return rows[0]["QUERY PLAN"];
}

before(async () => {
  db = await createDb();
  // A real school to query as.
  S.admin = await db.signUp("admin@scale.test", "Scale Admin");
  S.tenant = (await db.rpc(S.admin, "bootstrap_school", { p_school_name: "Scale Academy", p_full_name: "Scale Admin" })).tenant_id;
  await db.admin("update public.tenants set plan_code = 'school' where id = $1", [S.tenant]);
  const inv = await db.rpc(S.admin, "create_invite", { p_role: "teacher", p_email: "t@scale.test" });
  S.teacher = await db.signUp("t@scale.test", "Scale Teacher");
  await db.rpc(S.teacher, "redeem_code", { p_code: inv.code });
  S.class = (await db.rpc(S.teacher, "create_class", { p_name: "Scale 1" })).id;
  S.student = await db.signUp("s@scale.test", "Scale Student");
  await db.rpc(S.student, "redeem_code", { p_code: (await db.admin("select join_code from public.classes where id = $1", [S.class]))[0].join_code });

  // Bulk data for thousands of other schools (triggers off for speed).
  const t0 = Date.now();
  await db.admin("set session_replication_role = replica");
  await db.admin(`insert into public.tenants (id, name, slug, plan_code, created_at)
    select gen_random_uuid(), 'School ' || g, 'school-' || g, 'school', now() - (g || ' minutes')::interval
    from generate_series(1, ${TENANTS}) g`);
  await db.admin(`insert into public.tenant_settings (tenant_id) select id from public.tenants where slug like 'school-%'`);
  await db.admin(`insert into public.users (id, tenant_id, email, full_name, role, status, created_at)
    select gen_random_uuid(), t.id, 'u' || g || '.' || t.slug || '@x.test', 'Student ' || g, 'student', 'active', now() - (g || ' seconds')::interval
    from public.tenants t cross join generate_series(1, ${USERS_PER_TENANT}) g where t.slug like 'school-%'`);
  await db.admin(`insert into public.classes (id, tenant_id, name, teacher_id, join_code)
    select gen_random_uuid(), t.id, 'Class', (select u.id from public.users u where u.tenant_id = t.id limit 1),
           -- unique, deterministic 6-character codes (random ones can collide across 2,000 schools)
           'Z' || to_char(row_number() over (order by t.id), 'FM00000')
    from public.tenants t where t.slug like 'school-%'`);
  await db.admin(`insert into public.notifications (tenant_id, user_id, kind, title)
    select u.tenant_id, u.id, 'info', 'Hello' from public.users u where u.tenant_id <> $1`, [S.tenant]);
  await db.admin(`insert into public.lessons (tenant_id, owner_id, title)
    select c.tenant_id, c.teacher_id, 'Lesson ' || g from public.classes c cross join generate_series(1, 3) g where c.tenant_id <> $1`, [S.tenant]);
  await db.admin(`insert into public.audit_logs (tenant_id, action, created_at)
    select t.id, 'x', now() - (g || ' minutes')::interval from public.tenants t cross join generate_series(1, 5) g where t.slug like 'school-%'`);
  await db.admin("set session_replication_role = origin");
  await db.admin("analyze");
  const n = (await db.admin("select count(*)::int n from public.users"))[0].n;
  console.log(`# seeded ${TENANTS} schools, ${n} users in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  assert.ok(n >= TENANTS * USERS_PER_TENANT);
});

test("a school's own lists use indexes, not full scans (RLS by tenant_id)", async () => {
  const cases = [
    [S.admin, "select id, full_name from public.users order by full_name limit 50"],
    [S.admin, "select id from public.users where role = 'student' order by created_at desc limit 50"],
    [S.teacher, "select id, title from public.lessons order by updated_at desc limit 50"],
    [S.admin, "select id from public.audit_logs order by created_at desc limit 50"],
    [S.student, "select id, title from public.notifications where user_id = auth.uid() order by created_at desc limit 20"],
    [S.teacher, "select id, name from public.classes"]
  ];
  for (const [u, sql] of cases) assert.deepEqual(seqScans(await explainAs(u, sql)), [], sql);
});

test("platform console pages are index-driven at 50,000 schools", async () => {
  const cases = [
    "select id from public.tenants order by created_at desc, id desc limit 51",
    "select id from public.users order by created_at desc, id desc limit 51",
    `select id from public.users where tenant_id = '${S.tenant}' order by created_at desc, id desc limit 51`,
    `select count(*) from public.users where tenant_id = '${S.tenant}'`
  ];
  for (const sql of cases) assert.deepEqual(seqScans(await explainAdmin(sql)), [], sql);
});

test("retention probes each school through the (tenant_id, time) index", async () => {
  const plan = await explainAdmin(`
    select e.ctid from public.tenant_settings s
    cross join lateral (select y.ctid from public.notifications y
                        where y.tenant_id = s.tenant_id and y.created_at < now() - interval '90 days' limit 2000) e
    limit 20000`);
  assert.deepEqual(seqScans(plan), []);
});

test("classroom hot paths stay fast with a large database", async () => {
  const s = await db.rpc(S.teacher, "start_session", { p_class: S.class });
  await db.rpc(S.student, "join_session", { p_code: s.join_code });
  const t0 = performance.now();
  for (let i = 0; i < 50; i++) {
    await db.rpc(S.student, "student_report", { p_session: s.id, p_visible: true, p_fullscreen: true, p_sharing: true });
  }
  const tick = (performance.now() - t0) / 50;
  const t1 = performance.now();
  for (let i = 0; i < 10; i++) await db.rpc(S.teacher, "teacher_session_state", { p_session: s.id });
  const state = (performance.now() - t1) / 10;
  console.log(`# student tick ${tick.toFixed(1)} ms, teacher state ${state.toFixed(1)} ms (in-process PGlite)`);
  // Generous bounds: these catch accidental full scans, not micro-regressions.
  assert.ok(tick < 250, `student tick ${tick} ms`);
  assert.ok(state < 1000, `teacher state ${state} ms`);
  const r = await db.rpc(S.admin, "sa_list_tenants", {}).catch((e) => e);
  assert.ok(r instanceof Error, "only the super admin lists schools");
});
