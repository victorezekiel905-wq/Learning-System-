// The production database was created from setup.sql before these releases.
// The update file must apply on top of it, with real data present, twice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDb } from "./harness.mjs";

test("update file upgrades a live database from 0730 and is safe to re-run", async () => {
  const db = await createDb("20260901000730_deferred_fks.sql");
  const admin = await db.signUp("a@live.test", "Live Admin");
  const tenant = (await db.rpc(admin, "bootstrap_school", { p_school_name: "Live School", p_full_name: "Live Admin" })).tenant_id;
  await db.admin("update public.tenants set plan_code = 'school' where id = $1", [tenant]);
  const cls = await db.rpc(admin, "create_class", { p_name: "Live 1" });
  const student = await db.signUp("s@live.test", "Live Student");
  await db.rpc(student, "redeem_code", { p_code: cls.join_code });

  const sql = readFileSync(new URL("../updates/2026-09-24_production_release.sql", import.meta.url), "utf8");
  for (let i = 0; i < 2; i++) {
    const r = await db.pg.exec(sql);
    assert.deepEqual(r.at(-1).rows[0], { lockdown_ready: true, operations_ready: true, scale_ready: true });
  }
  assert.equal((await db.rpc(null, "health", {})).schema, "0760");
  // Existing data still works through the new code paths.
  const s = await db.rpc(admin, "start_session", { p_class: cls.id });
  await db.rpc(student, "join_session", { p_code: s.join_code });
  const tick = await db.rpc(student, "student_report", { p_session: s.id, p_visible: true, p_fullscreen: true, p_sharing: true });
  assert.equal(tick.status, "live");
  assert.equal(tick.tick_seconds, 10);

  // Operator load-shedding knob: slower ticks, wider presence window, no deploy.
  await db.admin("update public.platform_config set value = '30' where key = 'student_tick_seconds'");
  assert.equal((await db.rpc(student, "student_report", { p_session: s.id, p_visible: true, p_fullscreen: true, p_sharing: true })).tick_seconds, 30);
  assert.equal((await db.admin("select extract(epoch from app.presence_window())::int s"))[0].s, 105);
  // A student silent for 60 s is still "present" at a 30 s tick (would be offline at 10 s).
  await db.admin("update public.session_participants set last_seen_at = now() - interval '60 seconds' where session_id = $1 and user_id = $2", [s.id, student]);
  const st = await db.rpc(admin, "teacher_session_state", { p_session: s.id });
  assert.equal(st.roster.find((r) => r.student_id === student).presence, "online");
});
