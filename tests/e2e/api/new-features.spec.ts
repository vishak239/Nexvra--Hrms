import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { DEMO, json, login } from "../support/api";
import { freshEmployee, hrSession } from "../support/people";

test("breaks and overtime: invalid transitions refused, retries idempotent", async () => {
  const hr = await hrSession();
  const person = await freshEmployee(hr);
  await hr.dispose();
  const me = await login(person.email, person.password);

  expect((await me.post("/api/attendance/breaks/start/")).status()).toBe(409); // not checked in
  await json(await me.post("/api/attendance/check-in/"), 201);
  expect((await me.post("/api/attendance/breaks/end/")).status()).toBe(409); // no break
  const id = randomUUID();
  const first = await json(await me.post("/api/attendance/breaks/start/", { client_event_id: id }), 200);
  const retry = await json(await me.post("/api/attendance/breaks/start/", { client_event_id: id }), 200);
  expect(retry.duplicate).toBe(true);
  expect(first.state.active_break.id).toBe(retry.state.active_break.id);
  expect((await me.post("/api/attendance/breaks/start/")).status()).toBe(409); // two breaks at once
  await json(await me.post("/api/attendance/breaks/end/"), 200);
  expect((await me.post("/api/attendance/overtime/start/")).status()).toBe(409); // before checkout
  await json(await me.post("/api/attendance/check-out/"), 200);
  expect((await me.post("/api/attendance/overtime/start/")).status()).toBe(409); // needs an approved request
  const declared = await json(
    await me.post("/api/attendance/overtime/request/", {
      use_other_reason: true,
      other_reason: "Production release support for payroll",
      work_description: "Deploy and monitor the payroll release.",
      declaration_confirmed: true,
    }),
    201,
  );
  const approver = await hrSession();
  await json(await approver.post(`/api/attendance/overtime/${declared.state.open_overtime_request.id}/approve/`), 200);
  await approver.dispose();
  await json(await me.post("/api/attendance/overtime/start/"), 200);
  expect((await me.post("/api/attendance/overtime/start/")).status()).toBe(409); // already running
  const done = await json(await me.post("/api/attendance/overtime/end/"), 200);
  expect(done.state.overtime[0].status).toBe("COMPLETED");

  // offline sync is idempotent too
  const events = [{ id: randomUUID(), type: "OVERTIME_END", occurred_at: new Date().toISOString() }];
  const sync1 = await json(await me.post("/api/attendance/sync/", { events }), 200);
  const sync2 = await json(await me.post("/api/attendance/sync/", { events }), 200);
  expect(sync1.results[0]).toMatchObject({ status: "CONFLICT", duplicate: false });
  expect(sync2.results[0]).toMatchObject({ status: "CONFLICT", duplicate: true });
  await me.dispose();
});

test("tasks: assignment by username, role limits, and checkout protection cannot be bypassed", async () => {
  const hr = await hrSession();
  const person = await freshEmployee(hr, { managerCode: "DEMO-003" });
  const task = await json(await hr.post("/api/tasks/", { username: `@${person.username}`, title: "Confirm bank details" }), 201);
  expect(task.assigned_to.employee_code).toBe(person.employeeCode);

  const me = await login(person.email, person.password);
  expect((await me.post("/api/tasks/", { username: DEMO.employee, title: "x" })).status()).toBe(403);
  expect((await me.post(`/api/tasks/${task.id}/cancel/`)).status()).toBe(403);
  expect((await me.patch(`/api/tasks/${task.id}/`, { title: "Mine now" })).status()).toBe(403);

  const outsider = await login(DEMO.outsider);
  expect((await outsider.get(`/api/tasks/${task.id}/`)).status()).toBe(404);
  const manager = await login(DEMO.manager);
  expect((await manager.get(`/api/tasks/${task.id}/`)).status()).toBe(200); // direct report
  const otherTeam = await json(await manager.get("/api/tasks/", { search: "DEMO-006" }), 200);
  expect(otherTeam.results).toEqual([]);

  await json(await me.post("/api/attendance/check-in/"), 201);
  const blocked = await me.post("/api/attendance/check-out/");
  expect(blocked.status()).toBe(409);
  expect((await blocked.json()).error.code).toBe("checkout_blocked_by_tasks");
  await json(await me.post(`/api/tasks/${task.id}/respond/`, { message: "Confirmed." }), 200);
  await json(await me.post("/api/attendance/check-out/"), 200);

  // Super Admin is never blocked by tasks.
  const superAdmin = await login(DEMO.superAdmin);
  const admin = await freshEmployee(superAdmin, { role: "SUPER_ADMIN" });
  await json(await hr.post("/api/tasks/", { employee_code: admin.employeeCode, title: "Review policy" }), 201);
  const adminSession = await login(admin.email, admin.password);
  await json(await adminSession.post("/api/attendance/check-in/"), 201);
  await json(await adminSession.post("/api/attendance/check-out/"), 200);

  for (const s of [hr, me, outsider, manager, superAdmin, adminSession]) await s.dispose();
});

