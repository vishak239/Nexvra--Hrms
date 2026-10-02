import { expect, test } from "@playwright/test";
import { DEMO, Session, json, login } from "../support/api";

/**
 * Critical flow, end to end against the live API:
 * HR creates an employee -> employee logs in -> checks in -> applies for leave ->
 * manager approves -> HR runs payroll -> employee sees own payslip only.
 */
test.describe.serial("employee lifecycle", () => {
  const stamp = Date.now().toString(36);
  const email = `e2e-${stamp}@example.test`;
  // Must not resemble the username (Django's similarity validator checks it).
  const password = `Start-Pa55-${Math.random().toString(36).slice(2, 10)}!`;
  let hr: Session, manager: Session, newcomer: Session;
  let employeeId: number;
  let leaveId: number;

  test.beforeAll(async () => {
    hr = await login(DEMO.hr);
    manager = await login(DEMO.manager);
  });

  test.afterAll(async () => {
    for (const s of [hr, manager, newcomer]) await s?.dispose();
  });

  test("HR creates an employee reporting to the manager", async () => {
    const managerRecord = await json(await manager.get("/api/employees/me/"), 200);
    const body = await json(
      await hr.post("/api/employees/", {
        email,
        first_name: "E2E",
        last_name: stamp,
        employee_code: `E2E-${stamp}`,
        joining_date: "2024-01-01",
        employment_type: "FULL_TIME",
        manager: managerRecord.id,
        initial_password: password,
      }),
      201,
    );
    employeeId = body.id;
    expect(body.role).toBe("EMPLOYEE");
  });

  test("HR and the manager can view the employee; confidential fields only for HR", async () => {
    const asHr = await json(await hr.get(`/api/employees/${employeeId}/`), 200);
    expect(asHr).toHaveProperty("phone");
    const asManager = await json(await manager.get(`/api/employees/${employeeId}/`), 200);
    expect(asManager.full_name).toContain("E2E");
    expect(asManager).not.toHaveProperty("phone");
  });

  test("new employee logs in and checks in", async () => {
    newcomer = await login(email, password);
    const me = await json(await newcomer.get("/api/auth/me/"), 200);
    expect(me.must_change_password).toBe(true);
    const record = await json(await newcomer.post("/api/attendance/check-in/"), 201);
    expect(record.employee.id).toBe(employeeId);
    await json(await newcomer.post("/api/attendance/check-in/"), 409);
    await json(await newcomer.post("/api/attendance/check-out/"), 200);
  });

  test("employee applies for leave and the manager approves it", async () => {
    const types = await json(await newcomer.get("/api/leaves/types/"), 200);
    const unpaid = types.find((t: { code: string }) => t.code === "DEMO-UL");
    expect(unpaid, "seed_demo must have created DEMO-UL").toBeTruthy();
    const leave = await json(
      await newcomer.post("/api/leaves/requests/", {
        leave_type: unpaid.id,
        start_date: "2099-06-01",
        end_date: "2099-06-02",
        reason: "E2E test",
      }),
      201,
    );
    leaveId = leave.id;
    expect(leave.status).toBe("PENDING");

    // the employee cannot approve their own request
    await json(await newcomer.post(`/api/leaves/requests/${leaveId}/approve/`), 403);

    const pending = await json(await manager.get("/api/leaves/requests/pending-approvals/"), 200);
    expect(pending.results.map((r: { id: number }) => r.id)).toContain(leaveId);
    const approved = await json(await manager.post(`/api/leaves/requests/${leaveId}/approve/`, { note: "OK" }), 200);
    expect(approved.status).toBe("APPROVED");

    const notes = await json(await newcomer.get("/api/notifications/"), 200);
    expect(notes.results.some((n: { type: string }) => n.type === "LEAVE_APPROVED")).toBe(true);
  });

  test("HR runs payroll and the employee sees only their own payslip", async () => {
    const components = await json(await hr.get("/api/payroll/components/"), 200);
    const base = components.find((c: { code: string }) => c.code === "DEMO-BASE");
    await json(
      await hr.post("/api/payroll/salary-structures/", {
        employee: employeeId,
        effective_from: "2024-01-01",
        items: [{ component: base.id, amount: "1234.00" }],
      }),
      201,
    );

    // pick an unused far-future period so the test can be re-run
    let run: { id: number } | undefined;
    for (let attempt = 0; attempt < 20 && !run; attempt++) {
      const year = 2040 + Math.floor(Math.random() * 59);
      const month = 1 + Math.floor(Math.random() * 12);
      const res = await hr.post("/api/payroll/runs/", { year, month });
      if (res.status() === 201) run = await res.json();
    }
    expect(run).toBeTruthy();
    await json(await hr.post(`/api/payroll/runs/${run!.id}/generate/`), 200);

    // draft payslips are invisible to employees
    const draft = await json(await newcomer.get("/api/payroll/payslips/", { run: run!.id }), 200);
    expect(draft.count).toBe(0);

    await json(await hr.post(`/api/payroll/runs/${run!.id}/finalize/`), 200);
    const mine = await json(await newcomer.get("/api/payroll/payslips/", { run: run!.id }), 200);
    expect(mine.count).toBe(1);
    expect(mine.results[0].employee.id).toBe(employeeId);
    expect(mine.results[0].net_pay).toBe("1234.00");

    // manager cannot see the team member's payslip
    await json(await manager.get(`/api/payroll/payslips/${mine.results[0].id}/`), 404);
  });
});
