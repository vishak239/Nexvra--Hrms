import { expect, test } from "@playwright/test";
import { DEMO, anonymous, json, login } from "../support/api";

test("each role logs in and receives its own permission set", async () => {
  const expected: Record<string, string> = {
    [DEMO.superAdmin]: "SUPER_ADMIN",
    [DEMO.hr]: "HR_ADMIN",
    [DEMO.manager]: "MANAGER",
    [DEMO.employee]: "EMPLOYEE",
  };
  for (const [email, role] of Object.entries(expected)) {
    const s = await login(email);
    const me = await json(await s.get("/api/auth/me/"), 200);
    expect(me.role.code).toBe(role);
    expect(me.permissions.includes("audit.view")).toBe(role === "SUPER_ADMIN");
    await s.dispose();
  }
});

test("wrong password is rejected with a generic message", async () => {
  const s = await anonymous();
  const body = await json(await s.post("/api/auth/login/", { email: DEMO.employee, password: "wrong" }), 400);
  expect(body.error.message).toBe("Invalid email or password.");
  await s.dispose();
});

test("login without CSRF token is refused", async () => {
  const s = await anonymous();
  const res = await s.ctx.post("/api/auth/login/", { data: { email: DEMO.employee, password: "x" } });
  expect(res.status()).toBe(403);
  await s.dispose();
});

test("logout ends the session", async () => {
  const s = await login(DEMO.employee);
  await json(await s.post("/api/auth/logout/"), 204);
  await json(await s.get("/api/auth/me/"), 401);
  await s.dispose();
});
