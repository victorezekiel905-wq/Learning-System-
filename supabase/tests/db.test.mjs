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
  const s = await db.rpc(S.teacherA, "start_session", { p_class: S.classA });
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
  const s = await db.rpc(S.teacherA, "start_session", { p_class: S.classA });
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
  const stale = await db.rpc(S.teacherA, "start_session", { p_class: S.classA });
  await db.admin("update public.class_sessions set started_at = now() - interval '13 hours' where id = $1", [stale.id]);
  await db.admin("update public.session_participants set last_seen_at = now() - interval '3 hours' where session_id = $1", [stale.id]);
  const m = (await db.admin("select app.run_maintenance() r"))[0].r;
  assert.equal(m.sessions_auto_ended, 1);

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

  const s = await db.rpc(S.teacherA, "start_session", { p_class: S.classA });
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
  // Signals carry no personal data, only "something changed".
  assert.ok(msgs.every((m) => JSON.stringify(m.payload).length < 40));
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
  const s = await db.rpc(S.teacherA, "start_session", { p_class: S.classA });
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
  const s = await db.rpc(S.teacherA, "start_session", { p_class: S.classA });
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
  const s = await db.rpc(t, "start_session", { p_class: S.classA });
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
  const s = await db.rpc(t, "start_session", { p_class: S.classA });
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
  const s = await db.rpc(t, "start_session", { p_class: S.classA });
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

test("deleting a school with real data removes everything (no FK ordering errors)", async () => {
  const before = (await db.admin("select count(*)::int n from public.users where tenant_id = $1", [S.tenantA]))[0].n;
  assert.ok(before > 3);
  await db.admin("delete from public.tenants where id = $1", [S.tenantA]);
  for (const t of ["users", "classes", "lessons", "activities", "questions", "quiz_attempts", "class_sessions", "devices", "game_sessions"]) {
    assert.equal((await db.admin(`select count(*)::int n from public.${t} where tenant_id = $1`, [S.tenantA]))[0].n, 0, t);
  }
});
