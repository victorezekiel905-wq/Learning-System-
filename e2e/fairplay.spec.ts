import { expect, test } from "@playwright/test";
import { admin, call, canSeed, cleanup, dbReady, makeUser, sessionCookies, type TestUser } from "./env";

// Fair play in a real browser: second chance on a wrong answer (then locked),
// a student writes a question and the teacher adds it, and private supports.
test.describe("fair play", () => {
  test.skip(!canSeed, "needs the Supabase service-role key to create a throwaway school");
  const created = { users: [] as string[], tenants: [] as string[] };
  const tag = `f${Date.now().toString(36)}`;
  let teacher: TestUser, student: TestUser, sessionId = "", classId = "", activityId = "";

  test.beforeAll(async () => {
    test.skip(!(await dbReady("0800")), "database update 2026-09-26_fair_play.sql not applied yet");
    teacher = await makeUser(tag, "teacher", created);
    student = await makeUser(tag, "student", created);
    const boot = await call<{ tenant_id: string }>(teacher.client, "bootstrap_school", { p_school_name: `E2E Fair ${tag}`, p_full_name: "E2E Teacher" });
    created.tenants.push(boot.tenant_id);
    await admin().from("tenants").update({ plan_code: "school" }).eq("id", boot.tenant_id);
    const cls = await call<{ id: string; join_code: string }>(teacher.client, "create_class", { p_name: "E2E Fair Maths" });
    classId = cls.id;
    await call(student.client, "redeem_code", { p_code: cls.join_code, p_full_name: "E2E Student" });
    for (const u of [teacher, student]) await call(u.client, "accept_notice", { p_kind: "terms_of_service" });

    const a = admin();
    const { data: act } = await a.from("activities").insert({ tenant_id: boot.tenant_id, owner_id: teacher.id, kind: "quiz", title: "Second chance quiz",
      settings: { show_feedback: "immediately", redemption: true, attempts_allowed: 1 } }).select("id").single();
    activityId = act!.id;
    const { data: q } = await a.from("questions").insert({ tenant_id: boot.tenant_id, activity_id: activityId, owner_id: teacher.id, kind: "mcq",
      prompt: "What is 6 x 7?", points: 2, position: 0, explanation: "Six groups of seven make forty-two." }).select("id").single();
    await a.from("question_options").insert([
      { tenant_id: boot.tenant_id, question_id: q!.id, label: "42", is_correct: true, position: 0 },
      { tenant_id: boot.tenant_id, question_id: q!.id, label: "36", is_correct: false, position: 1 }]);
    const s = await call<{ id: string; join_code: string }>(teacher.client, "start_session", { p_class: cls.id });
    sessionId = s.id;
    await a.from("class_sessions").update({ lockdown: false }).eq("id", s.id);
    await call(student.client, "join_session", { p_code: s.join_code });
    await call(teacher.client, "set_session_state", { p_session: s.id, p_activity: activityId });
    await call(teacher.client, "open_question_collab", { p_class: cls.id, p_activity: activityId, p_open: true, p_prompt: "Times tables" });
  });
  test.afterAll(async () => { await cleanup(created); });

  test("second chance, student-written question, private supports", async ({ browser, baseURL }) => {
    const sCtx = await browser.newContext();
    await sCtx.addCookies(await sessionCookies(student, baseURL!));
    const page = await sCtx.newPage();

    // Wrong first: "one more try" and no answer shown; right second: half credit, then locked.
    await page.goto(`/student/live/${sessionId}`);
    await expect(page.getByText("What is 6 x 7?")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Read aloud" })).toBeVisible();
    await page.getByRole("radio", { name: /36/ }).click();
    await page.getByRole("button", { name: "Save answer" }).click();
    await expect(page.getByText("Not quite. You have one more try.")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/forty-two/)).toHaveCount(0);
    await page.getByRole("radio", { name: /42/ }).click();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("Correct on your second try!")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/forty-two/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Save answer|Update answer|Try again/ })).toHaveCount(0);

    // The student writes a question from their home page.
    await page.goto("/student");
    await page.getByRole("button", { name: "Write a question" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Question").fill("What is 9 x 9?");
    await dialog.getByLabel("Choice 1", { exact: true }).fill("81");
    await dialog.getByLabel("Choice 2", { exact: true }).fill("99");
    await dialog.getByLabel("Why is the correct answer right?").fill("Nine nines are eighty-one because 9 x 10 is 90, minus 9.");
    await dialog.getByRole("button", { name: "Send to teacher" }).click();
    await expect(page.getByText("Waiting for your teacher")).toBeVisible({ timeout: 20_000 });

    // The teacher adds it to the quiz; the student is credited.
    const tCtx = await browser.newContext();
    await tCtx.addCookies(await sessionCookies(teacher, baseURL!));
    const t = await tCtx.newPage();
    const { data: sub } = await admin().from("question_submissions").select("id").eq("student_id", student.id).limit(1).single();
    expect(sub).toBeTruthy();
    await call(teacher.client, "review_question_submission", { p_submission: sub!.id, p_action: "approve" });
    await page.reload();
    await expect(page.getByText("Added to the quiz")).toBeVisible({ timeout: 20_000 });

    // Supports tab: private per-student supports.
    await t.goto(`/teacher/classes/${classId}`);
    await t.getByRole("tab", { name: "Supports" }).click();
    await t.getByText("Easy-to-read font").first().click();
    await t.getByRole("button", { name: "Save" }).first().click();
    await expect(t.getByText(/Saved supports for/)).toBeVisible({ timeout: 20_000 });
    await page.goto("/student");
    await expect.poll(async () => page.evaluate(() => document.documentElement.classList.contains("readable")), { timeout: 20_000 }).toBe(true);
    await sCtx.close(); await tCtx.close();
  });
});
