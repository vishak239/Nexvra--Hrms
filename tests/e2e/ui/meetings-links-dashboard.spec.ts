import { expect, test } from "@playwright/test";
import { DEMO, json, login } from "../support/api";
import { freshEmployee, hrSession } from "../support/people";
import { cardActions, uiLoginToDashboard } from "./helpers";

test("HR runs a selected meeting from the Meetings page; the participant sees working time paused", async ({ page, browser }) => {
  const hr = await hrSession();
  const person = await freshEmployee(hr, { firstName: "Meeting" });
  await hr.dispose();
  const api = await login(person.email, person.password);
  await json(await api.post("/api/attendance/check-in/"), 201);

  await uiLoginToDashboard(page, DEMO.hr);
  await page.goto("/meetings");
  await page.getByRole("button", { name: "New meeting" }).click();
  const dialog = page.getByRole("dialog");
  const title = `UI meeting ${Date.now()}`;
  await dialog.getByLabel("Meeting title").fill(title);
  await dialog.getByLabel("Meeting type").selectOption("SELECTED");
  await dialog.getByLabel("Find employees").fill(person.employeeCode);
  await dialog.getByRole("checkbox").first().check();
  await dialog.getByRole("button", { name: "Schedule meeting" }).click();
  const row = page.getByRole("row", { name: new RegExp(title) });
  await row.getByRole("button", { name: "Start" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Start meeting" }).click();
  await expect(page.getByTestId("active-meeting")).toContainText(title);

  const ctx = await browser.newContext();
  const mine = await ctx.newPage();
  await uiLoginToDashboard(mine, person.email, person.password);
  await expect(mine.getByText("Meeting in progress — Working Time paused.")).toBeVisible();
  await expect(cardActions(mine).getByRole("button", { name: "Break" })).toHaveCount(0);

  await page.getByTestId("active-meeting").getByRole("button", { name: "End meeting" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "End meeting" }).click();
  await expect(page.getByTestId("active-meeting")).toHaveCount(0);
  await mine.reload();
  await expect(mine.getByTestId("session-phase")).toHaveAttribute("data-phase", "WORKING");
  await ctx.close();
  await json(await api.post("/api/attendance/check-out/"), 200);
  await api.dispose();
});

test("links in messages are clickable and markup is shown as text", async ({ page }) => {
  const hr = await hrSession();
  const sender = await freshEmployee(hr, { firstName: "Links" });
  const reader = await freshEmployee(hr, { firstName: "Reader" });
  await hr.dispose();
  const api = await login(sender.email, sender.password);
  const conversation = await json(await api.post("/api/messages/conversations/", { user_id: reader.userId }), 201);
  const text = 'Please check https://example.com/policy and <img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
  await json(await api.post(`/api/messages/conversations/${conversation.id}/messages/`, { body: text }), 201);
  await api.dispose();

  await uiLoginToDashboard(page, reader.email, reader.password);
  await page.goto(`/messages?c=${conversation.id}`);
  const log = page.getByRole("log", { name: "Messages" });
  const link = log.getByRole("link", { name: "https://example.com/policy" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "https://example.com/policy");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
  await expect(log.getByText("<script>window.__xss=2</script>", { exact: false })).toBeVisible(); // shown as text
  await expect(log.locator("script, img")).toHaveCount(0); // nothing from the message became an element
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
});

test("dashboard summary cards share one row on a wide screen and wrap on a narrow one", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await uiLoginToDashboard(page, DEMO.employee);
  const cards = page.getByTestId("summary-cards").locator(":scope > *");
  await expect(cards).toHaveCount(3);
  const tops = async () => Promise.all((await cards.all()).map(async (c) => Math.round((await c.boundingBox())!.y)));
  expect(new Set(await tops()).size).toBe(1); // one row
  for (const accent of ["tasks", "messages", "notifications"]) {
    await expect(page.locator(`[data-accent="${accent}"]`)).toBeVisible();
  }
  await page.setViewportSize({ width: 420, height: 900 });
  await expect.poll(async () => new Set(await tops()).size).toBeGreaterThan(1); // wraps on a phone
  for (const card of await cards.all()) expect((await card.boundingBox())!.width).toBeGreaterThanOrEqual(11.5 * 16 - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); // no sideways scroll
  for (const theme of ["dark", "light"]) {
    await page.evaluate((t) => document.documentElement.classList.toggle("dark", t === "dark"), theme);
    const colours = await Promise.all(
      ["tasks", "messages", "notifications"].map((a) => page.locator(`[data-accent="${a}"]`).evaluate((el) => getComputedStyle(el).color)),
    );
    expect(new Set(colours).size).toBe(3); // three distinct colours in both themes
  }
});
