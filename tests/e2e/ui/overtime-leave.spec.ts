import { expect, test } from "@playwright/test";
import { DEMO, json } from "../support/api";
import { browserPost, expectToast, freshEmployee, hrSession } from "../support/people";
import { uiLoginToDashboard, cardActions } from "./helpers";

test("overtime: declaration, HR approval, start with a live timer, stop", async ({ page, browser }) => {
  const hr = await hrSession();
  const person = await freshEmployee(hr);

  await uiLoginToDashboard(page, person.email, person.password);
  await page.goto("/attendance");
  await cardActions(page).getByRole("button", { name: "Check in", exact: true }).click();
  await expectToast(page, "Checked in.");
  await expect(cardActions(page).getByRole("button", { name: "Overtime" })).toHaveCount(0); // not before checkout
  await cardActions(page).getByRole("button", { name: "Check out", exact: true }).click();
  await expectToast(page, "Checked out.");

  await cardActions(page).getByRole("button", { name: "Overtime", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Request overtime" });
  const send = dialog.getByRole("button", { name: "Send request" }).or(page.getByRole("button", { name: "Send request" }));
  await dialog.getByLabel("Other reason").check();
  await dialog.getByLabel("Explain the other reason").fill("Production release support for payroll.");
  await dialog.getByLabel("What will you work on during overtime?").fill("Deploy and monitor the payroll release.");
  await expect(send).toBeDisabled(); // the declaration must be confirmed
  await dialog.getByLabel("I confirm that the above work is the reason for my overtime.").check();
  await send.click();
  await expectToast(page, "Overtime requested — HR will review it.");
  await expect(cardActions(page).getByRole("button", { name: "Overtime pending" })).toBeDisabled();

  // HR approves in the Attendance > Overtime tab
  const hrContext = await browser.newContext();
  const hrPage = await hrContext.newPage();
  await uiLoginToDashboard(hrPage, DEMO.hr);
  await hrPage.goto("/attendance?tab=overtime");
  const row = hrPage.getByRole("row", { name: new RegExp(person.fullName) });
  await expect(row.getByText("Deploy and monitor the payroll release.")).toBeVisible();
  await row.getByRole("button", { name: "Approve" }).click();
  await hrPage.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await expectToast(hrPage, "Approved — the employee has been notified.");
  await hrContext.close();
  await hr.dispose();

  await page.reload();
  await cardActions(page).getByRole("button", { name: "Start overtime", exact: true }).click();
  await expectToast(page, "Overtime started.");
  const timer = page.getByRole("timer", { name: "Overtime timer" });
  const first = await timer.textContent();
  await expect.poll(async () => timer.textContent(), { timeout: 5000 }).not.toBe(first);
  await cardActions(page).getByRole("button", { name: "Stop overtime", exact: true }).click();
  await expectToast(page, "Overtime ended.");
  await expect(page.getByTestId("session-phase")).toHaveAttribute("data-phase", "CHECKED_OUT");
  await expect(page.getByText("My overtime")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Completed" })).toHaveCount(1);
});

function leaveDates() {
  const start = new Date();
  start.setDate(start.getDate() + 21);
  if (start.getMonth() === 11 && start.getDate() > 27) start.setFullYear(start.getFullYear() + 1, 0, 6);
  const end = new Date(start);
  end.setDate(end.getDate() + 2);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: iso(start), end: iso(end), year: start.getFullYear() };
}

test("leave: balance unchanged while pending, deducted on approval, then locked", async ({ page, browser }) => {
  const hr = await hrSession();
  const person = await freshEmployee(hr, { managerCode: "DEMO-003" });
  const types = await json(await hr.get("/api/leaves/types/"), 200);
  const annual = types.find((t: { code: string }) => t.code === "DEMO-AL");
  const { start, end, year } = leaveDates();
  await json(
    await hr.post("/api/leaves/balances/allocate/", { leave_type: annual.id, year, allocated: "12", employees: [person.id] }),
    200,
  );
  await hr.dispose();

  await uiLoginToDashboard(page, person.email, person.password);
  await page.goto("/leave");
  await page.getByRole("button", { name: "Apply for leave" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Leave type").selectOption(String(annual.id));
  await dialog.getByLabel("From").fill(start);
  await dialog.getByLabel("To").fill(end);
  await dialog.getByRole("button", { name: "Submit request" }).click();
  await expectToast(page, "Leave request submitted.");
  const card = page.getByTestId(`balance-${annual.id}`);
  await expect(card).toContainText(/12\s*\/\s*12 days/); // pending does NOT reduce the balance
  await expect(card).toContainText("0 used · 3 pending approval");

  // the manager approves
  const managerContext = await browser.newContext();
  const manager = await managerContext.newPage();
  await uiLoginToDashboard(manager, DEMO.manager);
  await manager.goto("/leave?tab=approvals");
  await manager.getByRole("row", { name: new RegExp(person.fullName) }).getByRole("button", { name: "Approve" }).click();
  await manager.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await expectToast(manager, "Leave approved.");
  await managerContext.close();

  await page.reload();
  await expect(card).toContainText(/9\s*\/\s*12 days/);
  await expect(card).toContainText("3 used · 0 pending approval");
  const row = page.getByRole("row", { name: /Demo Annual Leave/ });
  await expect(row.getByText("Locked")).toBeVisible();
  await expect(row.getByRole("button", { name: "Cancel" })).toHaveCount(0);

  // a direct API call cannot cancel it either
  const requests = await (await page.request.get("/api/leaves/requests/")).json();
  const res = await browserPost(page, page.context(), `/api/leaves/requests/${requests.results[0].id}/cancel/`);
  expect(res.status()).toBe(409);
  expect((await res.json()).error.message).toBe("This leave has already been approved and cannot be cancelled.");
  await page.reload();
  await expect(card).toContainText(/9\s*\/\s*12 days/);
});
