import { expect, test } from "@playwright/test";
import { DEMO, json, login } from "../support/api";

test("employee cannot see other employees", async () => {
  const s = await login(DEMO.employee);
  const list = await json(await s.get("/api/employees/"), 200);
  expect(list.count).toBe(1);
  const outsider = await login(DEMO.outsider);
  const other = await json(await outsider.get("/api/employees/me/"), 200);
  await json(await s.get(`/api/employees/${other.id}/`), 404);
  await s.dispose();
  await outsider.dispose();
});

test("manager cannot see employees outside the team", async () => {
  const manager = await login(DEMO.manager);
  const outsider = await login(DEMO.outsider);
  const other = await json(await outsider.get("/api/employees/me/"), 200);
  await json(await manager.get(`/api/employees/${other.id}/`), 404);
  const team = await json(await manager.get("/api/employees/"), 200);
  expect(team.results.map((e: { id: number }) => e.id)).not.toContain(other.id);
  await manager.dispose();
  await outsider.dispose();
});

test("HR cannot perform system administration", async () => {
  const hr = await login(DEMO.hr);
  await json(await hr.get("/api/users/"), 403);
  await json(await hr.get("/api/audit-logs/"), 403);
  await json(await hr.patch("/api/company/", { name: "x" }), 403);
  const roles = await json(await hr.get("/api/roles/"), 200);
  const hrRole = roles.find((r: { code: string }) => r.code === "HR_ADMIN");
  await json(await hr.patch(`/api/roles/${hrRole.id}/`, { permissions: [] }), 403);
  await hr.dispose();
});

test("employee cannot reach administrative endpoints", async () => {
  const s = await login(DEMO.employee);
  for (const url of ["/api/users/", "/api/audit-logs/", "/api/payroll/runs/", "/api/reports/headcount/"]) {
    await json(await s.get(url), 403);
  }
  await json(await s.post("/api/employees/", { email: "x@example.test" }), 403);
  await json(await s.patch("/api/settings/", { currency: "USD" }), 403);
  await s.dispose();
});

test("super admin can read the audit log of these actions", async () => {
  const sa = await login(DEMO.superAdmin);
  const logs = await json(await sa.get("/api/audit-logs/", { action: "LOGIN" }), 200);
  expect(logs.count).toBeGreaterThan(0);
  await sa.dispose();
});
