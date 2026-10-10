// End-to-end database tests (blueprint §29): permissions, tenant isolation,
// scoring, policy evaluation, device agent flows. Run: npm run test:db
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "./harness.mjs";

let db;
const S = {}; // shared fixture ids

/** Start a live lesson and press Start: sessions open in the lobby (0880). */
async function goLive(teacher, args) {
  const s = await db.rpc(teacher, "start_session", args);
  await db.rpc(teacher, "session_control", { p_session: s.id, p_action: "start" });
  return s;
}

async function rejects(promise, pattern) {
  await assert.rejects(promise, (err) => {
    if (pattern && !pattern.test(err.message)) {
      assert.fail(`expected error matching ${pattern}, got: ${err.message}`);
    }
    return true;
  });
}
const J = (v) => JSON.stringify(v);

before(async () => {
  db = await createDb();

  // School A: admin bootstraps; teacher, students, parent join by code.
  S.adminA = await db.signUp("admin@a.test", "Grace Admin");
  const boot = await db.rpc(S.adminA, "bootstrap_school", { p_school_name: "Alpha Academy", p_full_name: "Grace Admin" });
  S.tenantA = boot.tenant_id;
  // Upgrade A to a plan with device control for Guard tests.
  await db.admin("update public.tenants set plan_code = 'school' where id = $1", [S.tenantA]);

  S.adminB = await db.signUp("admin@b.test", "Bob Admin");
  S.tenantB = (await db.rpc(S.adminB, "bootstrap_school", { p_school_name: "Beta School", p_full_name: "Bob Admin" })).tenant_id;
  // Monitoring is an add-on (0870), off for new schools; these schools use it.
  await db.admin("update public.tenant_settings set monitoring_enabled = true where tenant_id = any($1)", [[S.tenantA, S.tenantB]]);
  await db.admin("delete from public.audit_logs where action = 'settings.updated'"); // fixture, not part of any scenario
});

// ---------------------------------------------------------------------------
test("onboarding: invites, class codes, roles", async () => {
  const inv = await db.rpc(S.adminA, "create_invite", { p_role: "teacher", p_email: "teach@a.test" });
  S.teacherA = await db.signUp("teach@a.test", "Tom Teacher");
  const r = await db.rpc(S.teacherA, "redeem_code", { p_code: inv.code });
  assert.equal(r.role, "teacher");

  const cls = await db.rpc(S.teacherA, "create_class", { p_name: "Year 8 ICT", p_subject: "ICT" });
  S.classA = cls.id;
  S.classCode = cls.join_code;
  assert.match(cls.join_code, /^[A-Z0-9]{6}$/);

  S.stu1 = await db.signUp("ada@a.test", "Ada Lovelace");
  S.stu2 = await db.signUp("alan@a.test", "Alan Turing");
  S.stu3 = await db.signUp("kat@a.test", "Katherine Johnson");
  for (const s of [S.stu1, S.stu2, S.stu3]) {
    const j = await db.rpc(s, "redeem_code", { p_code: S.classCode.toLowerCase() });
    assert.equal(j.role, "student");
  }
  // Teacher got a join notification.
  const notes = await db.as(S.teacherA, "select kind from public.notifications");
  assert.ok(notes.some((n) => n.kind === "student_joined"));

  // Students cannot redeem a staff invite with the wrong email.
  const inv2 = await db.rpc(S.adminA, "create_invite", { p_role: "it_admin", p_email: "it@a.test" });
  await rejects(db.rpc(S.stu1, "redeem_code", { p_code: inv2.code }), /different email/);
  S.itA = await db.signUp("it@a.test", "Ivy IT");
  await db.rpc(S.itA, "redeem_code", { p_code: inv2.code });

  // Parent invite linked to Ada.
  const pinv = await db.rpc(S.teacherA, "create_invite", { p_role: "parent", p_student: S.stu1 });
  S.parentA = await db.signUp("mum@a.test", "Anne Parent");
  await db.rpc(S.parentA, "redeem_code", { p_code: pinv.code });

  // Only admins invite staff.
  await rejects(db.rpc(S.teacherA, "create_invite", { p_role: "teacher" }), /Only administrators/);
  // Users cannot change their own role.
  await rejects(db.as(S.stu1, "update public.users set role = 'school_admin' where id = $1", [S.stu1]), /permission denied|administrator/);
  // Duplicate bootstrap is refused.
  await rejects(db.rpc(S.stu1, "bootstrap_school", { p_school_name: "X", p_full_name: "Y" }), /already belongs/);
});

test("tenant isolation (§4, §20)", async () => {
  const b = S.adminB;
  assert.equal((await db.as(b, "select * from public.users where tenant_id = $1", [S.tenantA])).length, 0);
  assert.equal((await db.as(b, "select * from public.classes")).length, 0);
  assert.equal((await db.as(b, "select * from public.tenants")).length, 1);
  // Another school's code looks like no code at all: a school never learns another exists.
  await rejects(db.rpc(b, "redeem_code", { p_code: S.classCode }), /No class or invite matches that code/);
  await rejects(
    db.as(b, "insert into public.lessons (tenant_id, owner_id, title) values ($1, $2, 'x')", [S.tenantA, b]),
    /row-level security|violates/
  );
  // Anonymous clients see nothing and can't call app RPCs.
  assert.equal((await db.anon("select * from public.plans")).length, 5);
  await rejects(db.anon("select * from public.users"), /permission denied/);
  await rejects(db.rpc(null, "create_class", { p_name: "x" }), /permission denied/);
  // Students see teachers + themselves, not classmates.
  const seen = await db.as(S.stu1, "select id from public.users");
  assert.ok(seen.some((u) => u.id === S.teacherA));
  assert.ok(!seen.some((u) => u.id === S.stu2));
  // Parents see their linked child only once the school enables the portal.
  assert.ok(!(await db.as(S.parentA, "select id from public.users")).some((u) => u.id === S.stu1));
  await db.as(S.adminA, "update public.tenant_settings set parent_portal_enabled = true");
  assert.ok((await db.as(S.parentA, "select id from public.users")).some((u) => u.id === S.stu1));
  // Settings changes are audited.
  const audit = await db.as(S.adminA, "select action from public.audit_logs where action = 'settings.updated'");
  assert.equal(audit.length, 1);
});

