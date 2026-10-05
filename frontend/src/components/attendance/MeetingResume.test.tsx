// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionProvider } from "@/lib/connection";
import type { ResumeWorkRequest, WorkSessionState } from "@/lib/types";
import { EMP, MIN, iso, record, session } from "@/test/fixtures";
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
const actions = async () => within(await screen.findByTestId("session-actions"));

function autoCheckedOut(resume: Partial<ResumeWorkRequest> | null = null): WorkSessionState {
  const checkOut = iso(40 * MIN);
  return session("none", {
    record: record({ check_in: iso(5 * 60 * MIN), check_out: checkOut, checkout_reason: "INACTIVITY_TIMEOUT" }),
    open_non_working: resume?.status === "USED" ? null : { id: 1, started_at: checkOut, ended_at: null, duration_seconds: null, reason: "INACTIVITY_TIMEOUT", resume_request: null },
    resume_request: resume && {
      id: 9,
      employee: EMP,
      date: "2026-10-02",
      reason: "I was attending an offline discussion.",
      status: "PENDING",
      checked_out_at: checkOut,
      decided_by_name: null,
      decided_at: null,
      decision_note: "",
      used_at: null,
      created_at: iso(30 * MIN),
      ...resume,
    },
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.sessionStorage.setItem(`nexvra.session-seen.${ME.id}`, "1");
  Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Resume Work after an automatic inactivity check-out", () => {
  it("offers Resume Work instead of Check in, and sends the reason to HR", async () => {
    const { calls } = mockFetch((url) => {
      if (url === "/api/attendance/today/") return { body: autoCheckedOut() };
      if (url === "/api/attendance/resume-requests/") return { status: 201, body: { state: autoCheckedOut({ status: "PENDING" }) } };
    });
    renderCard();
    const card = await actions();
    expect(card.queryByRole("button", { name: /^Check in$/ })).toBeNull(); // no bypass
    expect((screen.getByTestId("auto-checkout"))?.textContent).toContain("non-working");
    fireEvent.click(card.getByRole("button", { name: "Resume Work" }));
    const dialog = await screen.findByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Submit Request" });
    expect((submit as HTMLButtonElement).disabled).toBe(true); // a reason is required
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "I was attending an offline discussion." } });
    fireEvent.click(submit);
    expect(await screen.findByText("Waiting for HR/Admin approval.")).toBeTruthy();
    const sent = calls.find((c) => c.url === "/api/attendance/resume-requests/");
    expect(body(sent?.init)).toEqual({ reason: "I was attending an offline discussion." });
    expect(((await actions()).getByRole("button", { name: "Waiting for approval" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("after approval, the employee checks in again (approval alone does not)", async () => {
    const { calls } = mockFetch((url) => {
      if (url === "/api/attendance/today/") return { body: autoCheckedOut({ status: "APPROVED", decided_by_name: "Demo HR" }) };
      if (url === "/api/attendance/check-in/") return { status: 201, body: record() };
    });
    renderCard();
    expect(await screen.findByText("Resume approved — Check in to continue working.")).toBeTruthy();
    expect(calls.some((c) => c.url === "/api/attendance/check-in/")).toBe(false);
    fireEvent.click((await actions()).getByRole("button", { name: "Check in" }));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/attendance/check-in/")).toBe(true));
    expect(body(calls.find((c) => c.url === "/api/attendance/check-in/")?.init)).toEqual({ mode: "OFFICE" });
  });

  it("after a rejection the employee stays checked out and can ask again", async () => {
    mockFetch((url) => {
      if (url === "/api/attendance/today/") return { body: autoCheckedOut({ status: "REJECTED", decision_note: "Please talk to HR" }) };
    });
    renderCard();
    expect(await screen.findByText("Resume request rejected.")).toBeTruthy();
    const card = await actions();
    expect(card.queryByRole("button", { name: /^Check in$/ })).toBeNull();
    expect((card.getByRole("button", { name: "Resume Work" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("meetings", () => {
  it("shows that working time is paused and offers no break", async () => {
    mockFetch((url) => {
      if (url === "/api/attendance/today/")
        return {
          body: session("working", {
            active_pause: { id: 1, meeting: 4, meeting_title: "All hands", meeting_kind: "OVERALL", started_at: iso(10 * MIN), ended_at: null, duration_seconds: null, status: "ACTIVE", end_reason: "" },
          }),
        };
    });
    renderCard();
    expect(await screen.findByText("Meeting in progress — Working Time paused.")).toBeTruthy();
    expect((screen.getByTestId("session-phase")).getAttribute("data-phase")).toBe("IN_MEETING");
    const card = await actions();
    expect(card.queryByRole("button", { name: "Break" })).toBeNull();
    expect((card.getByRole("button", { name: "Meeting in progress" }) as HTMLButtonElement).disabled).toBe(true);
    expect((card.getByRole("button", { name: "Check out" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("sends no activity heartbeat during a meeting", async () => {
    const { calls } = mockFetch((url) => {
      if (url === "/api/attendance/today/")
        return {
          body: session("working", {
            active_pause: { id: 1, meeting: 4, meeting_title: "1:1", meeting_kind: "SELECTED", started_at: iso(5 * MIN), ended_at: null, duration_seconds: null, status: "ACTIVE", end_reason: "" },
          }),
        };
    });
    renderCard();
    await screen.findByText("Meeting in progress — Working Time paused.");
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.some((c) => c.url === "/api/attendance/heartbeat/")).toBe(false);
  });
});

describe("activity heartbeat", () => {
  it("reports only activity metadata: moments as seconds ago and the observed window", async () => {
    const { calls } = mockFetch((url) => {
      if (url === "/api/attendance/today/") return { body: session("working") };
      if (url === "/api/attendance/heartbeat/") return { body: { changed: false, state: session("working") } };
    });
    renderCard();
    await waitFor(() => expect(calls.some((c) => c.url === "/api/attendance/heartbeat/")).toBe(true));
    const sent = body(calls.find((c) => c.url === "/api/attendance/heartbeat/")?.init);
    expect(Object.keys(sent).sort()).toEqual(["activity", "idle_seconds", "observed_seconds"]);
    expect(Array.isArray(sent.activity)).toBe(true);
    expect(sent.activity.every((n: unknown) => Number.isInteger(n) && (n as number) >= 0)).toBe(true);
  });

  it("explains how activity in other apps can count", async () => {
    mockFetch((url) => {
      if (url === "/api/attendance/today/") return { body: session("working") };
      if (url === "/api/attendance/heartbeat/") return { body: { changed: false, state: session("working") } };
    });
    renderCard();
    const note = await screen.findByTestId("system-idle-status");
    expect((note).getAttribute("data-enabled")).toBe("unsupported"); // jsdom has no Idle Detection
  });
});
