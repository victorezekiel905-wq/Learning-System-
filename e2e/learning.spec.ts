import { expect, test } from "@playwright/test";
import { admin, call, canSeed, cleanup, dbReady, makeUser, sessionCookies, type TestUser } from "./env";

// Student-centred learning in a real browser: the student picks a challenge level,
// gets the questions for it, must explain their reasoning, earns XP and a badge;
// the teacher sees the misconception insight.
test.describe("engaging learning", () => {
  test.skip(!canSeed, "needs the Supabase service-role key to create a throwaway school");
  const created = { users: [] as string[], tenants: [] as string[] };
  const tag = `l${Date.now().toString(36)}`;
  let teacher: TestUser, student: TestUser, sessionId = "", classId = "";

  test.beforeAll(async () => {
    test.skip(!(await dbReady("0790")), "database update 2026-09-25_classroom_update.sql not applied yet");
    teacher = await makeUser(tag, "teacher", created);
    student = await makeUser(tag, "student", created);
    const boot = await call<{ tenant_id: string }>(teacher.client, "bootstrap_school", { p_school_name: `E2E Learning ${tag}`, p_full_name: "E2E Teacher" });
    created.tenants.push(boot.tenant_id);
    await admin().from("tenants").update({ plan_code: "school" }).eq("id", boot.tenant_id);
    await admin().from("class_sessions").update({ lockdown: false }).eq("tenant_id", boot.tenant_id);
    const cls = await call<{ id: string; join_code: string }>(teacher.client, "create_class", { p_name: "E2E Maths" });
    classId = cls.id;
    await call(student.client, "redeem_code", { p_code: cls.join_code, p_full_name: "E2E Student" });
    for (const u of [teacher, student]) await call(u.client, "accept_notice", { p_kind: "terms_of_service" });

    // A differentiated activity: easy (1) and challenge (5) questions; the challenge one needs reasoning.
    const a = admin();
    const { data: act } = await a.from("activities").insert({ tenant_id: boot.tenant_id, owner_id: teacher.id, kind: "quiz", title: "Fractions challenge",
      settings: { differentiate: true, show_feedback: "immediately", attempts_allowed: 1 } }).select("id").single();
    const mk = async (prompt: string, difficulty: number, config: object, pos: number) => {
      const { data: q } = await a.from("questions").insert({ tenant_id: boot.tenant_id, activity_id: act!.id, owner_id: teacher.id, kind: "mcq",
        prompt, difficulty, config, points: 1, position: pos, bloom_level: "evaluate" }).select("id").single();
      await a.from("question_options").insert([
        { tenant_id: boot.tenant_id, question_id: q!.id, label: "3/4", is_correct: true, position: 0 },
        { tenant_id: boot.tenant_id, question_id: q!.id, label: "4/5", is_correct: false, position: 1 }]);
    };
    await mk("Easy: which is 0.75?", 1, {}, 0);
    await mk("Challenge: which fraction is closest to 0.76?", 5, { require_reasoning: true }, 1);
    const s = await call<{ id: string; join_code: string }>(teacher.client, "start_session", { p_class: cls.id });
    sessionId = s.id;
    await a.from("class_sessions").update({ lockdown: false }).eq("id", s.id);
    await call(student.client, "join_session", { p_code: s.join_code });
    await call(teacher.client, "set_session_state", { p_session: s.id, p_activity: act!.id });
  });
  test.afterAll(async () => { await cleanup(created); });

  test("choose a challenge, explain your reasoning, earn XP; teacher sees the thinking", async ({ browser, baseURL }) => {
    const sCtx = await browser.newContext();
    await sCtx.addCookies(await sessionCookies(student, baseURL!));
    const page = await sCtx.newPage();

    // Home: progress panel and "Choose your challenge" → Extension (Challenger badge).
    await page.goto("/student");
    await expect(page.getByText("My progress")).toBeVisible();
    await page.getByRole("radio", { name: "Extension" }).click();
    await expect(page.getByText(/Extension challenge chosen/)).toBeVisible();

    // Live lesson: only the challenge question (Extension band), reasoning required.
    await page.goto(`/student/live/${sessionId}`);
    await expect(page.getByText("Extension challenge")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Challenge: which fraction is closest to 0.76?")).toBeVisible();
    await expect(page.getByText("Easy: which is 0.75?")).toHaveCount(0);
    await page.getByRole("button", { name: /3\/4/ }).click();
    await expect(page.getByText("Explain your reasoning (required)")).toBeVisible();
    await page.getByPlaceholder(/Why is this your answer/).fill("3/4 is 0.75, only 0.01 away, while 4/5 is 0.80 which is 0.04 away.");
    await page.getByRole("radio", { name: "Certain" }).click();
    await page.getByRole("button", { name: "Save answer" }).click();
    await expect(page.getByText("Correct!")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /^Submit/ }).click();
    await expect(page.getByText(/\+\d+ XP/)).toBeVisible({ timeout: 20_000 });

    // Teacher: insight shows the student's reasoning and the Bloom level.
    const tCtx = await browser.newContext();
    await tCtx.addCookies(await sessionCookies(teacher, baseURL!));
    const t = await tCtx.newPage();
    await t.goto(`/teacher/live/${sessionId}`);
    await t.getByRole("tab", { name: "Responses" }).click();
    await expect(t.getByText("Bloom: Evaluate").first()).toBeVisible({ timeout: 20_000 });
    await t.getByText(/Students' reasoning/).first().click();
    await expect(t.getByText(/only 0.01 away/)).toBeVisible();

    // Class page: Levels & XP tab shows the student's choice.
    await t.goto(`/teacher/classes/${classId}`);
    await t.getByRole("tab", { name: "Levels & XP" }).click();
    await expect(t.getByText("chosen by student")).toBeVisible();
    await sCtx.close(); await tCtx.close();
  });
});
