import { APIRequestContext, APIResponse, expect, request } from "@playwright/test";

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8000";
export const PASSWORD = process.env.E2E_PASSWORD ?? "";

export const DEMO = {
  superAdmin: "superadmin@example.test",
  hr: "hr@example.test",
  manager: "manager@example.test",
  employee: "employee@example.test",
  employee2: "employee2@example.test",
  outsider: "outsider@example.test",
};

/** A logged-in API session that sends the CSRF header on unsafe requests, like the SPA will. */
export class Session {
  constructor(readonly ctx: APIRequestContext) {}

  private async csrf(): Promise<string> {
    const state = await this.ctx.storageState();
    return state.cookies.find((c) => c.name === "csrftoken")?.value ?? "";
  }

  get(url: string, params?: Record<string, string | number>) {
    return this.ctx.get(url, { params });
  }

  async post(url: string, data?: unknown) {
    return this.ctx.post(url, { data, headers: { "X-CSRFToken": await this.csrf() } });
  }

  async patch(url: string, data?: unknown) {
    return this.ctx.patch(url, { data, headers: { "X-CSRFToken": await this.csrf() } });
  }

  async dispose() {
    await this.ctx.dispose();
  }
}

export async function anonymous(): Promise<Session> {
  const ctx = await request.newContext({ baseURL: BASE_URL });
  await ctx.get("/api/auth/csrf/");
  return new Session(ctx);
}

export async function login(email: string, password = PASSWORD): Promise<Session> {
  expect(password, "Set E2E_PASSWORD to the seed_demo password").not.toBe("");
  const session = await anonymous();
  const res = await session.post("/api/auth/login/", { email, password });
  expect(res.status(), await res.text()).toBe(200);
  return session;
}

export async function json(res: APIResponse, status: number) {
  expect(res.status(), await res.text()).toBe(status);
  return res.status() === 204 ? null : res.json();
}
