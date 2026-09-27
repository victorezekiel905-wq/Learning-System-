// Design audit: screenshots of every screen for every role, at desktop and phone
// size, with realistic data in a throwaway school (deleted afterwards).
// Screens whose database functions aren't deployed yet (parent reports) get
// sample data at the network level so their layout can still be reviewed.
//   npm run build:e2e && (npm run start:e2e &) && node --experimental-strip-types scripts/ui-audit.mts <outDir>
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import { admin, call, cleanup, makeUser, sessionCookies } from "../e2e/env.ts";

const OUT = process.argv[2] ?? "ui-audit";
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const SIZES = [{ n: "desktop", w: 1440, h: 900 }, { n: "phone", w: 390, h: 844 }];
const only = (process.env.ONLY ?? "").split(",").filter(Boolean);
mkdirSync(OUT, { recursive: true });

const created = { users: [] as string[], tenants: [] as string[] };
const tag = `ua${Date.now().toString(36)}`;
const browser = await chromium.launch();
try {
  const teacher = await makeUser(tag, "teacher", created);
  const names = ["Ada Okafor", "Tunde Bello", "Chiamaka Eze", "David Mensah"];
  const students = await Promise.all(names.map((_, i) => makeUser(tag, `s${i}`, created)));
  const parent = await makeUser(tag, "parent", created);
  const boot = await call<{ tenant_id: string }>(teacher.client, "bootstrap_school", { p_school_name: "Greenfield International School", p_full_name: "Mrs. Adaeze Nwosu" });
  created.tenants.push(boot.tenant_id);
  const a = admin();
  await a.from("tenants").update({ plan_code: "school" }).eq("id", boot.tenant_id);
  await a.from("tenant_settings").update({ parent_portal_enabled: true }).eq("tenant_id", boot.tenant_id);
  const cls = await call<{ id: string; join_code: string }>(teacher.client, "create_class", { p_name: "Year 8 Mathematics", p_subject: "Mathematics" });
  for (const [i, s] of students.entries()) {
    await call(s.client, "redeem_code", { p_code: cls.join_code, p_full_name: names[i] });
    await call(s.client, "accept_notice", { p_kind: "terms_of_service" }).catch(() => {});
  }
  const pinv = await call<{ code: string }>(teacher.client, "create_invite", { p_role: "parent", p_student: students[0]!.id });
  await call(parent.client, "redeem_code", { p_code: pinv.code, p_full_name: "Mrs. Ngozi Okafor" });
  for (const u of [teacher, parent]) await call(u.client, "accept_notice", { p_kind: "terms_of_service" }).catch(() => {});
  const { data: lesson } = await a.from("lessons").insert({ tenant_id: boot.tenant_id, owner_id: teacher.id, title: "Equivalent fractions", subject: "Mathematics" }).select("id").single();
  await a.from("lesson_slides").insert([
    { tenant_id: boot.tenant_id, lesson_id: lesson!.id, position: 0, kind: "title", content: { heading: "Equivalent fractions", body: "Same value, different names" } },
    { tenant_id: boot.tenant_id, lesson_id: lesson!.id, position: 1, kind: "text", content: { heading: "Why 2/4 = 1/2", body: "Multiply or divide the top and bottom by the same number." } }
  ]);
  const { data: act } = await a.from("activities").insert({ tenant_id: boot.tenant_id, lesson_id: lesson!.id, owner_id: teacher.id, kind: "quiz", title: "Fractions check",
    settings: { show_feedback: "immediately", redemption: true } }).select("id").single();
  const { data: q } = await a.from("questions").insert({ tenant_id: boot.tenant_id, activity_id: act!.id, owner_id: teacher.id, kind: "mcq", prompt: "Which fraction equals 1/2?", points: 1, position: 0, explanation: "2/4 simplifies to 1/2." }).select("id").single();
  await a.from("question_options").insert([
    { tenant_id: boot.tenant_id, question_id: q!.id, label: "2/4", is_correct: true, position: 0 },
    { tenant_id: boot.tenant_id, question_id: q!.id, label: "2/3", is_correct: false, position: 1 }]);
  await a.from("lesson_slides").insert({ tenant_id: boot.tenant_id, lesson_id: lesson!.id, position: 2, kind: "activity", activity_id: act!.id, content: {} });
  await call(teacher.client, "publish_lesson", { p_lesson: lesson!.id });
  await a.from("assignments").insert({ tenant_id: boot.tenant_id, class_id: cls.id, activity_id: act!.id, title: "Fractions homework", created_by: teacher.id,
    due_at: new Date(Date.now() + 3 * 86400_000).toISOString(), points_possible: 10 });
  const s = await call<{ id: string; join_code: string }>(teacher.client, "start_session", { p_class: cls.id, p_lesson: lesson!.id });
  for (const st of students.slice(0, 3)) await call(st.client, "join_session", { p_code: s.join_code });

  const shot = async (page: Page, name: string) => {
    for (const z of SIZES) {
      await page.setViewportSize({ width: z.w, height: z.h });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/${name}-${z.n}.png`, fullPage: true });
      // A page wider than the screen scrolls sideways on phones: report it.
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 1) console.log(`OVERFLOW ${name}-${z.n}: ${over}px wider than the screen`);
    }
  };
  const want = (n: string) => !only.length || only.includes(n);
  const ctxFor = async (u: typeof teacher | null) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    if (u) await ctx.addCookies(await sessionCookies(u, BASE));
    return ctx;
  };

  // Sample data for screens whose database functions aren't deployed yet.
  const report = sampleReport(students[0]!.id, names[0]!, cls.id);
  const mock = async (page: Page) => {
    await page.route("**/rest/v1/rpc/parent_report*", (r) => r.fulfill({ json: report }));
    await page.route("**/rest/v1/rpc/parent_alerts*", (r) => r.fulfill({ json: { alert_on_leave: true, weekly_digest: true, low_score_below: 60 } }));
  };

  const run = async (ctxUser: typeof teacher | null, list: [string, string][], mocked = false) => {
    const page = await (await ctxFor(ctxUser)).newPage();
    if (mocked) await mock(page);
    for (const [n, path] of list) {
      if (!want(n)) continue;
      try {
        await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 60_000 });
        await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {}); // live pages keep a socket open
        await shot(page, n);
      } catch (e) { console.log(`SKIPPED ${n}: ${(e as Error).message.split("\n")[0]}`); }
    }
  };

  await run(null, [["landing", "/"], ["login", "/login"], ["signup", "/signup"], ["join", "/join"], ["terms", "/terms"], ["security", "/security"], ["notfound", "/nope"]]);
  await run(teacher, [
    ["t-home", "/teacher"], ["t-classes", "/teacher/classes"], ["t-class", `/teacher/classes/${cls.id}`], ["t-lessons", "/teacher/lessons"],
    ["t-lesson-editor", `/teacher/lessons/${lesson!.id}`], ["t-questions", "/teacher/questions"], ["t-media", "/teacher/media"],
    ["t-assignments", "/teacher/assignments"], ["t-review", "/teacher/review"], ["t-live-new", "/teacher/live/new"], ["t-live", `/teacher/live/${s.id}`],
    ["t-challenge-new", "/teacher/challenge/new"], ["t-insights", "/teacher/insights"], ["t-reports", "/teacher/reports"],
    ["t-student-report", `/teacher/students/${students[0]!.id}`], ["admin", "/admin"], ["admin-users", "/admin/users"], ["admin-settings", "/admin/settings"],
    ["admin-audit", "/admin/audit"], ["admin-billing", "/admin/billing"], ["guard", "/guard"], ["guard-envs", "/guard/environments"],
    ["messages", "/messages"], ["notifications", "/notifications"], ["account", "/account"]
  ], true);
  await run(students[1]!, [["s-home", "/student"], ["s-work", "/student/work"], ["s-join", "/student/join"], ["s-device", "/student/device"], ["s-live", `/student/live/${s.id}`]]);
  await run(parent, [["p-report", "/parent"], ["p-messages", "/messages"]], true);
  console.log("screenshots in", OUT);
} finally {
  await browser.close();
  await cleanup(created);
}

function sampleReport(id: string, name: string, classId: string) {
  const weeks = [0, 1, 2, 3, 4, 5].map((i) => new Date(Date.now() - (5 - i) * 7 * 86400_000).toISOString().slice(0, 10));
  const stats = (p: number, focus: number) => ({ sessions_held: 5, sessions_attended: 5, minutes: 212, answers: 23, accuracy: 78, reasoned: 9,
    activities_completed: 4, hands_raised: 2, xp: 185, focus_events: focus, participation: p });
  const subj = (cid: string, cls: string, subject: string, teacher: string, p: number, focus: number) => ({
    class_id: cid, class: cls, subject, teacher, teacher_id: "t",
    now: { ...stats(p, focus), focus: focus ? [
      { at: new Date(Date.now() - 2 * 86400_000).toISOString(), kind: "domain_blocked", reason: "Game sites are blocked", site: "coolmathgames.com",
        page_title: "Run 3 - Cool Math Games", returned: true, away_minutes: 3,
        context: { class: cls, lesson: "Equivalent fractions", slide: 3, slide_heading: "Adding fractions", activity: "Fractions check" } },
      { at: new Date(Date.now() - 86400_000).toISOString(), kind: "environment_left", reason: "Switched to another tab or app", site: null, page_title: null,
        returned: true, away_minutes: 1, context: { class: cls, lesson: "Ratio and proportion", slide: 1, slide_heading: "What is a ratio?" } }] : [] },
    before: stats(p - 8, focus + 1),
    trend: weeks.map((w, i) => ({ week: w, accuracy: 60 + i * 4, xp: 80 + i * 20, participation: 55 + i * 5 })),
    assignments: { due: 2, submitted: 1, late: 0, missing: 1, missing_titles: ["Ratio worksheet"] },
    grades: [{ assignment: "Fractions homework", score: 8, out_of: 10, feedback: "Clear working. Check your simplifying in Q4.", released_at: new Date().toISOString() }]
  });
  return {
    student: { id, name }, period: "week", from: new Date().toISOString(), to: new Date().toISOString(), date: weeks[5], timezone: "Africa/Lagos",
    focus_details: true, progress: { xp: 1240, level: 5 }, badges: [{ badge: "deep_thinker", earned_at: new Date().toISOString() }],
    subjects: [subj(classId, "Year 8 Mathematics", "Mathematics", "Mrs. Adaeze Nwosu", 82, 2), subj("c2", "Year 8 Science", "Science", "Mr. Tunde Adeyemi", 64, 0)]
  };
}
