import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// WCAG 2.1 A/AA checks (axe-core) on every public page, at phone and laptop sizes.
for (const vp of [{ name: "phone", width: 360, height: 740 }, { name: "laptop", width: 1280, height: 800 }]) {
  for (const path of ["/", "/login", "/signup", "/join", "/terms", "/privacy", "/dpa", "/security", "/does-not-exist"]) {
    test(`${path} has no accessibility violations (${vp.name})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(path);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const problems = results.violations.map((v) => `${v.impact} ${v.id}: ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
      expect(problems, problems.join("\n")).toEqual([]);
    });
  }
}
