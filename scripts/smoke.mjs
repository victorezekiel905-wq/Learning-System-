// End-to-end smoke test against a REAL Supabase project (after `supabase db push`).
// Creates throwaway users/tenant, exercises the core flows through PostgREST as
// real users (RLS applies), then deletes everything it created.
//
//   node scripts/smoke.mjs            # reads .env.local
//   node scripts/smoke.mjs --keep     # keep the demo data (prints logins)
import { readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SERVICE) { console.error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.local"); process.exit(2); }
const keep = process.argv.includes("--keep");

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const tag = Date.now().toString(36);
const created = { users: [], tenants: [] };
let step = 0;
const ok = (msg) => console.log(`  ✓ ${++step}. ${msg}`);
const must = (cond, msg) => { if (!cond) throw new Error(`Assertion failed: ${msg}`); };

async function user(role) {
  const email = `smoke-${tag}-${role}@swiftcipher.test`, password = randomBytes(12).toString("base64url") + "A1!";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Smoke ${role}` } });
  if (error) throw error;
  created.users.push(data.user.id);
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: e2 } = await c.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return { c, id: data.user.id, email, password };
}
async function call(c, fn, args = {}) {
  const { data, error } = await c.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message} (${error.code})`);
  return data;
}
async function expectFail(p, re, msg) {
  try { await p; } catch (e) { must(re.test(e.message), `${msg} (got ${e.message})`); return; }
  throw new Error(`Expected failure: ${msg}`);
}

try {
  console.log(`SwiftCipher smoke test against ${URL_}`);
  const t = await user("admin");
  const s = await user("student");
  const other = await user("other");

  const boot = await call(t.c, "bootstrap_school", { p_school_name: `Smoke School ${tag}`, p_full_name: "Smoke Admin" });
  created.tenants.push(boot.tenant_id);
  await admin.from("tenants").update({ plan_code: "school" }).eq("id", boot.tenant_id);
  ok("school workspace bootstrapped (tenant + settings + admin profile)");

  const cls = await call(t.c, "create_class", { p_name: "Smoke Year 8 ICT", p_subject: "ICT" });
  await call(s.c, "redeem_code", { p_code: cls.join_code, p_full_name: "Smoke Student" });
  ok(`class created and student joined with code ${cls.join_code}`);

  const { data: lesson, error: le } = await t.c.from("lessons").insert({ tenant_id: boot.tenant_id, owner_id: t.id, title: "Smoke HTML" }).select("id").single();
  if (le) throw le;
  const { data: act, error: ae } = await t.c.from("activities").insert({ tenant_id: boot.tenant_id, lesson_id: lesson.id, owner_id: t.id, kind: "multiple_choice", title: "Links", settings: { show_feedback: "immediately" } }).select("id").single();
  if (ae) throw ae;
  const { data: q, error: qe } = await t.c.from("questions").insert({ tenant_id: boot.tenant_id, activity_id: act.id, owner_id: t.id, kind: "mcq", prompt: "Which tag makes a link?", points: 1 }).select("id").single();
  if (qe) throw qe;
  const { data: opts, error: oe } = await t.c.from("question_options").insert([
    { tenant_id: boot.tenant_id, question_id: q.id, label: "<a>", is_correct: true, position: 0 },
    { tenant_id: boot.tenant_id, question_id: q.id, label: "<p>", is_correct: false, position: 1 }
  ]).select("id,is_correct");
  if (oe) throw oe;
  const { error: se } = await t.c.from("lesson_slides").insert([
    { tenant_id: boot.tenant_id, lesson_id: lesson.id, position: 0, kind: "title", content: { heading: "HTML" } },
    { tenant_id: boot.tenant_id, lesson_id: lesson.id, position: 1, kind: "activity", content: {}, activity_id: act.id }
  ]);
  if (se) throw se;
  const pub = await call(t.c, "publish_lesson", { p_lesson: lesson.id });
  must(pub.version === 1, "published v1");
  const { data: leaked } = await s.c.from("questions").select("id");
  must((leaked ?? []).length === 0, "students cannot read answer keys");
  ok("lesson authored, published, answer keys hidden from students");

  const session = await call(t.c, "start_session", { p_class: cls.id, p_lesson: lesson.id });
  await call(s.c, "join_session", { p_code: session.join_code });
  await call(t.c, "set_session_state", { p_session: session.id, p_activity: act.id });
  const att = await call(s.c, "start_attempt", { p_activity: act.id, p_session: session.id });
  const right = opts.find((o) => o.is_correct).id;
  const ans = await call(s.c, "submit_answer", { p_attempt: att.attempt.id, p_question: q.id, p_response: { option_id: right } });
  must(ans.is_correct === true, "server graded the answer correct");
  await call(s.c, "finish_attempt", { p_attempt: att.attempt.id });
  ok("live session: join, launch activity, server-side grading");

  const pc = await call(s.c, "create_pairing_code");
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });
  const dev = await call(anon, "device_pair", { p_code: pc.code, p_label: "Smoke browser", p_os: "linux", p_browser: "Chrome", p_version: "1.0.0" });
  const hb = await call(anon, "device_heartbeat", { p_device: dev.device_id, p_secret: dev.secret, p_url: "https://developer.mozilla.org/", p_title: "MDN", p_tab_count: 2, p_idle_state: "active", p_version: "1.0.0", p_app_host: null });
  must(hb.state === "active", "device sees the live session");
  await expectFail(call(anon, "device_heartbeat", { p_device: dev.device_id, p_secret: "wrong" }), /credentials/i, "bad secret rejected");
  ok("device pairing + authenticated heartbeat + wrong secret rejected");

  const state = await call(t.c, "teacher_session_state", { p_session: session.id });
  must(state.roster.length === 1 && state.roster[0].device, "teacher sees student with device telemetry");
  ok("teacher live dashboard state");

  const boot2 = await call(other.c, "bootstrap_school", { p_school_name: `Smoke Other ${tag}`, p_full_name: "Other Admin" });
  created.tenants.push(boot2.tenant_id);
  const { data: cross } = await other.c.from("lessons").select("id").eq("id", lesson.id);
  must((cross ?? []).length === 0, "other tenant cannot read lesson");
  await expectFail(call(other.c, "join_session", { p_code: session.join_code }), /another class|not found|No live/i, "cross-tenant join blocked");
  ok("tenant isolation holds across schools");

  const end = await call(t.c, "end_session", { p_session: session.id });
  must(end.report_id, "session report generated");
  const analytics = await call(t.c, "class_analytics", { p_class: cls.id, p_days: 7 });
  must(analytics.sessions === 1, "analytics counts the session");
  ok("session ended → attendance + report + analytics");

  const { data: bucket } = await admin.storage.getBucket("lesson-media");
  must(bucket, "storage bucket lesson-media exists");
  ok("storage buckets provisioned");

  console.log(`\nAll ${step} smoke checks passed.`);
  if (keep) console.log(`Kept demo data. Teacher login: ${t.email} / ${t.password}\nStudent login: ${s.email} / ${s.password}`);
} catch (e) {
  console.error(`\n✗ Smoke test failed at step ${step + 1}: ${e.message}`);
  process.exitCode = 1;
} finally {
  if (!keep) {
    for (const id of created.tenants) await admin.from("tenants").delete().eq("id", id);
    for (const id of created.users) await admin.auth.admin.deleteUser(id);
    console.log("Cleaned up smoke-test data.");
  }
}
