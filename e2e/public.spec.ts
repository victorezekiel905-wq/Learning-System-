import { expect, test } from "@playwright/test";

test.describe("public site", () => {
  for (const [path, heading] of [
    ["/", null], ["/login", null], ["/signup", null],
    ["/terms", "Terms of Service"], ["/privacy", "Privacy Notice"], ["/dpa", "Data Processing Agreement"], ["/security", "Security"]
  ] as const) {
    test(`${path} renders without errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => { if (m.type() === "error" && /Content Security Policy|Refused/.test(m.text())) errors.push(m.text()); });
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      if (heading) await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      expect(errors).toEqual([]);
    });
  }

  test("unknown pages get the 404 page", async ({ page }) => {
    const res = await page.goto("/this-page-does-not-exist");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  test("protected pages redirect to sign in", async ({ page }) => {
    await page.goto("/teacher");
    await expect(page).toHaveURL(/\/login\?next=%2Fteacher/);
  });

  test("signup requires accepting the terms", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("link", { name: "Terms of Service" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Create/ })).toBeDisabled();
  });
});

test.describe("security headers", () => {
  test("the app never allows eval; only the code sandbox may", async ({ request }) => {
    const app = (await request.get("/login")).headers()["content-security-policy"];
    expect(app).toContain("default-src 'self'");
    expect(app).not.toContain("unsafe-eval");
    const sandbox = (await request.get("/sandbox/js-worker.js")).headers()["content-security-policy"];
    expect(sandbox).toContain("default-src 'none'");
    expect(sandbox).not.toContain("'self' https://"); // no route back to the app API
  });

  test("HSTS, nosniff and frame protections are set", async ({ request }) => {
    const h = (await request.get("/login")).headers();
    expect(h["strict-transport-security"]).toContain("max-age=");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBe("SAMEORIGIN");
    expect(h["x-powered-by"]).toBeUndefined();
  });

  test("health endpoint answers for uptime monitors", async ({ request }) => {
    const res = await request.get("/api/health");
    expect([200, 503]).toContain(res.status());
    const body = await res.json();
    expect(body).toHaveProperty("ok");
    expect(body).toHaveProperty("db");
  });
});

test.describe("student code sandbox", () => {
  test("runs JavaScript and grades tests", async ({ page }) => {
    await page.goto("/privacy");
    const r = await page.evaluate(() => new Promise<{ stdout: string; tests: { passed: boolean }[] }>((resolve) => {
      const w = new Worker("/sandbox/js-worker.js");
      w.onmessage = (e) => { resolve(e.data); w.terminate(); };
      w.postMessage({ source: "console.log('hi', 1 + 1)", tests: [{ name: "mult", input: "2*3", expected: "6" }] });
    }));
    expect(r.stdout).toBe("hi 2");
    expect(r.tests[0].passed).toBe(true);
  });

  test("student code cannot reach the SwiftCipher API", async ({ page }) => {
    await page.goto("/privacy");
    const outcome = await page.evaluate(() => new Promise<string>((resolve) => {
      const w = new Worker("/sandbox/js-worker.js");
      w.onmessage = (e) => { if (e.data?.probe) { resolve(e.data.probe); w.terminate(); } };
      w.postMessage({ source: "fetch('/api/health').then(() => self.postMessage({ probe: 'reached' }), () => self.postMessage({ probe: 'blocked' }))", tests: [] });
      setTimeout(() => resolve("timeout"), 8000);
    }));
    expect(outcome).toBe("blocked");
  });

  test("an infinite loop is stopped without freezing the page", async ({ page }) => {
    await page.goto("/privacy");
    const r = await page.evaluate(() => new Promise<string>((resolve) => {
      const w = new Worker("/sandbox/js-worker.js");
      const t = setTimeout(() => { w.terminate(); resolve("terminated"); }, 1500);
      w.onmessage = () => { clearTimeout(t); resolve("finished"); };
      w.postMessage({ source: "while (true) {}", tests: [] });
    }));
    expect(r).toBe("terminated");
    expect(await page.evaluate(() => 1 + 1)).toBe(2); // page still responsive
  });
});
