import { expect, test } from "@playwright/test";
import { DEMO } from "../support/api";
import { expectToast, freshEmployee, hrSession, type FreshPerson } from "../support/people";
import { nav, uiLoginToDashboard } from "./helpers";

test.describe.serial("employee work session with an HR task", () => {
  let person: FreshPerson;
  const taskTitle = `Update employee database ${Date.now().toString(36)}`;

  test.beforeAll(async () => {
    const hr = await hrSession();
    person = await freshEmployee(hr, { managerCode: "DEMO-003" });
    await hr.dispose();
  });

  test("HR assigns a task by Employee ID through the UI", async ({ page }) => {
    await uiLoginToDashboard(page, DEMO.hr);
    await nav(page).getByRole("link", { name: "Tasks" }).click();
    await page.getByRole("button", { name: "Assign task" }).click();
    const dialog = page.getByRole("dialog", { name: "Assign a task" });
    await dialog.getByRole("textbox", { name: /Employee ID/ }).fill(person.employeeCode);
    await dialog.getByRole("button", { name: "Find" }).click();
    await expect(dialog.getByTestId("assignee-confirmation")).toContainText(`@${person.username}`);
    await dialog.getByLabel(/^Title/).fill(taskTitle);
    await dialog.getByLabel(/^Description/).fill("Please correct the phone numbers.");
    await dialog.getByRole("button", { name: "Assign task" }).click();
    await expectToast(page, /Task assigned to/);
    await expect(page.getByRole("dialog", { name: taskTitle })).toBeVisible();
  });

  test("employee: notification, check in, break, back to work, task, checkout", async ({ page }) => {
    await uiLoginToDashboard(page, person.email, person.password);
    await page.goto("/notifications");
    await expect(page.getByText(`@${person.username}, HR assigned you a new task`)).toBeVisible();

    await page.goto("/attendance");
    await page.getByRole("button", { name: "Check in" }).click();
    await expectToast(page, "Checked in.");
    await page.getByRole("button", { name: "Start break" }).click();
    await expect(page.getByTestId("session-phase")).toHaveAttribute("data-phase", "ON_BREAK");
    const timer = page.getByRole("timer", { name: "Break timer" });
    const first = await timer.textContent();
    await expect.poll(async () => timer.textContent(), { timeout: 5000 }).not.toBe(first); // it ticks
    await page.getByRole("button", { name: "Back to work" }).click();
    await expect(page.getByTestId("session-phase")).toHaveAttribute("data-phase", "WORKING");
    await page.getByRole("button", { name: /Break history \(1\)/ }).click();
    await expect(page.getByRole("list", { name: "Break history" }).getByRole("listitem")).toHaveCount(1);

    // view the task
    await nav(page).getByRole("link", { name: "Tasks" }).click();
    await page.getByRole("button", { name: taskTitle }).click();
    const detail = page.getByRole("dialog", { name: taskTitle });
    await expect(detail).toContainText("Response needed before checkout");
    await detail.getByRole("button", { name: "Close" }).click();

    // checkout is blocked until the task is answered
    await nav(page).getByRole("link", { name: "Attendance" }).click();
    await page.getByRole("button", { name: "Check out" }).click();
    const guard = page.getByRole("dialog", { name: /Respond to your tasks/ });
    await expect(guard).toContainText(`@${person.username} — ${taskTitle}`);
    await expect(guard.getByRole("button", { name: "Checkout" })).toBeDisabled();
    await guard.getByLabel(/^Response/).fill("Phone numbers corrected.");
    await guard.getByRole("button", { name: "Submit response" }).click();
    const ready = page.getByRole("dialog", { name: "Ready to check out" });
    await expect(ready).toBeVisible();
    await ready.getByRole("button", { name: "Checkout" }).click();
    await expectToast(page, "Checked out.");
    await expect(page.getByTestId("session-phase")).toHaveAttribute("data-phase", "CHECKED_OUT");
  });

  test("HR sees the response in activity monitoring", async ({ page }) => {
    await uiLoginToDashboard(page, DEMO.hr);
    await nav(page).getByRole("link", { name: "Reports" }).click();
    await page.getByRole("tab", { name: "Activity monitoring" }).click();
    await page.getByLabel("Dataset").selectOption("tasks");
    const row = page.getByRole("row", { name: new RegExp(taskTitle) });
    await expect(row).toContainText("Phone numbers corrected.");
    await page.getByLabel("Dataset").selectOption("breaks");
    await expect(page.getByRole("row", { name: new RegExp(person.employeeCode) })).toHaveCount(1);
  });
});
