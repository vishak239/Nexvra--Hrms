import { expect, test, type Page } from "@playwright/test";
import { DEMO } from "../support/api";
import { uiLoginToDashboard } from "./helpers";

const PAGES = [
  "/dashboard",
  "/attendance",
  "/leave",
  "/tasks",
  "/messages",
  "/notifications",
  "/documents",
  "/holidays",
  "/policies",
  "/profile",
  "/payslips",
  "/employees",
  "/payroll",
  "/reports",
  "/settings",
  "/admin/users",
  "/admin/audit",
];

function watch(page: Page) {
  const problems: string[] = [];
  page.on("console", (msg) => msg.type() === "error" && problems.push(`console: ${msg.text()}`));
  page.on("pageerror", (err) => problems.push(`page error: ${err.message}`));
  page.on("response", (res) => res.status() >= 500 && problems.push(`${res.status()} ${res.url()}`));
  return problems;
}

for (const who of [DEMO.superAdmin, DEMO.hr, DEMO.manager, DEMO.employee]) {
  test(`every page loads without console errors or server errors: ${who}`, async ({ page }) => {
    test.setTimeout(120_000);
    const problems = watch(page);
    await uiLoginToDashboard(page, who);
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).or(page.getByText("You don't have access to this"))).toBeVisible();
      await page.waitForLoadState("networkidle");
    }
    // 403 responses are expected for pages a role cannot use; the browser logs those as
    // "Failed to load resource" console errors, so they are not counted as problems.
    expect(problems.filter((p) => !/status of 403|status of 404/.test(p))).toEqual([]);
  });
}

test("new pages fit a phone screen without horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await uiLoginToDashboard(page, DEMO.hr);
  for (const path of ["/dashboard", "/attendance", "/tasks", "/messages", "/leave", "/reports", "/policies", "/employees", "/settings"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} overflows horizontally by ${overflow}px`).toBeLessThanOrEqual(0);
  }
});
