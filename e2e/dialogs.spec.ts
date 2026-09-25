import { expect, test } from "@playwright/test";
import { admin, call, canSeed, cleanup, makeUser, sessionCookies, type TestUser } from "./env";

// The app's own confirm/ask dialogs (they replaced window.confirm/prompt):
// Cancel changes nothing, Confirm acts, type-to-confirm guards irreversible actions.
test.describe("dialogs", () => {
  test.skip(!canSeed, "needs the Supabase service-role key to create a throwaway school");
  const created = { users: [] as string[], tenants: [] as string[] };
  const tag = `d${Date.now().toString(36)}`;
  let teacher: TestUser, student: TestUser, classId = "", code = "";

  test.beforeAll(async () => {
    teacher = await makeUser(tag, "teacher", created);
    student = await makeUser(tag, "student", created);
    const boot = await call<{ tenant_id: string }>(teacher.client, "bootstrap_school", { p_school_name: `E2E Dialogs ${tag}`, p_full_name: "E2E Admin" });
    created.tenants.push(boot.tenant_id);
    const cls = await call<{ id: string; join_code: string }>(teacher.client, "create_class", { p_name: "E2E Dialog class" });
    classId = cls.id; code = cls.join_code;
    await call(student.client, "redeem_code", { p_code: cls.join_code, p_full_name: "E2E Student" });
    await call(teacher.client, "accept_notice", { p_kind: "terms_of_service" });
  });
  test.afterAll(async () => { await cleanup(created); });

  test("confirm and type-to-confirm dialogs", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext();
    await ctx.addCookies(await sessionCookies(teacher, baseURL!));
    const page = await ctx.newPage();
    const dialogs: string[] = [];
    page.on("dialog", (d) => { dialogs.push(d.message()); void d.dismiss(); }); // native pop-ups must never appear

    await page.goto(`/teacher/classes/${classId}`);
    await page.getByRole("tab", { name: "Settings" }).click();

    // Cancel keeps the code.
    await page.getByRole("button", { name: "New code" }).click();
    const dlg = page.getByRole("dialog", { name: "Generate a new join code?" });
    await expect(dlg).toBeVisible();
    await dlg.getByRole("button", { name: "Cancel" }).click();
    await expect(dlg).toHaveCount(0);
    const same = await admin().from("classes").select("join_code").eq("id", classId).single();
    expect(same.data?.join_code).toBe(code);

    // Confirm changes it.
    await page.getByRole("button", { name: "New code" }).click();
    await page.getByRole("dialog", { name: "Generate a new join code?" }).getByRole("button", { name: "New code" }).click();
    await expect.poll(async () => (await admin().from("classes").select("join_code").eq("id", classId).single()).data?.join_code, { timeout: 15_000 }).not.toBe(code);

    // Type-to-confirm: the delete button stays disabled until DELETE is typed; cancelling deletes nothing.
    await page.goto("/admin/users");
    const row = page.getByRole("row", { name: /E2E Student/ });
    await row.getByRole("button", { name: "Delete" }).click();
    const del = page.getByRole("dialog", { name: /Delete E2E Student/ });
    const go = del.getByRole("button", { name: "Delete permanently" });
    await expect(go).toBeDisabled();
    await del.getByRole("textbox").fill("delete");
    await expect(go).toBeDisabled();
    await del.getByRole("textbox").fill("DELETE");
    await expect(go).toBeEnabled();
    await del.getByRole("button", { name: "Cancel" }).click();
    const still = await admin().from("users").select("id").eq("id", student.id).maybeSingle();
    expect(still.data?.id).toBe(student.id);

    expect(dialogs).toEqual([]);
    await ctx.close();
  });
});
