// Classroom load test against a real Supabase project (use a STAGING project).
//
//   node scripts/load/classroom-load.mjs --students 300 --class-size 30 --minutes 5
//   node scripts/load/classroom-load.mjs --students 300 --frames      # also stream screen frames
//
// Creates a throwaway school with one teacher + live class per `class-size`
// students, then simulates exactly what the pages do:
//   students: student_report every tick (server-directed), session_student_state
//             when the state version changes, optional 25 KB screen frames on their
//             private Realtime channel;
//   teachers: teacher_session_state every 15 s, a slide change every 60 s.
// Prints request rates and p50/p95/p99 latency per call, then deletes everything.
// Reads NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY from the environment or .env.local.
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SERVICE) { console.error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY."); process.exit(2); }

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? dflt : (process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true); };
const STUDENTS = Number(arg("students", 60));
const CLASS_SIZE = Number(arg("class-size", 30));
const MINUTES = Number(arg("minutes", 3));
const FRAMES = !!arg("frames", false);
const KEEP = !!arg("keep", false);
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const tag = `load${Date.now().toString(36)}`;
const created = { users: [], tenant: null };

const stats = new Map();
async function timed(name, fn) {
  const t = performance.now();
  try { const r = await fn(); if (r?.error) throw r.error; rec(name, performance.now() - t, false); return r?.data ?? r; }
  catch (e) { rec(name, performance.now() - t, true); if (process.env.DEBUG) console.error(name, e.message ?? e); return null; }
}
function rec(name, ms, err) {
  const s = stats.get(name) ?? { n: 0, err: 0, ms: [] };
  s.n++; if (err) s.err++; s.ms.push(ms); stats.set(name, s);
}
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0; };