// ---------------------------------------------------------------------------
test("studio: lessons, questions, publish, duplicate", async () => {
  const t = S.teacherA;
  const [lesson] = await db.as(t,
    "insert into public.lessons (tenant_id, owner_id, title) values ($1, $2, 'Introduction to HTML') returning id",
    [S.tenantA, t]);
  S.lesson = lesson.id;
  const [act] = await db.as(t,
    `insert into public.activities (tenant_id, lesson_id, owner_id, kind, title, settings)
     values ($1, $2, $3, 'quiz', 'HTML check', '{"show_feedback":"immediately","attempts_allowed":2,"shuffle_options":true}') returning id`,
    [S.tenantA, S.lesson, t]);
  S.quiz = act.id;

  const q = async (kind, prompt, extra = {}) => {
    const [row] = await db.as(t,
      `insert into public.questions (tenant_id, activity_id, owner_id, kind, prompt, config, answer_key, points, position)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [S.tenantA, S.quiz, t, kind, prompt, J(extra.config ?? {}), J(extra.key ?? {}), extra.points ?? 1, extra.pos ?? 0]);
    return row.id;
  };
  S.qMcq = await q("mcq", "Which tag makes a link?", { pos: 0 });
  const opts = await db.as(t,
    `insert into public.question_options (tenant_id, question_id, label, is_correct, position)
     values ($1,$2,'<a>',true,0), ($1,$2,'<p>',false,1), ($1,$2,'<div>',false,2) returning id, is_correct`,
    [S.tenantA, S.qMcq]);
  S.optRight = opts.find((o) => o.is_correct).id;
  S.optWrong = opts.find((o) => !o.is_correct).id;
  S.qBlank = await q("fill_blank", "HTML stands for Hyper___ Markup ___", { pos: 1, points: 2,
    config: { blanks: 2 }, key: { blanks: [["text"], ["language", "lang"]] } });
  S.qMatch = await q("matching", "Match tags", { pos: 2, points: 2,
    config: { left: [{ id: "l1", label: "<h1>" }, { id: "l2", label: "<img>" }], right: [{ id: "r1", label: "heading" }, { id: "r2", label: "image" }] },
    key: { pairs: { l1: "r1", l2: "r2" } } });
  S.qOrder = await q("ordering", "Order the document", { pos: 3,
    config: { items: [{ id: "a", label: "<html>" }, { id: "b", label: "<head>" }, { id: "c", label: "<body>" }] },
    key: { order: ["a", "b", "c"] } });
  S.qOpen = await q("open", "Explain semantic HTML", { pos: 4, points: 3 });

  await db.as(t,
    `insert into public.lesson_slides (tenant_id, lesson_id, position, kind, content) values
     ($1,$2,0,'title','{"heading":"HTML"}'), ($1,$2,1,'text','{"body":"Tags wrap content"}')`, [S.tenantA, S.lesson]);
  await db.as(t,
    `insert into public.lesson_slides (tenant_id, lesson_id, position, kind, activity_id) values ($1,$2,2,'activity',$3)`,
    [S.tenantA, S.lesson, S.quiz]);

  const pub = await db.rpc(t, "publish_lesson", { p_lesson: S.lesson });
  assert.equal(pub.version, 1);
  const copy = await db.rpc(t, "duplicate_lesson", { p_lesson: S.lesson });
  const [counts] = await db.as(t,
    `select (select count(*) from public.lesson_slides where lesson_id = $1)::int slides,
            (select count(*) from public.questions q join public.activities a on a.id = q.activity_id where a.lesson_id = $1)::int qs,
            (select count(*) from public.lesson_slides where lesson_id = $1 and activity_id is not null and activity_id <> $2)::int remapped`,
    [copy, S.quiz]);
  assert.deepEqual(counts, { slides: 3, qs: 5, remapped: 1 });

  // Students can never read answer keys.
  assert.equal((await db.as(S.stu1, "select * from public.questions")).length, 0);
  assert.equal((await db.as(S.stu1, "select * from public.question_options")).length, 0);
  // Other tenants cannot see the lesson at all.
  assert.equal((await db.as(S.adminB, "select * from public.lessons")).length, 0);
});

// ---------------------------------------------------------------------------
test("live session + auto-marking + review queue (§3.2, §3.4)", async () => {
  const s = await goLive(S.teacherA, { p_class: S.classA, p_lesson: S.lesson });
  S.session = s.id;
  await rejects(goLive(S.teacherA, { p_class: S.classA }), /already has a live session/);
  const joined = await db.rpc(S.stu1, "join_session", { p_code: s.join_code });
  assert.equal(joined.session_id, S.session);
  await rejects(db.rpc(S.adminB, "join_session", { p_code: s.join_code }), /another class|another school|profile|No live/);

  // Activity is not open until the teacher reaches it.
  await rejects(db.rpc(S.stu1, "start_attempt", { p_activity: S.quiz, p_session: S.session }), /not open/);
  await db.rpc(S.teacherA, "set_session_state", { p_session: S.session, p_activity: S.quiz });

  const att = await db.rpc(S.stu1, "start_attempt", { p_activity: S.quiz, p_session: S.session });
  S.attempt = att.attempt.id;
  assert.equal(att.questions.length, 5);
  const text = JSON.stringify(att.questions);
  assert.ok(!text.includes("is_correct") && !text.includes("answer_key"), "no secrets in payload");
  const order = att.questions.find((x) => x.id === S.qOrder);
  assert.equal(order.config.items.length, 3);

  const mcq = await db.rpc(S.stu1, "submit_answer", { p_attempt: S.attempt, p_question: S.qMcq, p_response: J({ option_id: S.optRight }) });
  assert.equal(mcq.is_correct, true);
  const blank = await db.rpc(S.stu1, "submit_answer", { p_attempt: S.attempt, p_question: S.qBlank, p_response: J({ blanks: [" Text ", "LANG"] }) });
  assert.equal(blank.is_correct, true);
  const match = await db.rpc(S.stu1, "submit_answer", { p_attempt: S.attempt, p_question: S.qMatch, p_response: J({ pairs: { l1: "r1", l2: "r1" } }) });
  assert.equal(match.is_correct, false);
  assert.equal(Number(match.score), 1);
  await db.rpc(S.stu1, "submit_answer", { p_attempt: S.attempt, p_question: S.qOrder, p_response: J({ order: ["a", "b", "c"] }) });
  const open = await db.rpc(S.stu1, "submit_answer", { p_attempt: S.attempt, p_question: S.qOpen, p_response: J({ text: "Meaningful tags" }) });
  assert.equal(open.status, "pending_review");
  await rejects(db.rpc(S.stu1, "submit_answer", { p_attempt: S.attempt, p_question: S.qMcq, p_response: J({ option_id: "nope" }) }), /Pick one/);
  await rejects(db.rpc(S.stu2, "submit_answer", { p_attempt: S.attempt, p_question: S.qMcq, p_response: J({ option_id: S.optRight }) }), /not found/);

  const fin = await db.rpc(S.stu1, "finish_attempt", { p_attempt: S.attempt });
  assert.equal(fin.attempt.status, "submitted");
  assert.equal(Number(fin.attempt.score), 1 + 2 + 1 + 1);
  assert.equal(Number(fin.attempt.max_score), 9);

  // Resume returns the same attempt; a second attempt is allowed (attempts_allowed = 2), a third is not.
  const a2 = await db.rpc(S.stu1, "start_attempt", { p_activity: S.quiz, p_session: S.session });
  assert.equal(a2.attempt.attempt_no, 2);
  const a2again = await db.rpc(S.stu1, "start_attempt", { p_activity: S.quiz, p_session: S.session });
  assert.equal(a2again.attempt.id, a2.attempt.id);
  await db.rpc(S.stu1, "finish_attempt", { p_attempt: a2.attempt.id });
  await rejects(db.rpc(S.stu1, "start_attempt", { p_activity: S.quiz, p_session: S.session }), /No attempts left/);

  // Teacher review queue → grade → attempt becomes graded.
  const queue = await db.rpc(S.teacherA, "review_queue", {});
  const item = queue.find((x) => x.question.id === S.qOpen);
  assert.ok(item);
  await rejects(db.rpc(S.teacherA, "review_answer", { p_answer: item.answer_id, p_score: 9 }), /between 0 and/);
  await db.rpc(S.teacherA, "review_answer", { p_answer: item.answer_id, p_score: 2, p_feedback: "Good start" });
  const [graded] = await db.as(S.stu1, "select status, score from public.quiz_attempts where id = $1", [S.attempt]);
  assert.deepEqual({ status: graded.status, score: Number(graded.score) }, { status: "graded", score: 7 });
  // Other students cannot see Ada's attempt; the teacher can.
  assert.equal((await db.as(S.stu2, "select * from public.quiz_attempts where student_id = $1", [S.stu1])).length, 0);
  assert.ok((await db.as(S.teacherA, "select * from public.quiz_attempts where student_id = $1", [S.stu1])).length >= 1);

  const results = await db.rpc(S.teacherA, "activity_results", { p_activity: S.quiz, p_session: S.session });
  const mcqStats = results.questions.find((x) => x.question_id === S.qMcq);
  assert.equal(mcqStats.correct, 1);
  await rejects(db.rpc(S.stu2, "activity_results", { p_activity: S.quiz, p_session: S.session }), /Not your session/);
});

// ---------------------------------------------------------------------------
test("game engine: scoring, anti-lag, visibility, badges (§3.3, §13)", async () => {
  const pts = await db.admin("select app.game_points(true, 1, true, true, 5000, 20000, 2) p");
  assert.deepEqual(pts[0].p, { base: 1000, speed: 375, streak: 200 });
  const none = await db.admin("select app.game_points(false, 1, true, true, 100, 20000, 4) p");
  assert.deepEqual(none[0].p, { base: 0, speed: 0, streak: 0 });
  const lag = await db.admin(
    "select app.normalize_elapsed(4000, 3000) a, app.normalize_elapsed(4000, 100) b, app.normalize_elapsed(4000, 9000) c, app.normalize_elapsed(4000, null) d");
  assert.deepEqual(lag[0], { a: 3000, b: 2500, c: 4000, d: 3750 });

  const g = await db.rpc(S.teacherA, "create_game", {
    p_class: S.classA, p_activity: S.quiz, p_settings: J({ rank_visibility: "end_only", question_seconds: 20 }) });
  S.game = g.id;
  assert.equal(g.question_order.length, 1, "only MCQ-style questions are playable");
  await db.rpc(S.stu1, "join_game", { p_code: g.join_code });
  await db.rpc(S.stu2, "join_game", { p_code: g.join_code });
  await rejects(db.rpc(S.adminB, "join_game", { p_code: g.join_code }), /another class|profile/);
  await rejects(db.rpc(S.stu1, "game_control", { p_game: S.game, p_action: "start" }), /Only the host/);
  await db.rpc(S.teacherA, "game_control", { p_game: S.game, p_action: "start" });

  const st = await db.rpc(S.stu1, "game_state", { p_game: S.game });
  assert.equal(st.status, "question");
  assert.ok(!JSON.stringify(st.question).includes("is_correct"));
  await db.rpc(S.stu1, "game_answer", { p_game: S.game, p_index: 0, p_choice: J({ option_id: S.optRight }), p_client_elapsed_ms: 1200 });
  await rejects(db.rpc(S.stu1, "game_answer", { p_game: S.game, p_index: 0, p_choice: J({ option_id: S.optRight }) }), /already answered/);

  const hidden = await db.rpc(S.stu2, "game_leaderboard", { p_game: S.game });
  assert.equal(hidden.visible, false);
  assert.equal(hidden.top.length, 0);
  assert.ok(hidden.me, "students always see their own position");
  await db.rpc(S.stu2, "game_answer", { p_game: S.game, p_index: 0, p_choice: J({ option_id: S.optWrong }) });
  const review = await db.rpc(S.stu2, "game_state", { p_game: S.game });
  assert.equal(review.status, "review", "closes once everyone answered");
  assert.equal(review.me.last.is_correct, false);
  assert.ok(review.review.correct_option_ids.includes(S.optRight));

  await db.rpc(S.teacherA, "game_control", { p_game: S.game, p_action: "next" });
  const board = await db.rpc(S.stu2, "game_leaderboard", { p_game: S.game });
  assert.equal(board.status, "ended");
  assert.equal(board.visible, true);
  assert.equal(board.top[0].name, "Ada L.");
  assert.ok(board.top[0].badges.includes("gold") && board.top[0].badges.includes("perfect"));
  assert.ok(board.top[0].score >= 1000);
  // Students can't read other players' rows directly.
  assert.equal((await db.as(S.stu2, "select * from public.game_players")).length, 1);
});

// ---------------------------------------------------------------------------
test("policy engine is deterministic and label-aware (§14)", async () => {
  const hosts = await db.admin(`select app.url_host('https://www.Example.com:8443/a?b') a, app.url_host('chrome://newtab') b,
                                       app.url_host('http://user@docs.google.com/x') c`);
  assert.deepEqual(hosts[0], { a: "example.com", b: null, c: "docs.google.com" });
  const m = await db.admin(`select app.domain_matches('mail.example.com','example.com') a, app.domain_matches('badexample.com','example.com') b,
                                   app.domain_matches('example.com','https://www.example.com/path') c, app.domain_matches('x.com','*.x.com') d`);
  assert.deepEqual(m[0], { a: true, b: false, c: true, d: true });

  const [pol] = await db.as(S.teacherA,
    `insert into public.environment_policies (tenant_id, owner_id, name, allowed_domains, blocked_domains, blocked_categories, lesson_url, focus_mode, grace_seconds, subject)
     values ($1, $2, 'HTML Lesson Environment', '{w3schools.com, developer.mozilla.org}', '{tiktok.com}', '{games}', 'https://lesson.school.com/html', false, 15, 'ICT')
     returning id`, [S.tenantA, S.teacherA]);
  S.policy = pol.id;
  const ev = async (url, tabs = 1) => (await db.admin(
    "select app.evaluate_url(p, $2, $3, 'swiftcipher.app') r from public.environment_policies p where id = $1", [S.policy, url, tabs]))[0].r;
  assert.equal((await ev("https://developer.mozilla.org/en-US/docs/Web/HTML")).verdict, "allowed");
  assert.equal((await ev("https://lesson.school.com/html/1")).verdict, "allowed");
  assert.equal((await ev("https://swiftcipher.app/student/live/1")).verdict, "allowed");
  const tt = await ev("https://www.tiktok.com/@x");
  assert.deepEqual([tt.verdict, tt.kind, tt.severity], ["violation", "domain_blocked", "critical"]);
  const game = await ev("https://www.roblox.com/games");
  assert.deepEqual([game.verdict, game.rule], ["violation", "Blocked category: games"]);
  const yt = await ev("https://youtube.com/watch?v=1");
  assert.equal(yt.verdict, "off_task");
  assert.equal((await ev("https://news.example.org")).verdict, "warning");
  assert.equal((await ev("chrome://newtab")).verdict, "neutral");
  await db.as(S.teacherA, "update public.environment_policies set focus_mode = true where id = $1", [S.policy]);
  assert.equal((await ev("https://news.example.org")).verdict, "violation");
  await db.as(S.teacherA, "update public.environment_policies set focus_mode = false where id = $1", [S.policy]);
});

// ---------------------------------------------------------------------------
test("device agent: pairing, telemetry, grace period, dedup, commands (§3.5, §3.6, §21)", async () => {
  await rejects(db.rpc(S.teacherA, "create_pairing_code", {}), /Only student devices/);
  const pc = await db.rpc(S.stu2, "create_pairing_code", {});
  const pair = await db.rpc(null, "device_pair", { p_code: pc.code, p_label: "Chromebook 12", p_os: "ChromeOS", p_browser: "Chrome", p_version: "1.0.0" });
  S.dev = pair.device_id; S.secret = pair.secret;
  assert.equal(pair.secret.length, 64);
  await rejects(db.rpc(null, "device_pair", { p_code: pc.code, p_label: "again" }), /invalid or expired/);
  await rejects(db.rpc(null, "device_heartbeat", { p_device: S.dev, p_secret: "wrong" }), /Invalid device credentials/);
  // Nobody can read the secret hash.
  await rejects(db.as(S.itA, "select secret_hash from public.devices"), /permission denied/);
  assert.equal((await db.as(S.itA, "select id from public.devices")).length, 1);
  // Anonymous clients cannot read devices at all.
  await rejects(db.anon("select id from public.devices"), /permission denied/);

  // Student 3 has no device; session is live (from earlier test) but no environment yet.
  const hb0 = await db.rpc(null, "device_heartbeat", { p_device: S.dev, p_secret: S.secret, p_url: "https://youtube.com/x", p_app_host: "swiftcipher.app" });
  assert.equal(hb0.state, "active");
  assert.equal(hb0.verdict, "allowed", "no environment active yet");

  await db.rpc(S.teacherA, "start_environment", { p_session: S.session, p_policy: S.policy });
  const hb1 = await db.rpc(null, "device_heartbeat", { p_device: S.dev, p_secret: S.secret, p_url: "https://www.tiktok.com/", p_tab_count: 3, p_app_host: "swiftcipher.app" });
  assert.equal(hb1.verdict, "violation");
  assert.match(hb1.notice, /return to the lesson/);
  let events = await db.as(S.teacherA, "select * from public.environment_events where class_session_id = $1 and kind = 'domain_blocked'", [S.session]);
  assert.equal(events.length, 0, "grace period suppresses the first report");

  await db.admin("update public.browser_sessions set violation_since = now() - interval '20 seconds' where device_id = $1", [S.dev]);
  await db.rpc(null, "device_heartbeat", { p_device: S.dev, p_secret: S.secret, p_url: "https://www.tiktok.com/", p_app_host: "swiftcipher.app" });
  await db.rpc(null, "device_heartbeat", { p_device: S.dev, p_secret: S.secret, p_url: "https://www.tiktok.com/", p_app_host: "swiftcipher.app" });
  events = await db.as(S.teacherA, "select * from public.environment_events where class_session_id = $1 and kind = 'domain_blocked'", [S.session]);
  assert.equal(events.length, 1, "deduplicated");
  assert.equal(events[0].rule, "Blocked domain: tiktok.com");
  assert.equal((await db.as(S.stu1, "select * from public.environment_events")).length, 0, "other students can't see it");
  const tnotes = await db.as(S.teacherA, "select kind from public.notifications where kind = 'domain_blocked'");
  assert.equal(tnotes.length, 1);

  // Student returns → event resolved + teacher told.
  await db.rpc(null, "device_heartbeat", { p_device: S.dev, p_secret: S.secret, p_url: "https://developer.mozilla.org/", p_app_host: "swiftcipher.app" });
  const [resolved] = await db.as(S.teacherA, "select resolved_at from public.environment_events where id = $1", [events[0].id]);
  assert.ok(resolved.resolved_at);
  assert.equal((await db.as(S.teacherA, "select 1 from public.notifications where kind = 'student_returned'")).length, 1);

  // Off-task alert with confidence; dismissing lowers future confidence.
  await db.rpc(null, "device_heartbeat", { p_device: S.dev, p_secret: S.secret, p_url: "https://youtube.com/watch", p_app_host: "swiftcipher.app" });
  const [ot] = await db.as(S.teacherA, "select * from public.environment_events where kind = 'off_task' and resolved_at is null");
  assert.equal(Number(ot.confidence), 0.7);
  await db.rpc(S.teacherA, "handle_environment_event", { p_event: ot.id, p_action: "dismiss" });
  const [fb] = await db.as(S.teacherA, "select dismissals from public.off_task_feedback where domain = 'youtube.com'");
  assert.equal(fb.dismissals, 1);

  // Commands: queue → deliver on heartbeat → ack.
  await rejects(db.rpc(S.teacherA, "issue_command", { p_session: S.session, p_students: `{${S.stu2}}`, p_kind: "redirect", p_payload: J({ url: "javascript:alert(1)" }) }), /http/);
  const cmd = await db.rpc(S.teacherA, "issue_command", { p_session: S.session, p_students: `{${S.stu2},${S.stu3}}`, p_kind: "redirect", p_payload: J({ url: "https://lesson.school.com/html" }) });
  assert.equal(cmd.queued, 1);
  assert.deepEqual(cmd.results.map((r) => r.result).sort(), ["no_device", "queued"]);
  const hb2 = await db.rpc(null, "device_heartbeat", { p_device: S.dev, p_secret: S.secret, p_url: "https://developer.mozilla.org/", p_app_host: "swiftcipher.app" });
  assert.equal(hb2.commands.length, 1);
  await db.rpc(null, "device_command_ack", { p_device: S.dev, p_secret: S.secret, p_command: hb2.commands[0].id, p_ok: true });
  const [acked] = await db.as(S.teacherA, "select status from public.teacher_commands where id = $1", [hb2.commands[0].id]);
  assert.equal(acked.status, "acked");
  const audit = await db.as(S.adminA, "select 1 from public.audit_logs where action = 'command.redirect'");
  assert.equal(audit.length, 1, "every device command is audited");

  // Snapshots: size limit + rate limit + teacher-only visibility.
  const img = "data:image/jpeg;base64," + "A".repeat(1000);
  assert.equal((await db.rpc(null, "device_snapshot", { p_device: S.dev, p_secret: S.secret, p_image: img })).stored, true);
  assert.equal((await db.rpc(null, "device_snapshot", { p_device: S.dev, p_secret: S.secret, p_image: img })).stored, false);
  await rejects(db.rpc(null, "device_snapshot", { p_device: S.dev, p_secret: S.secret, p_image: "data:image/png;base64," + "A".repeat(400001) }), /400 KB/);
  const screens = await db.rpc(S.teacherA, "session_screens", { p_session: S.session });
  assert.equal(screens.length, 1);
  assert.equal(screens[0].stale, false);
  assert.equal((await db.as(S.stu1, "select * from public.screen_snapshots")).length, 0);
  await rejects(db.rpc(S.stu1, "session_screens", { p_session: S.session }), /not found/);

  // Spotlight: the student is told; class sees an anonymised frame.
  await db.rpc(S.teacherA, "spotlight_start", { p_session: S.session, p_student: S.stu2, p_anonymized: true, p_show_to_class: true });
  assert.equal((await db.as(S.stu2, "select 1 from public.notifications where kind = 'spotlight'")).length, 1);
  const view = await db.rpc(S.stu1, "spotlight_view", { p_session: S.session });
  assert.equal(view.student, "A classmate");
  const hb3 = await db.rpc(null, "device_heartbeat", { p_device: S.dev, p_secret: S.secret, p_url: "https://developer.mozilla.org/", p_app_host: "swiftcipher.app" });
  assert.equal(hb3.capture.high_quality, true);
  await db.rpc(S.teacherA, "spotlight_stop", { p_session: S.session });

  // Silent device → "connection lost", never a violation (§3.6, §30).
  await db.admin("update public.browser_sessions set last_heartbeat_at = now() - interval '2 minutes' where device_id = $1", [S.dev]);
  const state = await db.rpc(S.teacherA, "teacher_session_state", { p_session: S.session });
  const lost = state.alerts.find((a) => a.kind === "connection_lost");
  assert.ok(lost);
  assert.equal(lost.severity, "info");
  const ada = state.roster.find((r) => r.student_id === S.stu2);
  assert.equal(ada.device.online, false);
  await db.rpc(null, "device_heartbeat", { p_device: S.dev, p_secret: S.secret, p_url: "https://developer.mozilla.org/", p_app_host: "swiftcipher.app" });
  const [re] = await db.as(S.teacherA, "select resolved_at from public.environment_events where id = $1", [lost.id]);
  assert.ok(re.resolved_at, "reconnect resolves connection-lost");

  // IT admin disables the device remotely.
  await rejects(db.rpc(S.teacherA, "device_set_status", { p_device: S.dev, p_status: "disabled" }), /IT administrators/);
  await db.rpc(S.itA, "device_set_status", { p_device: S.dev, p_status: "disabled" });
  await rejects(db.rpc(null, "device_heartbeat", { p_device: S.dev, p_secret: S.secret }), /disabled/);
  await db.rpc(S.itA, "device_set_status", { p_device: S.dev, p_status: "active" });
});

// ---------------------------------------------------------------------------
test("webrtc signalling, share links, audit triggers", async () => {
  const room = await db.rpc(S.teacherA, "rtc_open_room", { p_session: S.session, p_purpose: "screen_share" });
  const host = await db.rpc(S.teacherA, "rtc_join", { p_room: room });
  const stu = await db.rpc(S.stu1, "rtc_join", { p_room: room });
  assert.equal(stu.role, "participant");
  await rejects(db.rpc(S.adminB, "rtc_join", { p_room: room }), /closed|Not your|profile/);
  await db.rpc(S.teacherA, "rtc_signal", { p_room: room, p_to_peer: stu.peer_id, p_kind: "offer", p_payload: J({ sdp: { type: "offer", sdp: "v=0" } }) });
  const poll = await db.rpc(S.stu1, "rtc_poll", { p_room: room, p_after: 0 });
  assert.equal(poll.signals.length, 1);
  assert.equal(poll.signals[0].from, host.peer_id);
  assert.equal((await db.rpc(S.stu2, "rtc_poll", { p_room: room, p_after: 0 }).catch((e) => e.message)).includes("Join the room"), true);
  // Students cannot read signals addressed to others.
  assert.equal((await db.as(S.stu2, "select * from public.rtc_signals")).length, 0);
  await db.rpc(S.teacherA, "rtc_close", { p_room: room });

  const share = await db.rpc(S.teacherA, "create_lesson_share", { p_lesson: S.lesson, p_hours: 24, p_class: S.classA });
  const opened = await db.rpc(S.stu2, "open_lesson_share", { p_code: share.code });
  assert.equal(opened.slides.length, 3);
  assert.ok(!JSON.stringify(opened).includes("answer_key"));
  await rejects(db.rpc(S.adminB, "open_lesson_share", { p_code: share.code }), /invalid or has expired|profile/);

  const audit = await db.as(S.adminA, "select action from public.audit_logs where action like 'environment_policies.%'");
  assert.ok(audit.length >= 2, "environment policy changes are audited");
});

// ---------------------------------------------------------------------------
test("chat, hands, announcements, end of session, reports (§3.4, §17)", async () => {
  const thread = await db.rpc(S.stu1, "open_direct_thread", { p_class: S.classA });
  await db.rpc(S.stu1, "send_message", { p_thread: thread, p_body: "Can I get help?" });
  assert.equal((await db.as(S.teacherA, "select * from public.chat_messages where thread_id = $1", [thread])).length, 1);
  assert.equal((await db.as(S.stu2, "select * from public.chat_messages where thread_id = $1", [thread])).length, 0);
  await rejects(db.rpc(S.stu2, "send_message", { p_thread: thread, p_body: "hi" }), /Not your conversation/);
  await rejects(db.rpc(S.stu1, "open_group_thread", { p_session: S.session }), /Group chat is off/);
  await rejects(db.rpc(S.teacherA, "set_session_state", { p_session: S.session, p_group_chat: true }), /disabled by your school/);

  await db.as(S.stu1, "insert into public.raise_hands (tenant_id, session_id, student_id, message) values ($1,$2,$3,'stuck')",
    [S.tenantA, S.session, S.stu1]);
  await rejects(db.as(S.stu1, "insert into public.raise_hands (tenant_id, session_id, student_id) values ($1,$2,$3)",
    [S.tenantA, S.session, S.stu1]), /duplicate|unique/);
  await rejects(db.as(S.stu2, "insert into public.announcements (tenant_id, class_id, session_id, author_id, body) values ($1,$2,$3,$4,'hi')",
    [S.tenantA, S.classA, S.session, S.stu2]), /row-level security/);
  await db.as(S.teacherA, "insert into public.announcements (tenant_id, class_id, session_id, author_id, body) values ($1,$2,$3,$4,'Open slide 3')",
    [S.tenantA, S.classA, S.session, S.teacherA]);
  const st = await db.rpc(S.stu1, "session_student_state", { p_session: S.session });
  assert.equal(st.announcements.length, 1);
  assert.ok(st.hand);

  const ended = await db.rpc(S.teacherA, "end_session", { p_session: S.session });
  assert.ok(ended.report_id);
  // Attendance registers are retired (live engine, increment 1): ending writes none.
  assert.equal((await db.admin("select count(*)::int n from public.attendance where session_id = $1", [S.session]))[0].n, 0);
  const [rep] = await db.as(S.teacherA, "select payload from public.reports where id = $1", [ended.report_id]);
  assert.equal(rep.payload.enrolled, 3);
  // After the session, the device goes quiet (privacy boundary).
  const idle = await db.rpc(null, "device_heartbeat", { p_device: S.dev, p_secret: S.secret, p_url: "https://tiktok.com" });
  assert.equal(idle.state, "idle");
});

test("assignments, rubric grading, release (§23)", async () => {
  const [asg] = await db.as(S.teacherA,
    `insert into public.assignments (tenant_id, class_id, title, points_possible, max_resubmissions, created_by, due_at, allow_late)
     values ($1,$2,'Build a web page',10,1,$3, now() - interval '1 day', true) returning id`, [S.tenantA, S.classA, S.teacherA]);
  const sub = await db.rpc(S.stu1, "submit_assignment", { p_assignment: asg.id, p_body: "https://example.com/my-page" });
  assert.equal(sub.is_late, true);
  await db.rpc(S.stu1, "submit_assignment", { p_assignment: asg.id, p_body: "v2" });
  await rejects(db.rpc(S.stu1, "submit_assignment", { p_assignment: asg.id, p_body: "v3" }), /No resubmissions/);
  await rejects(db.rpc(S.stu1, "submit_assignment", { p_assignment: asg.id, p_files: J([{ path: "other/x.pdf" }]) }), /Invalid attachment|No resubmissions/);
  await db.rpc(S.teacherA, "grade_submission", { p_submission: sub.id, p_score: 8, p_feedback: "Nice" });
  assert.equal((await db.as(S.stu1, "select * from public.grades")).length, 0, "unreleased grades are hidden");
  assert.equal(await db.rpc(S.teacherA, "release_grades", { p_assignment: asg.id }), 1);
  assert.equal((await db.as(S.stu1, "select * from public.grades")).length, 1);
});

test("insights, parent portal, privacy, retention (§18, §20)", async () => {
  const ca = await db.rpc(S.teacherA, "class_analytics", { p_class: S.classA, p_days: 30 });
  assert.equal(ca.students, 3);
  assert.equal(ca.sessions, 1);
  assert.ok(Array.isArray(ca.per_student));
  await rejects(db.rpc(S.stu1, "class_analytics", { p_class: S.classA }), /Not your class/);
  const ov = await db.rpc(S.adminA, "tenant_overview", {});
  assert.equal(ov.students, 3);
  await rejects(db.rpc(S.teacherA, "tenant_overview", {}), /Administrators only/);
  const usage = await db.rpc(S.adminA, "usage_metrics", {});
  assert.equal(usage.managed_devices, 1);

  const kids = await db.rpc(S.parentA, "parent_children", {});
  assert.equal(kids.length, 1);
  const summary = await db.rpc(S.parentA, "student_summary", { p_student: S.stu1 });
  await rejects(db.rpc(S.parentA, "student_summary", { p_student: S.stu2 }), /Not available/);

  const exp = await db.rpc(S.adminA, "export_user_data", { p_user: S.stu1 });
  assert.ok(exp.attempts.length >= 1);
  await rejects(db.rpc(S.teacherA, "export_user_data", { p_user: S.stu1 }), /Administrators only/);

  const ret = await db.rpc(S.adminA, "apply_retention", {});
  assert.equal(typeof ret.browser_events, "number");
  await rejects(db.rpc(S.adminA, "billing_apply_subscription", {
    p_tenant: S.tenantA, p_plan: "enterprise", p_status: "active", p_provider: "stripe", p_ref: "x", p_period_end: null }), /permission denied/);

  await db.rpc(S.adminA, "delete_user_data", { p_user: S.stu3 });
  assert.equal((await db.as(S.adminA, "select * from public.users where id = $1", [S.stu3])).length, 0);
});

// ---------------------------------------------------------------------------
test("platform super admin: singleton, invisible, cross-tenant control", async () => {
  S.superA = await db.signUp("owner@platform.test", "Platform Owner");
  await db.admin("insert into public.platform_admins (user_id) values ($1)", [S.superA]);
  await rejects(db.admin("insert into public.platform_admins (user_id) values ($1)", [S.adminB]), /duplicate|unique/);

  // Nobody can see or grant it.
  await rejects(db.as(S.adminA, "select * from public.platform_admins"), /permission denied/);
  await rejects(db.as(S.adminA, "insert into public.platform_admins (user_id) values ($1)", [S.adminA]), /permission denied/);
  assert.equal(await db.rpc(S.adminA, "am_super_admin"), false);
  assert.equal(await db.rpc(S.superA, "am_super_admin"), true);
  await rejects(db.rpc(S.adminA, "sa_overview"), /Not found/);
  await rejects(db.rpc(S.teacherA, "sa_list_tenants"), /Not found/);
  await rejects(db.as(S.adminA, "select * from public.platform_audit"), /permission denied/);
  await rejects(db.rpc(S.adminA, "admin_set_user_role", { p_user: S.teacherA, p_role: "platform_admin" }), /Unknown role/);

  const ov = await db.rpc(S.superA, "sa_overview");
  assert.equal(ov.tenants, 2);
  const list = await db.rpc(S.superA, "sa_list_tenants", {});
  assert.deepEqual(list.rows.map((t) => t.name).sort(), ["Alpha Academy", "Beta School"]);
  assert.equal(list.next_cursor, null);
  // Keyset pages: one school per page, the cursor walks to the other, then stops.
  const p1 = await db.rpc(S.superA, "sa_list_tenants", { p_limit: 1 });
  const p2 = await db.rpc(S.superA, "sa_list_tenants", { p_limit: 1, p_cursor: p1.next_cursor });
  assert.equal(p1.rows.length, 1); assert.equal(p2.rows.length, 1);
  assert.notEqual(p1.rows[0].id, p2.rows[0].id);
  assert.equal(p2.next_cursor, null);
  assert.equal((await db.rpc(S.superA, "sa_list_tenants", { p_search: "beta" })).rows[0].name, "Beta School");
  const users = await db.rpc(S.superA, "sa_list_users", { p_limit: 2 });
  assert.equal(users.rows.length, 2);
  assert.ok(users.next_cursor);
  const more = await db.rpc(S.superA, "sa_list_users", { p_limit: 2, p_cursor: users.next_cursor });
  assert.ok(!more.rows.some((u) => users.rows.some((v) => v.id === u.id)), "pages don't overlap");

  // Suspend a school: everyone in it is locked out, devices stop.
  await db.rpc(S.superA, "sa_set_tenant_status", { p_tenant: S.tenantB, p_status: "suspended", p_reason: "unpaid" });
  await rejects(db.rpc(S.adminB, "create_class", { p_name: "X" }), /suspended/);
  assert.equal((await db.as(S.adminB, "select * from public.tenants")).length, 0);
  await db.rpc(S.superA, "sa_set_tenant_status", { p_tenant: S.tenantB, p_status: "active" });
  assert.ok((await db.rpc(S.adminB, "create_class", { p_name: "Back" })).id);

  // Users anywhere.
  await db.rpc(S.superA, "sa_set_user_status", { p_user: S.stu2, p_status: "suspended" });
  await rejects(db.rpc(S.stu2, "student_home"), /active SwiftCipher profile/);
  await db.rpc(S.superA, "sa_set_user_status", { p_user: S.stu2, p_status: "active" });
  await db.rpc(S.superA, "sa_set_user_role", { p_user: S.itA, p_role: "teacher" });
  assert.equal((await db.admin("select role from public.users where id = $1", [S.itA]))[0].role, "teacher");

  // Any school's settings, within the same limits a school admin has (0850).
  const [before] = await db.admin("select s.parent_portal_enabled, s.default_grace_seconds, s.brand_name, t.timezone from public.tenant_settings s join public.tenants t on t.id = s.tenant_id where s.tenant_id = $1", [S.tenantA]);
  const st = await db.rpc(S.superA, "sa_update_tenant_settings", { p_tenant: S.tenantA,
    p_changes: { parent_portal_enabled: !before.parent_portal_enabled, default_grace_seconds: 30, brand_name: "Alpha Academy", timezone: "Africa/Lagos" } });
  assert.equal(st.default_grace_seconds, 30);
  assert.equal(st.timezone, "Africa/Lagos");
  assert.equal((await db.as(S.adminA, "select parent_portal_enabled from public.tenant_settings"))[0].parent_portal_enabled, !before.parent_portal_enabled);
  await rejects(db.rpc(S.superA, "sa_update_tenant_settings", { p_tenant: S.tenantA, p_changes: { support_access_until: "2030-01-01" } }), /can't be changed here/);
  await rejects(db.rpc(S.superA, "sa_update_tenant_settings", { p_tenant: S.tenantA, p_changes: { default_grace_seconds: 9999 } }), /check constraint/);
  await rejects(db.rpc(S.superA, "sa_update_tenant_settings", { p_tenant: S.tenantA, p_changes: { timezone: "Mars/Base" } }), /Unknown time zone/);
  await rejects(db.rpc(S.adminA, "sa_update_tenant_settings", { p_tenant: S.tenantA, p_changes: { default_grace_seconds: 20 } }), /Not found/);
  await rejects(db.rpc(S.adminA, "sa_update_tenant_settings", { p_tenant: S.tenantB, p_changes: { parent_portal_enabled: true } }), /Not found/);
  // The school's log shows the change as a platform action, never who made it.
  const named = await db.admin("select count(*)::int n from public.audit_logs where tenant_id = $1 and actor_id = $2", [S.tenantA, S.superA]);
  assert.equal(named[0].n, 0);
  assert.ok((await db.as(S.adminA, "select 1 from public.audit_logs where action = 'platform.settings.updated'")).length >= 1);
  await db.rpc(S.superA, "sa_update_tenant_settings", { p_tenant: S.tenantA, p_changes: {
    parent_portal_enabled: before.parent_portal_enabled, default_grace_seconds: before.default_grace_seconds, brand_name: before.brand_name ?? "", timezone: before.timezone } });

  // Tenant audit shows the platform action without revealing who.
  const tAudit = await db.as(S.adminA, "select actor_id, action from public.audit_logs where action like 'platform.%'");
  assert.ok(tAudit.length >= 2);
  assert.ok(tAudit.every((r) => r.actor_id === null));
  assert.ok((await db.rpc(S.superA, "sa_audit", {})).length >= 5);

  // Create a school with an admin invite; delete requires the exact name.
  const created = await db.rpc(S.superA, "sa_create_tenant", { p_name: "Gamma College", p_plan: "school", p_admin_email: "head@gamma.test" });
  const head = await db.signUp("head@gamma.test", "Gamma Head");
  assert.equal((await db.rpc(head, "redeem_code", { p_code: created.admin_invite_code })).role, "school_admin");
  const detail = await db.rpc(S.superA, "sa_tenant_detail", { p_tenant: created.tenant_id });
  assert.equal(detail.users.length, 1);
  await rejects(db.rpc(S.superA, "sa_delete_tenant", { p_tenant: created.tenant_id, p_confirm_name: "gamma" }), /exactly/);
  const removed = await db.rpc(S.superA, "sa_delete_tenant", { p_tenant: created.tenant_id, p_confirm_name: "Gamma College" });
  assert.deepEqual(removed, [head]);
  assert.equal((await db.admin("select count(*)::int n from public.tenants where id = $1", [created.tenant_id]))[0].n, 0);
});

test("school branding: admins only, logo must stay in the school's folder", async () => {
  await db.as(S.adminA, "update public.tenant_settings set brand_name = 'Alpha', brand_primary = '#0f766e', welcome_message = 'Welcome!'");
  const [s] = await db.as(S.teacherA, "select brand_name, brand_primary from public.tenant_settings");
  assert.deepEqual(s, { brand_name: "Alpha", brand_primary: "#0f766e" });
  const n = await db.as(S.teacherA, "update public.tenant_settings set brand_name = 'Hacked' returning 1");
  assert.equal(n.length, 0, "teachers cannot change branding");
  await rejects(db.as(S.adminA, "update public.tenant_settings set brand_primary = 'red'"), /check constraint/);
  await rejects(db.as(S.adminA, "update public.tenant_settings set brand_logo_path = $1", [`${S.tenantB}/x.png`]), /check constraint/);
  assert.equal((await db.as(S.adminB, "select brand_name from public.tenant_settings"))[0].brand_name, null, "other schools unaffected");
});

test("web classroom: screen sharing, lockdown, leave alerts with the screen", async () => {
  const s = await goLive(S.teacherA, { p_class: S.classA });
  await db.rpc(S.stu1, "join_session", { p_code: s.join_code });
  await db.rpc(S.stu2, "join_session", { p_code: s.join_code });
  const frame = "data:image/jpeg;base64,AAAA";

  // Just joined, still on the setup screen: not "away" for the first 2 minutes...
  const setup = await db.rpc(S.stu2, "student_report", { p_session: s.id, p_visible: true, p_fullscreen: false, p_sharing: false });
  assert.equal(setup.away, false);
  assert.equal(setup.setting_up, true);
  // ...but never starting the lesson counts once that window has passed.
  await db.admin("update public.session_participants set joined_at = now() - interval '3 minutes' where session_id = $1 and user_id = $2", [s.id, S.stu2]);
  const late = await db.rpc(S.stu2, "student_report", { p_session: s.id, p_visible: true, p_fullscreen: false, p_sharing: false });
  assert.equal(late.away, true);
  assert.match(late.reason, /Did not start the lesson/);

  const ok = await db.rpc(S.stu1, "student_report", { p_session: s.id, p_visible: true, p_fullscreen: true, p_sharing: true, p_surface: "monitor" });
  assert.equal(ok.lockdown, true, "lockdown is on by default");
  assert.equal(ok.away, false);
  assert.equal(ok.capture.enabled, true);
  assert.equal((await db.rpc(S.stu1, "student_screen_frame", { p_session: s.id, p_image: frame, p_width: 480, p_height: 270 })).stored, true);
  assert.equal((await db.rpc(S.stu1, "student_screen_frame", { p_session: s.id, p_image: frame })).stored, false, "rate limited");
  const screens = await db.rpc(S.teacherA, "session_screens", { p_session: s.id });
  assert.equal(screens.length, 1);
  assert.equal(screens[0].source, "web");
  let st = await db.rpc(S.teacherA, "teacher_session_state", { p_session: s.id });
  assert.equal(st.roster.find((r) => r.student_id === S.stu1).web.sharing, true);
  await rejects(db.rpc(S.adminB, "session_screens", { p_session: s.id }), /not found/);
  await rejects(db.rpc(S.adminB, "student_report", { p_session: s.id, p_visible: true, p_fullscreen: true, p_sharing: true }), /not found/);

  // Teacher opens Ada's screen: only a request flag for Ada, nobody else's view changes.
  await db.rpc(S.teacherA, "request_screenshot", { p_session: s.id, p_student: S.stu1 });
  assert.equal((await db.rpc(S.stu1, "student_report", { p_session: s.id, p_visible: true, p_fullscreen: true, p_sharing: true })).capture.high_quality, true);
  assert.equal((await db.rpc(S.stu2, "student_report", { p_session: s.id, p_visible: true, p_fullscreen: true, p_sharing: false, p_unsupported: true })).capture.high_quality, false);
  await db.rpc(S.teacherA, "spotlight_start", { p_session: s.id, p_student: S.stu1 });
  await rejects(db.rpc(S.teacherA, "spotlight_start", { p_session: s.id, p_student: S.stu2 }), /isn't sharing/);
  await db.rpc(S.teacherA, "spotlight_stop", { p_session: s.id });

  // Ada switches tab: away, but no alert inside the grace period.
  const away = await db.rpc(S.stu1, "student_report", { p_session: s.id, p_visible: false, p_fullscreen: false, p_sharing: true });
  assert.equal(away.away, true);
  st = await db.rpc(S.teacherA, "teacher_session_state", { p_session: s.id });
  assert.equal(st.alerts.length, 0, "grace period");
  await db.admin("update public.session_participants set away_since = now() - interval '1 minute' where session_id = $1 and user_id = $2", [s.id, S.stu1]);
  await db.admin("update public.tenant_settings set store_event_screenshots = true where tenant_id = $1", [S.tenantA]);
  st = await db.rpc(S.teacherA, "teacher_session_state", { p_session: s.id });
  assert.equal(st.alerts.length, 1);
  assert.equal(st.alerts[0].kind, "environment_left");
  assert.match(st.alerts[0].rule, /switched tab/);
  assert.equal(st.alerts[0].has_evidence, true, "last screen attached");
  const ev = await db.rpc(S.teacherA, "event_evidence", { p_event: st.alerts[0].id });
  assert.equal(ev.image, frame);
  await rejects(db.rpc(S.stu2, "event_evidence", { p_event: st.alerts[0].id }), /not found/);
  const notes = await db.as(S.teacherA, "select kind, title from public.notifications where kind = 'environment_left'");
  assert.ok(notes.some((n) => /Ada Lovelace left the class/.test(n.title)));
  // Only one alert while she stays away.
  await db.rpc(S.stu1, "student_report", { p_session: s.id, p_visible: false, p_fullscreen: false, p_sharing: true });
  assert.equal((await db.rpc(S.teacherA, "teacher_session_state", { p_session: s.id })).alerts.length, 1);

  // The teacher's own participant row going quiet is not a student leaving: no
  // "Mrs X left the class" alert to the teacher about themselves (0840).
  const teacherRow = [s.id, S.teacherA];
  assert.equal((await db.admin("select count(*)::int n from public.session_participants where session_id = $1 and user_id = $2", teacherRow))[0].n, 1);
  await db.admin("update public.session_participants set last_seen_at = now() - interval '10 minutes', joined_at = now() - interval '10 minutes' where session_id = $1 and user_id = $2", teacherRow);
  assert.equal((await db.rpc(S.teacherA, "teacher_session_state", { p_session: s.id })).alerts.length, 1);
  assert.equal((await db.admin("select count(*)::int n from public.environment_events where class_session_id = $1 and student_id = $2", teacherRow))[0].n, 0);

  // She comes back: alert resolves and the teacher is told.
  await db.rpc(S.stu1, "student_report", { p_session: s.id, p_visible: true, p_fullscreen: true, p_sharing: true });
  assert.equal((await db.admin("select count(*)::int n from public.environment_events where class_session_id = $1 and resolved_at is null", [s.id]))[0].n, 0);
  assert.ok((await db.as(S.teacherA, "select 1 from public.notifications where kind = 'student_returned'")).length >= 1);

  // Closing the lesson counts as leaving too.
  await db.rpc(S.stu1, "leave_session", { p_session: s.id });
  await db.admin("update public.session_participants set away_since = now() - interval '1 minute' where session_id = $1 and user_id = $2", [s.id, S.stu1]);
  st = await db.rpc(S.teacherA, "teacher_session_state", { p_session: s.id });
  assert.ok(st.alerts.some((a) => a.resolved_at === null && a.rule === "Closed the lesson"));

  // Lockdown off: nothing counts as leaving; only the teacher can switch it.
  await rejects(db.rpc(S.stu1, "set_session_lockdown", { p_session: s.id, p_on: false }), /Not your session/);
  await db.rpc(S.teacherA, "set_session_lockdown", { p_session: s.id, p_on: false });
  const free = await db.rpc(S.stu1, "student_report", { p_session: s.id, p_visible: false, p_fullscreen: false, p_sharing: false });
  assert.equal(free.away, false);
  assert.equal(free.lockdown, false);
  await db.rpc(S.teacherA, "end_session", { p_session: s.id });
});

test("operations: thumbnails deleted at session end, error log, health, maintenance, terms consent", async () => {
  // Live thumbnails go the moment a session ends.
  const s = await goLive(S.teacherA, { p_class: S.classA });
  await db.rpc(S.stu1, "join_session", { p_code: s.join_code });
  await db.rpc(S.stu1, "student_report", { p_session: s.id, p_visible: true, p_fullscreen: true, p_sharing: true });
  await db.rpc(S.stu1, "student_screen_frame", { p_session: s.id, p_image: "data:image/jpeg;base64,BBBB" });
  const count = async () => (await db.admin("select count(*)::int n from public.screen_snapshots where class_session_id = $1", [s.id]))[0].n;
  assert.equal(await count(), 1);
  await db.rpc(S.teacherA, "end_session", { p_session: s.id });
  assert.equal(await count(), 0);

  // Error log: anyone may report, repeats are counted, only the super admin reads.
  await db.rpc(null, "log_error", { p_source: "client", p_message: "TypeError: x is undefined", p_stack: "Error\n at a.js:1", p_url: "/login" });
  await db.rpc(S.stu1, "log_error", { p_source: "client", p_message: "TypeError: x is undefined", p_stack: "Error\n at a.js:1" });
  await rejects(db.anon("select * from public.error_events"), /permission denied/);
  await rejects(db.as(S.adminA, "select * from public.error_events"), /permission denied/);
  await rejects(db.rpc(S.adminA, "sa_errors", {}), /not found|super|permission/i);
  const errs = await db.rpc(S.superA, "sa_errors", {});
  assert.equal(errs.length, 1);
  assert.equal(errs[0].count, 2);
  await db.rpc(S.superA, "sa_resolve_error", { p_id: errs[0].id });
  assert.equal((await db.rpc(S.superA, "sa_errors", {})).length, 0);

  // Health for uptime monitors; maintenance only for the service role.
  assert.equal((await db.rpc(null, "health", {})).ok, true);
  await rejects(db.rpc(S.adminA, "run_maintenance", {}), /permission denied/);
  await db.admin("update public.class_sessions set started_at = now() - interval '13 hours' where id = $1", [s.id]);
  const stale = await goLive(S.teacherA, { p_class: S.classA });
  await db.admin("update public.class_sessions set started_at = now() - interval '13 hours' where id = $1", [stale.id]);
  await db.admin("update public.session_participants set last_seen_at = now() - interval '3 hours' where session_id = $1", [stale.id]);
  const m = (await db.admin("select app.run_maintenance() r"))[0].r;
  assert.equal(m.ok, true);
  // Ended either by maintenance or already, since its teacher hasn't been seen (1020).
  assert.equal((await db.admin("select status from public.class_sessions where id = $1", [stale.id]))[0].status, "ended");

  // Terms of service acceptance is recorded.
  await db.rpc(S.teacherA, "accept_notice", { p_kind: "terms_of_service" });
  assert.equal((await db.as(S.teacherA, "select 1 from public.consents where kind = 'terms_of_service'")).length, 1);
});

test("scale: indexes, push signals, write throttling, private channels, batched retention", async () => {
  // Every foreign key (incl. every tenant_id) is backed by an index.
  const unindexed = await db.admin(`
    select c.conrelid::regclass::text t, a.attname c from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and n.nspname = 'public' and c.confrelid not in ('public.plans'::regclass, 'public.roles'::regclass)
      and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])`);
  assert.deepEqual(unindexed, [], "foreign keys without an index");
  // postgres_changes is not used any more.
  assert.equal((await db.admin("select count(*)::int n from pg_publication_tables where pubname = 'supabase_realtime'"))[0].n, 0);

  const s = await goLive(S.teacherA, { p_class: S.classA });
  await db.rpc(S.stu1, "join_session", { p_code: s.join_code });
  await db.admin("delete from realtime.sent");
  const sent = async () => db.admin("select topic, event, payload from realtime.sent order by id");

  // Teacher moves the slide: students get a 'state' signal with the new version.
  const r0 = await db.rpc(S.stu1, "student_report", { p_session: s.id, p_visible: true, p_fullscreen: true, p_sharing: true });
  await db.rpc(S.teacherA, "set_session_state", { p_session: s.id, p_slide: 1 });
  let msgs = await sent();
  const st = msgs.find((m) => m.topic === `session:${s.id}` && m.event === "state");
  assert.ok(st, "session state signal");
  const r1 = await db.rpc(S.stu1, "student_report", { p_session: s.id, p_visible: true, p_fullscreen: true, p_sharing: true });
  assert.ok(r1.state_version > r0.state_version, "tick reports the new version");
  assert.equal(r1.current_slide, 1);

  // Raised hand and leave alert reach the teacher's staff channel; notifications reach the user.
  await db.admin("delete from realtime.sent");
  await db.as(S.stu1, "insert into public.raise_hands (tenant_id, session_id, student_id) values ($1,$2,$3)", [S.tenantA, s.id, S.stu1]);
  await db.rpc(S.stu1, "student_report", { p_session: s.id, p_visible: false, p_fullscreen: true, p_sharing: true });
  await db.admin("update public.session_participants set away_since = now() - interval '1 minute' where session_id = $1 and user_id = $2", [s.id, S.stu1]);
  await db.rpc(S.teacherA, "teacher_session_state", { p_session: s.id });
  msgs = await sent();
  for (const [topic, event] of [[`staff:${s.id}`, "hand"], [`staff:${s.id}`, "roster"], [`staff:${s.id}`, "alert"], [`user:${S.teacherA}`, "notification"]]) {
    assert.ok(msgs.some((m) => m.topic === topic && m.event === event), `${topic} ${event}`);
  }
  // Signals carry no personal data: "something changed", or (session state, 0880) only the
  // lesson position (version, phase, status, slide, activity, mode). Never a name.
  const STATE_KEYS = new Set(["v", "phase", "status", "slide", "activity", "mode"]);
  for (const m of msgs) {
    assert.ok(Object.keys(m.payload ?? {}).every((k) => STATE_KEYS.has(k)), `${m.topic} ${m.event}: ${JSON.stringify(m.payload)}`);
    assert.ok(JSON.stringify(m.payload).length < 220);
    assert.ok(!/Ada|Lovelace|Grace|Alan/.test(JSON.stringify(m.payload)));
  }
  await db.rpc(S.stu1, "student_report", { p_session: s.id, p_visible: true, p_fullscreen: true, p_sharing: true });

  // Presence ticks don't write when nothing changed (at most every 15 s).
  const seen = async () => (await db.admin("select last_seen_at::text t from public.session_participants where session_id = $1 and user_id = $2", [s.id, S.stu1]))[0].t;
  const before = await seen();
  await db.admin("delete from realtime.sent");
  await db.rpc(S.stu1, "student_report", { p_session: s.id, p_visible: true, p_fullscreen: true, p_sharing: true });
  assert.equal(await seen(), before, "no write for an unchanged tick");
  assert.equal((await sent()).length, 0, "no signal for an unchanged tick");
  await db.admin("update public.session_participants set last_seen_at = now() - interval '20 seconds' where session_id = $1 and user_id = $2", [s.id, S.stu1]);
  await db.rpc(S.stu1, "student_report", { p_session: s.id, p_visible: true, p_fullscreen: true, p_sharing: true });
  assert.notEqual(await seen(), before, "presence refreshed after 15 s");
  assert.equal((await sent()).length, 0, "a presence refresh is not broadcast");

  // Frames are only sent while a teacher has the live room open.
  await db.admin("update public.class_sessions set teacher_seen_at = null where id = $1", [s.id]);
  assert.equal((await db.rpc(S.stu1, "student_report", { p_session: s.id, p_visible: true, p_fullscreen: true, p_sharing: true })).capture.send, false);
  await db.rpc(S.teacherA, "teacher_session_state", { p_session: s.id });
  assert.equal((await db.rpc(S.stu1, "student_report", { p_session: s.id, p_visible: true, p_fullscreen: true, p_sharing: true })).capture.send, true);

  // Private channels: who may listen / send.
  const can = async (u, fn, topic) => (await db.as(u, `select app.${fn}($1) ok`, [topic]))[0].ok;
  assert.equal(await can(S.stu1, "can_listen", `session:${s.id}`), true);
  assert.equal(await can(S.stu1, "can_listen", `staff:${s.id}`), false);
  assert.equal(await can(S.stu1, "can_listen", `screen:${s.id}:${S.stu1}`), true, "a student may join their own screen channel (to send)");
  assert.equal(await can(S.stu1, "can_listen", `screen:${s.id}:${S.stu2}`), false, "students cannot watch other screens");
  assert.equal(await can(S.teacherA, "can_listen", `screen:${s.id}:${S.stu1}`), true);
  assert.equal(await can(S.teacherA, "can_listen", `staff:${s.id}`), true);
  assert.equal(await can(S.stu1, "can_send", `screen:${s.id}:${S.stu1}`), true);
  assert.equal(await can(S.stu1, "can_send", `screen:${s.id}:${S.stu2}`), false, "no sending as another student");
  assert.equal(await can(S.adminB, "can_listen", `session:${s.id}`), false, "other schools can't listen");
  assert.equal(await can(S.stu1, "can_listen", `user:${S.stu1}`), true);
  assert.equal(await can(S.stu1, "can_listen", `user:${S.teacherA}`), false);
  assert.equal(await can(S.stu1, "can_listen", "session:not-a-uuid"), false);
  await db.rpc(S.teacherA, "end_session", { p_session: s.id });
  assert.equal(await can(S.stu1, "can_send", `screen:${s.id}:${S.stu1}`), false, "no frames after the class ends");

  // Retention runs set-based across schools.
  await db.admin("update public.notifications set created_at = now() - interval '100 days' where tenant_id = $1", [S.tenantA]);
  await db.admin("select app.apply_retention_all()");
  assert.equal((await db.admin("select count(*)::int n from public.notifications where tenant_id = $1 and created_at < now() - interval '90 days'", [S.tenantA]))[0].n, 0);

  // Platform stats are cached for the console.
  const ov = await db.rpc(S.superA, "sa_overview");
  assert.ok(ov.stats_at && ov.users > 0);
});

test("realtime authorization: joining and sending on private channels, as Supabase checks it", async () => {
  const s = await goLive(S.teacherA, { p_class: S.classA });
  await db.rpc(S.stu1, "join_session", { p_code: s.join_code });
  // Realtime seeds a row per topic and checks a SELECT (join) / INSERT (send) under RLS.
  const join = async (user, topic) => {
    await db.admin("select set_config('realtime.topic', $1, false)", [topic]);
    await db.admin("insert into realtime.messages (topic, event) values ($1, 'probe')", [topic]);
    return (await db.as(user, "select count(*)::int n from realtime.messages where topic = $1", [topic]))[0].n > 0;
  };
  const send = async (user, topic) => {
    await db.admin("select set_config('realtime.topic', $1, false)", [topic]);
    try { await db.as(user, "insert into realtime.messages (topic, event, payload) values ($1, 'frame', '{}')", [topic]); return true; }
    catch (e) { if (/row-level security/.test(e.message)) return false; throw e; }
  };
  assert.equal(await join(S.stu1, `session:${s.id}`), true, "student joins their class channel");
  assert.equal(await join(S.stu1, `staff:${s.id}`), false, "student can't join the teacher channel");
  assert.equal(await join(S.teacherA, `staff:${s.id}`), true);
  assert.equal(await join(S.teacherA, `screen:${s.id}:${S.stu1}`), true, "teacher watches a student's screen");
  assert.equal(await join(S.stu2, `screen:${s.id}:${S.stu1}`), false, "classmates can't watch each other");
  assert.equal(await join(S.stu1, `screen:${s.id}:${S.stu1}`), true, "a student joins their own screen channel to stream");
  assert.equal(await join(S.adminB, `session:${s.id}`), false, "other schools can't join");
  assert.equal(await send(S.stu1, `screen:${s.id}:${S.stu1}`), true, "student streams their own screen");
  assert.equal(await send(S.stu1, `screen:${s.id}:${S.stu2}`), false, "no streaming as someone else");
  assert.equal(await send(S.stu1, `session:${s.id}`), false, "students can't broadcast to the class");
  assert.equal(await send(S.teacherA, `annot:${s.id}`), true, "teacher draws on the whiteboard channel");
  assert.equal(await send(S.stu1, `annot:${s.id}`), false);
  assert.equal(await join(S.stu1, `annot:${s.id}`), true, "class sees whiteboard strokes");
  assert.equal(await join(S.stu1, `user:${S.stu1}`), true);
  assert.equal(await join(S.stu1, `user:${S.teacherA}`), false, "no reading someone else's notifications");

  // Games: class members and teachers only (not the whole school).
  const [act] = await db.admin("select id from public.activities where tenant_id = $1 limit 1", [S.tenantA]);
  const [game] = await db.admin(`insert into public.game_sessions (tenant_id, class_id, host_id, activity_id, title, join_code)
    values ($1, $2, $3, $4, 'Signal game', 'SIG123') returning id`, [S.tenantA, S.classA, S.teacherA, act.id]);
  assert.equal(await join(S.stu1, `game:${game.id}`), true);
  const outsider = await db.signUp("outsider@a.test", "Other Student");
  const cls2 = await db.rpc(S.teacherA, "create_class", { p_name: "Other class" });
  await db.rpc(outsider, "redeem_code", { p_code: cls2.join_code });
  assert.equal(await join(outsider, `game:${game.id}`), false, "same school, different class: no game signals");
  await db.rpc(S.teacherA, "end_session", { p_session: s.id });
  assert.equal(await send(S.stu1, `screen:${s.id}:${S.stu1}`), false, "no streaming after the class ends");
});

test("anti-gaming: game sites and game copies are recognised; school sites are not", async () => {
  const cat = async (url) => (await db.admin("select app.url_category($1) c", [url]))[0].c;
  for (const url of [
    "https://www.roblox.com/games/123", "https://poki.com/en/g/subway-surfers", "https://krunker.io/", "https://1v1.lol/",
    "https://unblocked-games-66.github.io/slope", "https://sites.google.com/view/unblocked-games-premium/retro-bowl",
    "https://slope-games.io/", "https://retrobowl.me/", "https://now.gg/apps/roblox", "https://play.geforcenow.com/",
    "https://coolmath-games.com/0-run-3", "https://classroom6x.com/", "https://mygames.netlify.app/games/drift-hunters"
  ]) assert.equal(await cat(url), "games", url);
  for (const url of [
    "https://www.khanacademy.org/math", "https://docs.google.com/document/d/x", "https://sites.google.com/view/year8-maths-lessons",
    "https://en.wikipedia.org/wiki/Game_theory", "https://classroom.google.com/c/abc", "https://scratch.mit.edu/projects/1",
    "https://studentname.github.io/portfolio", "https://www.bbc.co.uk/bitesize"
  ]) assert.notEqual(await cat(url), "games", url);
  assert.equal(await cat("https://www.bet9ja.com/"), "gambling");

  // Every school gets the ready-made "Lesson focus" environment, and it blocks games.
  const [pol] = await db.admin("select * from public.environment_policies where tenant_id = $1 and name = 'Lesson focus: no games or social media'", [S.tenantA]);
  assert.ok(pol, "lesson focus environment exists");
  assert.ok(pol.blocked_categories.includes("games"));
  const v = (await db.admin(`select app.evaluate_url(p, 'https://unblocked-games-66.github.io/slope', 1, null) r
                             from public.environment_policies p where p.id = $1`, [pol.id]))[0].r;
  assert.equal(v.verdict, "violation");
  assert.match(v.rule, /games/);
  const ok = (await db.admin(`select app.evaluate_url(p, 'https://www.khanacademy.org/', 1, null) r
                              from public.environment_policies p where p.id = $1`, [pol.id]))[0].r;
  assert.notEqual(ok.verdict, "violation");
  // A brand-new school gets it too.
  const newAdmin = await db.signUp("new@c.test", "New Admin");
  const t = (await db.rpc(newAdmin, "bootstrap_school", { p_school_name: "Gamma School", p_full_name: "New Admin" })).tenant_id;
  assert.equal((await db.admin("select count(*)::int n from public.environment_policies where tenant_id = $1 and name like 'Lesson focus%'", [t]))[0].n, 1);
});

test("parental monitoring consent: signed undertakings, parent portal, optional requirement", async () => {
  await rejects(db.rpc(S.teacherA, "record_monitoring_consent", { p_reference: "x" }), /Administrators only/);
  await rejects(db.rpc(S.adminA, "record_monitoring_consent", { p_reference: " " }), /reference/);
  let sum = await db.rpc(S.adminA, "monitoring_consent_summary", {});
  const students = sum.students;
  assert.ok(students >= 2);
  // Only Ada's signed undertaking is on file so far.
  assert.equal(await db.rpc(S.adminA, "record_monitoring_consent", { p_reference: "Admissions pack 2026", p_students: `{${S.stu1}}` }), 1);
  sum = await db.rpc(S.adminA, "monitoring_consent_summary", {});
  assert.equal(sum.with_consent, 1);
  assert.ok(sum.missing.some((m) => m.id === S.stu2));

  // When the school requires consent, screens are only requested from students with consent.
  await db.as(S.adminA, "update public.tenant_settings set require_monitoring_consent = true");
  const s = await goLive(S.teacherA, { p_class: S.classA });
  for (const u of [S.stu1, S.stu2]) await db.rpc(u, "join_session", { p_code: s.join_code });
  const tick = (u) => db.rpc(u, "student_report", { p_session: s.id, p_visible: true, p_fullscreen: true, p_sharing: false });
  assert.equal((await tick(S.stu1)).capture.enabled, true, "consent on file: screen requested");
  const noConsent = await tick(S.stu2);
  assert.equal(noConsent.capture.enabled, false, "no consent: screen not requested");
  assert.equal(noConsent.away, false, "not sharing isn't counted as leaving without consent");

  // Parents can see and give consent in the portal; others can't read it.
  assert.equal((await db.as(S.parentA, "select count(*)::int n from public.monitoring_consents where student_id = $1", [S.stu1]))[0].n, 1);
  assert.equal((await db.as(S.stu2, "select count(*)::int n from public.monitoring_consents where student_id = $1", [S.stu1]))[0].n, 0);
  await rejects(db.rpc(S.parentA, "parent_monitoring_consent", { p_student: S.stu2, p_consent: true }), /Not your child/);
  await db.rpc(S.parentA, "parent_monitoring_consent", { p_student: S.stu1, p_consent: false, p_reason: "Changed my mind" });
  assert.equal((await tick(S.stu1)).capture.enabled, false, "withdrawn: screen no longer requested");
  await db.rpc(S.parentA, "parent_monitoring_consent", { p_student: S.stu1, p_consent: true });
  assert.equal((await tick(S.stu1)).capture.enabled, true);

  // Record for everyone at once (all signed undertakings collected).
  assert.equal(await db.rpc(S.adminA, "record_monitoring_consent", { p_reference: "Signed undertakings 2026/27" }), students);
  assert.equal((await tick(S.stu2)).capture.enabled, true);
  assert.ok((await db.as(S.adminA, "select 1 from public.audit_logs where action = 'privacy.monitoring_consent_recorded'")).length >= 1);
  await db.as(S.adminA, "update public.tenant_settings set require_monitoring_consent = false");
  await db.rpc(S.teacherA, "end_session", { p_session: s.id });
});

test("engaging learning: differentiated levels, reasoning, XP, badges, leaderboard, insights", async () => {
  const t = S.teacherA;
  // A differentiated activity: one easy, one core, one challenge and one untagged question.
  const [act] = await db.as(t, `insert into public.activities (tenant_id, lesson_id, owner_id, kind, title, settings)
    values ($1, $2, $3, 'quiz', 'Fractions', '{"differentiate":true,"show_feedback":"immediately"}') returning id`, [S.tenantA, S.lesson, t]);
  const mk = async (prompt, difficulty, config = {}, pos = 0) => {
    const [q] = await db.as(t, `insert into public.questions (tenant_id, activity_id, owner_id, kind, prompt, difficulty, config, points, position, bloom_level)
      values ($1,$2,$3,'mcq',$4,$5,$6,1,$7,'analyze') returning id`, [S.tenantA, act.id, t, prompt, difficulty, JSON.stringify(config), pos]);
    const opts = await db.as(t, `insert into public.question_options (tenant_id, question_id, label, is_correct, position)
      values ($1,$2,'Right',true,0), ($1,$2,'Wrong',false,1) returning id, is_correct`, [S.tenantA, q.id]);
    return { id: q.id, right: opts.find((o) => o.is_correct).id, wrong: opts.find((o) => !o.is_correct).id };
  };
  const easy = await mk("1/2 + 1/2?", 1, {}, 0);
  const core = await mk("Which is bigger, 2/3 or 3/5?", 3, { require_reasoning: true }, 1);
  const hard = await mk("Prove 1/n - 1/(n+1) = 1/(n(n+1))", 5, {}, 2);
  const open = await mk("Any fraction equal to 0.5?", null, {}, 3);

  // Levels: Ada chooses Extension herself (badge), the teacher puts Alan on Support.
  await db.rpc(S.stu1, "choose_level", { p_class: S.classA, p_level: 3 });
  await db.rpc(t, "set_student_level", { p_class: S.classA, p_student: S.stu2, p_level: 1 });
  await rejects(db.rpc(S.stu1, "set_student_level", { p_class: S.classA, p_student: S.stu2, p_level: 3 }), /Not your class/);
  assert.equal((await db.as(S.stu1, "select 1 from public.student_badges where badge = 'challenger'")).length, 1);

  const adaBefore = (await db.rpc(S.stu1, "my_progress", {})).xp;
  const alanBefore = (await db.rpc(S.stu2, "my_progress", {})).xp;
  const s = await goLive(t, { p_class: S.classA });
  for (const u of [S.stu1, S.stu2]) await db.rpc(u, "join_session", { p_code: s.join_code });
  await db.rpc(t, "set_session_state", { p_session: s.id, p_activity: act.id });
  const ada = await db.rpc(S.stu1, "start_attempt", { p_activity: act.id, p_session: s.id });
  const alan = await db.rpc(S.stu2, "start_attempt", { p_activity: act.id, p_session: s.id });
  const ids = (a) => a.questions.map((q) => q.id).sort();
  assert.deepEqual(ids(ada), [core.id, hard.id, open.id].sort(), "Extension: difficulty 3–5 + untagged");
  assert.deepEqual(ids(alan), [easy.id, core.id, open.id].sort(), "Support: difficulty 1–3 + untagged");
  assert.equal(ada.attempt.level, 3);
  // The server enforces the band: Alan can't answer the challenge question.
  await rejects(db.rpc(S.stu2, "submit_answer", { p_attempt: alan.attempt.id, p_question: hard.id, p_response: J({ option_id: hard.right }) }), /not part of your challenge level/);

  // Critical thinking: reasoning required, confidence 1–5.
  await rejects(db.rpc(S.stu1, "submit_answer", { p_attempt: ada.attempt.id, p_question: core.id, p_response: J({ option_id: core.right }) }), /Explain your reasoning/);
  await rejects(db.rpc(S.stu1, "submit_answer", { p_attempt: ada.attempt.id, p_question: core.id, p_response: J({ option_id: core.right, reasoning: "Because 2/3 is 10/15 and 3/5 is 9/15.", confidence: 9 }) }), /Confidence/);
  await db.rpc(S.stu1, "submit_answer", { p_attempt: ada.attempt.id, p_question: core.id, p_response: J({ option_id: core.right, reasoning: "Because 2/3 is 10/15 and 3/5 is 9/15.", confidence: 5 }) });
  await db.rpc(S.stu1, "submit_answer", { p_attempt: ada.attempt.id, p_question: hard.id, p_response: J({ option_id: hard.right }) });
  await db.rpc(S.stu1, "submit_answer", { p_attempt: ada.attempt.id, p_question: open.id, p_response: J({ option_id: open.right }) });
  // Alan is confident but wrong: a likely misconception for the teacher.
  await db.rpc(S.stu2, "submit_answer", { p_attempt: alan.attempt.id, p_question: core.id, p_response: J({ option_id: core.wrong, reasoning: "3/5 has bigger numbers so it is bigger.", confidence: 5 }) });
  await db.rpc(S.stu1, "finish_attempt", { p_attempt: ada.attempt.id });

  // XP: core 10 + reasoning 5 + challenge 20 + untagged 10 + completion 20 + perfect 20 = 85.
  const p = await db.rpc(S.stu1, "my_progress", {});
  assert.equal(p.xp - adaBefore, 85);
  assert.equal(p.level, Math.max(1, Math.floor((1 + Math.sqrt(1 + 0.08 * p.xp)) / 2)));
  assert.ok(p.badges.some((b) => b.badge === "first_steps") && p.badges.some((b) => b.badge === "perfectionist"));
  assert.ok(p.classes.some((c) => c.class_id === S.classA && c.level === 3 && c.level_set_by === "student"));
  assert.equal((await db.rpc(S.stu2, "my_progress", {})).xp - alanBefore, 5, "reasoning earns XP even when the answer is wrong");
  assert.ok((await db.as(S.stu1, "select 1 from public.notifications where kind = 'badge'")).length >= 1, "badges notify");

  // Teacher shout-out; leaderboard shows first name + initial to classmates.
  await db.rpc(t, "award_xp", { p_student: S.stu2, p_points: 20, p_reason: "Great explanation to the class", p_class: S.classA });
  await rejects(db.rpc(S.stu1, "award_xp", { p_student: S.stu1, p_points: 50, p_reason: "me" }), /Not your student/);
  const board = await db.rpc(S.stu2, "class_leaderboard", { p_class: S.classA, p_period: "week" });
  assert.equal(board.rows[0].name, "Ada L.");
  assert.ok(board.rows.some((r) => r.me && r.name === "Alan Turing"));
  assert.equal((await db.rpc(t, "class_leaderboard", { p_class: S.classA })).rows[0].name, "Ada Lovelace");
  await db.rpc(t, "set_class_engagement", { p_class: S.classA, p_leaderboard: false, p_student_choice: false });
  assert.equal((await db.rpc(S.stu2, "class_leaderboard", { p_class: S.classA })).enabled, false);
  await rejects(db.rpc(S.stu2, "choose_level", { p_class: S.classA, p_level: 3 }), /teacher sets the challenge level/);
  await rejects(db.rpc(S.adminB, "class_leaderboard", { p_class: S.classA }), /not found/);

  // Teacher insights: confident-but-wrong and the reasoning; level suggestions.
  const ins = await db.rpc(t, "question_insights", { p_activity: act.id, p_session: s.id });
  const qi = ins.find((q) => q.question_id === core.id);
  assert.equal(qi.confident_wrong, 1);
  assert.equal(qi.bloom_level, "analyze");
  assert.ok(qi.reasoning.some((r) => /bigger numbers/.test(r.text) && r.correct === false && r.confidence === 5));
  await rejects(db.rpc(S.stu1, "question_insights", { p_activity: act.id }), /not found/);
  const lv = await db.rpc(t, "class_levels", { p_class: S.classA });
  assert.ok(lv.some((r) => r.student_id === S.stu1 && r.level === 3));
  await db.rpc(t, "set_class_engagement", { p_class: S.classA, p_leaderboard: true, p_student_choice: true });
  await db.rpc(t, "end_session", { p_session: s.id });
});

test("fair play: answers lock once revealed, second chance, untimed games, class goal, lobby lock", async () => {
  const t = S.teacherA;
  const mkQuiz = async (title, settings) => {
    const [act] = await db.as(t, `insert into public.activities (tenant_id, lesson_id, owner_id, kind, title, settings)
      values ($1, $2, $3, 'quiz', $4, $5) returning id`, [S.tenantA, S.lesson, t, title, J(settings)]);
    const [q] = await db.as(t, `insert into public.questions (tenant_id, activity_id, owner_id, kind, prompt, points, explanation)
      values ($1,$2,$3,'mcq','3 x 4?',2,'Three groups of four make twelve.') returning id`, [S.tenantA, act.id, t]);
    const opts = await db.as(t, `insert into public.question_options (tenant_id, question_id, label, is_correct, position)
      values ($1,$2,'12',true,0), ($1,$2,'7',false,1) returning id, is_correct`, [S.tenantA, q.id]);
    return { act: act.id, q: q.id, right: opts.find((o) => o.is_correct).id, wrong: opts.find((o) => !o.is_correct).id };
  };
  const s = await goLive(t, { p_class: S.classA });
  for (const u of [S.stu1, S.stu2]) await db.rpc(u, "join_session", { p_code: s.join_code });

  // Instant feedback without a second chance: the revealed answer is final (no copying the answer back in).
  const a = await mkQuiz("Times tables", { show_feedback: "immediately" });
  await db.rpc(t, "set_session_state", { p_session: s.id, p_activity: a.act });
  const at1 = await db.rpc(S.stu1, "start_attempt", { p_activity: a.act, p_session: s.id });
  const r1 = await db.rpc(S.stu1, "submit_answer", { p_attempt: at1.attempt.id, p_question: a.q, p_response: J({ option_id: a.wrong }) });
  assert.equal(r1.is_correct, false);
  assert.ok(r1.correct_option_ids.includes(a.right), "answer shown");
  assert.match(r1.explanation, /twelve/);
  await rejects(db.rpc(S.stu1, "submit_answer", { p_attempt: at1.attempt.id, p_question: a.q, p_response: J({ option_id: a.right }) }), /already answered/);

  // Second chance: a wrong first try hides the answer; the retry earns half.
  const b = await mkQuiz("Times tables redemption", { show_feedback: "immediately", redemption: true });
  await db.rpc(t, "set_session_state", { p_session: s.id, p_activity: b.act });
  const at2 = await db.rpc(S.stu2, "start_attempt", { p_activity: b.act, p_session: s.id });
  const first = await db.rpc(S.stu2, "submit_answer", { p_attempt: at2.attempt.id, p_question: b.q, p_response: J({ option_id: b.wrong }) });
  assert.equal(first.second_chance, true);
  assert.equal(first.correct_option_ids, undefined, "no answer revealed before the second try");
  const again = await db.rpc(S.stu2, "start_attempt", { p_activity: b.act, p_session: s.id });
  assert.equal(again.locked[b.q].tries, 1, "reloading keeps the second chance");
  const second = await db.rpc(S.stu2, "submit_answer", { p_attempt: at2.attempt.id, p_question: b.q, p_response: J({ option_id: b.right }) });
  assert.equal(second.is_correct, true);
  assert.equal(Number(second.score), 1, "half of 2 points");
  await rejects(db.rpc(S.stu2, "submit_answer", { p_attempt: at2.attempt.id, p_question: b.q, p_response: J({ option_id: b.right }) }), /already answered/);
  // A right first try gets full marks and is final.
  const at3 = await db.rpc(S.stu1, "start_attempt", { p_activity: b.act, p_session: s.id });
  assert.equal(Number((await db.rpc(S.stu1, "submit_answer", { p_attempt: at3.attempt.id, p_question: b.q, p_response: J({ option_id: b.right }) })).score), 2);

  // Games: untimed means no speed bonus and no countdown; class goal hides ranks; the lobby can be locked.
  const set = (await db.admin(`select app.game_settings('{"question_seconds":0,"speed_bonus":true,"class_goal":true,"rank_visibility":"after_each"}') s`))[0].s;
  assert.equal(set.question_seconds, 0);
  assert.equal(set.speed_bonus, false);
  assert.equal(set.rank_visibility, "hidden");
  assert.equal((await db.admin(`select app.game_settings('{"question_seconds":2}') s`))[0].s.question_seconds, 5, "timed games keep the 5 s minimum");
  const g = await db.rpc(t, "create_game", { p_class: S.classA, p_activity: a.act, p_settings: J({ question_seconds: 0, class_goal: true, goal_percent: 50 }) });
  await db.rpc(S.stu1, "join_game", { p_code: g.join_code });
  await db.rpc(t, "game_control", { p_game: g.id, p_action: "lock" });
  await rejects(db.rpc(S.stu2, "join_game", { p_code: g.join_code }), /locked/);
  await db.rpc(S.stu1, "join_game", { p_code: g.join_code }); // already in: fine
  await rejects(db.rpc(S.stu1, "game_control", { p_game: g.id, p_action: "unlock" }), /Only the host/);
  await db.rpc(t, "game_control", { p_game: g.id, p_action: "unlock" });
  await db.rpc(S.stu2, "join_game", { p_code: g.join_code });
  await db.rpc(t, "game_control", { p_game: g.id, p_action: "start" });
  const gs = await db.rpc(S.stu1, "game_state", { p_game: g.id });
  assert.ok(new Date(gs.question_ends_at) - new Date(gs.question_started_at) >= 3_000_000, "untimed: open until the teacher moves on");
  await db.rpc(S.stu1, "game_answer", { p_game: g.id, p_index: 0, p_choice: J({ option_id: a.right }), p_client_elapsed_ms: 100 });
  const [ans] = await db.admin("select speed_bonus from public.game_answers where game_id = $1", [g.id]);
  assert.equal(ans.speed_bonus, 0);
  const goal = await db.rpc(S.stu2, "game_goal", { p_game: g.id });
  assert.deepEqual([goal.enabled, goal.correct, goal.target], [true, 1, 1]);
  await rejects(db.rpc(S.adminB, "game_goal", { p_game: g.id }), /not found|Not your game/);
  await db.rpc(t, "game_control", { p_game: g.id, p_action: "end" });
  await db.rpc(t, "end_session", { p_session: s.id });
});

test("learning supports, student-written questions, gradebook export", async () => {
  const t = S.teacherA;
  // Supports are private: the student sees their own (without the staff note); other students see nothing.
  await db.rpc(t, "set_student_supports", { p_class: S.classA, p_student: S.stu2, p_read_aloud: true, p_readable_font: true,
    p_extra_time_pct: 50, p_calm_mode: true, p_note: "EAL, first term" });
  await rejects(db.rpc(t, "set_student_supports", { p_class: S.classA, p_student: S.stu2, p_read_aloud: true, p_readable_font: false,
    p_extra_time_pct: 30, p_calm_mode: false }), /Extra time/);
  await rejects(db.rpc(S.stu1, "set_student_supports", { p_class: S.classA, p_student: S.stu1, p_read_aloud: true, p_readable_font: false,
    p_extra_time_pct: 100, p_calm_mode: false }), /Not your class/);
  const mine = await db.rpc(S.stu2, "my_supports", {});
  assert.deepEqual(mine, { read_aloud: true, readable_font: true, extra_time_pct: 50, calm_mode: true });
  assert.equal((await db.as(S.stu1, "select * from public.student_supports")).length, 0);
  assert.equal((await db.rpc(t, "class_supports", { p_class: S.classA })).find((r) => r.student_id === S.stu2).note, "EAL, first term");

  // Extra time stretches a timed activity's deadline for that student only.
  const [act] = await db.as(t, `insert into public.activities (tenant_id, lesson_id, owner_id, kind, title, settings)
    values ($1, $2, $3, 'quiz', 'Timed check', '{"time_limit_seconds":600}') returning id`, [S.tenantA, S.lesson, t]);
  await db.as(t, `insert into public.questions (tenant_id, activity_id, owner_id, kind, prompt, points) values ($1,$2,$3,'short','Name a prime',1)`, [S.tenantA, act.id, t]);
  const s = await goLive(t, { p_class: S.classA });
  for (const u of [S.stu1, S.stu2]) await db.rpc(u, "join_session", { p_code: s.join_code });
  await db.rpc(t, "set_session_state", { p_session: s.id, p_activity: act.id });
  const secs = (x) => Math.round((new Date(x.attempt.deadline_at) - new Date(x.attempt.server_now)) / 1000);
  assert.equal(secs(await db.rpc(S.stu1, "start_attempt", { p_activity: act.id, p_session: s.id })), 600);
  assert.equal(secs(await db.rpc(S.stu2, "start_attempt", { p_activity: act.id, p_session: s.id })), 900);
  await db.rpc(t, "end_session", { p_session: s.id });

  // Students write questions; the teacher approves one into the quiz and returns another with feedback.
  const [quiz] = await db.as(t, `insert into public.activities (tenant_id, lesson_id, owner_id, kind, title) values ($1,$2,$3,'quiz','Class-made quiz') returning id`,
    [S.tenantA, S.lesson, t]);
  await rejects(db.rpc(S.stu1, "open_question_collab", { p_class: S.classA, p_activity: quiz.id, p_open: true }), /Not your class/);
  const c = await db.rpc(t, "open_question_collab", { p_class: S.classA, p_activity: quiz.id, p_open: true, p_prompt: "Questions about primes" });
  const open = await db.rpc(S.stu1, "my_collabs", {});
  assert.equal(open.find((x) => x.id === c.id).title, "Class-made quiz");
  const opts = J([{ label: "7", correct: true }, { label: "9", correct: false }]);
  await rejects(db.rpc(S.stu1, "submit_question", { p_collab: c.id, p_prompt: "Which is prime?", p_options: J([{ label: "7", correct: true }, { label: "5", correct: true }]), p_explanation: "Seven has two factors." }), /exactly one/);
  await rejects(db.rpc(S.stu1, "submit_question", { p_collab: c.id, p_prompt: "Which is prime?", p_options: opts, p_explanation: "It is." }), /Explain why/);
  const sub1 = await db.rpc(S.stu1, "submit_question", { p_collab: c.id, p_prompt: "Which number is prime?", p_options: opts, p_explanation: "7 has exactly two factors, 1 and 7; 9 is 3 x 3." });
  const sub2 = await db.rpc(S.stu2, "submit_question", { p_collab: c.id, p_prompt: "Is 1 prime or not prime?", p_options: J([{ label: "Prime", correct: true }, { label: "Not prime", correct: false }]), p_explanation: "Because it is only divisible by itself." });
  await rejects(db.rpc(S.adminB, "submit_question", { p_collab: c.id, p_prompt: "Hack?", p_options: opts, p_explanation: "Trying to get in." }), /another class|profile|not found/);
  assert.equal((await db.as(S.stu1, "select * from public.question_submissions")).length, 1, "students only see their own");
  const xpBefore = (await db.rpc(S.stu1, "my_progress", {})).xp;
  const approved = await db.rpc(t, "review_question_submission", { p_submission: sub1.id, p_action: "approve" });
  const [q] = await db.admin("select kind, explanation, config from public.questions where id = $1", [approved.question_id]);
  assert.equal(q.kind, "mcq");
  assert.equal(q.config.authored_by, "Ada L.");
  assert.equal((await db.admin("select count(*)::int n from public.question_options where question_id = $1 and is_correct", [approved.question_id]))[0].n, 1);
  assert.equal((await db.rpc(S.stu1, "my_progress", {})).xp - xpBefore, 25);
  assert.ok((await db.rpc(S.stu1, "my_progress", {})).badges.some((b) => b.badge === "author"));
  await rejects(db.rpc(t, "review_question_submission", { p_submission: sub2.id, p_action: "return" }), /what to improve/);
  await db.rpc(t, "review_question_submission", { p_submission: sub2.id, p_action: "return", p_feedback: "1 has only one factor. Check the definition of prime." });
  const back = (await db.rpc(S.stu2, "my_collabs", {})).find((x) => x.id === c.id).mine[0];
  assert.equal(back.status, "returned");
  assert.match(back.feedback, /one factor/);
  assert.equal((await db.rpc(t, "collab_submissions", { p_activity: quiz.id })).length, 2);
  await db.rpc(t, "open_question_collab", { p_class: S.classA, p_activity: quiz.id, p_open: false });
  await rejects(db.rpc(S.stu1, "submit_question", { p_collab: c.id, p_prompt: "Another question?", p_options: opts, p_explanation: "Because seven is prime." }), /closed/);

  // Gradebook: every student, every published assignment, scores scaled to the assignment's points.
  const gb = await db.rpc(t, "class_gradebook", { p_class: S.classA });
  assert.ok(Array.isArray(gb.assignments) && gb.students.some((s) => s.id === S.stu1));
  await rejects(db.rpc(S.stu1, "class_gradebook", { p_class: S.classA }), /Not your class/);
});

test("audit fixes: no right/wrong leak before submit, second try never lowers a score, atomic slide order", async () => {
  const t = S.teacherA;
  const s = await goLive(t, { p_class: S.classA });
  await db.rpc(S.stu1, "join_session", { p_code: s.join_code });

  // "After submit" feedback: a wrong answer must not come back flagged on reload (that would reveal it's wrong).
  const [quiet] = await db.as(t, `insert into public.activities (tenant_id, lesson_id, owner_id, kind, title, settings)
    values ($1,$2,$3,'quiz','Quiet quiz','{"show_feedback":"after_submit","redemption":true}') returning id`, [S.tenantA, S.lesson, t]);
  const [qq] = await db.as(t, `insert into public.questions (tenant_id, activity_id, owner_id, kind, prompt, points) values ($1,$2,$3,'mcq','2+2?',1) returning id`, [S.tenantA, quiet.id, t]);
  const qo = await db.as(t, `insert into public.question_options (tenant_id, question_id, label, is_correct, position)
    values ($1,$2,'4',true,0), ($1,$2,'5',false,1) returning id, is_correct`, [S.tenantA, qq.id]);
  await db.rpc(t, "set_session_state", { p_session: s.id, p_activity: quiet.id });
  const a1 = await db.rpc(S.stu1, "start_attempt", { p_activity: quiet.id, p_session: s.id });
  const saved = await db.rpc(S.stu1, "submit_answer", { p_attempt: a1.attempt.id, p_question: qq.id, p_response: J({ option_id: qo.find((o) => !o.is_correct).id }) });
  assert.equal(saved.is_correct, undefined, "no right/wrong before submit");
  assert.deepEqual((await db.rpc(S.stu1, "start_attempt", { p_activity: quiet.id, p_session: s.id })).locked, {});

  // Partial credit + second chance: a worse second try keeps the first try's partial score.
  const [pc] = await db.as(t, `insert into public.activities (tenant_id, lesson_id, owner_id, kind, title, settings)
    values ($1,$2,$3,'quiz','Primes','{"show_feedback":"immediately","redemption":true}') returning id`, [S.tenantA, S.lesson, t]);
  const [mq] = await db.as(t, `insert into public.questions (tenant_id, activity_id, owner_id, kind, prompt, points, config)
    values ($1,$2,$3,'multi_select','Pick the primes',4,'{"partial_credit":true}') returning id`, [S.tenantA, pc.id, t]);
  const mo = await db.as(t, `insert into public.question_options (tenant_id, question_id, label, is_correct, position)
    values ($1,$2,'2',true,0), ($1,$2,'3',true,1), ($1,$2,'4',false,2), ($1,$2,'6',false,3) returning id, label`, [S.tenantA, mq.id]);
  const id = (l) => mo.find((o) => o.label === l).id;
  await db.rpc(t, "set_session_state", { p_session: s.id, p_activity: pc.id });
  const a2 = await db.rpc(S.stu1, "start_attempt", { p_activity: pc.id, p_session: s.id });
  const try1 = await db.rpc(S.stu1, "submit_answer", { p_attempt: a2.attempt.id, p_question: mq.id, p_response: J({ option_ids: [id("2")] }) });
  assert.equal(try1.second_chance, true);
  const try2 = await db.rpc(S.stu1, "submit_answer", { p_attempt: a2.attempt.id, p_question: mq.id, p_response: J({ option_ids: [id("2"), id("4")] }) });
  assert.equal(Number(try2.score), 2, "keeps the 2 points from the first try (half of 4)");
  await db.rpc(t, "end_session", { p_session: s.id });

  // Slide order: one atomic call; only the lesson's editor; the whole list must match.
  const slides = await db.as(t, `insert into public.lesson_slides (tenant_id, lesson_id, position, kind, content) values
    ($1,$2,10,'text','{}'), ($1,$2,11,'text','{}') returning id`, [S.tenantA, S.lesson]);
  const all = (await db.admin("select id from public.lesson_slides where lesson_id = $1 order by position", [S.lesson])).map((r) => r.id);
  const reversed = [...all].reverse();
  await db.rpc(t, "reorder_slides", { p_lesson: S.lesson, p_order: `{${reversed.join(",")}}` });
  const after = await db.admin("select id, position from public.lesson_slides where lesson_id = $1 order by position", [S.lesson]);
  assert.deepEqual(after.map((r) => r.id), reversed);
  assert.deepEqual(after.map((r) => r.position), reversed.map((_, i) => i));
  await rejects(db.rpc(t, "reorder_slides", { p_lesson: S.lesson, p_order: `{${reversed.slice(1).join(",")}}` }), /slide list changed/);
  await rejects(db.rpc(S.stu1, "reorder_slides", { p_lesson: S.lesson, p_order: `{${all.join(",")}}` }), /can't edit/);
  await rejects(db.rpc(S.adminB, "reorder_slides", { p_lesson: S.lesson, p_order: `{${all.join(",")}}` }), /can't edit|profile/);
  await db.admin("delete from public.lesson_slides where id = any($1::uuid[])", [slides.map((x) => x.id)]);
  const extra = new Set(slides.map((x) => x.id));
  await db.rpc(t, "reorder_slides", { p_lesson: S.lesson, p_order: `{${all.filter((id) => !extra.has(id)).join(",")}}` }); // back to 0..n-1

  // Join-code guessing: wrong codes are counted (returned, not raised) and capped at 8 per 15 minutes.
  const guesser = await db.signUp("guesser@x.test", "Code Guesser");
  for (let i = 0; i < 8; i++) {
    const r = await db.rpc(guesser, "redeem_code", { p_code: `ZZZZZ${i}` });
    assert.equal(r.code, "P0002");
  }
  await rejects(db.rpc(guesser, "redeem_code", { p_code: S.classCode }), /Too many wrong codes/);
  assert.equal((await db.admin("select count(*)::int n from public.users where id = $1", [guesser]))[0].n, 0, "never enrolled");
  await rejects(db.as(guesser, "select * from public.code_attempts"), /permission denied/);
  // Another account is unaffected.
  const fresh = await db.signUp("fresh@x.test", "Fresh Student");
  assert.equal((await db.rpc(fresh, "redeem_code", { p_code: S.classCode })).kind, "class");
});

test("parent reports: daily/weekly by subject, participation, focus with context, alerts, parent–teacher messages", async () => {
  const t = S.teacherA;
  await db.as(S.adminA, "update public.tenant_settings set parent_portal_enabled = true, parent_focus_details = true");
  await db.rpc(S.parentA, "set_parent_alerts", { p_student: S.stu1, p_alert_on_leave: true, p_weekly_digest: true, p_low_score_below: 80 });
  await rejects(db.rpc(S.parentA, "set_parent_alerts", { p_student: S.stu2, p_alert_on_leave: true, p_weekly_digest: true }), /Not your child/);
  assert.deepEqual(await db.rpc(S.parentA, "parent_alerts", { p_student: S.stu1 }), { alert_on_leave: true, weekly_digest: true, low_score_below: 80 });

  // Earlier tests already have Ada active today: measure what this lesson adds.
  const mathsNow = async () => (await db.rpc(S.parentA, "parent_report", { p_student: S.stu1, p_period: "day" })).subjects.find((x) => x.class_id === S.classA).now;
  const before = await mathsNow();
  // A lesson with a titled slide; Ada joins, answers with reasoning, raises a hand, then leaves.
  await db.admin("update public.lesson_slides set content = jsonb_set(coalesce(content, '{}'), '{heading}', '\"Adding fractions\"') where lesson_id = $1 and position = 0", [S.lesson]);
  const s = await goLive(t, { p_class: S.classA, p_lesson: S.lesson });
  await db.rpc(S.stu1, "join_session", { p_code: s.join_code });
  const [act] = await db.as(t, `insert into public.activities (tenant_id, lesson_id, owner_id, kind, title, settings)
    values ($1,$2,$3,'quiz','Warm-up','{}') returning id`, [S.tenantA, S.lesson, t]);
  const [q] = await db.as(t, `insert into public.questions (tenant_id, activity_id, owner_id, kind, prompt, points) values ($1,$2,$3,'mcq','1/2+1/4?',1) returning id`, [S.tenantA, act.id, t]);
  const [ok] = await db.as(t, `insert into public.question_options (tenant_id, question_id, label, is_correct, position) values ($1,$2,'3/4',true,0) returning id`, [S.tenantA, q.id]);
  await db.rpc(t, "set_session_state", { p_session: s.id, p_activity: act.id });
  const at = await db.rpc(S.stu1, "start_attempt", { p_activity: act.id, p_session: s.id });
  await db.rpc(S.stu1, "submit_answer", { p_attempt: at.attempt.id, p_question: q.id, p_response: J({ option_id: ok.id, reasoning: "Half is two quarters, plus one quarter is three." }) });
  await db.rpc(S.stu1, "finish_attempt", { p_attempt: at.attempt.id });
  await db.as(S.stu1, "insert into public.raise_hands (tenant_id, session_id, student_id, status) values ($1,$2,$3,'open')", [S.tenantA, s.id, S.stu1]);
  // Leaving the lesson (as the web lockdown or the extension records it).
  await db.admin(`insert into public.environment_events (tenant_id, class_session_id, class_id, student_id, kind, severity, rule, domain, page_title)
    values ($1,$2,$3,$4,'domain_blocked','critical','Game sites are blocked','coolmathgames.com','Run 3 - Cool Math Games')`, [S.tenantA, s.id, S.classA, S.stu1]);
  const [ev] = await db.admin("select lesson_context, away_started_at from public.environment_events where class_session_id = $1 and student_id = $2", [s.id, S.stu1]);
  assert.equal(ev.lesson_context.slide, 1);
  assert.equal(ev.lesson_context.slide_heading, "Adding fractions");
  assert.equal(ev.lesson_context.activity, "Warm-up");
  assert.ok(ev.away_started_at);
  const alerts = await db.as(S.parentA, "select title, body from public.notifications where kind = 'child_left_lesson' and body like '%Cool Math%'");
  assert.equal(alerts.length, 1, "opted-in parent told at once");
  assert.match(alerts[0].body, /Cool Math Games/);
  assert.match(alerts[0].body, /Warm-up/);
  await db.admin("update public.environment_events set resolved_at = now() + interval '3 minutes' where class_session_id = $1", [s.id]);

  // The daily report, per subject.
  const day = await db.rpc(S.parentA, "parent_report", { p_student: S.stu1, p_period: "day" });
  const maths = day.subjects.find((x) => x.class_id === S.classA);
  assert.equal(maths.now.sessions_attended - before.sessions_attended, 1);
  assert.equal(maths.now.answers - before.answers, 1);
  assert.ok(maths.now.accuracy >= 0 && maths.now.accuracy <= 100);
  assert.equal(maths.now.reasoned - before.reasoned, 1);
  assert.equal(maths.now.hands_raised - before.hands_raised, 1);
  assert.equal(maths.now.focus_events - before.focus_events, 1);
  assert.ok(maths.now.participation > 0 && maths.now.participation <= 100);
  const f = maths.now.focus.find((x) => x.page_title === "Run 3 - Cool Math Games");
  assert.equal(f.page_title, "Run 3 - Cool Math Games");
  assert.equal(f.site, "coolmathgames.com");
  assert.equal(f.context.slide_heading, "Adding fractions");
  assert.equal(f.returned, true);
  assert.ok(f.away_minutes >= 1);
  assert.equal(maths.trend.length, 6, "six weeks of progress");
  const week = await db.rpc(S.parentA, "parent_report", { p_student: S.stu1, p_period: "week" });
  assert.ok(week.subjects.find((x) => x.class_id === S.classA).now.answers >= 1);

  // The school can limit parents to counts; staff still see details.
  await db.as(S.adminA, "update public.tenant_settings set parent_focus_details = false");
  const limited = (await db.rpc(S.parentA, "parent_report", { p_student: S.stu1, p_period: "day" })).subjects.find((x) => x.class_id === S.classA);
  assert.ok(limited.now.focus_events >= 1);
  assert.deepEqual(limited.now.focus, []);
  assert.ok((await db.rpc(t, "parent_report", { p_student: S.stu1, p_period: "day" })).subjects.find((x) => x.class_id === S.classA).now.focus.length >= 1);
  await db.as(S.adminA, "update public.tenant_settings set parent_focus_details = true");

  // Only the child's own guardians and staff.
  await rejects(db.rpc(S.parentA, "parent_report", { p_student: S.stu2, p_period: "day" }), /not found/);
  await rejects(db.rpc(S.stu2, "parent_report", { p_student: S.stu1, p_period: "day" }), /not found/);
  await rejects(db.rpc(S.adminB, "parent_report", { p_student: S.stu1, p_period: "day" }), /not found|profile/);

  // A released grade below the parent's threshold.
  const [asg] = await db.admin(`insert into public.assignments (tenant_id, class_id, title, points_possible, created_by) values ($1,$2,'Fractions homework',10,$3) returning id`, [S.tenantA, S.classA, t]);
  const [sub] = await db.admin(`insert into public.submissions (tenant_id, assignment_id, student_id) values ($1,$2,$3) returning id`, [S.tenantA, asg.id, S.stu1]);
  await db.admin(`insert into public.grades (tenant_id, submission_id, grader_id, score, released_at) values ($1,$2,$3,6,now())`, [S.tenantA, sub.id, t]);
  const low = await db.as(S.parentA, "select title, body from public.notifications where kind = 'child_low_score'");
  assert.equal(low.length, 1);
  assert.match(low[0].body, /60%/);
  assert.equal(typeof (await db.admin("select app.send_parent_digests() n"))[0].n, "number");

  // Parent ↔ teacher messages: private to the two of them.
  const thread = await db.rpc(S.parentA, "open_parent_thread", { p_student: S.stu1, p_class: S.classA });
  await db.rpc(S.parentA, "send_message", { p_thread: thread, p_body: "Hello, how is Ada getting on with fractions?" });
  await db.rpc(t, "send_message", { p_thread: thread, p_body: "Very well: she explains her thinking clearly." });
  assert.equal((await db.as(t, "select * from public.chat_messages where thread_id = $1", [thread])).length, 2);
  assert.equal((await db.as(S.stu1, "select * from public.chat_threads where id = $1", [thread])).length, 0, "the child can't see it");
  assert.equal((await db.as(S.stu1, "select app.can_listen($1) ok", [`thread:${thread}`]))[0].ok, false);
  assert.equal((await db.as(S.parentA, "select app.can_listen($1) ok", [`thread:${thread}`]))[0].ok, true);
  await rejects(db.rpc(S.stu1, "send_message", { p_thread: thread, p_body: "hi" }), /Not your conversation/);
  await rejects(db.rpc(S.parentA, "open_parent_thread", { p_student: S.stu2, p_class: S.classA }), /Not your child/);
  assert.equal(await db.rpc(t, "open_parent_thread", { p_student: S.stu1, p_class: S.classA, p_parent: S.parentA }), thread, "the teacher reaches the same thread");
  assert.ok((await db.rpc(t, "class_parents", { p_class: S.classA })).some((p) => p.parent_id === S.parentA));
  await db.rpc(t, "end_session", { p_session: s.id });
});

test("pen-test fixes: school admins can't unlock paid features; anonymous error reports can't crowd out real ones", async () => {
  // School B on the free plan (no device control, but games included).
  await db.admin("update public.tenants set plan_code = 'free_teacher' where id = $1", [S.tenantB]);
  await rejects(db.as(S.adminB, "insert into public.feature_flags (tenant_id, key, enabled) values ($1, 'device_control', true)", [S.tenantB]), /row-level security|violates/);
  assert.equal((await db.admin("select app.feature($1, 'device_control') f", [S.tenantB]))[0].f, false);
  // Even a flag planted directly can't switch a feature on beyond the plan.
  await db.admin("insert into public.feature_flags (tenant_id, key, enabled) values ($1, 'device_control', true)", [S.tenantB]);
  assert.equal((await db.admin("select app.feature($1, 'device_control') f", [S.tenantB]))[0].f, false);
  // Switching an included feature off is still the school's choice.
  await db.as(S.adminB, "insert into public.feature_flags (tenant_id, key, enabled) values ($1, 'games', false)", [S.tenantB]);
  assert.equal((await db.admin("select app.feature($1, 'games') f", [S.tenantB]))[0].f, false);
  await db.admin("delete from public.feature_flags where tenant_id = $1", [S.tenantB]);
  assert.equal((await db.admin("select app.feature($1, 'games') f", [S.tenantB]))[0].f, true);

  // Anonymous error reports are capped at 150 new rows an hour; signed-in reports still get through.
  for (let i = 0; i < 160; i++) await db.rpc(null, "log_error", { p_source: "client", p_message: `junk ${i}` });
  const [{ n }] = await db.admin("select count(*)::int n from public.error_events where user_id is null and first_seen_at > now() - interval '1 hour'");
  assert.equal(n, 150);
  await db.rpc(S.teacherA, "log_error", { p_source: "client", p_message: "real error after the flood" });
  assert.equal((await db.admin("select count(*)::int n from public.error_events where message = 'real error after the flood'"))[0].n, 1);
});

test("deleting a school with real data removes everything (no FK ordering errors)", async () => {
  const before = (await db.admin("select count(*)::int n from public.users where tenant_id = $1", [S.tenantA]))[0].n;
  assert.ok(before > 3);
  await db.admin("delete from public.tenants where id = $1", [S.tenantA]);
  for (const t of ["users", "classes", "lessons", "activities", "questions", "quiz_attempts", "class_sessions", "devices", "game_sessions"]) {
    assert.equal((await db.admin(`select count(*)::int n from public.${t} where tenant_id = $1`, [S.tenantA]))[0].n, 0, t);
  }
});

test("guests join a live lesson with the code and a name, and reach only that lesson (0860)", async () => {
  // Its own school, so earlier tests can't affect it.
  const T = await db.signUp("head@guests.test", "Guest Head");
  const tenant = (await db.rpc(T, "bootstrap_school", { p_school_name: "Guest School", p_full_name: "Guest Head" })).tenant_id;
  const cls = await db.rpc(T, "create_class", { p_name: "Guest Class" });
  await db.admin("update public.tenant_settings set monitoring_enabled = true where tenant_id = $1", [tenant]);
  const pupil = await db.signUp("pupil@guests.test", "Pupil One");
  await db.rpc(pupil, "redeem_code", { p_code: cls.join_code });
  const s = await goLive(T, { p_class: cls.id });
  const g = await db.signInAnonymously();

  // Wrong codes are counted (8 per 15 minutes) and answered plainly; names are checked.
  assert.equal((await db.rpc(g, "join_session_as_guest", { p_code: "ZZZZZZ", p_name: "Kemi A" })).code, "P0002");
  await rejects(db.rpc(g, "join_session_as_guest", { p_code: s.join_code, p_name: "x" }), /2 to 40/);
  const joined = await db.rpc(g, "join_session_as_guest", { p_code: s.join_code.toLowerCase(), p_name: "Kemi A" });
  assert.equal(joined.session_id, s.id);
  const g2 = await db.signInAnonymously();
  await rejects(db.rpc(g2, "join_session_as_guest", { p_code: s.join_code, p_name: "kemi a" }), /already uses that name/);
  // A real account can't use the guest door.
  await rejects(db.rpc(pupil, "join_session_as_guest", { p_code: s.join_code, p_name: "Ada" }), /guest sign-in/);

  // In the lesson: state, slides, hands up. No chat.
  const st = await db.rpc(g, "session_student_state", { p_session: s.id });
  assert.equal(st.guest, true);
  assert.equal(st.session.group_chat_enabled, false);
  await db.rpc(g, "session_lesson", { p_session: s.id });
  await db.as(g, "insert into public.raise_hands (tenant_id, session_id, student_id, message) values ($1, $2, $3, 'help')", [tenant, s.id, g]);
  await rejects(db.rpc(g, "open_group_thread", { p_session: s.id }), /./);

  // Not monitored unless the teacher chooses: lockdown is off for the guest.
  const free = await db.rpc(g, "student_report", { p_session: s.id, p_visible: false, p_fullscreen: false, p_sharing: false });
  assert.equal(free.lockdown, false);
  assert.equal(free.away, false);
  assert.equal(free.capture.enabled, false);

  // The teacher sees the guest, marked as a guest.
  const ts = await db.rpc(T, "teacher_session_state", { p_session: s.id });
  assert.equal(ts.roster.find((r) => r.student_id === g).guest, true);
  assert.equal(ts.roster.find((r) => r.student_id === pupil).guest, false);

  // Nothing beyond this lesson: no class list, classes, assignments, other sessions.
  assert.equal((await db.as(g, "select 1 from public.class_members")).length, 0);
  assert.equal((await db.as(g, "select 1 from public.classes")).length, 0);
  assert.equal((await db.as(g, "select 1 from public.assignments")).length, 0);
  assert.deepEqual((await db.as(g, "select id from public.class_sessions")).map((r) => r.id), [s.id]);

  // An anonymous sign-in can never become a student or create a school.
  const g3 = await db.signInAnonymously();
  await rejects(db.rpc(g3, "redeem_code", { p_code: cls.join_code }), /Create an account/);
  await rejects(db.rpc(g3, "bootstrap_school", { p_school_name: "Fake School", p_full_name: "Fake" }), /Create an account/);

  // The teacher turns on guest monitoring: lockdown now applies to the guest.
  await rejects(db.rpc(pupil, "set_session_guests", { p_session: s.id, p_monitor: true }), /Not your session/);
  await db.rpc(T, "set_session_guests", { p_session: s.id, p_monitor: true });
  const watched = await db.rpc(g, "student_report", { p_session: s.id, p_visible: false, p_fullscreen: false, p_sharing: false });
  assert.equal(watched.lockdown, true);

  // Closed to new guests; then the teacher removes the guest.
  await db.rpc(T, "set_session_guests", { p_session: s.id, p_closed: true });
  await rejects(db.rpc(g2, "join_session_as_guest", { p_code: s.join_code, p_name: "Tobi" }), /isn't taking new guests/);
  await db.rpc(T, "remove_session_guest", { p_session: s.id, p_user: g });
  await rejects(db.rpc(g, "session_student_state", { p_session: s.id }), /not found/i);
  await rejects(db.rpc(g, "join_session_as_guest", { p_code: s.join_code, p_name: "Kemi A" }), /removed you/);
  await db.rpc(T, "end_session", { p_session: s.id });

  // Guests are deleted 30 days after their last lesson.
  await db.admin("update public.class_sessions set ended_at = now() - interval '31 days' where id = $1", [s.id]);
  const [{ n }] = await db.admin("select app.purge_guests() as n");
  assert.ok(n >= 1);
  assert.equal((await db.admin("select count(*)::int c from public.users where id = $1", [g]))[0].c, 0);
});

test("guests join even with Supabase's anonymous sign-ins off: the server makes a guest-only account (1000)", async () => {
  const T = await db.signUp("head@serverguests.test", "Server Head");
  await db.rpc(T, "bootstrap_school", { p_school_name: "Server Guest School", p_full_name: "Server Head" });
  const cls = await db.rpc(T, "create_class", { p_name: "Open Class" });
  const s = await goLive(T, { p_class: cls.id });

  // Joins, plays, and is shown to the teacher as a guest, exactly like an anonymous sign-in.
  const g = await db.serverGuest();
  assert.equal((await db.rpc(g, "join_session_as_guest", { p_code: s.join_code, p_name: "Ngozi E" })).session_id, s.id);
  assert.equal((await db.rpc(g, "session_student_state", { p_session: s.id })).guest, true);
  assert.equal((await db.rpc(T, "teacher_session_state", { p_session: s.id })).roster.find((r) => r.student_id === g).guest, true);
  assert.equal((await db.as(g, "select 1 from public.classes")).length, 0);

  // The mark only counts in app_metadata (service key only): a user's own metadata doesn't make a guest.
  const fake = await db.signUp("fake@serverguests.test", "Fake Guest");
  await db.admin("update auth.users set raw_user_meta_data = '{\"guest\": true}' where id = $1", [fake]);
  await rejects(db.rpc(fake, "join_session_as_guest", { p_code: s.join_code, p_name: "Fake" }), /guest sign-in/);

  // A guest account can never become a student or start a school.
  const g2 = await db.serverGuest();
  await rejects(db.rpc(g2, "redeem_code", { p_code: cls.join_code }), /Create an account/);
  await rejects(db.rpc(g2, "bootstrap_school", { p_school_name: "Fake School", p_full_name: "Fake" }), /Create an account/);

  // Guest accounts that never joined a lesson are removed after a day; recent ones and real accounts stay.
  await db.admin("update auth.users set created_at = now() - interval '2 days' where id = $1", [g2]);
  const fresh = await db.serverGuest();
  await db.rpc(T, "end_session", { p_session: s.id });
  await db.admin("update public.class_sessions set ended_at = now() - interval '31 days' where id = $1", [s.id]);
  await db.admin("select app.purge_guests()");
  const left = (await db.admin("select id from auth.users where id = any($1)", [[g, g2, fresh, fake]])).map((r) => r.id).sort();
  assert.deepEqual(left, [fresh, fake].sort());
});

test("monitoring is an add-on: off for new schools, enforced by the database (0870)", async () => {
  const head = await db.signUp("head@nomon.test", "No Monitor Head");
  const tenant = (await db.rpc(head, "bootstrap_school", { p_school_name: "Calm School", p_full_name: "No Monitor Head" })).tenant_id;
  assert.equal((await db.as(head, "select monitoring_enabled from public.tenant_settings"))[0].monitoring_enabled, false);
  const cls = await db.rpc(head, "create_class", { p_name: "Calm 1" });
  const kid = await db.signUp("kid@nomon.test", "Kid One");
  await db.rpc(kid, "redeem_code", { p_code: cls.join_code });

  // Off: sessions start without lockdown, can't be locked, and nothing is captured.
  const s = await goLive(head, { p_class: cls.id });
  assert.equal(s.lockdown, false);
  await rejects(db.rpc(head, "set_session_lockdown", { p_session: s.id, p_on: true }), /monitoring is switched off/);
  const r = await db.rpc(kid, "student_report", { p_session: s.id, p_visible: false, p_fullscreen: false, p_sharing: false });
  assert.equal(r.lockdown, false);
  assert.equal(r.away, false);
  assert.equal(r.capture.enabled, false);
  assert.equal((await db.rpc(kid, "student_screen_frame", { p_session: s.id, p_image: "data:image/jpeg;base64,AAAA" })).stored, false);
  assert.equal((await db.rpc(head, "teacher_session_state", { p_session: s.id })).settings.monitoring_enabled, false);
  await db.rpc(head, "end_session", { p_session: s.id });

  // The school admin turns it on: new sessions lock down again.
  await db.as(head, "update public.tenant_settings set monitoring_enabled = true");
  const s2 = await goLive(head, { p_class: cls.id });
  assert.equal(s2.lockdown, true);
  await db.rpc(head, "end_session", { p_session: s2.id });
  // Only the school's admins can switch it: a student's update changes nothing.
  await db.as(head, "update public.tenant_settings set monitoring_enabled = false");
  assert.equal((await db.as(kid, "update public.tenant_settings set monitoring_enabled = true returning 1")).length, 0);
  assert.equal((await db.admin("select monitoring_enabled from public.tenant_settings where tenant_id = $1", [tenant]))[0].monitoring_enabled, false);
});

test("live engine core: lobby, start, pause, end; no class needed; join by code (0880)", async () => {
  const T = await db.signUp("t@engine.test", "Engine Teacher");
  const tenant = (await db.rpc(T, "bootstrap_school", { p_school_name: "Engine School", p_full_name: "Engine Teacher" })).tenant_id;
  const other = await db.signUp("o@engine.test", "Other Head");
  await db.rpc(other, "bootstrap_school", { p_school_name: "Other School", p_full_name: "Other Head" });
  // A student of the school with no class at all, and a deck with two slides and a quiz.
  const cls = await db.rpc(T, "create_class", { p_name: "Unused class" });
  const pupil = await db.signUp("p@engine.test", "Pupil Two");
  await db.rpc(pupil, "redeem_code", { p_code: cls.join_code });
  await db.admin("delete from public.class_members where user_id = $1", [pupil]);
  const [{ id: lesson }] = await db.admin("insert into public.lessons (tenant_id, owner_id, title, status) values ($1, $2, 'Deck', 'published') returning id", [tenant, T]);
  const [{ id: act }] = await db.admin("insert into public.activities (tenant_id, lesson_id, owner_id, kind, title) values ($1, $2, $3, 'quiz', 'Q') returning id", [tenant, lesson, T]);
  await db.admin("insert into public.lesson_slides (tenant_id, lesson_id, position, kind, content) values ($1, $2, 0, 'title', '{}'), ($1, $2, 1, 'text', '{}')", [tenant, lesson]);
  await db.admin("insert into public.lesson_slides (tenant_id, lesson_id, position, kind, activity_id, content) values ($1, $2, 2, 'activity', $3, '{}')", [tenant, lesson, act]);

  // No class: the session opens in the lobby.
  const s = await db.rpc(T, "start_session", { p_class: null, p_lesson: lesson });
  assert.equal(s.phase, "lobby");
  assert.equal(s.class_id, null);

  // A guest and a classless student of the school join by code (dashes allowed for students).
  const g = await db.signInAnonymously();
  assert.equal((await db.rpc(g, "join_session_as_guest", { p_code: s.join_code, p_name: "Tobi" })).session_id, s.id);
  const code = s.join_code.slice(0, 3) + "-" + s.join_code.slice(3);
  assert.equal((await db.rpc(pupil, "join_session", { p_code: code })).session_id, s.id);
  await rejects(db.rpc(other, "join_session", { p_code: s.join_code }), /No live lesson has that code/, "another school's lesson looks like no lesson at all");
  let st = await db.rpc(pupil, "session_student_state", { p_session: s.id });
  assert.equal(st.session.phase, "lobby");
  assert.equal(st.me.name, "Pupil Two");
  assert.equal(st.guest, false);

  // Avatars; nothing to answer in the lobby.
  await db.rpc(g, "set_avatar", { p_session: s.id, p_avatar: "fox" });
  await rejects(db.rpc(g, "set_avatar", { p_session: s.id, p_avatar: "<b>" }), /Unknown avatar/);
  assert.equal((await db.rpc(g, "session_student_state", { p_session: s.id })).me.avatar, "fox");
  await rejects(db.rpc(pupil, "start_attempt", { p_activity: act, p_session: s.id }), /not open/);

  // Only the session's teacher drives it; transitions are checked.
  await rejects(db.rpc(pupil, "session_control", { p_session: s.id, p_action: "start" }), /Not your session/);
  await rejects(db.rpc(T, "session_control", { p_session: s.id, p_action: "next" }), /Start the lesson first/);
  await rejects(db.rpc(T, "session_control", { p_session: s.id, p_action: "fly" }), /Unknown action/);
  await db.admin("delete from realtime.sent");
  assert.equal((await db.rpc(T, "session_control", { p_session: s.id, p_action: "start" })).phase, "active");
  await rejects(db.rpc(T, "session_control", { p_session: s.id, p_action: "start" }), /already started/);
  // The state travels with the signal.
  const [sig] = await db.admin("select payload from realtime.sent where topic = $1 and event = 'state' order by id desc limit 1", [`session:${s.id}`]);
  assert.equal(sig.payload.phase, "active");
  assert.equal(sig.payload.slide, 0);

  // Navigation is bounded by the deck; answering works once active and on the slide.
  assert.equal((await db.rpc(T, "session_control", { p_session: s.id, p_action: "next" })).slide, 1);
  assert.equal((await db.rpc(T, "session_control", { p_session: s.id, p_action: "goto", p_args: { slide: 99 } })).slide, 2);
  assert.equal((await db.rpc(T, "session_control", { p_session: s.id, p_action: "prev" })).slide, 1);
  await db.rpc(T, "session_control", { p_session: s.id, p_action: "goto", p_args: { slide: 2 } });
  assert.ok((await db.rpc(pupil, "start_attempt", { p_activity: act, p_session: s.id })).attempt.id);

  // Pause ("eyes on teacher") blocks answering; resume.
  assert.equal((await db.rpc(T, "session_control", { p_session: s.id, p_action: "pause" })).phase, "paused");
  await rejects(db.rpc(g, "start_attempt", { p_activity: act, p_session: s.id }), /not open/);
  await rejects(db.rpc(T, "session_control", { p_session: s.id, p_action: "pause" }), /Only a running lesson/);
  assert.equal((await db.rpc(T, "session_control", { p_session: s.id, p_action: "resume" })).phase, "active");

  // Settings: no late joiners now; invalid settings refused.
  await rejects(db.rpc(T, "session_control", { p_session: s.id, p_action: "settings", p_args: { colour: true } }), /Unknown or invalid setting/);
  assert.equal((await db.rpc(T, "session_control", { p_session: s.id, p_action: "settings", p_args: { late_join: false } })).settings.late_join, false);
  const late = await db.signInAnonymously();
  await rejects(db.rpc(late, "join_session_as_guest", { p_code: s.join_code, p_name: "Latecomer" }), /late joiners/);

  // The teacher removes the classless student; they can't come back.
  const ts = await db.rpc(T, "teacher_session_state", { p_session: s.id });
  assert.equal(ts.roster.find((r) => r.student_id === pupil).guest, false);
  assert.equal(ts.roster.find((r) => r.student_id === g).avatar, "fox");
  await db.rpc(T, "session_control", { p_session: s.id, p_action: "kick", p_args: { user_id: pupil } });
  await rejects(db.rpc(pupil, "session_student_state", { p_session: s.id }), /removed you/);
  await rejects(db.rpc(pupil, "join_session", { p_code: s.join_code }), /removed you/);

  // End: the guest sees their summary.
  assert.equal((await db.rpc(T, "session_control", { p_session: s.id, p_action: "end" })).ended, true);
  st = await db.rpc(g, "session_student_state", { p_session: s.id });
  assert.equal(st.session.phase, "ended");
  assert.equal(st.summary.answered, 0);
});

test("points and leaderboard: server scoring, speed, streaks, private ranks (0890)", async () => {
  const T = await db.signUp("t@score.test", "Score Teacher");
  const tenant = (await db.rpc(T, "bootstrap_school", { p_school_name: "Score School", p_full_name: "Score Teacher" })).tenant_id;
  const [{ id: lesson }] = await db.admin("insert into public.lessons (tenant_id, owner_id, title, status) values ($1, $2, 'Quiz deck', 'published') returning id", [tenant, T]);
  const [{ id: act }] = await db.admin(`insert into public.activities (tenant_id, lesson_id, owner_id, kind, title, settings)
    values ($1, $2, $3, 'quiz', 'Quick quiz', '{"show_feedback": "immediately", "attempts_allowed": 1}') returning id`, [tenant, lesson, T]);
  await db.admin("insert into public.lesson_slides (tenant_id, lesson_id, position, kind, activity_id, content) values ($1, $2, 0, 'activity', $3, '{}')", [tenant, lesson, act]);
  const q = {};
  for (const [i, k] of ["q1", "q2", "q3", "poll"].entries()) {
    const kind = k === "poll" ? "poll" : "mcq";
    const [{ id }] = await db.admin("insert into public.questions (tenant_id, activity_id, owner_id, kind, prompt, points, position) values ($1, $2, $3, $4, $5, 1, $6) returning id", [tenant, act, T, kind, k, i]);
    const [{ id: right }] = await db.admin("insert into public.question_options (tenant_id, question_id, label, is_correct, position) values ($1, $2, 'right', $3, 0) returning id", [tenant, id, kind === "mcq"]);
    const [{ id: wrong }] = await db.admin("insert into public.question_options (tenant_id, question_id, label, is_correct, position) values ($1, $2, 'wrong', false, 1) returning id", [tenant, id]);
    q[k] = { id, right, wrong };
  }
  const s = await db.rpc(T, "start_session", { p_class: null, p_lesson: lesson });
  const players = {};
  for (const n of ["Ada", "Ben", "Cy"]) {
    players[n] = await db.signInAnonymously();
    await db.rpc(players[n], "join_session_as_guest", { p_code: s.join_code, p_name: n });
  }
  await db.rpc(T, "session_control", { p_session: s.id, p_action: "start" });
  const attempt = async (who) => (await db.rpc(players[who], "start_attempt", { p_activity: act, p_session: s.id })).attempt.id;
  const answer = (who, a, k, pick) => db.rpc(players[who], "submit_answer", { p_attempt: a, p_question: q[k].id, p_response: JSON.stringify({ option_id: q[k][pick] }) });

  // Ada: right, right (streak), wrong (streak resets), poll (taking part).
  const aA = await attempt("Ada");
  const r1 = await answer("Ada", aA, "q1", "right");
  assert.equal(r1.points.base, 1000);
  assert.ok(r1.points.speed >= 450, `fast answer earns most of the speed bonus (${r1.points.speed})`);
  assert.equal(r1.points.streak_bonus, 0);
  const r2 = await answer("Ada", aA, "q2", "right");
  assert.equal(r2.points.streak_bonus, 100);
  assert.equal(r2.points.streak, 2);
  const r3 = await answer("Ada", aA, "q3", "wrong");
  assert.equal(r3.points.points, 0, "wrong: no points");
  assert.equal(r3.points.streak, 0, "wrong: the streak resets");
  const r4 = await answer("Ada", aA, "poll", "right");
  assert.equal(r4.points.points, 100);
  const [ada] = await db.admin("select total_score, streak, correct_count from public.session_participants where session_id = $1 and user_id = $2", [s.id, players.Ada]);
  const [{ sum }] = await db.admin("select sum(points)::int as sum from public.quiz_answers where attempt_id = $1", [aA]);
  assert.equal(ada.total_score, sum, "the total is exactly the sum of the answers' points");
  assert.equal(ada.streak, 0);
  assert.equal(ada.correct_count, 2);

  // Ben: wrong. Cy: right with the speed bonus switched off for the lesson.
  const aB = await attempt("Ben");
  await answer("Ben", aB, "q1", "wrong");
  await db.rpc(T, "session_control", { p_session: s.id, p_action: "settings", p_args: { speed_bonus: false } });
  const aC = await attempt("Cy");
  assert.equal((await answer("Cy", aC, "q1", "right")).points.points, 1000);

  // Before the board is shown, students only know their own rank.
  let ben = await db.rpc(players.Ben, "session_student_state", { p_session: s.id });
  assert.equal(ben.leaderboard, null);
  assert.deepEqual([ben.my.rank, ben.my.of], [3, 3]);
  await rejects(db.rpc(players.Ben, "session_control", { p_session: s.id, p_action: "leaderboard" }), /Not your session/);

  // The teacher shows the board: one frozen snapshot for everyone.
  await db.rpc(T, "session_control", { p_session: s.id, p_action: "leaderboard", p_args: { show: true } });
  ben = await db.rpc(players.Ben, "session_student_state", { p_session: s.id });
  assert.deepEqual(ben.leaderboard.map((e) => e.name), ["Ada", "Cy", "Ben"]);
  assert.ok(ben.leaderboard.length <= 5);
  // Ben overtakes Cy (speed bonus back on); the next board shows the movement.
  await db.rpc(T, "session_control", { p_session: s.id, p_action: "settings", p_args: { speed_bonus: true } });
  await answer("Ben", aB, "q2", "right");
  await db.rpc(T, "session_control", { p_session: s.id, p_action: "leaderboard", p_args: { show: true } });
  const board = (await db.rpc(T, "teacher_session_state", { p_session: s.id })).session.leaderboard.top;
  assert.equal(board.find((e) => e.name === "Ben").delta, 1);
  assert.equal(board.find((e) => e.name === "Cy").delta, -1);

  // Anonymous names; a lesson without a public board; hiding it.
  await db.rpc(T, "session_control", { p_session: s.id, p_action: "settings", p_args: { anonymous_names: true } });
  await db.rpc(T, "session_control", { p_session: s.id, p_action: "leaderboard", p_args: { show: true } });
  assert.ok((await db.rpc(players.Cy, "session_student_state", { p_session: s.id })).leaderboard.every((e) => /^Player \d+$/.test(e.name)));
  await db.rpc(T, "session_control", { p_session: s.id, p_action: "settings", p_args: { leaderboard: false } });
  assert.equal((await db.rpc(players.Cy, "session_student_state", { p_session: s.id })).leaderboard, null);
  assert.equal((await db.rpc(T, "teacher_session_state", { p_session: s.id })).ranking.length, 3, "the teacher always sees the ranking");
  await db.rpc(T, "session_control", { p_session: s.id, p_action: "leaderboard", p_args: { show: false } });
  assert.equal((await db.rpc(T, "teacher_session_state", { p_session: s.id })).session.show_leaderboard, false);
  await db.rpc(T, "session_control", { p_session: s.id, p_action: "end" });
});

test("reveal closes the activity and shows the right answers; live answered counts (0900)", async () => {
  const T = await db.signUp("t@reveal.test", "Reveal Teacher");
  const tenant = (await db.rpc(T, "bootstrap_school", { p_school_name: "Reveal School", p_full_name: "Reveal Teacher" })).tenant_id;
  const [{ id: lesson }] = await db.admin("insert into public.lessons (tenant_id, owner_id, title, status) values ($1, $2, 'Reveal deck', 'published') returning id", [tenant, T]);
  const [{ id: act }] = await db.admin(`insert into public.activities (tenant_id, lesson_id, owner_id, kind, title, settings)
    values ($1, $2, $3, 'quiz', 'Check', '{"show_feedback": "after_submit"}') returning id`, [tenant, lesson, T]);
  await db.admin("insert into public.lesson_slides (tenant_id, lesson_id, position, kind, content) values ($1, $2, 0, 'title', '{}')", [tenant, lesson]);
  await db.admin("insert into public.lesson_slides (tenant_id, lesson_id, position, kind, activity_id, content) values ($1, $2, 1, 'activity', $3, '{}')", [tenant, lesson, act]);
  const [{ id: qid }] = await db.admin("insert into public.questions (tenant_id, activity_id, owner_id, kind, prompt, points, position) values ($1, $2, $3, 'mcq', '2+2?', 1, 0) returning id", [tenant, act, T]);
  const [{ id: right }] = await db.admin("insert into public.question_options (tenant_id, question_id, label, is_correct, position) values ($1, $2, '4', true, 0) returning id", [tenant, qid]);
  const [{ id: wrong }] = await db.admin("insert into public.question_options (tenant_id, question_id, label, is_correct, position) values ($1, $2, '5', false, 1) returning id", [tenant, qid]);

  const s = await db.rpc(T, "start_session", { p_class: null, p_lesson: lesson });
  const [a, b, c] = [await db.signInAnonymously(), await db.signInAnonymously(), await db.signInAnonymously()];
  for (const [g, n] of [[a, "Amy"], [b, "Bola"], [c, "Chidi"]]) await db.rpc(g, "join_session_as_guest", { p_code: s.join_code, p_name: n });
  await db.rpc(T, "session_control", { p_session: s.id, p_action: "start" });
  await rejects(db.rpc(T, "session_control", { p_session: s.id, p_action: "reveal" }), /no activity on this slide/);
  await db.rpc(T, "session_control", { p_session: s.id, p_action: "next" });

  // Amy answers right, Bola wrong, Chidi doesn't answer. The teacher sees 2 of 3.
  const ta = (await db.rpc(a, "start_attempt", { p_activity: act, p_session: s.id })).attempt.id;
  const tb = (await db.rpc(b, "start_attempt", { p_activity: act, p_session: s.id })).attempt.id;
  await db.rpc(a, "submit_answer", { p_attempt: ta, p_question: qid, p_response: JSON.stringify({ option_id: right }) });
  await db.rpc(b, "submit_answer", { p_attempt: tb, p_question: qid, p_response: JSON.stringify({ option_id: wrong }) });
  let ts = await db.rpc(T, "teacher_session_state", { p_session: s.id });
  assert.equal(ts.activity.activity.id, act, "the activity on the current slide, without launching it");
  assert.deepEqual([ts.activity.answered, ts.activity.joined, ts.activity.revealed], [2, 3, false]);

  // Shared results before the reveal: counts, but not which option is right.
  await db.rpc(T, "set_session_state", { p_session: s.id, p_responses_visible: true });
  // Regression (0900): changing a setting without naming a slide kept the class where it was.
  assert.equal((await db.admin("select current_slide from public.class_sessions where id = $1", [s.id]))[0].current_slide, 1);
  let seen = await db.rpc(c, "activity_results", { p_activity: act, p_session: s.id });
  assert.ok(seen.questions[0].options.every((o) => o.is_correct === null));

  // Reveal: unfinished attempts are submitted, no more answers, right answers shown.
  await db.rpc(T, "session_control", { p_session: s.id, p_action: "reveal" });
  const statuses = await db.admin("select status from public.quiz_attempts where session_id = $1", [s.id]);
  assert.ok(statuses.every((r) => r.status !== "in_progress"));
  await rejects(db.rpc(b, "submit_answer", { p_attempt: tb, p_question: qid, p_response: JSON.stringify({ option_id: right }) }), /already been submitted|closed/);
  await rejects(db.rpc(c, "start_attempt", { p_activity: act, p_session: s.id }), /not open/);
  seen = await db.rpc(c, "activity_results", { p_activity: act, p_session: s.id });
  assert.equal(seen.questions[0].options.find((o) => o.id === right).is_correct, true);
  assert.equal(seen.questions[0].options.find((o) => o.id === right).count, 1);
  assert.equal((await db.rpc(c, "session_student_state", { p_session: s.id })).revealed_activity_id, act);
  ts = await db.rpc(T, "teacher_session_state", { p_session: s.id });
  assert.equal(ts.activity.revealed, true);
  await rejects(db.rpc(a, "session_control", { p_session: s.id, p_action: "reveal" }), /Not your session/);
  await db.rpc(T, "session_control", { p_session: s.id, p_action: "end" });
});

test("moving to another slide closes the launched activity and hides results (1010)", async () => {
  const T = await db.signUp("t@slides.test", "Slides Teacher");
  const tenant = (await db.rpc(T, "bootstrap_school", { p_school_name: "Slides School", p_full_name: "Slides Teacher" })).tenant_id;
  const [{ id: lesson }] = await db.admin("insert into public.lessons (tenant_id, owner_id, title, status) values ($1, $2, 'Deck', 'published') returning id", [tenant, T]);
  const [{ id: q1 }] = await db.admin("insert into public.activities (tenant_id, lesson_id, owner_id, kind, title) values ($1, $2, $3, 'quiz', 'First') returning id", [tenant, lesson, T]);
  const [{ id: q2 }] = await db.admin("insert into public.activities (tenant_id, lesson_id, owner_id, kind, title) values ($1, $2, $3, 'quiz', 'Second') returning id", [tenant, lesson, T]);
  await db.admin("insert into public.lesson_slides (tenant_id, lesson_id, position, kind, activity_id, content) values ($1, $2, 0, 'activity', $3, '{}')", [tenant, lesson, q1]);
  await db.admin("insert into public.lesson_slides (tenant_id, lesson_id, position, kind, content) values ($1, $2, 1, 'title', '{}')", [tenant, lesson]);
  await db.admin("insert into public.lesson_slides (tenant_id, lesson_id, position, kind, activity_id, content) values ($1, $2, 2, 'activity', $3, '{}')", [tenant, lesson, q2]);
  const s = await goLive(T, { p_class: null, p_lesson: lesson });
  const row = async () => (await db.admin("select current_slide, active_activity_id, responses_visible from public.class_sessions where id = $1", [s.id]))[0];

  // The first question is launched, revealed (which shares results), then the teacher moves on.
  await db.rpc(T, "set_session_state", { p_session: s.id, p_activity: q1 });
  await db.rpc(T, "session_control", { p_session: s.id, p_action: "reveal" });
  assert.equal((await row()).responses_visible, true);
  await db.rpc(T, "session_control", { p_session: s.id, p_action: "next" });
  assert.deepEqual(await row(), { current_slide: 1, active_activity_id: null, responses_visible: false });
  assert.equal((await db.rpc(T, "teacher_session_state", { p_session: s.id })).activity, null, "the plain slide shows, not the old question");

  // The next activity slide shows its own question; going back shows the first again.
  await db.rpc(T, "session_control", { p_session: s.id, p_action: "next" });
  assert.equal((await db.rpc(T, "teacher_session_state", { p_session: s.id })).activity.activity.id, q2);
  await db.rpc(T, "session_control", { p_session: s.id, p_action: "goto", p_args: { slide: 0 } });
  assert.equal((await db.rpc(T, "teacher_session_state", { p_session: s.id })).activity.activity.id, q1);

  // Launching or sharing in the same change as a slide move is kept.
  await db.rpc(T, "set_session_state", { p_session: s.id, p_slide: 2, p_activity: q2, p_responses_visible: true });
  assert.deepEqual(await row(), { current_slide: 2, active_activity_id: q2, responses_visible: true });
  // Settings changes that don't move the slide leave the activity open.
  await db.rpc(T, "set_session_state", { p_session: s.id, p_group_chat: false });
  assert.equal((await row()).active_activity_id, q2);
  await db.rpc(T, "session_control", { p_session: s.id, p_action: "end" });
});

test("a lesson ends when the teacher closes it, without End session (1020)", async () => {
  const T = await db.signUp("t@closes.test", "Closing Teacher");
  await db.rpc(T, "bootstrap_school", { p_school_name: "Closing School", p_full_name: "Closing Teacher" });
  const s = await goLive(T, { p_class: null });
  const g = await db.signInAnonymously();
  await db.rpc(g, "join_session_as_guest", { p_code: s.join_code, p_name: "Uche" });
  const status = async (id) => (await db.admin("select status from public.class_sessions where id = $1", [id]))[0].status;
  const tick = async () => {
    await db.admin("update public.session_participants set last_seen_at = now() - interval '1 minute' where user_id = $1", [g]);
    await db.rpc(g, "student_report", { p_session: s.id, p_visible: true, p_fullscreen: false, p_sharing: false });
  };

  // Only the lesson's teacher reports their presence.
  await rejects(db.rpc(g, "teacher_here", { p_session: s.id }), /not found/);
  await db.rpc(T, "teacher_here", { p_session: s.id });

  // Closing the tab, then a refresh coming back: the lesson carries on.
  await db.rpc(T, "teacher_here", { p_session: s.id, p_here: false });
  await tick();
  assert.equal(await status(s.id), "live", "within the 45-second grace");
  await db.rpc(T, "teacher_here", { p_session: s.id });
  await db.admin("update public.class_sessions set teacher_left_at = null, teacher_seen_at = now() - interval '2 minutes' where id = $1", [s.id]);
  await tick();
  assert.equal(await status(s.id), "live");

  // Closed for good: the next student tick ends it for everyone, with a report the teacher sees.
  await db.rpc(T, "teacher_here", { p_session: s.id, p_here: false });
  await db.admin("update public.class_sessions set teacher_left_at = now() - interval '1 minute' where id = $1", [s.id]);
  await tick();
  assert.equal(await status(s.id), "ended");
  assert.equal((await db.rpc(g, "session_student_state", { p_session: s.id })).session.status, "ended");
  const reports = await db.as(T, "select id from public.reports where scope_id = $1", [s.id]);
  assert.equal(reports.length, 1);
  assert.equal((await db.rpc(T, "session_report", { p_session: s.id })).version, 2);

  // The teacher's page went silent (no internet, laptop shut) and nobody is in it: the minute job ends it.
  const quiet = await goLive(T, { p_class: null });
  const busy = await goLive(T, { p_class: null });
  await db.rpc(T, "teacher_here", { p_session: busy.id });
  await db.admin("update public.class_sessions set teacher_seen_at = now() - interval '4 minutes' where id = $1", [quiet.id]);
  await db.admin("select app.end_teacherless_sessions()");
  assert.deepEqual([await status(quiet.id), await status(busy.id)], ["ended", "live"]);

  // End session still ends at once, with the full report.
  const ended = await db.rpc(T, "end_session", { p_session: busy.id });
  assert.ok(ended.report_id);
  assert.equal((await db.admin("select payload ->> 'version' v from public.reports where id = $1", [ended.report_id]))[0].v, "2");
});

test("the lobby shows who has joined, to people in the lesson only (1030)", async () => {
  const T = await db.signUp("t@lobby.test", "Lobby Teacher");
  await db.rpc(T, "bootstrap_school", { p_school_name: "Lobby School", p_full_name: "Lobby Teacher" });
  const s = await db.rpc(T, "start_session", { p_class: null });   // in the lobby until Start
  const [a, b] = [await db.signInAnonymously(), await db.signInAnonymously()];
  await db.rpc(a, "join_session_as_guest", { p_code: s.join_code, p_name: "Amaka Obi" });
  await db.rpc(b, "join_session_as_guest", { p_code: s.join_code, p_name: "Bayo" });
  await db.rpc(a, "set_avatar", { p_session: s.id, p_avatar: "owl" });

  const seen = await db.rpc(b, "session_lobby", { p_session: s.id });
  assert.deepEqual(seen.map((p) => [p.name, p.avatar, p.me]), [["Amaka O.", "owl", false], ["Bayo", null, true]]);
  // Not to someone outside the lesson.
  const outsider = await db.signInAnonymously();
  await rejects(db.rpc(outsider, "session_lobby", { p_session: s.id }), /not found/);
  // Anonymous names: avatars only.
  await db.rpc(T, "session_control", { p_session: s.id, p_action: "settings", p_args: { anonymous_names: true } });
  assert.deepEqual((await db.rpc(a, "session_lobby", { p_session: s.id })).map((p) => p.name), [null, null]);
  // Once the lesson starts, the list is gone.
  await db.rpc(T, "session_control", { p_session: s.id, p_action: "start" });
  assert.deepEqual(await db.rpc(a, "session_lobby", { p_session: s.id }), []);
  await db.rpc(T, "end_session", { p_session: s.id });
});

test("designed slides: canvas kind, size cap, only the lesson's school can edit (0910)", async () => {
  const T = await db.signUp("t@canvas.test", "Canvas Teacher");
  const tenant = (await db.rpc(T, "bootstrap_school", { p_school_name: "Canvas School", p_full_name: "Canvas Teacher" })).tenant_id;
  const [{ id: lesson }] = await db.admin("insert into public.lessons (tenant_id, owner_id, title) values ($1, $2, 'Designed deck') returning id", [tenant, T]);
  const content = { background: { color: "#0f172a" }, elements: [{ id: "a", type: "text", x: 100, y: 100, w: 800, h: 160, text: "Hello", size: 96 }] };
  const [{ id: slide }] = await db.as(T, "insert into public.lesson_slides (tenant_id, lesson_id, position, kind, content) values ($1, $2, 0, 'canvas', $3) returning id",
    [tenant, lesson, JSON.stringify(content)]);
  assert.ok(slide);
  await rejects(db.as(T, "update public.lesson_slides set content = $2 where id = $1",
    [slide, JSON.stringify({ elements: [{ id: "b", type: "text", text: "x".repeat(300000) }] })]), /lesson_slides_content_size/);
  // Another school's teacher can neither see nor change it.
  const rows = await db.as(S.teacherB ?? S.adminB, "update public.lesson_slides set content = '{}' where id = $1 returning id", [slide]);
  assert.equal(rows.length, 0);
  assert.equal((await db.admin("select content -> 'elements' -> 0 ->> 'text' t from public.lesson_slides where id = $1", [slide]))[0].t, "Hello");

  // A guest in the live lesson may load the pictures placed on its designed slides, and nothing else.
  const pic = `${tenant}/${T}/photo.jpg`, back = `${tenant}/${T}/back.jpg`;
  await db.admin("update public.lesson_slides set content = $2 where id = $1", [slide, JSON.stringify({ background: { media_path: back },
    elements: [{ id: "p", type: "image", x: 0, y: 0, w: 800, h: 450, media_path: pic, alt: "A photo" }] })]);
  const s = await db.rpc(T, "start_session", { p_class: null, p_lesson: lesson });
  const g = await db.signInAnonymously();
  await db.rpc(g, "join_session_as_guest", { p_code: s.join_code, p_name: "Gina" });
  const can = async (p) => (await db.as(g, "select app.guest_can_read_media($1) ok", [p]))[0].ok;
  assert.equal(await can(pic), true);
  assert.equal(await can(back), true);
  assert.equal(await can(`${tenant}/${T}/other.jpg`), false);
});

/** A school with a class, a quiz lesson (one choice question, one written), and a live session. */
async function lessonWithQuiz(tag) {
  const T = await db.signUp(`t@${tag}.test`, `${tag} Teacher`);
  const tenant = (await db.rpc(T, "bootstrap_school", { p_school_name: `${tag} School`, p_full_name: `${tag} Teacher` })).tenant_id;
  const cls = await db.rpc(T, "create_class", { p_name: `${tag} 1` });
  const [{ id: lesson }] = await db.admin("insert into public.lessons (tenant_id, owner_id, title, status) values ($1, $2, 'Light', 'published') returning id", [tenant, T]);
  const [{ id: act }] = await db.admin(`insert into public.activities (tenant_id, lesson_id, owner_id, kind, title, settings)
    values ($1, $2, $3, 'quiz', 'Check', '{"show_feedback": "after_submit"}') returning id`, [tenant, lesson, T]);
  await db.admin("insert into public.lesson_slides (tenant_id, lesson_id, position, kind, content) values ($1, $2, 0, 'canvas', '{}')", [tenant, lesson]);
  await db.admin("insert into public.lesson_slides (tenant_id, lesson_id, position, kind, activity_id, content) values ($1, $2, 1, 'activity', $3, '{}')", [tenant, lesson, act]);
  const [{ id: q1 }] = await db.admin("insert into public.questions (tenant_id, activity_id, owner_id, kind, prompt, points, position) values ($1, $2, $3, 'mcq', 'Light travels fastest in?', 1, 0) returning id", [tenant, act, T]);
  const [{ id: right }] = await db.admin("insert into public.question_options (tenant_id, question_id, label, is_correct, position) values ($1, $2, 'A vacuum', true, 0) returning id", [tenant, q1]);
  const [{ id: wrong }] = await db.admin("insert into public.question_options (tenant_id, question_id, label, is_correct, position) values ($1, $2, 'Glass', false, 1) returning id", [tenant, q1]);
  const [{ id: q2 }] = await db.admin("insert into public.questions (tenant_id, activity_id, owner_id, kind, prompt, points, position) values ($1, $2, $3, 'open', 'Why?', 0, 1) returning id", [tenant, act, T]);
  const s = await db.rpc(T, "start_session", { p_class: cls.id, p_lesson: lesson });
  return { T, tenant, cls, lesson, act, q1, q2, right, wrong, s };
}

test("session report: everyone who took part, scores and ranks, each question (0920)", async () => {
  const L = await lessonWithQuiz("Report");
  const [ada, absent] = [await db.signUp("ada@report.test", "Ada Obi"), await db.signUp("ben@report.test", "Ben Absent")];
  for (const p of [ada, absent]) await db.rpc(p, "redeem_code", { p_code: L.cls.join_code });
  await db.rpc(ada, "join_session", { p_code: L.s.join_code });
  const gina = await db.signInAnonymously();
  await db.rpc(gina, "join_session_as_guest", { p_code: L.s.join_code, p_name: "Gina" });
  await db.rpc(L.T, "session_control", { p_session: L.s.id, p_action: "start" });
  await db.rpc(L.T, "session_control", { p_session: L.s.id, p_action: "next" });

  const ta = (await db.rpc(ada, "start_attempt", { p_activity: L.act, p_session: L.s.id })).attempt.id;
  await db.rpc(ada, "submit_answer", { p_attempt: ta, p_question: L.q1, p_response: JSON.stringify({ option_id: L.right }) });
  await db.rpc(ada, "submit_answer", { p_attempt: ta, p_question: L.q2, p_response: JSON.stringify({ text: "Nothing slows it down" }) });
  const tg = (await db.rpc(gina, "start_attempt", { p_activity: L.act, p_session: L.s.id })).attempt.id;
  await db.rpc(gina, "submit_answer", { p_attempt: tg, p_question: L.q1, p_response: JSON.stringify({ option_id: L.wrong }) });
  const ended = await db.rpc(L.T, "end_session", { p_session: L.s.id });

  const r = await db.rpc(L.T, "session_report", { p_session: L.s.id });
  assert.equal(r.version, 2);
  assert.deepEqual([r.enrolled, r.joined, r.guests, r.accuracy], [2, 2, 1, 50]);
  assert.equal(r.monitoring, false);
  assert.equal(r.commands, null, "monitoring numbers only when the school has monitoring");
  const by = Object.fromEntries(r.students.map((x) => [x.name, x]));
  assert.deepEqual(Object.keys(by).sort(), ["Ada Obi", "Ben Absent", "Gina"]);
  assert.equal(by["Ada Obi"].rank, 1);
  assert.ok(by["Ada Obi"].score > 0);
  assert.equal(by["Ada Obi"].accuracy, 100);
  assert.deepEqual([by.Gina.guest, by.Gina.rank, by.Gina.accuracy, by.Gina.answers], [true, 2, 0, 1]);
  assert.deepEqual([by["Ben Absent"].joined, by["Ben Absent"].rank], [false, null]);
  assert.equal(r.students[0].name, "Ada Obi", "ranked first");

  const [q1, q2] = r.questions;
  assert.equal(q1.prompt, "Light travels fastest in?");
  assert.deepEqual([q1.answered, q1.correct, q1.accuracy], [2, 1, 50]);
  assert.deepEqual(q1.options.map((o) => [o.label, o.count, o.is_correct]), [["A vacuum", 1, true], ["Glass", 1, false]]);
  assert.deepEqual(q1.missed_by, ["Gina"]);
  assert.deepEqual(q2.written.map((w) => [w.name, w.text]), [["Ada Obi", "Nothing slows it down"]]);
  assert.equal(q1.written, null);

  // The report saved when the lesson ended has the same shape.
  const [saved] = await db.admin("select payload from public.reports where id = $1", [ended.report_id]);
  assert.equal(saved.payload.version, 2);
  assert.equal(saved.payload.questions.length, 2);
  // Only the lesson's teacher (or the school's admins) may see it.
  await rejects(db.rpc(ada, "session_report", { p_session: L.s.id }), /Session not found/);
});

test("cross-school isolation: live lessons, answers, reports and slides stay inside their school", async () => {
  const X = await lessonWithQuiz("Xschool");
  const Y = await lessonWithQuiz("Yschool");
  const pupil = await db.signUp("pupil@xschool.test", "Xavier Pupil");
  await db.rpc(pupil, "redeem_code", { p_code: X.cls.join_code });
  await db.rpc(pupil, "join_session", { p_code: X.s.join_code });
  await db.rpc(X.T, "session_control", { p_session: X.s.id, p_action: "start" });
  await db.rpc(X.T, "session_control", { p_session: X.s.id, p_action: "next" });
  const at = (await db.rpc(pupil, "start_attempt", { p_activity: X.act, p_session: X.s.id })).attempt.id;
  await db.rpc(pupil, "submit_answer", { p_attempt: at, p_question: X.q1, p_response: JSON.stringify({ option_id: X.right }) });
  const yGuest = await db.signInAnonymously();
  await db.rpc(yGuest, "join_session_as_guest", { p_code: Y.s.join_code, p_name: "Yemi" });

  // School Y's teacher (who is also its admin) can't see or steer school X's lesson.
  const O = Y.T;
  await rejects(db.rpc(O, "teacher_session_state", { p_session: X.s.id }), /not found/i);
  await rejects(db.rpc(O, "session_control", { p_session: X.s.id, p_action: "next" }), /not found|Not your session/i);
  await rejects(db.rpc(O, "session_report", { p_session: X.s.id }), /Session not found/);
  await rejects(db.rpc(O, "activity_results", { p_activity: X.act, p_session: X.s.id }), /not found|not allowed|Not your/i);
  const none = async (sql, args) => assert.equal((await db.as(O, sql, args)).length, 0, sql);
  await none("select 1 from public.class_sessions where id = $1", [X.s.id]);
  await none("select 1 from public.session_participants where session_id = $1", [X.s.id]);
  await none("select 1 from public.quiz_attempts where session_id = $1", [X.s.id]);
  await none("select 1 from public.quiz_answers where question_id = $1", [X.q1]);
  await none("select 1 from public.questions where id = $1", [X.q1]);
  await none("select 1 from public.lesson_slides where lesson_id = $1", [X.lesson]);
  await none("select 1 from public.session_guests where session_id = $1", [X.s.id]);
  // Nor change school X's slides.
  assert.equal((await db.as(O, "update public.lesson_slides set content = '{}' where lesson_id = $1 returning id", [X.lesson])).length, 0);

  // A guest of school Y's lesson reaches only that lesson.
  await rejects(db.rpc(yGuest, "session_student_state", { p_session: X.s.id }), /not found/i);
  await rejects(db.rpc(yGuest, "start_attempt", { p_activity: X.act, p_session: X.s.id }), /not found|not open|not allowed/i);
  assert.equal((await db.as(yGuest, "select 1 from public.lesson_slides where lesson_id = $1", [X.lesson])).length, 0);

  // School X's report is invisible to school Y once the lesson ends.
  const ended = await db.rpc(X.T, "end_session", { p_session: X.s.id });
  await none("select 1 from public.reports where id = $1", [ended.report_id]);
});

test("progress: periods, subjects and topics; seen by the student, their parent and teachers only (0930)", async () => {
  const T = await db.signUp("t@progress.test", "Progress Teacher");
  const tenant = (await db.rpc(T, "bootstrap_school", { p_school_name: "Progress School", p_full_name: "Progress Teacher" })).tenant_id;
  const cls = await db.rpc(T, "create_class", { p_name: "JSS 2" });
  const [ada, ben] = [await db.signUp("ada@progress.test", "Ada Obi"), await db.signUp("ben@progress.test", "Ben Ade")];
  for (const p of [ada, ben]) await db.rpc(p, "redeem_code", { p_code: cls.join_code });
  const inv = await db.rpc(T, "create_invite", { p_role: "parent", p_student: ada });
  const mum = await db.signUp("mum@progress.test", "Mrs Obi");
  await db.rpc(mum, "redeem_code", { p_code: inv.code });
  await db.as(T, "update public.tenant_settings set parent_portal_enabled = true");

  // A maths lesson: three questions on Fractions (Ada gets them right), three on Decimals (wrong), one untagged (right).
  const [{ id: lesson }] = await db.admin("insert into public.lessons (tenant_id, owner_id, title, subject, status) values ($1, $2, 'Numbers', 'Mathematics', 'published') returning id", [tenant, T]);
  const [{ id: act }] = await db.admin(`insert into public.activities (tenant_id, lesson_id, owner_id, kind, title, settings)
    values ($1, $2, $3, 'quiz', 'Check', '{"show_feedback": "after_submit"}') returning id`, [tenant, lesson, T]);
  await db.admin("insert into public.lesson_slides (tenant_id, lesson_id, position, kind, content) values ($1, $2, 0, 'canvas', '{}')", [tenant, lesson]);
  await db.admin("insert into public.lesson_slides (tenant_id, lesson_id, position, kind, activity_id, content) values ($1, $2, 1, 'activity', $3, '{}')", [tenant, lesson, act]);
  const qs = [];
  for (const [i, topic, rightAnswer] of [[0, "Fractions", true], [1, "Fractions", true], [2, "Fractions", true], [3, "Decimals", false], [4, "Decimals", false], [5, "Decimals", false], [6, null, true]]) {
    const [{ id: q }] = await db.admin("insert into public.questions (tenant_id, activity_id, owner_id, kind, prompt, points, position, topic) values ($1, $2, $3, 'mcq', $4, 1, $5, $6) returning id",
      [tenant, act, T, `Q${i}`, i, topic]);
    const [{ id: right }] = await db.admin("insert into public.question_options (tenant_id, question_id, label, is_correct, position) values ($1, $2, 'yes', true, 0) returning id", [tenant, q]);
    const [{ id: wrong }] = await db.admin("insert into public.question_options (tenant_id, question_id, label, is_correct, position) values ($1, $2, 'no', false, 1) returning id", [tenant, q]);
    qs.push({ q, pick: rightAnswer ? right : wrong });
  }
  await rejects(db.admin("update public.questions set topic = ' ' where id = $1", [qs[0].q]), /questions_topic_check/);

  const s1 = await db.rpc(T, "start_session", { p_class: cls.id, p_lesson: lesson });
  await db.rpc(ada, "join_session", { p_code: s1.join_code });
  await db.rpc(T, "session_control", { p_session: s1.id, p_action: "start" });
  await db.rpc(T, "session_control", { p_session: s1.id, p_action: "next" });
  const at = (await db.rpc(ada, "start_attempt", { p_activity: act, p_session: s1.id })).attempt.id;
  for (const { q, pick } of qs) await db.rpc(ada, "submit_answer", { p_attempt: at, p_question: q, p_response: JSON.stringify({ option_id: pick }) });
  await db.rpc(T, "end_session", { p_session: s1.id });
  // A second lesson Ada misses.
  const s2 = await db.rpc(T, "start_session", { p_class: cls.id, p_lesson: lesson });
  await db.rpc(T, "session_control", { p_session: s2.id, p_action: "start" });
  await db.rpc(T, "end_session", { p_session: s2.id });

  const r = await db.rpc(ada, "progress_report", { p_student: ada, p_period: "week" });
  assert.deepEqual([r.summary.held, r.summary.attended, r.summary.answers, r.summary.correct, r.summary.accuracy], [2, 1, 7, 4, 57]);
  assert.equal(r.trend.length, 7, "a week has seven days");
  assert.equal(r.trend.reduce((n, d) => n + d.answers, 0), 7);
  assert.equal(r.subjects[0].subject, "Mathematics");
  assert.deepEqual(r.subjects[0].topics.map((t) => [t.topic, t.accuracy]), [["Decimals", 0], ["Fractions", 100], ["Numbers", 100]],
    "weakest first; an untagged question counts under the lesson title");
  assert.deepEqual(r.strengths.map((t) => t.topic), ["Fractions"]);
  assert.deepEqual(r.needs_help.map((t) => [t.subject, t.topic, t.accuracy]), [["Mathematics", "Decimals", 0]]);
  assert.deepEqual(r.lessons.map((l) => l.attended).sort(), [false, true]);
  assert.equal(r.lessons.find((l) => l.attended).accuracy, 57);

  for (const p of ["day", "month"]) assert.equal((await db.rpc(ada, "progress_report", { p_student: ada, p_period: p })).summary.answers, 7, p);
  const year = await db.rpc(ada, "progress_report", { p_student: ada, p_period: "year" });
  assert.match(year.label, /^School year \d{4}\/\d{4}$/, "September to August until the school enters its terms");
  assert.equal(year.trend.length, 12);
  assert.equal((await db.rpc(ada, "progress_report", { p_student: ada, p_period: "term" })).needs_terms, true);

  // The school admin enters the terms; students can't.
  await db.as(T, `insert into public.school_terms (tenant_id, school_year, name, starts_on, ends_on)
    values ($1, '2026/2027', 'First term', current_date - 10, current_date + 30), ($1, '2026/2027', 'Second term', current_date + 45, current_date + 120)`, [tenant]);
  await rejects(db.as(T, "insert into public.school_terms (tenant_id, school_year, name, starts_on, ends_on) values ($1, '2026/2027', 'Clash', current_date, current_date + 5)", [tenant]), /overlap/);
  await rejects(db.as(ada, "insert into public.school_terms (tenant_id, school_year, name, starts_on, ends_on) values ($1, '2027/2028', 'Mine', current_date + 300, current_date + 310)", [tenant]), /row-level security|permission/);
  const term = await db.rpc(ada, "progress_report", { p_student: ada, p_period: "term" });
  assert.deepEqual([term.label, term.summary.answers, term.prev_date], ["First term, 2026/2027", 7, null]);
  const sy = await db.rpc(ada, "progress_report", { p_student: ada, p_period: "year" });
  assert.equal(sy.label, "School year 2026/2027");

  // Who may see it: Ada, her parent, her teacher. Not a classmate, not her parent for another child, not another school.
  assert.equal((await db.rpc(mum, "progress_report", { p_student: ada, p_period: "week" })).summary.answers, 7);
  assert.equal((await db.rpc(T, "progress_report", { p_student: ada, p_period: "week" })).summary.answers, 7);
  await rejects(db.rpc(mum, "progress_report", { p_student: ben, p_period: "week" }), /Report not found/);
  await rejects(db.rpc(ben, "progress_report", { p_student: ada, p_period: "week" }), /Report not found/);
  await rejects(db.rpc(S.teacherA, "progress_report", { p_student: ada, p_period: "week" }), /Report not found/);
  await rejects(db.rpc(ada, "progress_report", { p_student: ada, p_period: "decade" }), /Period is/);
  // Turning the parent portal off hides it from parents again.
  await db.as(T, "update public.tenant_settings set parent_portal_enabled = false");
  await rejects(db.rpc(mum, "progress_report", { p_student: ada, p_period: "week" }), /Report not found/);
});

test("game countdown: shared clock, answers close when time is up, pause stops the clock (0940)", async () => {
  const L = await lessonWithQuiz("Timer");
  const kid = await db.signInAnonymously();
  await db.rpc(kid, "join_session_as_guest", { p_code: L.s.join_code, p_name: "Kemi" });
  const late = await db.signInAnonymously();
  await db.rpc(late, "join_session_as_guest", { p_code: L.s.join_code, p_name: "Lola" });
  await db.rpc(L.T, "session_control", { p_session: L.s.id, p_action: "start" });
  assert.equal((await db.rpc(kid, "session_student_state", { p_session: L.s.id })).timer, null, "no countdown on a content slide");
  await db.rpc(L.T, "session_control", { p_session: L.s.id, p_action: "next" });

  // One choice question (20 s) and one written answer (90 s) on this activity.
  let st = await db.rpc(kid, "session_student_state", { p_session: L.s.id });
  assert.equal(st.timer.activity_id, L.act);
  assert.equal(st.timer.seconds, 110);
  assert.equal(new Date(st.timer.ends_at) - new Date(st.timer.started_at), 110000);
  assert.equal((await db.rpc(L.T, "teacher_session_state", { p_session: L.s.id })).timer.ends_at, st.timer.ends_at, "one clock for everyone");

  const a = (await db.rpc(kid, "start_attempt", { p_activity: L.act, p_session: L.s.id })).attempt.id;
  await db.rpc(kid, "submit_answer", { p_attempt: a, p_question: L.q1, p_response: JSON.stringify({ option_id: L.right }) });

  // Time runs out: answers are refused.
  await db.admin("update public.class_sessions set slide_changed_at = now() - interval '2 minutes' where id = $1", [L.s.id]);
  const b = (await db.rpc(late, "start_attempt", { p_activity: L.act, p_session: L.s.id })).attempt.id;
  await rejects(db.rpc(late, "submit_answer", { p_attempt: b, p_question: L.q1, p_response: JSON.stringify({ option_id: L.right }) }), /Time's up/);

  // A pause doesn't count: 100 s gone, then a 60 s pause, then resume: 10 s are left.
  await db.admin("update public.class_sessions set slide_changed_at = now() - interval '100 seconds' where id = $1", [L.s.id]);
  await db.rpc(L.T, "session_control", { p_session: L.s.id, p_action: "pause" });
  assert.equal((await db.rpc(kid, "session_student_state", { p_session: L.s.id })).timer, null, "no countdown while paused");
  await db.admin("update public.class_sessions set paused_at = now() - interval '60 seconds' where id = $1", [L.s.id]);
  await db.rpc(L.T, "session_control", { p_session: L.s.id, p_action: "resume" });
  st = await db.rpc(kid, "session_student_state", { p_session: L.s.id });
  const left = (new Date(st.timer.ends_at) - new Date(st.server_now)) / 1000;
  assert.ok(left > 60 && left < 75, `about 70 s left after the pause, got ${left}`);
  await db.rpc(late, "submit_answer", { p_attempt: b, p_question: L.q1, p_response: JSON.stringify({ option_id: L.right }) });

  // The teacher can turn the countdown off; then late answers are fine.
  await rejects(db.rpc(L.T, "session_control", { p_session: L.s.id, p_action: "settings", p_args: { countdown: false } }), /Unknown or invalid setting/);
  await db.rpc(L.T, "session_control", { p_session: L.s.id, p_action: "settings", p_args: { timer: false, auto_reveal: false } });
  await db.admin("update public.class_sessions set slide_changed_at = now() - interval '10 minutes' where id = $1", [L.s.id]);
  assert.equal((await db.rpc(kid, "session_student_state", { p_session: L.s.id })).timer, null);
  await db.rpc(kid, "submit_answer", { p_attempt: a, p_question: L.q2, p_response: JSON.stringify({ text: "Because" }) });

  // Once revealed, there is no countdown either.
  await db.rpc(L.T, "session_control", { p_session: L.s.id, p_action: "settings", p_args: { timer: true } });
  await db.rpc(L.T, "session_control", { p_session: L.s.id, p_action: "reveal" });
  assert.equal((await db.rpc(L.T, "teacher_session_state", { p_session: L.s.id })).timer, null);
});

test("roles: teachers see their own subjects, parent codes, feedback to teachers, school progress (0950)", async () => {
  const A = await db.signUp("head@roles.test", "Head Teacher");
  const tenant = (await db.rpc(A, "bootstrap_school", { p_school_name: "Roles School", p_full_name: "Head Teacher" })).tenant_id;
  await db.admin("update public.tenants set plan_code = 'school' where id = $1", [tenant]);
  const staff = async (email, name) => {
    const inv = await db.rpc(A, "create_invite", { p_role: "teacher", p_email: email });
    const u = await db.signUp(email, name);
    await db.rpc(u, "redeem_code", { p_code: inv.code });
    return u;
  };
  const [maths, english] = [await staff("maths@roles.test", "Mr Maths"), await staff("english@roles.test", "Mrs English")];
  const mc = await db.rpc(maths, "create_class", { p_name: "JSS2 Maths", p_subject: "Mathematics" });
  const ec = await db.rpc(english, "create_class", { p_name: "JSS2 English", p_subject: "English" });
  const [ada, obi] = [await db.signUp("ada@roles.test", "Ada Obi"), await db.signUp("obi@roles.test", "Obi Obi")];
  for (const kid of [ada, obi]) for (const c of [mc, ec]) await db.rpc(kid, "redeem_code", { p_code: c.join_code });
  await db.as(A, "update public.tenant_settings set parent_portal_enabled = true");

  // One quiz lesson per subject, taught live, Ada answers right in maths and wrong in English.
  const teach = async (T, cls, subject, right) => {
    const [{ id: lesson }] = await db.admin("insert into public.lessons (tenant_id, owner_id, title, subject, status) values ($1, $2, $3, $4, 'published') returning id", [tenant, T, `${subject} lesson`, subject]);
    const [{ id: act }] = await db.admin("insert into public.activities (tenant_id, lesson_id, owner_id, kind, title) values ($1, $2, $3, 'quiz', 'Check') returning id", [tenant, lesson, T]);
    await db.admin("insert into public.lesson_slides (tenant_id, lesson_id, position, kind, activity_id, content) values ($1, $2, 0, 'activity', $3, '{}')", [tenant, lesson, act]);
    const qs = [];
    for (let i = 0; i < 5; i++) {
      const [{ id: q }] = await db.admin("insert into public.questions (tenant_id, activity_id, owner_id, kind, prompt, points, position, topic) values ($1, $2, $3, 'mcq', 'Q', 1, $4, $5) returning id", [tenant, act, T, i, `${subject} topic`]);
      const [{ id: ok }] = await db.admin("insert into public.question_options (tenant_id, question_id, label, is_correct, position) values ($1, $2, 'y', true, 0) returning id", [tenant, q]);
      const [{ id: no }] = await db.admin("insert into public.question_options (tenant_id, question_id, label, is_correct, position) values ($1, $2, 'n', false, 1) returning id", [tenant, q]);
      qs.push({ q, pick: right ? ok : no });
    }
    const s = await db.rpc(T, "start_session", { p_class: cls.id, p_lesson: lesson });
    await db.rpc(ada, "join_session", { p_code: s.join_code });
    await db.rpc(T, "session_control", { p_session: s.id, p_action: "start" });
    const at = (await db.rpc(ada, "start_attempt", { p_activity: act, p_session: s.id })).attempt.id;
    for (const { q, pick } of qs) await db.rpc(ada, "submit_answer", { p_attempt: at, p_question: q, p_response: JSON.stringify({ option_id: pick }) });
    await db.rpc(T, "end_session", { p_session: s.id });
  };
  await teach(maths, mc, "Mathematics", true);
  await teach(english, ec, "English", false);

  // Each teacher sees only their own subject; the admin and Ada see both.
  const subjects = async (who) => (await db.rpc(who, "progress_report", { p_student: ada, p_period: "week" })).subjects.map((s) => s.subject).sort();
  assert.deepEqual(await subjects(maths), ["Mathematics"]);
  assert.deepEqual(await subjects(english), ["English"]);
  assert.deepEqual(await subjects(A), ["English", "Mathematics"]);
  assert.deepEqual(await subjects(ada), ["English", "Mathematics"]);
  assert.equal((await db.rpc(maths, "progress_report", { p_student: ada, p_period: "week" })).scope, "teacher");

  // Parent codes: staff only. A parent signs up with one and adds a second child with the other.
  const codes = await db.rpc(maths, "parent_codes", { p_class: mc.id });
  assert.deepEqual(codes.students.map((s) => s.name), ["Ada Obi", "Obi Obi"]);
  assert.equal((await db.rpc(maths, "parent_codes", { p_class: mc.id })).students[0].code, codes.students[0].code, "the code stays the same");
  await rejects(db.rpc(ada, "parent_codes", { p_class: mc.id }), /Class not found/);
  await rejects(db.rpc(english, "parent_codes", { p_class: mc.id }), /Class not found/);
  const mum = await db.signUp("mum@roles.test", "Mrs Obi");
  const r = await db.rpc(mum, "redeem_code", { p_code: codes.students[0].code, p_full_name: "Mrs Obi" });
  assert.equal(r.role, "parent");
  await db.rpc(mum, "redeem_code", { p_code: codes.students[1].code });
  assert.deepEqual((await db.rpc(mum, "parent_children", {})).map((k) => k.name).sort(), ["Ada Obi", "Obi Obi"]);
  // A new code: the old one stops working, the parent stays linked.
  const fresh = await db.rpc(maths, "new_parent_code", { p_student: ada });
  assert.notEqual(fresh, codes.students[0].code);
  const dad = await db.signUp("dad@roles.test", "Mr Obi");
  assert.match((await db.rpc(dad, "redeem_code", { p_code: codes.students[0].code })).error, /No class or invite matches/);
  assert.equal((await db.rpc(mum, "parent_children", {})).length, 2);

  // Feedback to each subject teacher, with a reply. Teachers see their own; the admin sees all.
  const targets = await db.rpc(mum, "feedback_targets", { p_student: ada });
  assert.deepEqual(targets.map((t) => [t.subject, t.teacher]), [["English", "Mrs English"], ["Mathematics", "Mr Maths"]]);
  await db.rpc(mum, "send_parent_feedback", { p_student: ada, p_class: ec.id, p_body: "Ada finds the reading hard at home." });
  await db.rpc(mum, "send_parent_feedback", { p_student: ada, p_class: mc.id, p_body: "Thank you, she loves fractions now." });
  await rejects(db.rpc(mum, "send_parent_feedback", { p_student: ada, p_class: ec.id, p_body: "x" }), /check/);
  await db.rpc(dad, "redeem_code", { p_code: codes.students[1].code });   // Obi's parent only
  await rejects(db.rpc(dad, "send_parent_feedback", { p_student: ada, p_class: ec.id, p_body: "Hello" }), /Not your child/);
  const inbox = await db.rpc(english, "parent_feedback_list", {});
  assert.deepEqual(inbox.map((f) => [f.subject, f.parent, f.student]), [["English", "Mrs Obi", "Ada Obi"]]);
  const f = inbox[0];
  await rejects(db.rpc(maths, "reply_parent_feedback", { p_feedback: f.id, p_reply: "Not mine" }), /Feedback not found/);
  await db.rpc(english, "reply_parent_feedback", { p_feedback: f.id, p_reply: "Thanks, I'll give her extra reading time." });
  const mine = await db.rpc(mum, "parent_feedback_list", { p_student: ada });
  assert.equal(mine.find((x) => x.subject === "English").reply, "Thanks, I'll give her extra reading time.");
  assert.equal((await db.rpc(A, "parent_feedback_list", {})).length, 2, "the school admin reads all feedback");
  assert.equal((await db.as(maths, "select count(*)::int n from public.parent_feedback"))[0].n, 1, "a teacher reads only their own");

  // School-wide progress, for admins only.
  const sp = await db.rpc(A, "school_progress", { p_period: "week" });
  assert.deepEqual([sp.summary.answers, sp.summary.accuracy, sp.summary.active], [10, 50, 1]);
  assert.equal(sp.hardest[0].topic, "English topic");
  assert.equal(sp.hardest[0].struggling, 1);
  assert.deepEqual(sp.feedback, { total: 2, unanswered: 1 });
  const byClass = await db.rpc(A, "school_progress", { p_period: "week", p_class: mc.id });
  assert.equal(byClass.summary.pupils, 2);
  await rejects(db.rpc(maths, "school_progress", { p_period: "week" }), /Only school admins/);
  const other = await db.signUp("head@other-roles.test", "Other Head");
  await db.rpc(other, "bootstrap_school", { p_school_name: "Other School", p_full_name: "Other Head" });
  await rejects(db.rpc(other, "school_progress", { p_period: "week", p_class: mc.id }), /Class not found/);
  assert.equal((await db.rpc(other, "school_progress", { p_period: "week" })).summary.answers, 0, "another school sees none of it");
});

test("sign-up checks who is joining; the platform's support account acts as a school admin (0960)", async () => {
  const H = await db.signUp("head@support.test", "Head");
  const tenant = (await db.rpc(H, "bootstrap_school", { p_school_name: "Support School", p_full_name: "Head" })).tenant_id;
  await db.admin("update public.tenants set plan_code = 'school' where id = $1", [tenant]);
  const cls = await db.rpc(H, "create_class", { p_name: "Basic 5" });
  const kid = await db.signUp("kid@support.test", "Kid");
  await db.rpc(kid, "redeem_code", { p_code: cls.join_code, p_as: "student" });
  const pcode = (await db.rpc(H, "parent_codes", { p_class: cls.id })).students[0].code;

  // A parent who types the class code, or a student who types a parent code, is told so and nothing is created.
  const mum = await db.signUp("mum@support.test", "Mum");
  await rejects(db.rpc(mum, "redeem_code", { p_code: cls.join_code, p_as: "parent" }), /class code for students/);
  await rejects(db.rpc(mum, "redeem_code", { p_code: pcode, p_as: "student" }), /parent code/);
  assert.equal((await db.admin("select count(*)::int n from public.users where id = $1", [mum]))[0].n, 0);
  assert.equal((await db.rpc(mum, "redeem_code", { p_code: pcode, p_as: "parent" })).role, "parent");
  const inv = await db.rpc(H, "create_invite", { p_role: "teacher" });
  const t = await db.signUp("t@support.test", "Teacher");
  await rejects(db.rpc(t, "redeem_code", { p_code: inv.code, p_as: "parent" }), /staff invite/);
  await db.rpc(t, "redeem_code", { p_code: inv.code, p_as: "staff" });

  // Only the super admin can open a school as its support account.
  await rejects(db.rpc(H, "sa_support_account", { p_tenant: tenant }), /Not found/);
  const boss = await db.signUp("owner@platform.test", "Platform Owner");
  await db.admin("delete from public.platform_admins");
  await db.admin("insert into public.platform_admins (user_id) values ($1)", [boss]);
  const acct = await db.rpc(boss, "sa_support_account", { p_tenant: tenant });
  assert.equal(acct.user_id, null);
  assert.match(acct.email, /^support-[0-9a-f]{16}@support\.swiftcipher\.invalid$/);
  const wrong = await db.signUp("someone@else.test", "Someone");
  await rejects(db.rpc(boss, "sa_register_support", { p_tenant: tenant, p_user: wrong }), /Not a support account/);
  const support = await db.signUp(acct.email, "x");
  await db.rpc(boss, "sa_register_support", { p_tenant: tenant, p_user: support });
  assert.equal((await db.rpc(boss, "sa_support_account", { p_tenant: tenant })).user_id, support);
  const [row] = await db.admin("select role, full_name, is_support from public.users where id = $1", [support]);
  assert.deepEqual(row, { role: "school_admin", full_name: "SwiftCipher support", is_support: true });

  // Inside, it is a school admin of that school only.
  assert.equal((await db.rpc(support, "me", {})).profile.is_support, true);
  assert.equal((await db.rpc(H, "me", {})).profile.is_support, false);
  assert.equal((await db.rpc(support, "school_progress", { p_period: "week" })).summary.pupils, 1);
  assert.equal((await db.as(support, "select count(*)::int n from public.tenants"))[0].n, 1);
  // It never takes a staff seat, and visits are recorded for the platform.
  const seats = (await db.admin("select count(*)::int n from public.users where tenant_id = $1 and role in ('teacher','school_admin') and not is_support", [tenant]))[0].n;
  assert.equal(seats, 2);
  assert.ok((await db.admin("select count(*)::int n from public.platform_audit where action = 'support.enter' and actor_id = $1", [boss]))[0].n >= 2);
  await db.admin("delete from public.platform_admins");
  await db.admin("insert into public.platform_admins (user_id) values ($1)", [S.superA]);
});

test("rosters: staff-made logins, editing, password resets, promotion, a student's own classes (0970)", async () => {
  const H = await db.signUp("head@roster.test", "Head Teacher");
  const tenant = (await db.rpc(H, "bootstrap_school", { p_school_name: "Roster School", p_full_name: "Head Teacher" })).tenant_id;
  await db.admin("update public.tenants set plan_code = 'school' where id = $1", [tenant]);
  const inv = await db.rpc(H, "create_invite", { p_role: "teacher" });
  const T = await db.signUp("t@roster.test", "Mr Bello");
  await db.rpc(T, "redeem_code", { p_code: inv.code });
  const [j1, j2, j3] = [await db.rpc(T, "create_class", { p_name: "JSS 1 Gold" }), await db.rpc(T, "create_class", { p_name: "JSS 2 Gold" }), await db.rpc(H, "create_class", { p_name: "JSS 3 Gold" })];

  // The server creates the login; the class teacher makes it a student of the class.
  const email = "ada.obi12@students.swiftcipher.invalid";
  const ada = await db.signUp(email, "x");
  assert.equal(await db.rpc(T, "add_managed_student", { p_class: j1.id, p_user: ada, p_email: email, p_name: "Ada Obi", p_login: "ada.obi12", p_admission: "ADM/001" }), ada);
  const [row] = await db.admin("select u.role, u.login_name, u.must_change_password, p.student_number from public.users u join public.student_profiles p on p.user_id = u.id where u.id = $1", [ada]);
  assert.deepEqual(row, { role: "student", login_name: "ada.obi12", must_change_password: true, student_number: "ADM/001" });
  await rejects(db.rpc(T, "add_managed_student", { p_class: j1.id, p_user: ada, p_email: email, p_name: "Again" }), /not new/);
  const other = await db.signUp("stranger@roster.test", "Stranger");
  await rejects(db.rpc(S.teacherA, "add_managed_student", { p_class: j1.id, p_user: other, p_email: "stranger@roster.test", p_name: "X" }), /Class not found/);

  // First sign-in: the student must choose a password.
  assert.equal((await db.rpc(ada, "me", {})).profile.must_change_password, true);
  await db.rpc(ada, "password_changed", {});
  assert.equal((await db.rpc(ada, "me", {})).profile.must_change_password, false);

  // Editing and password resets.
  await db.rpc(T, "update_student", { p_student: ada, p_name: "Ada N. Obi", p_admission: "ADM/002" });
  assert.equal((await db.admin("select full_name from public.users where id = $1", [ada]))[0].full_name, "Ada N. Obi");
  await rejects(db.rpc(S.teacherA, "update_student", { p_student: ada, p_name: "Hacked" }), /Student not found/);
  assert.equal((await db.rpc(T, "prepare_password_reset", { p_student: ada })).login_name, "ada.obi12");
  assert.equal((await db.rpc(ada, "me", {})).profile.must_change_password, true);
  const ben = await db.signUp("ben@roster.test", "Ben Own");
  await db.rpc(ben, "redeem_code", { p_code: j1.join_code });
  await rejects(db.rpc(T, "prepare_password_reset", { p_student: ben }), /their own email/);
  // A student who already has an account joins by email.
  assert.equal(await db.rpc(T, "add_existing_student", { p_class: j2.id, p_email: "BEN@roster.test" }), ben);
  assert.equal(await db.rpc(T, "add_existing_student", { p_class: j2.id, p_email: "nobody@roster.test" }), null);

  // Promotion: JSS 1 Gold into JSS 2 Gold.
  assert.ok((await db.rpc(T, "promotion_targets", { p_class: j1.id })).some((c) => c.name === "JSS 3 Gold"));
  assert.equal(await db.rpc(T, "promote_students", { p_from: j1.id, p_to: j2.id }), 2);
  const inClass = async (c) => (await db.admin("select user_id from public.class_members where class_id = $1 and role = 'student' order by user_id", [c])).map((r) => r.user_id);
  assert.deepEqual(await inClass(j1.id), []);
  assert.deepEqual((await inClass(j2.id)).sort(), [ada, ben].sort());
  await rejects(db.rpc(T, "promote_students", { p_from: j2.id, p_to: j2.id }), /another open class/);

  // Whole school at the end of the year: chains work and the top class leaves.
  const kemi = await db.signUp("kemi@roster.test", "Kemi");
  await db.rpc(kemi, "redeem_code", { p_code: j3.join_code });
  await rejects(db.rpc(T, "promote_school", { p_moves: JSON.stringify([]) }), /Only school admins/);
  const res = await db.rpc(H, "promote_school", { p_moves: JSON.stringify([{ from: j2.id, to: j3.id }, { from: j3.id, to: null }]) });
  assert.deepEqual(res, { moved: 2, left: 1 });
  assert.deepEqual((await inClass(j3.id)).sort(), [ada, ben].sort());
  assert.deepEqual(await inClass(j2.id), []);

  // A student sees only their own classes, with their results.
  const mine = await db.rpc(ada, "my_classes", {});
  assert.deepEqual(mine.map((c) => c.name), ["JSS 3 Gold"]);
  assert.ok("accuracy" in mine[0] && "held" in mine[0]);

  // Deleting a student's account: school admins only, with the exact name.
  await rejects(db.rpc(T, "delete_student_check", { p_student: ada, p_confirm_name: "Ada N. Obi" }), /Student not found/);
  await rejects(db.rpc(H, "delete_student_check", { p_student: ada, p_confirm_name: "Ada" }), /exactly/);
  await db.rpc(H, "delete_student_check", { p_student: ada, p_confirm_name: "ada n. obi" });
});

test("privacy: a student or parent never sees another child's report, answers or dashboard data (0980)", async () => {
  const L = await lessonWithQuiz("Privacy");
  await db.admin("update public.tenants set plan_code = 'school' where id = $1", [L.tenant]);
  await db.as(L.T, "update public.tenant_settings set parent_portal_enabled = true");
  const [ada, ben] = [await db.signUp("ada@privacy.test", "Ada Obi"), await db.signUp("ben@privacy.test", "Ben Ade")];
  for (const p of [ada, ben]) await db.rpc(p, "redeem_code", { p_code: L.cls.join_code });
  const mum = await db.signUp("mum@privacy.test", "Mrs Obi");          // Ada's parent only
  const codes = await db.rpc(L.T, "parent_codes", { p_class: L.cls.id });
  await db.rpc(mum, "redeem_code", { p_code: codes.students.find((s) => s.name === "Ada Obi").code, p_as: "parent" });

  // Ada answers in a live lesson, so there is something to protect.
  await db.rpc(ada, "join_session", { p_code: L.s.join_code });
  await db.rpc(L.T, "session_control", { p_session: L.s.id, p_action: "start" });
  await db.rpc(L.T, "session_control", { p_session: L.s.id, p_action: "next" });
  const at = (await db.rpc(ada, "start_attempt", { p_activity: L.act, p_session: L.s.id })).attempt.id;
  await db.rpc(ada, "submit_answer", { p_attempt: at, p_question: L.q1, p_response: JSON.stringify({ option_id: L.right }) });
  await db.rpc(ada, "submit_answer", { p_attempt: at, p_question: L.q2, p_response: JSON.stringify({ text: "Ada's private answer" }) });
  await db.rpc(L.T, "end_session", { p_session: L.s.id });

  // Ben (a classmate) and Ada's mother may not reach each other's child.
  for (const [who, child] of [[ben, ada], [mum, ben]]) {
    await rejects(db.rpc(who, "progress_report", { p_student: child, p_period: "week" }), /Report not found/);
    await rejects(db.rpc(who, "parent_report", { p_student: child, p_period: "week" }), /not found/i);
    await rejects(db.rpc(who, "session_report", { p_session: L.s.id }), /not found/i);
    await rejects(db.rpc(who, "activity_results", { p_activity: L.act }), /Not visible/);
    for (const [table, col] of [["quiz_attempts", "student_id"], ["xp_events", "student_id"], ["student_badges", "student_id"],
                                ["student_profiles", "user_id"], ["session_participants", "user_id"], ["parent_links", "student_id"]]) {
      assert.equal((await db.as(who, `select 1 from public.${table} where ${col} = $1`, [child])).length, 0, `${table} of another child`);
    }
    assert.equal((await db.as(who, "select 1 from public.users where id = $1", [child])).length, 0, "another child's profile");
  }
  assert.equal((await db.as(ben, "select 1 from public.quiz_answers where attempt_id = $1", [at])).length, 0, "Ada's answers");
  assert.deepEqual((await db.rpc(ben, "my_classes", {})).map((c) => c.name), [L.cls.name], "Ben sees only his own classes");

  // What each may see: Ada her own report; her mother hers; Ben nothing of Ada's even through his own report.
  assert.equal((await db.rpc(ada, "progress_report", { p_student: ada, p_period: "week" })).summary.answers, 2);
  assert.equal((await db.rpc(mum, "progress_report", { p_student: ada, p_period: "week" })).summary.answers, 2);
  assert.equal((await db.rpc(ben, "progress_report", { p_student: ben, p_period: "week" })).summary.answers, 0);
  assert.deepEqual((await db.rpc(mum, "parent_children", {})).map((k) => k.name), ["Ada Obi"]);

  // A teacher of another class can't open the activity's full results outside their own lessons.
  const inv = await db.rpc(L.T, "create_invite", { p_role: "teacher" });
  const other = await db.signUp("other@privacy.test", "Other Teacher");
  await db.rpc(other, "redeem_code", { p_code: inv.code });
  await rejects(db.rpc(other, "activity_results", { p_activity: L.act }), /Not visible/);
  assert.equal((await db.rpc(L.T, "activity_results", { p_activity: L.act })).questions[1].text_responses[0].response.text, "Ada's private answer");
});

test("class teachers see every subject of their class; subject teachers only their own; admins everything (0990)", async () => {
  const H = await db.signUp("head@subjects.test", "Head");
  const tenant = (await db.rpc(H, "bootstrap_school", { p_school_name: "Subjects School", p_full_name: "Head" })).tenant_id;
  await db.admin("update public.tenants set plan_code = 'school' where id = $1", [tenant]);
  await db.as(H, "update public.tenant_settings set parent_portal_enabled = true");
  const staff = async (email, name) => {
    const inv = await db.rpc(H, "create_invite", { p_role: "teacher" });
    const u = await db.signUp(email, name);
    await db.rpc(u, "redeem_code", { p_code: inv.code });
    return u;
  };
  const [form, maths, english, outsider] = [await staff("form@subjects.test", "Mrs Form"), await staff("maths@subjects.test", "Mr Maths"),
    await staff("english@subjects.test", "Ms English"), await staff("out@subjects.test", "Mr Outside")];
  const cls = await db.rpc(form, "create_class", { p_name: "JSS 2 Gold" });
  const ada = await db.signUp("ada@subjects.test", "Ada Obi");
  await db.rpc(ada, "redeem_code", { p_code: cls.join_code });

  // The class teacher assigns subject teachers; nobody else can.
  await db.rpc(form, "set_class_subject", { p_class: cls.id, p_subject: "Mathematics", p_teacher: maths });
  const englishRow = await db.rpc(form, "set_class_subject", { p_class: cls.id, p_subject: "English", p_teacher: english });
  await rejects(db.rpc(maths, "set_class_subject", { p_class: cls.id, p_subject: "Art", p_teacher: maths }), /Class not found/);
  await rejects(db.rpc(outsider, "set_class_subject", { p_class: cls.id, p_subject: "Art", p_teacher: outsider }), /Class not found/);
  assert.deepEqual((await db.rpc(form, "class_subject_teachers", { p_class: cls.id })).map((r) => [r.subject, r.teacher]), [["English", "Ms English"], ["Mathematics", "Mr Maths"]]);

  // Subject teachers see the class and its students and teach it live; an outsider doesn't.
  assert.equal((await db.as(maths, "select 1 from public.classes where id = $1", [cls.id])).length, 1);
  assert.equal((await db.as(maths, "select 1 from public.class_members where class_id = $1 and user_id = $2", [cls.id, ada])).length, 1);
  assert.equal((await db.as(outsider, "select 1 from public.classes where id = $1", [cls.id])).length, 0);
  assert.ok((await db.rpc(maths, "my_teaching_classes", {})).some((c) => c.id === cls.id));

  // Each subject teacher teaches a live lesson (lessons with no subject set: the subject comes from who teaches it).
  const teach = async (T, right) => {
    const [{ id: lesson }] = await db.admin("insert into public.lessons (tenant_id, owner_id, title, status) values ($1, $2, 'Lesson', 'published') returning id", [tenant, T]);
    const [{ id: act }] = await db.admin("insert into public.activities (tenant_id, lesson_id, owner_id, kind, title) values ($1, $2, $3, 'quiz', 'Check') returning id", [tenant, lesson, T]);
    await db.admin("insert into public.lesson_slides (tenant_id, lesson_id, position, kind, activity_id, content) values ($1, $2, 0, 'activity', $3, '{}')", [tenant, lesson, act]);
    const [{ id: q }] = await db.admin("insert into public.questions (tenant_id, activity_id, owner_id, kind, prompt, points, position) values ($1, $2, $3, 'mcq', 'Q', 1, 0) returning id", [tenant, act, T]);
    const [{ id: ok }] = await db.admin("insert into public.question_options (tenant_id, question_id, label, is_correct, position) values ($1, $2, 'y', true, 0) returning id", [tenant, q]);
    const [{ id: no }] = await db.admin("insert into public.question_options (tenant_id, question_id, label, is_correct, position) values ($1, $2, 'n', false, 1) returning id", [tenant, q]);
    const s = await db.rpc(T, "start_session", { p_class: cls.id, p_lesson: lesson });
    await db.rpc(ada, "join_session", { p_code: s.join_code });
    await db.rpc(T, "session_control", { p_session: s.id, p_action: "start" });
    const a = (await db.rpc(ada, "start_attempt", { p_activity: act, p_session: s.id })).attempt.id;
    await db.rpc(ada, "submit_answer", { p_attempt: a, p_question: q, p_response: JSON.stringify({ option_id: right ? ok : no }) });
    await db.rpc(T, "end_session", { p_session: s.id });
  };
  await teach(maths, true);
  await teach(english, false);
  await rejects(db.rpc(outsider, "start_session", { p_class: cls.id, p_lesson: null }), /Not your class/);

  const subjects = async (who) => (await db.rpc(who, "progress_report", { p_student: ada, p_period: "week" })).subjects.map((s) => s.subject).sort();
  assert.deepEqual(await subjects(maths), ["Mathematics"]);
  assert.deepEqual(await subjects(english), ["English"]);
  assert.deepEqual(await subjects(form), ["English", "Mathematics"], "the class teacher sees every subject");
  assert.deepEqual(await subjects(H), ["English", "Mathematics"], "the admin sees every subject");
  await rejects(db.rpc(outsider, "progress_report", { p_student: ada, p_period: "week" }), /Report not found/);

  // Class analysis: class teacher all subjects, subject teacher their own, admin anything.
  const cp = async (who) => db.rpc(who, "school_progress", { p_period: "week", p_class: cls.id });
  assert.deepEqual([(await cp(form)).scope, (await cp(form)).subjects.map((s) => s.subject).sort()], ["class", ["English", "Mathematics"]]);
  assert.deepEqual([(await cp(maths)).scope, (await cp(maths)).subjects.map((s) => s.subject)], ["subject", ["Mathematics"]]);
  assert.equal((await db.rpc(H, "school_progress", { p_period: "week" })).scope, "school");
  await rejects(db.rpc(maths, "school_progress", { p_period: "week" }), /Only school admins/);
  await rejects(cp(outsider), /Only school admins/);

  // Accounts and parent codes stay with the class teacher and admins.
  await rejects(db.rpc(maths, "update_student", { p_student: ada, p_name: "X" }), /Student not found/);
  await rejects(db.rpc(maths, "parent_codes", { p_class: cls.id }), /Class not found/);
  await db.rpc(form, "update_student", { p_student: ada, p_name: "Ada Obi" });

  // Parents write to a subject teacher; that teacher and the admins read it, the class teacher doesn't.
  const codes = await db.rpc(form, "parent_codes", { p_class: cls.id });
  const mum = await db.signUp("mum@subjects.test", "Mrs Obi");
  await db.rpc(mum, "redeem_code", { p_code: codes.students[0].code, p_as: "parent" });
  const targets = await db.rpc(mum, "feedback_targets", { p_student: ada });
  assert.deepEqual(targets.map((t) => t.teacher).sort(), ["Mr Maths", "Mrs Form", "Ms English"]);
  await db.rpc(mum, "send_parent_feedback", { p_student: ada, p_class: cls.id, p_body: "Ada enjoys maths now.", p_teacher: maths });
  await rejects(db.rpc(mum, "send_parent_feedback", { p_student: ada, p_class: cls.id, p_body: "Hello", p_teacher: outsider }), /doesn't teach this class/);
  assert.deepEqual((await db.rpc(maths, "parent_feedback_list", {})).map((f) => f.subject), ["Mathematics"]);
  assert.equal((await db.rpc(form, "parent_feedback_list", {})).length, 0);
  assert.equal((await db.rpc(H, "parent_feedback_list", {})).length, 1);

  // Taking a subject away removes the access.
  await db.rpc(form, "remove_class_subject", { p_id: englishRow });
  await rejects(db.rpc(english, "progress_report", { p_student: ada, p_period: "week" }), /Report not found/);
});
