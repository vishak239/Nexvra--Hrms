import { expect, type BrowserContext, type Page } from "@playwright/test";
import { DEMO, Session, json, login } from "./api";

export interface FreshPerson {
  id: number;
  userId: number;
  email: string;
  username: string;
  employeeCode: string;
  fullName: string;
  password: string;
}

let seq = 0;

/** A unique, ready-to-use employee (password already changed), so flows that check in/out
 * can run any number of times per day. Created by `creator` (HR unless a role needs more). */
export async function freshEmployee(
  creator: Session,
  opts: { role?: string; managerCode?: string; firstName?: string } = {},
): Promise<FreshPerson> {
  const stamp = `${Date.now().toString(36)}${(seq++).toString(36)}`;
  const username = `e2e.${stamp}`;
  const email = `${username}@example.test`;
  // Passwords are random and unrelated to the username (the similarity validator checks it).
  const secret = () => Math.random().toString(36).slice(2, 10);
  const initial = `Start-Pa55-${secret()}!`;
  let manager: number | undefined;
  if (opts.managerCode) {
    const found = await json(await creator.get("/api/employees/", { search: opts.managerCode }), 200);
    manager = found.results[0].id;
  }
  const created = await json(
    await creator.post("/api/employees/", {
      email,
      username,
      first_name: opts.firstName ?? "E2E",
      last_name: stamp,
      employee_code: `E2E-${stamp}`.toUpperCase(),
      joining_date: "2024-01-01",
      employment_type: "FULL_TIME",
      initial_password: initial,
      role: opts.role ?? "EMPLOYEE",
      manager,
    }),
    201,
  );
  const password = `Ready-Pa55-${secret()}!`;
  const self = await login(email, initial);
  await json(await self.post("/api/auth/change-password/", { current_password: initial, new_password: password }), 200);
  await self.dispose();
  return {
    id: created.id,
    userId: (await json(await creator.get("/api/messages/people/", { q: `@${username}` }), 200)).results[0].user_id,
    email,
    username,
    employeeCode: created.employee_code,
    fullName: `${opts.firstName ?? "E2E"} ${stamp}`,
    password,
  };
}

export async function hrSession() {
  return login(DEMO.hr);
}

/** Send a same-origin API call from the browser session (cookies + CSRF), like the SPA does. */
export async function browserPost(page: Page, context: BrowserContext, url: string, data?: unknown) {
  const csrf = (await context.cookies()).find((c) => c.name === "csrftoken")?.value ?? "";
  return page.request.post(url, { data, headers: { "X-CSRFToken": csrf } });
}

export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.getByText(text).first()).toBeVisible();
}
