import { expect, test, type BrowserContext } from "@playwright/test";
import { DEMO, json, login, type Session } from "../support/api";
import { expectToast, freshEmployee, hrSession } from "../support/people";
import { cardActions, uiLoginToDashboard } from "./helpers";

const WORK = { latitude: 12.9716, longitude: 77.5946 };
const north = (m: number) => ({ latitude: WORK.latitude + (m / 6_371_008.8) * (180 / Math.PI), longitude: WORK.longitude });

async function csrf(context: BrowserContext) {
  return (await context.cookies()).find((c) => c.name === "csrftoken")?.value ?? "";
}

/** Run with company settings changed, then restore exactly what was there. */
async function withSettings(hr: Session, changes: Record<string, unknown>, body: () => Promise<void>) {
  const before = await json(await hr.get("/api/settings/"), 200);
  const restore = Object.fromEntries(Object.keys(changes).map((k) => [k, before[k]]));
  await json(await hr.patch("/api/settings/", changes), 200);
  try {
    await body();
  } finally {
    await json(await hr.patch("/api/settings/", restore), 200);
  }
}

test("office check-in is limited to the workplace radius and verified by the server", async ({ browser }) => {
  test.setTimeout(90_000);
  const hr = await hrSession();
  const person = await freshEmployee(hr);
  await withSettings(hr, { workplace_latitude: String(WORK.latitude), workplace_longitude: String(WORK.longitude), geofence_radius_m: 20 }, async () => {
    const context = await browser.newContext({ geolocation: { ...north(100), accuracy: 10 }, permissions: ["geolocation"] });
    const page = await context.newPage();
    await uiLoginToDashboard(page, person.email, person.password);
    await page.goto("/attendance");
    await expect(page.getByText("You are outside the workplace check-in area.")).toBeVisible();
    await expect(page.getByText(/about 100 m away/)).toBeVisible();
    await expect(cardActions(page).getByRole("button", { name: "Check in", exact: true })).toBeDisabled();

    // calling the API directly with a forged "inside" flag does not help
    const forged = await page.request.post("/api/attendance/check-in/", {
      data: { ...north(100), accuracy: 10, inside_radius: true, distance: 0 },
      headers: { "X-CSRFToken": await csrf(context) },
    });
    expect(forged.status()).toBe(403);
    expect((await forged.json()).error.code).toBe("outside_geofence");

    await context.setGeolocation({ ...north(5), accuracy: 8 });
    await expect(page.getByTestId("geofence-status")).toHaveAttribute("data-verdict", "inside");
    await cardActions(page).getByRole("button", { name: "Check in", exact: true }).click();
    await expectToast(page, "Checked in.");
    await expect(page.getByText(/m from workplace at check-in/)).toBeVisible();

    // leaving the area: the next location report checks out automatically (once)
    for (let i = 0; i < 2; i++) {
      const res = await page.request.post("/api/attendance/heartbeat/", {
        data: { idle_seconds: 0, location_status: "ok", ...north(150), accuracy: 10 },
        headers: { "X-CSRFToken": await csrf(context) },
      });
      expect(res.status()).toBe(200);
    }
    await page.reload();
    await expect(page.getByTestId("auto-checkout")).toContainText("because you left the workplace area");
    await expect(page.getByTestId("session-phase")).toHaveAttribute("data-phase", "CHECKED_OUT");
    await context.close();
  });
  await hr.dispose();
});

