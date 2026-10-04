import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { json, login } from "../support/api";
import { expectToast, freshEmployee, hrSession } from "../support/people";
import { uiLoginToDashboard, cardActions } from "./helpers";

test("messaging: find a colleague by @username, send a file, colleague downloads it", async ({ page, browser }) => {
  const hr = await hrSession();
  const alice = await freshEmployee(hr, { firstName: "Alpha" });
  const bob = await freshEmployee(hr, { firstName: "Bravo" });
  await hr.dispose();
  const content = Buffer.from(`%PDF-1.4\n% shared plan ${Date.now()}\n`);

  await uiLoginToDashboard(page, alice.email, alice.password);
  await page.goto("/messages");
  await page.getByPlaceholder("Find @username, Employee ID or name").fill(`@${bob.username}`);
  await page.getByRole("button", { name: `Message ${bob.fullName}` }).click();
  await expect(page).toHaveURL(/\/messages\?c=\d+$/);
  await page.getByLabel("Message", { exact: true }).fill("Hi Bravo, here is the plan.");
  await page.getByLabel("Attach files").setInputFiles({ name: "plan.pdf", mimeType: "application/pdf", buffer: content });
  await expect(page.getByRole("list", { name: "Files to send" })).toContainText("plan.pdf");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("link", { name: "Download plan.pdf" })).toBeVisible();

  const ctx = await browser.newContext();
  const bobPage = await ctx.newPage();
  await uiLoginToDashboard(bobPage, bob.email, bob.password);
  await expect(bobPage.getByRole("link", { name: "Messages, 1 unread" })).toBeVisible();
  await bobPage.goto("/notifications");
  await expect(bobPage.getByText(/sent you 1 file/)).toBeVisible();
  await bobPage.goto("/messages");
  await bobPage.getByRole("button", { name: new RegExp(alice.fullName) }).click();
  await expect(bobPage.getByText("Hi Bravo, here is the plan.")).toBeVisible();
  const download = bobPage.waitForEvent("download");
  await bobPage.getByRole("link", { name: "Download plan.pdf" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("plan.pdf");
  expect(readFileSync((await file.path())!).equals(content)).toBe(true);
  await ctx.close();
});

test("offline: breaks are queued locally and synchronised on reconnect; the session is recovered", async ({ page, context }) => {
  const hr = await hrSession();
  const person = await freshEmployee(hr);
  await hr.dispose();

  await uiLoginToDashboard(page, person.email, person.password);
  await page.goto("/attendance");
  await cardActions(page).getByRole("button", { name: "Check in", exact: true }).click();
  await expectToast(page, "Checked in.");

  await context.setOffline(true);
  const status = page.getByTestId("connection-status");
  await expect(status).toHaveAttribute("data-status", "OFFLINE");
  await expect(page.getByText("Offline mode", { exact: true }).first()).toBeVisible();
  await cardActions(page).getByRole("button", { name: "Break", exact: true }).click();
  await expect(page.getByText("1 waiting to sync")).toBeVisible();
  await expect(page.getByTestId("session-phase")).toHaveAttribute("data-phase", "ON_BREAK");
  await page.waitForTimeout(1200);
  await cardActions(page).getByRole("button", { name: "End break", exact: true }).click();
  await expect(page.getByText("2 waiting to sync")).toBeVisible();
  await expect(cardActions(page).getByRole("button", { name: "Check out", exact: true })).toBeDisabled(); // needs the server

  await context.setOffline(false);
  await expect(status).not.toHaveAttribute("data-status", "OFFLINE");
  await expect(page.getByText(/waiting to sync/)).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId("session-phase")).toHaveAttribute("data-phase", "WORKING");

  const self = await login(person.email, person.password);
  const breaks = await json(await self.get("/api/attendance/breaks/"), 200);
  expect(breaks.results).toHaveLength(1);
  expect(breaks.results[0]).toMatchObject({ status: "COMPLETED", source: "OFFLINE" });
  const events = await json(await self.get("/api/attendance/sync-events/", { channel: "OFFLINE" }), 200);
  expect(events.results.map((e: { status: string }) => e.status)).toEqual(["APPLIED", "APPLIED"]);
  await self.dispose();

  // Reopening the app (a new tab has a fresh browser session) recovers the active session.
  const reopened = await context.newPage();
  await reopened.goto("/attendance");
  await expect(reopened.getByText("Active work session detected.")).toBeVisible();
  await reopened.getByRole("button", { name: "Resume session" }).click();
  await expect(reopened.getByText("Active work session detected.")).toHaveCount(0);
  await expect(reopened.getByTestId("session-phase")).toHaveAttribute("data-phase", "WORKING");
});
