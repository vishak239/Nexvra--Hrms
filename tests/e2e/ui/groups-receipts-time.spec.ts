import { expect, test } from "@playwright/test";
import { json, login } from "../support/api";
import { expectToast, freshEmployee, hrSession } from "../support/people";
import { cardActions, uiLoginToDashboard } from "./helpers";

const TWENTY_FOUR_HOUR = /\b(1[3-9]|2[0-3]):[0-5]\d\b/;

test("create a group in Messages, send a message, and see the Nexvra seen mark once a member reads it", async ({ page, browser }) => {
  const hr = await hrSession();
  const owner = await freshEmployee(hr, { firstName: "Group" });
  const first = await freshEmployee(hr, { firstName: "Member" });
  const second = await freshEmployee(hr, { firstName: "Second" });
  await hr.dispose();

  await uiLoginToDashboard(page, owner.email, owner.password);
  await page.goto("/messages");
  await page.getByRole("button", { name: "Create Group" }).click();
  const dialog = page.getByRole("dialog");
  const name = `UI group ${Date.now()}`;
  await dialog.getByLabel(/Group name/).fill(name);
  for (const person of [first, second]) {
    await dialog.getByPlaceholder("Find @username, Employee ID or name").fill(`@${person.username}`);
    await dialog.getByRole("button", { name: person.fullName, pressed: false }).click();
  }
  await expect(dialog.getByRole("list", { name: "Selected members" })).toContainText(first.fullName);
  await dialog.getByRole("button", { name: "Review" }).click();
  await expect(dialog.getByTestId("group-review")).toContainText("3 members including you");
  await dialog.getByRole("button", { name: "Create group" }).click();
  await expect(page).toHaveURL(/\/messages\?c=\d+$/);
  await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();

  await page.getByLabel("Message", { exact: true }).fill("Welcome to the group");
  await page.getByRole("button", { name: "Send" }).click();
  const mark = page.getByRole("log", { name: "Messages" }).getByTestId("receipt").last();
  await expect(mark).toHaveAttribute("data-status", /sent|delivered/);

  // Both members open the group in their own browser.
  for (const member of [first, second]) {
    const ctx = await browser.newContext();
    const other = await ctx.newPage();
    await uiLoginToDashboard(other, member.email, member.password);
    await other.goto("/messages");
    await other.getByRole("button", { name: new RegExp(name) }).click();
    await expect(other.getByRole("log", { name: "Messages" })).toContainText("Welcome to the group");
    await expect(other.getByRole("log", { name: "Messages" })).toContainText(owner.fullName); // sender name in groups
    await ctx.close();
  }
  // The sender's view refreshes receipts every 10 seconds.
  await expect(mark).toHaveAttribute("data-status", "seen", { timeout: 30_000 });
  await expect(mark).toHaveAttribute("title", /Seen by 2 of 2/);
});

test("notifications show a category icon for each kind", async ({ page }) => {
  const hr = await hrSession();
  const person = await freshEmployee(hr, { firstName: "Icons" });
  await json(await hr.post("/api/tasks/", { username: `@${person.username}`, title: "Icon check task" }), 201);
  await hr.dispose();
  const me = await login(person.email, person.password);
  await json(await me.post("/api/auth/change-password/", { current_password: person.password, new_password: `${person.password}x` }), 200);
  await me.dispose();

  await uiLoginToDashboard(page, person.email, `${person.password}x`);
  await page.goto("/notifications");
  const rows = page.getByTestId("notification-row");
  await expect(rows.first()).toBeVisible();
  await expect(page.getByTestId("notification-icon").and(page.locator('[data-category="task"]'))).toBeVisible();
  await expect(page.getByTestId("notification-icon").and(page.locator('[data-category="security"]'))).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Today" })).toBeVisible();
});

test("attendance times are shown on a 12-hour clock in India time", async ({ page }) => {
  const hr = await hrSession();
  const person = await freshEmployee(hr, { firstName: "Clock" });
  await hr.dispose();
  await uiLoginToDashboard(page, person.email, person.password);
  await page.goto("/attendance");
  await cardActions(page).getByRole("button", { name: "Check in", exact: true }).click();
  await expectToast(page, "Checked in.");
  const line = page.getByRole("cell", { name: /^(1[0-2]|[1-9]):[0-5]\d (AM|PM)$/ }).first(); // today's check-in
  await expect(line).toBeVisible();
  const card = await page.locator("main").innerText();
  expect(card).not.toMatch(TWENTY_FOUR_HOUR);
  // The time shown is India time, whatever this browser's timezone is.
  const ist = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true })
    .format(new Date())
    .replace(/\u202f/g, " ");
  const shown = (await line.innerText()).trim();
  const minutes = (t: string) => {
    const m = t.match(/(\d+):(\d+) (AM|PM)/)!;
    return ((+m[1] % 12) + (m[3] === "PM" ? 12 : 0)) * 60 + +m[2];
  };
  expect(Math.abs(minutes(shown) - minutes(ist))).toBeLessThanOrEqual(2);
});
