import { defineConfig, devices } from "@playwright/test";

// Browser tests against a production build (`npm run build:e2e` first).
//   npm run test:e2e                      → starts `next start` on :3100
//   E2E_BASE_URL=https://your.app npm run test:e2e   → tests a deployment
// The classroom test needs SUPABASE_SERVICE_ROLE_KEY (it creates and then deletes
// a throwaway school); without it that test is skipped.
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    launchOptions: {
      // Let the lesson page share the "entire screen" without a picker, as a student would.
      args: ["--auto-select-desktop-capture-source=Entire screen", "--use-fake-ui-for-media-stream"]
    }
  },
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: "npm run start:e2e",
    url: `${baseURL}/login`,
    reuseExistingServer: true,
    timeout: 120_000
  }
});
