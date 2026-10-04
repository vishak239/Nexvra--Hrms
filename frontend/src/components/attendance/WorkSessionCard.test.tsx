// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionProvider } from "@/lib/connection";
import { MIN, TASK, iso, overtimeSession, record, session } from "@/test/fixtures";
import { ME, Providers, mockFetch } from "@/test/utils";
import { AttendanceActions } from "./AttendanceActions";
import { WorkSessionCard } from "./WorkSessionCard";
import { WorkSessionProvider } from "./WorkSessionProvider";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const WORKPLACE = { configured: true, latitude: 12.9716, longitude: 77.5946, radius_m: 20, max_accuracy_m: 100 };
/** A point `m` metres north of the workplace. */
const north = (m: number) => ({ latitude: 12.9716 + (m / 6_371_008.8) * (180 / Math.PI), longitude: 77.5946 });

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { value, configurable: true });
}

function mockGeolocation(coords: { latitude: number; longitude: number; accuracy: number } | "denied") {
  const respond = (ok: PositionCallback, fail?: PositionErrorCallback | null) => {
    if (coords === "denied") fail?.({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: "denied" } as GeolocationPositionError);
    else ok({ coords: { ...coords, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() } as GeolocationPosition);
  };
  Object.defineProperty(window.navigator, "geolocation", {
    configurable: true,
    value: {
      watchPosition: vi.fn((ok: PositionCallback, fail?: PositionErrorCallback | null) => {
        setTimeout(() => respond(ok, fail), 0);
        return 1;
      }),
      clearWatch: vi.fn(),
      getCurrentPosition: vi.fn((ok: PositionCallback, fail?: PositionErrorCallback | null) => setTimeout(() => respond(ok, fail), 0)),
    },
  });
}

function renderCard() {
  return render(
    <Providers>
      <ConnectionProvider userId={ME.id}>
        <WorkSessionProvider>
          <AttendanceActions />
          <WorkSessionCard />
        </WorkSessionProvider>
      </ConnectionProvider>
    </Providers>,
  );
}

const body = (init?: RequestInit) => (init?.body ? JSON.parse(String(init.body)) : undefined);
const card = () => within(screen.getByTestId("session-actions"));
const cardAsync = async () => within(await screen.findByTestId("session-actions"));

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.sessionStorage.setItem(`nexvra.session-seen.${ME.id}`, "1"); // recovery notice off unless tested
  setOnline(true);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WorkSessionCard", () => {
  it("shows a live break timer and ends the break with an idempotency key", async () => {
    const { calls } = mockFetch((url) => {
      if (url === "/api/attendance/today/") return { body: session("break") };
      if (url === "/api/attendance/breaks/end/") return { body: { duplicate: false, state: session("working") } };
    });
    renderCard();
    const timer = await screen.findByRole("timer", { name: "Break timer" });
    expect(timer.textContent).toMatch(/^00:1[45]:\d\d$/);
    expect(screen.getAllByText("On break").length).toBeGreaterThan(0);

    fireEvent.click(card().getByRole("button", { name: "End break" }));
    await screen.findByText("Welcome back — break ended.");
    const call = calls.find((c) => c.url === "/api/attendance/breaks/end/");
    expect(body(call?.init).client_event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await (await cardAsync()).findByRole("button", { name: "Break" })).toBeTruthy();
  });

  it("shows break used and remaining, and disables Break when the allowance is used", async () => {
    mockFetch((url) =>
      url === "/api/attendance/today/"
        ? { body: session("working", { record: record({ total_break_seconds: 3600, break_minutes: 60 }), break_used_seconds: 3600, break_remaining_seconds: 0 }) }
        : undefined,
    );
    renderCard();
    expect((await screen.findByTestId("break-allowance")).textContent).toBe("Break used: 60 min · Break remaining: 0 min");
    expect(screen.getByTestId("total-break-hint").textContent).toBe("Break unavailable for the day");
    expect((card().getByRole("button", { name: "Break" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens the overtime declaration after checkout and only submits a complete one", async () => {
    let requested = false;
    const { calls } = mockFetch((url, init) => {
      if (url === "/api/attendance/today/") return { body: session("checked_out") };
      if (url.startsWith("/api/tasks/")) return { body: { count: 1, next: null, previous: null, results: [TASK] } };
      if (url === "/api/attendance/overtime/request/") {
        requested = true;
        return {
          status: 201,
          body: { state: session("checked_out", { open_overtime_request: overtimeSession({ status: "REQUESTED", started_at: null, decided_by_name: null }) }) },
        };
      }
      return init ? undefined : undefined;
    });
    renderCard();
    fireEvent.click(await (await cardAsync()).findByRole("button", { name: "Overtime" }));
    const dialog = await screen.findByRole("dialog", { name: "Request overtime" });
    const submit = within(dialog).queryByRole("button", { name: "Send request" }) ?? screen.getByRole("button", { name: "Send request" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(await within(dialog).findByRole("checkbox", { name: /Update employee database/ }));
    fireEvent.change(within(dialog).getByLabelText(/^What will you work on/), { target: { value: "Complete the API integration." } });
    expect((submit as HTMLButtonElement).disabled).toBe(true); // confirmation still missing
    fireEvent.click(within(dialog).getByLabelText(/I confirm that the above work/));
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submit);

    await waitFor(() => expect(requested).toBe(true));
    const sent = body(calls.find((c) => c.url === "/api/attendance/overtime/request/")?.init);
    expect(sent).toEqual({
      task_ids: [31],
      use_other_reason: false,
      other_reason: "",
      work_description: "Complete the API integration.",
      declaration_confirmed: true,
    });
    expect(await screen.findByTestId("overtime-request-status")).toBeTruthy();
    expect(card().getByRole("button", { name: "Overtime pending" })).toBeTruthy();
  });

  it("requires a detailed explanation for an other reason", async () => {
    mockFetch((url) => {
      if (url === "/api/attendance/today/") return { body: session("checked_out") };
      if (url.startsWith("/api/tasks/")) return { body: { count: 0, next: null, previous: null, results: [] } };
    });
    renderCard();
    fireEvent.click(await (await cardAsync()).findByRole("button", { name: "Overtime" }));
    const dialog = await screen.findByRole("dialog", { name: "Request overtime" });
    expect(await within(dialog).findByText(/You have no pending tasks/)).toBeTruthy();
    fireEvent.click(within(dialog).getByLabelText(/^Other reason/));
    fireEvent.change(within(dialog).getByLabelText(/^Explain the other reason/), { target: { value: "short" } });
    fireEvent.change(within(dialog).getByLabelText(/^What will you work on/), { target: { value: "Monthly payroll checks." } });
    fireEvent.click(within(dialog).getByLabelText(/I confirm that the above work/));
    expect(within(dialog).getByText("At least 15 characters.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Send request" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("starts an approved overtime and shows the overtime timer", async () => {
    mockFetch((url) => {
      if (url === "/api/attendance/today/")
        return { body: session("checked_out", { open_overtime_request: overtimeSession({ status: "APPROVED", started_at: null }) }) };
      if (url === "/api/attendance/overtime/start/") return { body: { duplicate: false, state: session("overtime") } };
    });
    renderCard();
    expect(await screen.findByText(/Overtime approved by Demo HR/)).toBeTruthy();
    fireEvent.click(card().getByRole("button", { name: "Start overtime" }));
    expect((await screen.findAllByText("Overtime running")).length).toBeGreaterThan(0);
    expect(screen.getByRole("timer", { name: "Overtime timer" }).textContent).toMatch(/^00:(19|20):\d\d$/);
    expect(card().getByRole("button", { name: "Stop overtime" })).toBeTruthy();
  });

  it("requires a task response before checkout (popup), then checks out", async () => {
    let answered = false;
    const { calls } = mockFetch((url, init) => {
      if (url === "/api/attendance/today/") return { body: session(answered ? "checked_out" : "working", { blocking_tasks: answered ? 0 : 1 }) };
      if (url === "/api/tasks/blocking/") return { body: answered ? { count: 0, results: [] } : { count: 1, results: [TASK] } };
      if (url === "/api/tasks/31/respond/") {
        answered = body(init).message === "Updated the records.";
        return { body: { ...TASK, responded_at: iso(0) } };
      }
      if (url === "/api/attendance/check-out/") return { body: {} };
    });
    renderCard();
    fireEvent.click(await (await cardAsync()).findByRole("button", { name: "Check out" }));
    expect(await screen.findByText("@vishak — Update employee database")).toBeTruthy();
    const checkout = screen.getByRole("button", { name: "Checkout" }) as HTMLButtonElement;
    expect(checkout.disabled).toBe(true);
    expect(calls.some((c) => c.url === "/api/attendance/check-out/")).toBe(false);

    fireEvent.change(screen.getByLabelText(/^Response/), { target: { value: "Updated the records." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit response" }));
    await screen.findByText(/All required responses are submitted/);
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    await screen.findByText("Checked out.");
    expect(calls.filter((c) => c.url === "/api/attendance/check-out/")).toHaveLength(1);
  });

  it("opens the popup when the server refuses checkout because of tasks", async () => {
    mockFetch((url) => {
      if (url === "/api/attendance/today/") return { body: session("working") }; // stale: says 0 blocking
      if (url === "/api/attendance/check-out/")
        return { status: 409, body: { error: { code: "checkout_blocked_by_tasks", message: "Respond first.", fields: {} } } };
      if (url === "/api/tasks/blocking/") return { body: { count: 1, results: [TASK] } };
    });
    renderCard();
    fireEvent.click(await (await cardAsync()).findByRole("button", { name: "Check out" }));
    expect(await screen.findByRole("dialog", { name: /Respond to your tasks/ })).toBeTruthy();
  });

  it("queues a break offline and synchronises it when the connection returns", async () => {
    setOnline(false);
    let synced: { id: string; type: string }[] = [];
    const { calls } = mockFetch((url, init) => {
      if (url === "/api/attendance/today/") return { body: synced.length ? session("break") : session("working") };
      if (url === "/api/health/") return { body: { status: "ok" } };
      if (url === "/api/attendance/sync/") {
        synced = body(init).events;
        return { body: { results: synced.map((e) => ({ id: e.id, type: e.type, status: "APPLIED", duplicate: false, error: "" })), state: session("break") } };
      }
    });
    renderCard();
    fireEvent.click(await (await cardAsync()).findByRole("button", { name: "Break" }));
    expect(await screen.findByText("1 waiting to sync")).toBeTruthy();
    expect(screen.getAllByText("On break").length).toBeGreaterThan(0);
    expect(calls.some((c) => c.url === "/api/attendance/breaks/start/")).toBe(false);
    const stored = JSON.parse(window.localStorage.getItem(`nexvra.offline-queue.v1.${ME.id}`) ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].type).toBe("BREAK_START");

    setOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(synced.map((e) => e.id)).toEqual([stored[0].id]), { timeout: 3000 });
    await waitFor(() => expect(window.localStorage.getItem(`nexvra.offline-queue.v1.${ME.id}`)).toBeNull());
    await waitFor(() => expect(screen.queryByText("1 waiting to sync")).toBeNull());
  });

  it("shows the last known session while the server is unreachable", async () => {
    window.localStorage.setItem(`nexvra.work-session.v1.${ME.id}`, JSON.stringify({ state: session("working"), savedAt: iso(5 * MIN) }));
    mockFetch((url) => {
      if (url === "/api/attendance/today/")
        return { status: 503, body: { error: { code: "backend_unavailable", message: "Can't reach the server.", fields: {} } } };
      if (url === "/api/health/") return { status: 503, body: {} };
    });
    renderCard();
    expect(await screen.findByText(/Offline — showing your last known session/)).toBeTruthy();
    expect(screen.getAllByText("Working").length).toBeGreaterThan(0);
  });

  it("detects an active session after the browser was reopened", async () => {
    window.sessionStorage.clear();
    mockFetch((url) => (url === "/api/attendance/today/" ? { body: session("break") } : undefined));
    renderCard();
    expect(await screen.findByText("Active work session detected.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume session" }));
    await waitFor(() => expect(screen.queryByText("Active work session detected.")).toBeNull());
    expect(window.sessionStorage.getItem(`nexvra.session-seen.${ME.id}`)).toBe("1");
  });

  it("explains an automatic check-out", async () => {
    mockFetch((url) =>
      url === "/api/attendance/today/"
        ? { body: session("checked_out", { record: record({ check_out: iso(10 * MIN), checkout_reason: "INACTIVITY_TIMEOUT" }) }) }
        : undefined,
    );
    renderCard();
    expect((await screen.findByTestId("auto-checkout")).textContent).toMatch(/after 30 minutes without activity/);
  });
});

describe("geofenced office check-in", () => {
  it("keeps Check in disabled outside the area and shows the distance", async () => {
    mockGeolocation({ ...north(85), accuracy: 10 });
    const { calls } = mockFetch((url) =>
      url === "/api/attendance/today/" ? { body: session("none", { workplace: WORKPLACE }) } : undefined,
    );
    renderCard();
    expect((await screen.findByText(/You are outside the workplace check-in area/)).closest("[role=status]")?.textContent).toMatch(/about 85 m away/);
    await waitFor(() => expect((card().getByRole("button", { name: "Check in" }) as HTMLButtonElement).disabled).toBe(true));
    expect(calls.some((c) => c.url === "/api/attendance/check-in/")).toBe(false);
  });

  it("enables Check in inside the area and sends raw coordinates for the server to verify", async () => {
    mockGeolocation({ ...north(8), accuracy: 6 });
    const { calls } = mockFetch((url) => {
      if (url === "/api/attendance/today/") return { body: session("none", { workplace: WORKPLACE }) };
      if (url === "/api/attendance/check-in/") return { status: 201, body: {} };
    });
    renderCard();
    await waitFor(() => expect(screen.getByTestId("geofence-status").dataset.verdict).toBe("inside"));
    fireEvent.click(card().getByRole("button", { name: "Check in" }));
    await screen.findByText("Checked in.");
    const sent = body(calls.find((c) => c.url === "/api/attendance/check-in/")?.init);
    expect(sent.mode).toBe("OFFICE");
    expect(sent.latitude).toBeCloseTo(north(8).latitude, 6);
    expect(sent.accuracy).toBe(6);
    expect(Object.keys(sent).sort()).toEqual(["accuracy", "latitude", "longitude", "mode"]); // no client verdict
  });

  it("reports blocked location permission instead of guessing", async () => {
    mockGeolocation("denied");
    mockFetch((url) => (url === "/api/attendance/today/" ? { body: session("none", { workplace: WORKPLACE }) } : undefined));
    renderCard();
    expect(await screen.findByText(/Location permission is blocked/)).toBeTruthy();
  });

  it("offers WFH check-in without location when work from home is approved", async () => {
    const { calls } = mockFetch((url) => {
      if (url === "/api/attendance/today/")
        return {
          body: session("none", {
            workplace: WORKPLACE,
            wfh_today: { id: 3, employee: { id: 4, employee_code: "DEMO-004", full_name: "Demo Employee" }, date: "2026-10-02", reason: "Plumber", remarks: "", status: "APPROVED", decided_by_name: "Demo HR", decided_at: iso(0), decision_note: "", cancelled_at: null, created_at: iso(0) },
          }),
        };
      if (url === "/api/attendance/check-in/") return { status: 201, body: {} };
    });
    renderCard();
    fireEvent.click(await (await cardAsync()).findByRole("button", { name: "WFH check in" }));
    await screen.findByText("Checked in — working from home.");
    expect(body(calls.find((c) => c.url === "/api/attendance/check-in/")?.init)).toEqual({ mode: "WORK_FROM_HOME" });
  });
});

describe("top-right attendance actions", () => {
  it.each([
    ["none", ["Check in", "Work from home"]],
    ["working", ["Break", "Check out", "Work from home"]],
    ["break", ["End break"]],
    ["checked_out", ["Overtime", "Work from home"]],
    ["overtime", ["Stop overtime"]],
  ] as const)("shows only the possible actions when %s", async (kind, labels) => {
    mockFetch((url) => (url === "/api/attendance/today/" ? { body: session(kind) } : undefined));
    renderCard();
    const group = await screen.findByRole("group", { name: "Attendance actions" });
    await waitFor(() => expect(within(group).getAllByRole("button").map((b) => b.textContent?.trim())).toEqual(labels));
  });
});
