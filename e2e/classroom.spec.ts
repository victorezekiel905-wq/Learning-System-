import { expect, test, type Page } from "@playwright/test";
import { admin, call, canSeed, cleanup, dbReady, makeUser, type TestUser } from "./env";

// The core promise of SwiftCipher, in a real browser:
//  1. a student joins a live class, shares their entire screen and goes full screen;
//  2. their screen appears in the teacher's left-hand strip;
//  3. the teacher opens it large, for the teacher only;
//  4. the student leaves the lesson → after the grace period the teacher gets a
//     LEFT CLASS alert; the student comes back → the alert clears.
test.describe("live classroom", () => {
  test.skip(!canSeed, "needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY");
  test.beforeAll(async () => { test.skip(!(await dbReady()), "database update not applied yet (supabase/updates/2026-09-24_production_release.sql)"); });

  const created = { users: [] as string[], tenants: [] as string[] };
  const tag = Date.now().toString(36);
  let teacher: TestUser, student: TestUser, sessionId: string, joinCode: string;

  test.beforeAll(async () => {
    teacher = await makeUser(tag, "teacher", created);
    student = await makeUser(tag, "student", created);
    const boot = await call<{ tenant_id: string }>(teacher.client, "bootstrap_school", { p_school_name: `E2E School ${tag}`, p_full_name: "E2E Teacher" });
    created.tenants.push(boot.tenant_id);
    await admin().from("tenants").update({ plan_code: "school" }).eq("id", boot.tenant_id);
    // Short grace period keeps the test fast; the default is 15 s.
    await admin().from("tenant_settings").update({ default_grace_seconds: 5, store_event_screenshots: true }).eq("tenant_id", boot.tenant_id);
    const cls = await call<{ id: string; join_code: string }>(teacher.client, "create_class", { p_name: "E2E Year 8", p_subject: "ICT" });
    await call(student.client, "redeem_code", { p_code: cls.join_code, p_full_name: "E2E Student" });
    for (const u of [teacher, student]) {
      await call(u.client, "accept_notice", { p_kind: "terms_of_service" });
      await call(u.client, "accept_notice", { p_kind: "privacy_notice" });
    }
    const s = await call<{ id: string; join_code: string }>(teacher.client, "start_session", { p_class: cls.id });
    sessionId = s.id; joinCode = s.join_code;
    await call(student.client, "join_session", { p_code: joinCode });
  });

  test.afterAll(async () => { await cleanup(created); });

  async function signIn(page: Page, u: TestUser, next: string) {
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    await page.locator("#email").fill(u.email);
    await page.locator("#password").fill(u.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((url) => url.pathname === next, { timeout: 30_000 });
  }

  test("screen strip, teacher-only focus, leave alert and return", async ({ browser }) => {
    const tCtx = await browser.newContext();
    const sCtx = await browser.newContext();
    const tPage = await tCtx.newPage();
    const sPage = await sCtx.newPage();
    const pageErrors: string[] = [];
    for (const p of [tPage, sPage]) p.on("pageerror", (e) => pageErrors.push(e.message));

    await signIn(tPage, teacher, `/teacher/live/${sessionId}`);
    await expect(tPage.getByText(joinCode)).toBeVisible();
    await expect(tPage.getByRole("button", { name: /Lockdown on/ })).toBeVisible();

    // Student: the lockdown gate covers the lesson until they share and go full screen.
    await signIn(sPage, student, `/student/live/${sessionId}`);
    const gate = sPage.getByRole("dialog");
    await expect(gate.getByRole("heading", { name: /Join .* class/ })).toBeVisible();
    await gate.getByRole("button", { name: "Share screen" }).click();
    await gate.getByRole("button", { name: "Enter full screen" }).click();
    await expect(gate).toBeHidden();
    await expect(sPage.getByText("Sharing screen with your teacher")).toBeVisible();

    // Teacher: the student's live screen appears in the left strip.
    const strip = tPage.getByRole("complementary", { name: "Student screens" });
    const tile = strip.getByRole("button", { name: /E2E Student/ });
    await expect(tile.getByAltText("E2E Student's screen")).toBeVisible({ timeout: 45_000 });
    await expect(tile.getByText("LIVE")).toBeVisible();

    // Teacher opens it large: only on the teacher's screen.
    await tile.click();
    await expect(tPage.getByText("Only you can see this")).toBeVisible();
    await expect(tPage.getByRole("heading", { name: "E2E Student" })).toBeVisible();
    await expect(sPage.getByText("Only you can see this")).toHaveCount(0);
    await expect(sPage.getByRole("dialog")).toBeHidden(); // student still on the lesson
    await tPage.getByRole("button", { name: "Minimize" }).click();
    await expect(tPage.getByText("Only you can see this")).toHaveCount(0);

    // Student leaves the lesson (exits full screen) → gate returns immediately.
    const leftAt = Date.now();
    await sPage.evaluate(() => document.exitFullscreen());
    await expect(sPage.getByRole("dialog").getByRole("heading", { name: "Return to the lesson" })).toBeVisible();

    // Teacher: INSTANT pop-up and red "LEFT LESSON" tile, before any grace period.
    await expect(tPage.getByText(/E2E Student left the lesson/).first()).toBeVisible({ timeout: 10_000 });
    await expect(tile.getByText("LEFT LESSON", { exact: true })).toBeVisible({ timeout: 5_000 });
    const popupSeconds = (Date.now() - leftAt) / 1000;
    console.log(`teacher pop-up after ${popupSeconds.toFixed(1)} s`);
    expect(popupSeconds).toBeLessThan(10);

    // Teacher: red LEFT CLASS tile after the grace period, with the student's screen attached.
    await expect(tile.getByText("LEFT CLASS", { exact: true })).toBeVisible({ timeout: 45_000 });
    // The alert bar across the top of the live room names the student.
    await expect(tPage.getByRole("alert").filter({ hasText: "E2E Student" }).first()).toBeVisible({ timeout: 20_000 });
    const { data: ev } = await admin().from("environment_events").select("rule, evidence_image")
      .eq("class_session_id", sessionId).is("resolved_at", null).single();
    expect(ev?.rule).toMatch(/full-screen/);

    // Student comes back → alert resolves.
    await sPage.getByRole("dialog").getByRole("button", { name: "Enter full screen" }).click();
    await expect(sPage.getByRole("dialog")).toBeHidden();
    await expect(tile.getByText("LEFT CLASS", { exact: true })).toHaveCount(0, { timeout: 30_000 });
    await expect(tPage.getByText(/E2E Student is back in the lesson/).first()).toBeVisible({ timeout: 15_000 });
    const { count } = await admin().from("environment_events").select("id", { count: "exact", head: true })
      .eq("class_session_id", sessionId).is("resolved_at", null);
    expect(count).toBe(0);

    // Ending the class deletes the live screen pictures.
    await call(teacher.client, "end_session", { p_session: sessionId });
    const { count: frames } = await admin().from("screen_snapshots").select("id", { count: "exact", head: true })
      .eq("class_session_id", sessionId).neq("quality", "event");
    expect(frames).toBe(0);

    expect(pageErrors).toEqual([]);
    await tCtx.close(); await sCtx.close();
  });
});
