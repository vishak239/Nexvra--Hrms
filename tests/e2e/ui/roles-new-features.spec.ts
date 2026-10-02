import { expect, test } from "@playwright/test";
import { DEMO } from "../support/api";
import { nav, uiLoginToDashboard } from "./helpers";

const ROLES = [
  { who: DEMO.superAdmin, manageTasks: true, monitoring: true },
  { who: DEMO.hr, manageTasks: true, monitoring: true },
  { who: DEMO.manager, manageTasks: false, monitoring: true },
  { who: DEMO.employee, manageTasks: false, monitoring: false },
];

for (const role of ROLES) {
  test(`new features are visible according to role: ${role.who}`, async ({ page }) => {
    await uiLoginToDashboard(page, role.who);
    const menu = nav(page);
    await expect(menu.getByRole("link", { name: "Tasks" })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Messages" })).toBeVisible();
    await expect(page.getByTestId("connection-status")).toHaveAttribute("data-status", /ONLINE|SYNCED/);

    await menu.getByRole("link", { name: "Tasks" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Assign task" })).toHaveCount(role.manageTasks ? 1 : 0);

    await page.goto("/reports");
    if (role.monitoring) {
      await expect(page.getByRole("tab", { name: "Activity monitoring" })).toBeVisible();
    } else {
      await expect(page.getByText("You don't have access to this")).toBeVisible();
    }

    // The API agrees with the UI.
    const lookup = await page.request.get("/api/tasks/lookup/", { params: { employee_code: "DEMO-005" } });
    expect(lookup.status()).toBe(role.manageTasks ? 200 : 403);
  });
}
