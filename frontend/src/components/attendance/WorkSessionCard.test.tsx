// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionProvider } from "@/lib/connection";
import type { Task, WorkSessionState } from "@/lib/types";
import { ME, Providers, mockFetch } from "@/test/utils";
import { WorkSessionCard } from "./WorkSessionCard";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60_000;
const EMP = { id: 4, employee_code: "DEMO-004", full_name: "Demo Employee" };

function session(kind: "none" | "working" | "break" | "checked_out" | "overtime", extra: Partial<WorkSessionState> = {}): WorkSessionState {
  const record =
    kind === "none"
      ? null
      : {
          id: 1, employee: EMP, date: "2026-10-02", check_in: iso(240 * MIN),
          check_out: kind === "checked_out" || kind === "overtime" ? iso(30 * MIN) : null,
          status: "PRESENT" as const, is_late: false, worked_minutes: null, session_minutes: null,
          break_minutes: 0, total_break_seconds: 0, source: "SELF" as const, remarks: "", updated_at: iso(0),
        };
  return {
    date: "2026-10-02",
    server_time: new Date().toISOString(),
    self_attendance_enabled: true,
    record,
    breaks: [],
    active_break:
      kind === "break"
        ? { id: 5, employee: EMP, attendance: 1, date: "2026-10-02", started_at: iso(15 * MIN), ended_at: null,
            duration_seconds: null, status: "ACTIVE", source: "ONLINE", created_at: iso(15 * MIN) }
        : null,
    overtime: [],
    active_overtime:
      kind === "overtime"
        ? { id: 8, employee: EMP, attendance: 1, date: "2026-10-02", started_at: iso(20 * MIN), ended_at: null,
            duration_seconds: null, status: "ACTIVE", trigger: "AFTER_CHECKOUT", source: "ONLINE",
            created_at: iso(20 * MIN), updated_at: iso(20 * MIN) }
        : null,
    blocking_tasks: 0,
    checkout_exempt: false,
    ...extra,
  };
}

const TASK: Task = {
  id: 31, title: "Update employee database", description: "Fix phone numbers", priority: "HIGH", due_date: null,
  status: "PENDING", display_status: "PENDING", is_overdue: false, requires_response: true,
  assigned_to: { ...EMP, username: "vishak" }, assigned_by: { id: 2, full_name: "Demo HR", username: "demo.hr" },
  acknowledged_at: null, response: "", responded_at: null, completed_at: null, cancelled_at: null, cancel_reason: "",
  created_at: iso(0), updated_at: iso(0), is_blocking: true, is_assignee: true, can_manage: false,
};

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { value, configurable: true });
}

function renderCard(withConnection = false) {
  const card = <WorkSessionCard />;
  return render(<Providers>{withConnection ? <ConnectionProvider userId={ME.id}>{card}</ConnectionProvider> : card}</Providers>);
}

const body = (init?: RequestInit) => (init?.body ? JSON.parse(String(init.body)) : undefined);

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
    expect(screen.getByText("On break")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back to work" }));
    await screen.findByText("Welcome back — break ended.");
    const call = calls.find((c) => c.url === "/api/attendance/breaks/end/");
    expect(body(call?.init).client_event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByRole("button", { name: "Start break" })).toBeTruthy();
  });

  it("starts overtime after checkout and shows the overtime timer", async () => {
    mockFetch((url) => {
      if (url === "/api/attendance/today/") return { body: session("checked_out") };
      if (url === "/api/attendance/overtime/start/") return { body: { duplicate: false, state: session("overtime") } };
    });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Start Overtime" }));
    expect(await screen.findByText("Overtime running")).toBeTruthy();
    expect(screen.getByRole("timer", { name: "Overtime timer" }).textContent).toMatch(/^00:(19|20):\d\d$/);
    expect(screen.getByRole("button", { name: "End Overtime" })).toBeTruthy();
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
    fireEvent.click(await screen.findByRole("button", { name: "Check out" }));
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
    fireEvent.click(await screen.findByRole("button", { name: "Check out" }));
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
    renderCard(true);
    fireEvent.click(await screen.findByRole("button", { name: "Start break" }));
    expect(await screen.findByText("1 waiting to sync")).toBeTruthy();
    expect(screen.getByText("On break")).toBeTruthy();
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
    window.localStorage.setItem(
      `nexvra.work-session.v1.${ME.id}`,
      JSON.stringify({ state: session("working"), savedAt: iso(5 * MIN) }),
    );
    mockFetch((url) => {
      if (url === "/api/attendance/today/")
        return { status: 503, body: { error: { code: "backend_unavailable", message: "Can't reach the server.", fields: {} } } };
      if (url === "/api/health/") return { status: 503, body: {} };
    });
    renderCard(true);
    expect(await screen.findByText(/Offline — showing your last known session/)).toBeTruthy();
    expect(screen.getByText("Working")).toBeTruthy();
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

  it("offers check-in when not checked in", async () => {
    mockFetch((url) => (url === "/api/attendance/today/" ? { body: session("none") } : undefined));
    renderCard();
    expect(await screen.findByRole("button", { name: "Check in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start break" })).toBeNull();
  });
});