test("work from home: request, HR approval, WFH check-in without location", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const hr = await hrSession();
  const person = await freshEmployee(hr);
  await withSettings(hr, { workplace_latitude: String(WORK.latitude), workplace_longitude: String(WORK.longitude) }, async () => {
    await uiLoginToDashboard(page, person.email, person.password);
    await page.goto("/attendance");
    // pending or missing approval: the server refuses a WFH check-in
    const early = await page.request.post("/api/attendance/check-in/", {
      data: { mode: "WORK_FROM_HOME" },
      headers: { "X-CSRFToken": await csrf(page.context()) },
    });
    expect((await early.json()).error.code).toBe("wfh_not_approved");

    await cardActions(page).getByRole("button", { name: "Work from home", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Request work from home" });
    await dialog.getByLabel("Reason").fill("Plumber visit at home");
    await page.getByRole("button", { name: "Send request" }).click();
    await expectToast(page, "Work-from-home request sent to HR.");
    await expect(cardActions(page).getByRole("button", { name: "WFH pending" })).toBeDisabled();

    const hrContext = await browser.newContext();
    const hrPage = await hrContext.newPage();
    await uiLoginToDashboard(hrPage, DEMO.hr);
    await hrPage.goto("/attendance?tab=wfh");
    const row = hrPage.getByRole("row", { name: new RegExp(person.fullName) });
    await row.getByRole("button", { name: "Approve" }).click();
    await hrPage.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
    await expectToast(hrPage, "Approved — the employee has been notified.");
    await hrContext.close();

    await page.reload();
    await expect(page.getByText("Work from home is approved for today.")).toBeVisible();
    await cardActions(page).getByRole("button", { name: "WFH check in", exact: true }).click();
    await expectToast(page, "Checked in — working from home.");
    await expect(page.getByText("Work from home", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("session-phase")).toHaveAttribute("data-phase", "WORKING");
  });
  await hr.dispose();
});

test("the daily break allowance is enforced in real time", async ({ page }) => {
  test.setTimeout(150_000);
  const hr = await hrSession();
  const person = await freshEmployee(hr);
  await withSettings(hr, { break_allowance_minutes: 1 }, async () => {
    await uiLoginToDashboard(page, person.email, person.password);
    await page.goto("/attendance");
    await cardActions(page).getByRole("button", { name: "Check in", exact: true }).click();
    await expectToast(page, "Checked in.");
    await expect(page.getByTestId("break-allowance")).toHaveText("Break used: 0 min · Break remaining: 1 min");
    await cardActions(page).getByRole("button", { name: "Break", exact: true }).click();
    await expect(page.getByTestId("session-phase")).toHaveAttribute("data-phase", "ON_BREAK");
    await page.waitForTimeout(62_000); // past the 1-minute allowance
    await page.reload(); // the server closes the break at the allowance
    await expect(page.getByTestId("session-phase")).toHaveAttribute("data-phase", "WORKING");
    await expect(page.getByTestId("break-allowance")).toHaveText("Break used: 1 min · Break remaining: 0 min");
    await expect(cardActions(page).getByRole("button", { name: "Break", exact: true })).toBeDisabled();
    const again = await page.request.post("/api/attendance/breaks/start/", { headers: { "X-CSRFToken": await csrf(page.context()) } });
    expect(again.status()).toBe(409);
  });
  await hr.dispose();
});

test("activity reports cannot fake inactivity before check-in; extra data is ignored", async () => {
  // The 30-minute check-out itself is covered with a controlled clock in the backend suite
  // (test_attendance_rules.py); a real E2E run cannot wait 30 minutes.
  const hr = await hrSession();
  const person = await freshEmployee(hr);
  await hr.dispose();
  const me = await login(person.email, person.password);
  const checkedIn = await json(await me.post("/api/attendance/check-in/"), 201);
  const res = await json(
    await me.post("/api/attendance/heartbeat/", { idle_seconds: 1800, typed_text: "secret", keys: ["a"], screenshot: "x" }),
    200,
  );
  expect(res.changed).toBe(false); // the session is seconds old: "30 minutes idle" is impossible
  expect(res.state.record.check_out).toBeNull();
  expect(res.state.record.last_activity_at).toBe(checkedIn.check_in);
  expect((await me.post("/api/attendance/heartbeat/", { idle_seconds: -5 })).status()).toBe(400);
  await me.dispose();
});

test("only HR and Super Admin decide work-from-home and overtime", async () => {
  const employee = await login(DEMO.employee);
  const manager = await login(DEMO.manager);
  for (const s of [employee, manager]) {
    expect((await s.post("/api/attendance/wfh/999999/approve/")).status()).toBe(403);
    expect((await s.post("/api/attendance/overtime/999999/approve/")).status()).toBe(403);
  }
  await employee.dispose();
  await manager.dispose();
});

test("light / dark theme switch is remembered", async ({ page }) => {
  await uiLoginToDashboard(page, DEMO.employee);
  await page.getByTestId("theme-toggle").click();
  await page.getByRole("menuitemradio", { name: "Light" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByTestId("theme-toggle").click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("attendance actions collapse into a menu on a phone", async ({ page }) => {
  const hr = await hrSession();
  const person = await freshEmployee(hr);
  await hr.dispose();
  await page.setViewportSize({ width: 390, height: 844 });
  await uiLoginToDashboard(page, person.email, person.password);
  const actions = page.getByTestId("attendance-actions");
  await actions.getByRole("button", { name: /Attendance/ }).click();
  await expect(page.getByRole("menuitem", { name: "Check in" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Work from home" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Check in" }).click();
  await expectToast(page, "Checked in.");
  await actions.getByRole("button", { name: /Attendance/ }).click();
  await expect(page.getByRole("menuitem", { name: "Check out" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Break" })).toBeVisible();
});