test("leave: approval deducts exactly once and locks the request", async () => {
  const hr = await hrSession();
  const person = await freshEmployee(hr, { managerCode: "DEMO-003" });
  const types = await json(await hr.get("/api/leaves/types/"), 200);
  const annual = types.find((t: { code: string }) => t.code === "DEMO-AL");
  const year = new Date().getFullYear() + 1;
  await json(await hr.post("/api/leaves/balances/allocate/", { leave_type: annual.id, year, allocated: "12", employees: [person.id] }), 200);

  const me = await login(person.email, person.password);
  const leave = await json(
    await me.post("/api/leaves/requests/", { leave_type: annual.id, start_date: `${year}-03-02`, end_date: `${year}-03-03` }),
    201,
  );
  const balance = async () =>
    (await json(await me.get("/api/leaves/balances/mine/", { year }), 200)).results.find((b: { leave_type: number }) => b.leave_type === annual.id);
  expect(Number((await balance()).available)).toBe(12);

  const manager = await login(DEMO.manager);
  const [a, b] = await Promise.all([
    manager.post(`/api/leaves/requests/${leave.id}/approve/`),
    hr.post(`/api/leaves/requests/${leave.id}/approve/`),
  ]);
  expect([a.status(), b.status()].sort()).toEqual([200, 409]); // concurrent approvals: one wins
  expect(Number((await balance()).available)).toBe(10);
  const ledger = await json(await hr.get("/api/leaves/balance-transactions/", { employee: person.id }), 200);
  expect(ledger.results).toHaveLength(1);

  const cancel = await me.post(`/api/leaves/requests/${leave.id}/cancel/`);
  expect(cancel.status()).toBe(409);
  expect(Number((await balance()).available)).toBe(10);
  for (const s of [hr, me, manager]) await s.dispose();
});

test("messaging: only participants can read conversations or download files", async () => {
  const hr = await hrSession();
  const a = await freshEmployee(hr);
  const b = await freshEmployee(hr);
  await hr.dispose();
  const alice = await login(a.email, a.password);
  const conversation = await json(await alice.post("/api/messages/conversations/", { user_id: b.userId }), 201);
  const sent = await alice.ctx.post(`/api/messages/conversations/${conversation.id}/messages/`, {
    multipart: {
      body: "Private",
      files: { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello\n") },
    },
    headers: { "X-CSRFToken": (await alice.ctx.storageState()).cookies.find((c) => c.name === "csrftoken")!.value },
  });
  expect(sent.status(), await sent.text()).toBe(201);
  const attachment = (await sent.json()).attachments[0];

  for (const who of [DEMO.outsider, DEMO.hr, DEMO.superAdmin]) {
    const other = await login(who);
    expect((await other.get(`/api/messages/conversations/${conversation.id}/messages/`)).status()).toBe(404);
    expect((await other.get(attachment.download_url)).status()).toBe(404);
    await other.dispose();
  }
  const bob = await login(b.email, b.password);
  expect((await json(await bob.get("/api/messages/unread-count/"), 200)).count).toBe(1);
  const file = await bob.get(attachment.download_url);
  expect(file.status()).toBe(200);
  expect((await file.body()).toString()).toBe("hello\n");
  await alice.dispose();
  await bob.dispose();
});
