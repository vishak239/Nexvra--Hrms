import { expect, test } from "@playwright/test";
import { DEMO, json, login } from "../support/api";
import { freshEmployee, hrSession } from "../support/people";

test("selected meeting pauses only its participants; the session continues without a new check-in", async () => {
  const hr = await hrSession();
  const inMeeting = await freshEmployee(hr, { firstName: "Meet" });
  const outside = await freshEmployee(hr, { firstName: "Other" });
  const a = await login(inMeeting.email, inMeeting.password);
  const b = await login(outside.email, outside.password);
  await json(await a.post("/api/attendance/check-in/"), 201);
  await json(await b.post("/api/attendance/check-in/"), 201);

  const meeting = await json(
    await hr.post("/api/attendance/meetings/", { title: "E2E 1:1 with HR", kind: "SELECTED", participant_ids: [inMeeting.id] }),
    201,
  );
  expect(meeting.status).toBe("SCHEDULED");
  const started = await json(await hr.post(`/api/attendance/meetings/${meeting.id}/start/`), 200);
  expect(started.status).toBe("ACTIVE");

  const paused = await json(await a.get("/api/attendance/today/"), 200);
  expect(paused.active_pause?.meeting).toBe(meeting.id);
  const blocked = await a.post("/api/attendance/breaks/start/");
  expect(blocked.status()).toBe(409);
  expect((await blocked.json()).error.code).toBe("in_meeting");
  const working = await json(await b.get("/api/attendance/today/"), 200);
  expect(working.active_pause).toBeNull();
  await json(await b.post("/api/attendance/breaks/start/"), 200); // non-participants work normally
  await json(await b.post("/api/attendance/breaks/end/"), 200);

  const ended = await json(await hr.post(`/api/attendance/meetings/${meeting.id}/end/`), 200);
  expect(ended.status).toBe("COMPLETED");
  const after = await json(await a.get("/api/attendance/today/"), 200);
  expect(after.active_pause).toBeNull();
  expect(after.record.check_out).toBeNull(); // still in the same session
  expect(after.meeting_pauses).toHaveLength(1);
  expect((await a.post("/api/attendance/check-in/")).status()).toBe(409); // no new check-in needed or allowed

  // Participants see the meeting; others do not.
  const visibleToA = await json(await a.get("/api/attendance/meetings/"), 200);
  expect(visibleToA.results.map((m: { id: number }) => m.id)).toContain(meeting.id);
  const visibleToB = await json(await b.get("/api/attendance/meetings/"), 200);
  expect(visibleToB.results.map((m: { id: number }) => m.id)).not.toContain(meeting.id);

  await json(await a.post("/api/attendance/check-out/"), 200);
  await json(await b.post("/api/attendance/check-out/"), 200);
  await Promise.all([a.dispose(), b.dispose(), hr.dispose()]);
});

test("only HR / Super Admin manage meetings and decide Resume Work", async () => {
  const employee = await login(DEMO.employee);
  const manager = await login(DEMO.manager);
  for (const s of [employee, manager]) {
    expect((await s.post("/api/attendance/meetings/", { title: "Not allowed", kind: "OVERALL" })).status()).toBe(403);
    expect((await s.post("/api/attendance/resume-requests/999999/approve/")).status()).toBe(403);
  }
  await Promise.all([employee.dispose(), manager.dispose()]);
});

test("Resume Work is only for an automatic inactivity check-out", async () => {
  const hr = await hrSession();
  const person = await freshEmployee(hr);
  await hr.dispose();
  const me = await login(person.email, person.password);
  const refusedBefore = await me.post("/api/attendance/resume-requests/", { reason: "I was attending an offline discussion." });
  expect(refusedBefore.status()).toBe(409); // not checked in
  await json(await me.post("/api/attendance/check-in/"), 201);
  expect((await me.post("/api/attendance/resume-requests/", { reason: "I was attending an offline discussion." })).status()).toBe(409);
  await json(await me.post("/api/attendance/check-out/"), 200);
  expect((await me.post("/api/attendance/resume-requests/", { reason: "I was attending an offline discussion." })).status()).toBe(409);
  expect((await me.post("/api/attendance/check-in/")).status()).toBe(409); // a manual check-out ends the day
  await me.dispose();
});

test("heartbeat accepts activity metadata only and rejects malformed reports", async () => {
  const hr = await hrSession();
  const person = await freshEmployee(hr);
  await hr.dispose();
  const me = await login(person.email, person.password);
  await json(await me.post("/api/attendance/check-in/"), 201);
  const ok = await json(await me.post("/api/attendance/heartbeat/", { idle_seconds: 2, activity: [40, 2], observed_seconds: 60 }), 200);
  expect(ok.state.record.check_out).toBeNull();
  expect((await me.post("/api/attendance/heartbeat/", { idle_seconds: 0, activity: [-1] })).status()).toBe(400);
  await json(await me.post("/api/attendance/check-out/"), 200);
  await me.dispose();
});
