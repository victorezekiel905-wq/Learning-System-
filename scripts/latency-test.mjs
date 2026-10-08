#!/usr/bin/env node
/**
 * Live-lesson speed test (docs/LIVE_ENGINE.md, "report and proof").
 *
 * Plays the teacher and N students against your real Supabase project: starts a
 * code-only lesson, joins N guests (each with its own sign-in and its own
 * Realtime connection, like N phones), then moves to the next slide R times and
 * measures, for every student, the time from the teacher pressing "next" to the
 * student receiving the change. The student screen shows the new slide as soon
 * as that arrives (StudentLive applies the broadcast directly).
 *
 * Usage (PowerShell):
 *   $env:TEACHER_EMAIL="you@school.org"; $env:TEACHER_PASSWORD="..."; node scripts/latency-test.mjs
 * Options: --students 30  --rounds 20  --target 300   (target is the p95 in ms)
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY from the
 * environment or .env.local. Needs a teacher account (email + password) and
 * anonymous sign-ins switched on with a limit of at least N per hour
 * (Supabase: Authentication -> Sign In / Providers, and Rate limits).
 * It creates a lesson called "Speed test (safe to delete)" and removes it after.
 */
import { readFileSync, existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createClient } from "@supabase/supabase-js";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : dflt;
};
const N = arg("students", 30), ROUNDS = arg("rounds", 20), TARGET = arg("target", 300);

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
const { TEACHER_EMAIL, TEACHER_PASSWORD } = process.env;
if (!URL_ || !ANON || !TEACHER_EMAIL || !TEACHER_PASSWORD) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY (or .env.local), TEACHER_EMAIL and TEACHER_PASSWORD.");
  process.exit(2);
}

const client = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const must = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : NaN; };
const ms = (x) => `${Math.round(x)} ms`;

const teacher = client();
must(await teacher.auth.signInWithPassword({ email: TEACHER_EMAIL, password: TEACHER_PASSWORD }), "Teacher sign-in");
const { data: { user } } = await teacher.auth.getUser();
const me = must(await teacher.from("users").select("tenant_id").eq("id", user.id).single(), "Teacher profile");

let lessonId = null, sessionId = null;
const students = [];
async function cleanup() {
  for (const s of students) await s.sb.removeAllChannels().catch(() => {});
  if (sessionId) await teacher.rpc("session_control", { p_session: sessionId, p_action: "end" }).catch(() => {});
  if (lessonId) {
    const { error } = await teacher.from("lessons").delete().eq("id", lessonId);
    if (error) console.log(`(The test lesson "Speed test (safe to delete)" could not be removed: ${error.message})`);
  }
}

try {
  // A lesson with enough slides for every round.
  lessonId = must(await teacher.from("lessons").insert({ tenant_id: me.tenant_id, owner_id: user.id, title: "Speed test (safe to delete)" })
    .select("id").single(), "Create lesson").id;
  must(await teacher.from("lesson_slides").insert(Array.from({ length: ROUNDS + 2 }, (_, i) => ({
    tenant_id: me.tenant_id, lesson_id: lessonId, position: i, kind: "canvas", content: {} }))), "Create slides");
  const s = must(await teacher.rpc("start_session", { p_class: null, p_lesson: lessonId }), "Start lesson");
  sessionId = s.id;
  console.log(`Lesson started, code ${s.join_code}. Joining ${N} students…`);

  for (let i = 0; i < N; i++) {
    const sb = client();
    const { data, error } = await sb.auth.signInAnonymously();
    if (error) {
      throw new Error(`Student ${i + 1} couldn't sign in (${error.message}). ` +
        (/rate|limit/i.test(error.message) ? "Raise the anonymous sign-in limit in Supabase (Authentication -> Rate limits) or wait an hour." : ""));
    }
    must(await sb.rpc("join_session_as_guest", { p_code: s.join_code, p_name: `Tester ${String(i + 1).padStart(2, "0")}` }), `Student ${i + 1} join`);
    await sb.realtime.setAuth(data.session.access_token);
    const got = new Map();
    const ch = sb.channel(`session:${sessionId}`, { config: { private: true } });
    ch.on("broadcast", { event: "state" }, (m) => { const v = m.payload?.v; if (typeof v === "number" && !got.has(v)) got.set(v, performance.now()); });
    await new Promise((ok, bad) => {
      const t = setTimeout(() => bad(new Error(`Student ${i + 1} couldn't connect to the lesson channel (Realtime).`)), 15000);
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED") { clearTimeout(t); ok(); }
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(t); bad(new Error(`Student ${i + 1}: channel ${status}`)); }
      });
    });
    students.push({ sb, got });
    process.stdout.write(`\r  ${i + 1}/${N} connected`);
  }
  console.log("");

  must(await teacher.rpc("session_control", { p_session: sessionId, p_action: "start" }), "Start");
  await sleep(1500);

  const all = [], rpcTimes = [], rows = [];
  let missed = 0;
  for (let r = 1; r <= ROUNDS; r++) {
    const before = Math.max(0, ...students.flatMap((x) => [...x.got.keys()]));
    const t0 = performance.now();
    must(await teacher.rpc("session_control", { p_session: sessionId, p_action: "next" }), "Next slide");
    const rpcMs = performance.now() - t0;
    rpcTimes.push(rpcMs);
    const deadline = performance.now() + 5000;
    const arrival = () => students.map((x) => [...x.got.entries()].find(([v]) => v > before)?.[1]);
    while (arrival().some((a) => a === undefined) && performance.now() < deadline) await sleep(5);
    const lat = arrival().filter((a) => a !== undefined).map((a) => a - t0);
    missed += N - lat.length;
    all.push(...lat);
    rows.push({ round: r, teacher_call: ms(rpcMs), p50: ms(pct(lat, 50)), p95: ms(pct(lat, 95)), slowest: ms(Math.max(...lat)), received: `${lat.length}/${N}` });
    await sleep(600);
  }

  console.table(rows);
  const p95 = pct(all, 95);
  console.log(`\n${N} students x ${ROUNDS} slide changes = ${all.length} deliveries${missed ? `, ${missed} not received within 5 s` : ""}`);
  console.log(`Teacher presses "next" -> student has the new slide:  median ${ms(pct(all, 50))}, p95 ${ms(p95)}, slowest ${ms(Math.max(...all))}`);
  console.log(`(of which the teacher's own call takes a median ${ms(pct(rpcTimes, 50))}; this computer's network to Supabase counts twice)`);
  const pass = missed === 0 && p95 <= TARGET;
  console.log(pass ? `PASS: p95 ${ms(p95)} is within the ${TARGET} ms target.` : `FAIL: target is p95 <= ${TARGET} ms with every change received.`);
  await cleanup();
  process.exit(pass ? 0 : 1);
} catch (e) {
  console.error(`\n${e.message}`);
  await cleanup();
  process.exit(2);
}
