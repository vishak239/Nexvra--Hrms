import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests run against live servers seeded with `python manage.py seed_demo`:
 *  - project "api": critical HR flows over HTTP (session + CSRF) against Django.
 *  - project "ui":  the same flows driven through the Next.js UI in Chromium.
 */
export default defineConfig({
  testDir: ".",
  timeout: 90_000, // logins hash passwords on purpose; busy machines need headroom
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "api", testDir: "./api" },
    {
      name: "ui",
      testDir: "./ui",
      use: { ...devices["Desktop Chrome"], baseURL: process.env.E2E_UI_URL ?? "http://127.0.0.1:3000" },
    },
  ],
});
