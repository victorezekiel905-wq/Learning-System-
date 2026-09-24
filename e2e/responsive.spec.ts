import { expect, test, type Page } from "@playwright/test";
import { admin, call, canSeed, cleanup, dbReady, makeUser, type TestUser } from "./env";

// Every page must fit a phone (360 px), a tablet (768 px) and a laptop (1280 px)
// with no sideways scrolling, and keep its main controls reachable.
const VIEWPORTS = [
  { name: "phone", width: 360, height: 740 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "laptop", width: 1280, height: 800 }
] as const;

async function expectNoSidewaysScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const widest = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        // ignore elements inside their own horizontal scrollers (tables, tab bars, the screen strip)
        let p = el.parentElement;
        while (p) { const s = getComputedStyle(p); if (s.overflowX === "auto" || s.overflowX === "scroll" || s.overflowX === "hidden") return false; p = p.parentElement; }
        return r.right > window.innerWidth + 1;
      })
      .slice(0, 3)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")}`);
    return { scroll: doc.scrollWidth, width: window.innerWidth, widest };
  });
  expect(overflow.scroll, `${label}: page is ${overflow.scroll}px wide on a ${overflow.width}px screen (${overflow.widest.join(", ")})`).toBeLessThanOrEqual(overflow.width + 1);
}

test.describe("responsive: public pages", () => {
  for (const vp of VIEWPORTS) {
    for (const path of ["/", "/login", "/signup", "/join", "/terms", "/privacy", "/dpa", "/security", "/does-not-exist"]) {
      test(`${path} fits a ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(path);
        await expectNoSidewaysScroll(page, `${path} @ ${vp.width}px`);
      });
    }
  }
});

test.describe("responsive: signed-in pages", () => {
  test.skip(!canSeed, "needs the Supabase service-role key to create a throwaway school");
  const created = { users: [] as string[], tenants: [] as string[] };
  const tag = `r${Date.now().toString(36)}`;
  let teacher: TestUser, student: TestUser, sessionId = "", classId = "";

  test.beforeAll(async () => {
    test.skip(!(await dbReady()), "database update not applied yet (supabase/updates/2026-09-24_production_release.sql)");
    teacher = await makeUser(tag, "teacher", created);
    student = await makeUser(tag, "student", created);
    const boot = await call<{ tenant_id: string }>(teacher.client, "bootstrap_school", { p_school_name: `E2E Layout ${tag}`, p_full_name: "E2E Teacher With A Fairly Long Name" });
    created.tenants.push(boot.tenant_id);
    await admin().from("tenants").update({ plan_code: "school" }).eq("id", boot.tenant_id);
    const cls = await call<{ id: string; join_code: string }>(teacher.client, "create_class", { p_name: "Year 10 Computer Science and Digital Literacy", p_subject: "ICT" });
    classId = cls.id;
    await call(student.client, "redeem_code", { p_code: cls.join_code, p_full_name: "E2E Student" });
    for (const u of [teacher, student]) await call(u.client, "accept_notice", { p_kind: "terms_of_service" });
    sessionId = (await call<{ id: string }>(teacher.client, "start_session", { p_class: cls.id })).id;
  });
  test.afterAll(async () => { await cleanup(created); });

  async function signIn(page: Page, u: TestUser) {
    await page.goto("/login");
    await page.locator("#email").fill(u.email);
    await page.locator("#password").fill(u.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  }

  for (const vp of VIEWPORTS) {
    test(`teacher and admin pages fit a ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await signIn(page, teacher);
      for (const path of ["/teacher", "/teacher/classes", `/teacher/classes/${classId}`, "/teacher/lessons", "/teacher/live/new",
                          `/teacher/live/${sessionId}`, "/teacher/challenge", "/teacher/reports", "/admin", "/admin/users", "/admin/settings",
                          "/messages", "/notifications", "/account"]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle").catch(() => {});
        await expectNoSidewaysScroll(page, `${path} @ ${vp.width}px`);
      }
      // The live room's student strip and the join code are on screen at every size.
      await page.goto(`/teacher/live/${sessionId}`);
      await expect(page.getByRole("complementary", { name: "Student screens" })).toBeVisible();
      await expect(page.getByText("Join code")).toBeVisible();
      if (vp.width < 1024) await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
    });

    test(`student pages fit a ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await signIn(page, student);
      for (const path of ["/student", "/student/work", `/student/live/${sessionId}`, "/account"]) {
        await page.goto(path);
        await page.waitForLoadState("networkidle").catch(() => {});
        await expectNoSidewaysScroll(page, `${path} @ ${vp.width}px`);
      }
      // The lockdown gate's buttons are reachable on every screen size.
      await page.goto(`/student/live/${sessionId}`);
      await expect(page.getByRole("dialog").getByRole("button").first()).toBeInViewport();
    });
  }
});
