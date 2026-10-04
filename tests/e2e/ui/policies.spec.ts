import { expect, test } from "@playwright/test";
import { DEMO, json, login } from "../support/api";
import { expectToast } from "../support/people";
import { nav, uiLoginToDashboard } from "./helpers";

const ROLES = [
  { who: DEMO.superAdmin, manage: true },
  { who: DEMO.hr, manage: true },
  { who: DEMO.manager, manage: false },
  { who: DEMO.employee, manage: false },
];

for (const role of ROLES) {
  test(`policies page is available to every role, editing only to policy managers: ${role.who}`, async ({ page }) => {
    await uiLoginToDashboard(page, role.who);
    await nav(page).getByRole("link", { name: "Policies" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Policies" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Rules applied by the system" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New policy" })).toHaveCount(role.manage ? 1 : 0);
    // The API agrees with the UI.
    const csrf = (await page.context().cookies()).find((c) => c.name === "csrftoken")?.value ?? "";
    const res = await page.request.post("/api/policies/", {
      data: { title: `Role probe ${Date.now()}`, category: "OTHER", body: "probe" },
      headers: { "X-CSRFToken": csrf },
    });
    expect(res.status()).toBe(role.manage ? 201 : 403);
    if (role.manage) {
      const created = await res.json();
      const del = await page.request.delete(`/api/policies/${created.id}/`, { headers: { "X-CSRFToken": csrf } });
      expect(del.status()).toBe(204);
    }
  });
}

test("HR drafts a policy, employees only see it once it is published", async ({ page, browser }) => {
  const title = `E2E communication policy ${Date.now()}`;
  const hr = await login(DEMO.hr);
  const employee = await login(DEMO.employee);
  let id: number | undefined;
  try {
    await uiLoginToDashboard(page, DEMO.hr);
    await page.goto("/policies");
    await page.getByRole("button", { name: "New policy" }).click();
    const dialog = page.getByRole("dialog", { name: "New policy" });
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByLabel("Category").selectOption("COMMUNICATION");
    await dialog.getByLabel("Policy text").fill("Use the company chat for work conversations.\nReply within one working day.");
    await dialog.getByRole("button", { name: "Save draft" }).click();
    await expectToast(page, "Draft saved.");
    const card = page.getByRole("article", { name: title });
    await expect(card.getByText("Draft")).toBeVisible();

    const found = await json(await hr.get("/api/policies/", { q: title }), 200);
    id = found.results[0].id;
    // a draft is invisible to employees, even by id
    expect((await json(await employee.get("/api/policies/", { q: title }), 200)).count).toBe(0);
    expect((await employee.get(`/api/policies/${id}/`)).status()).toBe(404);

    await card.getByRole("button", { name: "Edit" }).click();
    const edit = page.getByRole("dialog", { name: "Edit policy" });
    await edit.getByLabel("Published").check();
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expectToast(page, "Policy updated.");
    await expect(card.getByText("Draft")).toHaveCount(0);

    // the employee finds it by searching, and cannot change it
    const ctx = await browser.newContext();
    const emp = await ctx.newPage();
    await uiLoginToDashboard(emp, DEMO.employee);
    await emp.goto("/policies");
    await emp.getByLabel("Search policies").fill("company chat for work");
    await expect(emp.getByRole("heading", { name: title })).toBeVisible();
    await expect(emp.getByRole("button", { name: "Edit" })).toHaveCount(0);
    expect((await employee.patch(`/api/policies/${id}/`, { title: "Hijacked" })).status()).toBe(403);
    await ctx.close();
  } finally {
    if (id) expect((await hr.delete(`/api/policies/${id}/`)).status()).toBe(204);
    await hr.dispose();
    await employee.dispose();
  }
});

test("the daily break allowance set by HR is shown to employees", async ({ page }) => {
  const hr = await login(DEMO.hr);
  const original = (await json(await hr.get("/api/settings/"), 200)).break_allowance_minutes;
  try {
    await json(await hr.patch("/api/settings/", { break_allowance_minutes: 60 }), 200);
    await uiLoginToDashboard(page, DEMO.employee);

    await page.goto("/policies");
    const tile = page.getByText("Daily break allowance").locator("..");
    await expect(tile.getByText("60 min")).toBeVisible();

    await page.goto("/attendance");
    await expect(page.getByTestId("total-break-hint")).toContainText(/remaining of 60 min$/);
  } finally {
    await json(await hr.patch("/api/settings/", { break_allowance_minutes: original }), 200);
    await hr.dispose();
  }
});
