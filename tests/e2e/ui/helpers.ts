import { expect, type Page } from "@playwright/test";
import { PASSWORD } from "../support/api";

export async function uiLogin(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export async function uiLoginToDashboard(page: Page, email: string, password = PASSWORD) {
  await uiLogin(page, email, password);
  // Password hashing is deliberately slow; allow for busy test machines.
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/^Good (morning|afternoon|evening), /, { timeout: 30_000 });
}

export const nav = (page: Page) => page.getByRole("navigation", { name: "Main" });

/** The attendance card's action buttons (the header shows the same actions, so scope to the card). */
export const cardActions = (page: Page) => page.getByTestId("session-actions");
