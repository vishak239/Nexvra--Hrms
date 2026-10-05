import { expect, test } from "@playwright/test";
import { DEMO, json, login } from "../support/api";
import { nav, uiLogin, uiLoginToDashboard, cardActions } from "./helpers";

test("unauthenticated visitors are sent to login", async ({ page }) => {
  await page.goto("/employees");
  await expect(page).toHaveURL(/\/login\?next=%2Femployees/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("wrong password shows a clear error", async ({ page }) => {
  await uiLogin(page, DEMO.employee, "not-the-password");
  await expect(page.locator("main [role=alert], form [role=alert]")).toHaveText("Invalid email or password.", { timeout: 30_000 });
  await expect(page).toHaveURL(/\/login/);
});

test("navigation is role-aware", async ({ page }) => {
  await uiLoginToDashboard(page, DEMO.employee);
  const menu = nav(page);
  await expect(menu.getByRole("link", { name: "My payslips" })).toBeVisible();
  for (const hidden of ["Employees", "Payroll", "Reports", "Settings", "Users & roles", "Audit log"]) {
    await expect(menu.getByRole("link", { name: hidden })).toHaveCount(0);
  }
});

test("employee opening an admin page sees no-access, and the API refuses too", async ({ page }) => {
  await uiLoginToDashboard(page, DEMO.employee);
  for (const path of ["/payroll", "/admin/audit", "/employees"]) {
    await page.goto(path);
    await expect(page.getByText("You don't have access to this")).toBeVisible();
  }
  const res = await page.request.get("/api/audit-logs/");
  expect(res.status()).toBe(403);
});

test("manager sees only their team in the employee list", async ({ page }) => {
  await uiLoginToDashboard(page, DEMO.manager);
  await nav(page).getByRole("link", { name: "Employees" }).click();
  await expect(page.getByRole("link", { name: "Demo Employee", exact: true })).toBeVisible();
  await expect(page.getByText("Demo Outsider")).toHaveCount(0);
  await expect(page.getByText("Demo HR", { exact: true })).toHaveCount(0);
});

test("HR uploads a document and the employee downloads the same file", async ({ page, browser }) => {
  const title = `UI test document ${Date.now().toString(36)}`;
  const content = Buffer.from(`%PDF-1.4\n% ${title}\n`);
  await uiLoginToDashboard(page, DEMO.hr);
  await nav(page).getByRole("link", { name: "Documents" }).click();
  await page.getByRole("button", { name: "Upload document" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/^Employee/).selectOption({ label: "Demo Employee (DEMO-004)" });
  await dialog.getByLabel("Category").selectOption({ label: "Certificate" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByLabel("File").setInputFiles({ name: "certificate.pdf", mimeType: "application/pdf", buffer: content });
  await dialog.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("Document uploaded.")).toBeVisible();

  const ctx = await browser.newContext();
  const employee = await ctx.newPage();
  await uiLoginToDashboard(employee, DEMO.employee);
  await employee.goto("/documents");
  const download = employee.waitForEvent("download");
  await employee.getByRole("link", { name: `Download ${title}` }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("certificate.pdf");
  const path = await file.path();
  const { readFileSync } = await import("node:fs");
  expect(readFileSync(path!).equals(content)).toBe(true);
  await ctx.close();
});

test.describe.serial("employee lifecycle through the UI", () => {
  const stamp = Date.now().toString(36);
  const email = `ui-${stamp}@example.test`;
  // Passwords must not resemble the username (Django's similarity validator checks it).
  const initialPassword = `Start-Pa55-${Math.random().toString(36).slice(2, 8)}!`;
  const newPassword = `Rotated-Pa55-${Math.random().toString(36).slice(2, 8)}!`;
  const name = `Uitest ${stamp}`;

  test("HR creates an employee", async ({ page }) => {
    await uiLoginToDashboard(page, DEMO.hr);
    await nav(page).getByRole("link", { name: "Employees" }).click();
    await page.getByRole("link", { name: "Add employee" }).click();
    await expect(page.getByRole("heading", { name: "Add employee" })).toBeVisible();

    await page.getByLabel("First name").fill("Uitest");
    await page.getByLabel("Last name").fill(stamp);
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Initial password").fill(initialPassword);
    await page.getByLabel("Employee ID").fill(`UI-${stamp}`);
    await page.getByLabel("Joining date").fill("2024-01-01");
    await page.getByLabel("Reporting manager").selectOption({ label: "Demo Manager (DEMO-003)" });
    await page.getByRole("button", { name: "Create employee" }).click();

    await expect(page).toHaveURL(/\/employees\/\d+$/);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByText("Employee created.")).toBeVisible();
  });

  test("duplicate employee ID is rejected with a field error", async ({ page }) => {
    await uiLoginToDashboard(page, DEMO.hr);
    await page.goto("/employees/new");
    await page.getByLabel("First name").fill("Dup");
    await page.getByLabel("Work email").fill(`dup-${stamp}@example.test`);
    await page.getByLabel("Employee ID").fill(`UI-${stamp}`);
    await page.getByLabel("Joining date").fill("2024-01-01");
    await page.getByRole("button", { name: "Create employee" }).click();
    await expect(page.getByText(/already exists/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/employees\/new$/);
  });

  test("new employee lands on the dashboard with the initial password, checks in, then changes password voluntarily", async ({ page }) => {
    await uiLogin(page, email, initialPassword);
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
    await cardActions(page).getByRole("button", { name: "Check in", exact: true }).click();
    await expect(page.getByText("Checked in.")).toBeVisible();
    await expect(cardActions(page).getByRole("button", { name: "Check out", exact: true })).toBeVisible();

    await page.goto("/profile");
    await page.getByRole("link", { name: "Change password" }).first().click();
    await expect(page).toHaveURL(/\/change-password$/);
    await page.getByLabel(/^Current password/).fill(initialPassword);
    await page.getByLabel(/^New password/).fill(newPassword);
    await page.getByLabel(/^Confirm new password/).fill(newPassword);
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(page.getByText("Password changed.")).toBeVisible({ timeout: 30_000 }); // two password hashes
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("employee applies for leave and the manager approves it", async ({ page, browser }) => {
    await uiLogin(page, email, newPassword);
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
    await nav(page).getByRole("link", { name: "Leave" }).click();
    await page.getByRole("button", { name: "Apply for leave" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Leave type").selectOption({ label: "Demo Unpaid Leave (unpaid)" });
    await dialog.getByLabel("From").fill("2099-03-02");
    await dialog.getByLabel("To").fill("2099-03-03");
    await dialog.getByLabel("Reason").fill("UI e2e test");
    await dialog.getByRole("button", { name: "Submit request" }).click();
    await expect(page.getByText("Leave request submitted.")).toBeVisible();
    const myRow = page.getByRole("row", { name: /Demo Unpaid Leave/ });
    await expect(myRow.getByText("Pending")).toBeVisible();

    const managerContext = await browser.newContext();
    const managerPage = await managerContext.newPage();
    await uiLoginToDashboard(managerPage, DEMO.manager);
    await managerPage.goto("/leave?tab=approvals");
    const row = managerPage.getByRole("row", { name: new RegExp(name) });
    await row.getByRole("button", { name: "Approve" }).click();
    await managerPage.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
    await expect(managerPage.getByText("Leave approved.")).toBeVisible();
    await managerContext.close();

    await page.reload();
    await expect(page.getByRole("row", { name: /Demo Unpaid Leave/ }).getByText("Approved")).toBeVisible();
    await page.goto("/notifications");
    await expect(page.getByText("Your leave request was approved")).toBeVisible();
  });

  test("employee sees only their own payslip once payroll is finalized", async ({ page }) => {
    // Payroll setup through the API (HR), then verify the employee's UI.
    const hr = await login(DEMO.hr);
    const employees = await json(await hr.get("/api/employees/", { search: `UI-${stamp}` }), 200);
    const employeeId = employees.results[0].id;
    const components = await json(await hr.get("/api/payroll/components/"), 200);
    const base = components.find((c: { code: string }) => c.code === "DEMO-BASE");
    await json(
      await hr.post("/api/payroll/salary-structures/", {
        employee: employeeId,
        effective_from: "2024-01-01",
        items: [{ component: base.id, amount: "2500.00" }],
      }),
      201,
    );
    let runId: number | undefined;
    for (let i = 0; i < 30 && !runId; i++) {
      const res = await hr.post("/api/payroll/runs/", {
        year: 2040 + Math.floor(Math.random() * 59),
        month: 1 + Math.floor(Math.random() * 12),
      });
      if (res.status() === 201) runId = (await res.json()).id;
    }
    expect(runId).toBeTruthy();
    await json(await hr.post(`/api/payroll/runs/${runId}/generate/`), 200);
    await json(await hr.post(`/api/payroll/runs/${runId}/finalize/`), 200);
    await hr.dispose();

    await uiLogin(page, email, newPassword);
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
    await nav(page).getByRole("link", { name: "My payslips" }).click();
    const rows = page.getByRole("row").filter({ hasText: "2,500.00" });
    await expect(rows).toHaveCount(1);
    await rows.first().click();
    await expect(page).toHaveURL(/\/payslips\/\d+$/);
    const payslip = page.getByRole("article");
    await expect(payslip.getByText("Net pay")).toBeVisible();
    await expect(payslip.getByText(name)).toBeVisible();
    await expect(payslip.getByText("2,500.00").first()).toBeVisible();
  });
});
