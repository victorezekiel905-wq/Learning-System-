// Design review: screenshots of the key screens at phone, tablet and desktop sizes,
// with realistic data in a throwaway school (deleted afterwards).
//   npm run build:e2e && (npm run start:e2e &) && node --experimental-strip-types scripts/ui-shots.mts <outDir>
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import { admin, call, cleanup, makeUser, sessionCookies } from "../e2e/env.ts";

const OUT = process.argv[2] ?? "ui-shots";
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const SIZES = [{ n: "desktop", w: 1440, h: 900 }, { n: "tablet", w: 820, h: 1180 }, { n: "phone", w: 390, h: 844 }];
const only = (process.env.ONLY ?? "").split(",").filter(Boolean);
mkdirSync(OUT, { recursive: true });

const created = { users: [] as string[], tenants: [] as string[] };
const tag = `ui${Date.now().toString(36)}`;
const browser = await chromium.launch({ args: ["--auto-select-desktop-capture-source=Entire screen", "--use-fake-ui-for-media-stream"] });
try {
  const teacher = await makeUser(tag, "teacher", created);
  const students = await Promise.all(["Ada Okafor", "Tunde Bello", "Chiamaka Eze", "David Mensah"].map((n, i) => makeUser(tag, `s${i}`, created)));
  const boot = await call<{ tenant_id: string }>(teacher.client, "bootstrap_school", { p_school_name: "Greenfield International School", p_full_name: "Mrs. Adaeze Nwosu" });
  created.tenants.push(boot.tenant_id);
  const a = admin();
  await a.from("tenants").update({ plan_code: "school" }).eq("id", boot.tenant_id);
  const cls = await call<{ id: string; join_code: string }>(teacher.client, "create_class", { p_name: "Year 8 Mathematics", p_subject: "Mathematics" });
  const names = ["Ada Okafor", "Tunde Bello", "Chiamaka Eze", "David Mensah"];
  for (const [i, s] of students.entries()) {
    await call(s.client, "redeem_code", { p_code: cls.join_code, p_full_name: names[i] });
    await call(s.client, "accept_notice", { p_kind: "terms_of_service" }).catch(() => {});
  }
  await call(teacher.client, "accept_notice", { p_kind: "terms_of_service" }).catch(() => {});
  const { data: lesson } = await a.from("lessons").insert({ tenant_id: boot.tenant_id, owner_id: teacher.id, title: "Equivalent fractions" }).select("id").single();
  await a.from("lesson_slides").insert([
    { tenant_id: boot.tenant_id, lesson_id: lesson!.id, position: 0, kind: "title", content: { heading: "Equivalent fractions", subheading: "Same value, different names" } },
    { tenant_id: boot.tenant_id, lesson_id: lesson!.id, position: 1, kind: "text", content: { heading: "Why 2/4 = 1/2", body: "Multiply or divide the top and bottom by the same number." } }
  ]);
  await call(teacher.client, "publish_lesson", { p_lesson: lesson!.id });
  const s = await call<{ id: string; join_code: string }>(teacher.client, "start_session", { p_class: cls.id, p_lesson: lesson!.id });
  for (const st of students) await call(st.client, "join_session", { p_code: s.join_code });

  const shot = async (page: Page, name: string) => {
    for (const z of SIZES) {
      await page.setViewportSize({ width: z.w, height: z.h });
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${OUT}/${name}-${z.n}.png`, fullPage: z.n !== "desktop" });
    }
  };
  const want = (n: string) => !only.length || only.includes(n);
  const ctxFor = async (u: typeof teacher | null) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    if (u) await ctx.addCookies(await sessionCookies(u, BASE));
    return ctx;
  };

  const pub = await (await ctxFor(null)).newPage();
  for (const [n, path] of [["landing", "/"], ["login", "/login"], ["signup", "/signup"]] as const) {
    if (!want(n)) continue;
    await pub.goto(BASE + path); await shot(pub, n);
  }

  // Students 1–3 in the live lesson sharing their screens; student 4 leaves.
  const studentPages: Page[] = [];
  if (want("live") || want("student-live")) {
    for (const st of students.slice(0, 3)) {
      const p = await (await ctxFor(st)).newPage();
      await p.goto(`${BASE}/student/live/${s.id}`);
      const gate = p.getByRole("dialog");
      await gate.getByRole("button", { name: "Share screen" }).click().catch(() => {});
      await gate.getByRole("button", { name: "Enter full screen" }).click().catch(() => {});
      studentPages.push(p);
    }
  }
  const t = await (await ctxFor(teacher)).newPage();
  for (const [n, path] of [["teacher-home", "/teacher"], ["classes", `/teacher/classes/${cls.id}`], ["lessons", "/teacher/lessons"], ["admin-settings", "/admin/settings"]] as const) {
    if (!want(n)) continue;
    await t.goto(BASE + path); await t.waitForLoadState("load"); await shot(t, n);
  }
  if (want("live")) {
    await t.goto(`${BASE}/teacher/live/${s.id}`);
    await t.waitForTimeout(8000);
    await shot(t, "live");
  }
  if (want("student-home") || want("student-live")) {
    const sp = studentPages[0] ?? await (await ctxFor(students[0])).newPage();
    if (want("student-home")) { await sp.goto(`${BASE}/student`); await shot(sp, "student-home"); }
    if (want("student-live")) {
      const gp = await (await ctxFor(students[3])).newPage();
      await gp.goto(`${BASE}/student/live/${s.id}`); await gp.waitForTimeout(2500); await shot(gp, "student-gate");
    }
  }
  console.log("screenshots in", OUT);
} finally {
  await browser.close();
  await cleanup(created);
}
