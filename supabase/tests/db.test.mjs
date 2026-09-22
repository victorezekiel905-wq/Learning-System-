// End-to-end database tests (blueprint §29): permissions, tenant isolation,
// scoring, policy evaluation, device agent flows. Run: npm run test:db
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "./harness.mjs";

let db;
const S = {}; // shared fixture ids

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
  await rejects(db.rpc(b, "redeem_code", { p_code: S.classCode }), /different school/);
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
  const s = await db.rpc(S.teacherA, "start_session", { p_class: S.classA, p_lesson: S.lesson });
  S.session = s.id;
  await rejects(db.rpc(S.teacherA, "start_session", { p_class: S.classA }), /already has a live session/);
  const joined = await db.rpc(S.stu1, "join_session", { p_code: s.join_code });
  assert.equal(joined.session_id, S.session);
  await rejects(db.rpc(S.adminB, "join_session", { p_code: s.join_code }), /another class|profile|No live/);

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
  const att = await db.as(S.teacherA, "select student_id, status from public.attendance where session_id = $1", [S.session]);
  assert.equal(att.length, 3);
  assert.equal(att.find((a) => a.student_id === S.stu1).status, "present");
  assert.equal(att.find((a) => a.student_id === S.stu3).status, "absent");
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
  assert.equal(summary.attendance.present, 1);
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