async function user(role, i) {
  const email = `${tag}-${role}-${i}@swiftcipher.test`, password = randomBytes(12).toString("base64url") + "A1!";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Load ${role} ${i}` } });
  if (error) throw error;
  created.users.push(data.user.id);
  const c = createClient(URL_, ANON, opts);
  const { error: e2 } = await c.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return { id: data.user.id, c };
}
const rpc = async (c, fn, args) => { const { data, error } = await c.rpc(fn, args); if (error) throw new Error(`${fn}: ${error.message}`); return data; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inBatches = async (n, size, fn) => { const out = []; for (let i = 0; i < n; i += size) out.push(...await Promise.all(Array.from({ length: Math.min(size, n - i) }, (_, k) => fn(i + k)))); return out; };

let stop = false;
try {
  const health = await createClient(URL_, ANON, opts).rpc("health");
  if (!health.data || String(health.data.schema) < "0760") throw new Error("Apply supabase/updates/2026-09-24_production_release.sql to this project first.");

  console.log(`Setting up ${STUDENTS} students in classes of ${CLASS_SIZE}…`);
  const head = await user("admin", 0);
  created.tenant = (await rpc(head.c, "bootstrap_school", { p_school_name: `Load test ${tag}`, p_full_name: "Load Admin" })).tenant_id;
  await admin.from("tenants").update({ plan_code: "enterprise" }).eq("id", created.tenant);
  await admin.from("tenant_settings").update({ allow_screen_capture: true }).eq("tenant_id", created.tenant);

  const classes = Math.ceil(STUDENTS / CLASS_SIZE);
  const teachers = await inBatches(classes, 5, async (i) => {
    const inv = await rpc(head.c, "create_invite", { p_role: "teacher", p_email: `${tag}-teacher-${i}@swiftcipher.test` });
    const t = await user("teacher", i);
    await rpc(t.c, "redeem_code", { p_code: inv.code });
    const cls = await rpc(t.c, "create_class", { p_name: `Load class ${i}` });
    const s = await rpc(t.c, "start_session", { p_class: cls.id });
    return { ...t, cls, session: s };
  });
  const students = await inBatches(STUDENTS, 10, async (i) => {
    const t = teachers[Math.floor(i / CLASS_SIZE)];
    const s = await user("student", i);
    await rpc(s.c, "redeem_code", { p_code: t.cls.join_code });
    await rpc(s.c, "join_session", { p_code: t.session.join_code });
    return { ...s, session: t.session.id, version: -1 };
  });
  console.log(`Running for ${MINUTES} min${FRAMES ? " with screen frames" : ""}…`);

  const frame = "data:image/jpeg;base64," + randomBytes(18_000).toString("base64"); // ~25 KB, like a 480 px thumbnail
  const loops = [];
  for (const s of students) {
    loops.push((async () => {
      await sleep(Math.random() * 10_000); // spread the herd like real page loads
      let ch = null;
      if (FRAMES) {
        const { data } = await s.c.auth.getSession();
        await s.c.realtime.setAuth(data.session.access_token);
        ch = s.c.channel(`screen:${s.session}:${s.id}`, { config: { private: true } });
        // Like the app: frames go over the joined socket, never the REST fallback.
        const joined = await new Promise((res) => {
          const t = setTimeout(() => res(false), 15_000);
          ch.subscribe((status) => { if (status === "SUBSCRIBED") { clearTimeout(t); res(true); } else if (status !== "SUBSCRIBED" && status !== "JOINING") { clearTimeout(t); res(false); } });
        });
        rec("realtime_join", 0, !joined);
        if (!joined) { await s.c.removeChannel(ch); ch = null; }
      }
      let lastFrame = 0;
      while (!stop) {
        const d = await timed("student_report", () => s.c.rpc("student_report", { p_session: s.session, p_visible: true, p_fullscreen: true, p_sharing: true }));
        if (d && d.state_version !== s.version) { s.version = d.state_version; await timed("session_student_state", () => s.c.rpc("session_student_state", { p_session: s.session })); }
        if (ch && d?.capture?.send && Date.now() - lastFrame > (d.capture.interval_seconds ?? 10) * 1000) {
          lastFrame = Date.now();
          await timed("realtime_frame", () => ch.send({ type: "broadcast", event: "frame", payload: { image: frame, width: 480, height: 270, quality: "thumbnail", at: Date.now() } }).then((r) => (r === "ok" ? null : { error: new Error(r) })));
        }
        await sleep((d?.tick_seconds ?? 10) * 1000 * (0.9 + Math.random() * 0.2));
      }
      if (ch) await s.c.removeChannel(ch);
    })());
  }
  for (const t of teachers) {
    loops.push((async () => {
      let slide = 0, lastSlide = Date.now();
      while (!stop) {
        await timed("teacher_session_state", () => t.c.rpc("teacher_session_state", { p_session: t.session.id }));
        if (Date.now() - lastSlide > 60_000) { lastSlide = Date.now(); await timed("set_session_state", () => t.c.rpc("set_session_state", { p_session: t.session.id, p_slide: ++slide % 5 })); }
        await sleep(15_000);
      }
    })());
  }
  const started = Date.now();
  await sleep(MINUTES * 60_000);
  stop = true;
  await Promise.race([Promise.all(loops), sleep(20_000)]);
  const secs = (Date.now() - started) / 1000;

  console.log(`\n${STUDENTS} students, ${teachers.length} teachers, ${secs.toFixed(0)} s`);
  console.log("call                     req/s    p50 ms   p95 ms   p99 ms   errors");
  let total = 0;
  for (const [name, s] of stats) {
    total += s.n;
    console.log(`${name.padEnd(24)} ${(s.n / secs).toFixed(1).padStart(6)} ${pct(s.ms, 50).toFixed(0).padStart(8)} ${pct(s.ms, 95).toFixed(0).padStart(8)} ${pct(s.ms, 99).toFixed(0).padStart(8)} ${String(s.err).padStart(8)}`);
  }
  console.log(`total ${(total / secs).toFixed(1)} req/s = ${(total / secs / STUDENTS).toFixed(3)} per student`);
} catch (e) {
  console.error(`Load test failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  stop = true;
  if (!KEEP) {
    if (created.tenant) await admin.from("tenants").delete().eq("id", created.tenant);
    await inBatches(created.users.length, 20, (i) => admin.auth.admin.deleteUser(created.users[i]));
    console.log("Cleaned up load-test data.");
  }
}
