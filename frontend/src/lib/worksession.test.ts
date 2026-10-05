import { describe, expect, it } from "vitest";
import { breakSession, overtimeSession, record, session } from "@/test/fixtures";
import type { AttendanceRecord, WorkSessionState } from "./types";
import {
  clockOffset,
  currentBreakSeconds,
  deriveSession,
  fmtClock,
  fmtDuration,
  hasActiveSession,
  meetingSeconds,
  nonWorkingSeconds,
  overtimeSeconds,
  totalBreakSeconds,
  workedSeconds,
  type QueuedEvent,
} from "./worksession";

const T = (hhmm: string) => `2026-10-02T${hhmm}:00Z`;
const at = (hhmm: string) => Date.parse(T(hhmm));

function state(overrides: Partial<WorkSessionState> = {}, rec: Partial<AttendanceRecord> | null = {}): WorkSessionState {
  return session("none", {
    server_time: T("12:00"),
    break_allowance_minutes: null,
    record: rec === null ? null : record({ employee: { id: 4, employee_code: "E-4", full_name: "Demo" }, check_in: T("09:00"), updated_at: T("09:00"), ...rec }),
    ...overrides,
  });
}

const queued = (type: QueuedEvent["type"], hhmm: string, id = `${type}-${hhmm}`): QueuedEvent => ({ id, type, occurredAt: T(hhmm), attempts: 0 });

describe("break timer and working time", () => {
  it("is not checked in without a record", () => {
    expect(deriveSession(state({}, null)).phase).toBe("NOT_CHECKED_IN");
  });

  it("counts a running break and excludes it from worked time", () => {
    const view = deriveSession(
      state({
        active_break: breakSession({ id: 9, started_at: T("12:00"), created_at: T("12:00") }),
      }, { total_break_seconds: 600 }),
    );
    expect(view.phase).toBe("ON_BREAK");
    expect(currentBreakSeconds(view, at("12:15"))).toBe(900);
    expect(totalBreakSeconds(view, at("12:15"))).toBe(1500);
    // 3h15m since check-in minus 25m of breaks
    expect(workedSeconds(view, at("12:15"))).toBe(3 * 3600 + 15 * 60 - 1500);
  });

  it("uses check-out time once checked out", () => {
    const view = deriveSession(state({}, { check_out: T("17:00"), total_break_seconds: 3600 }));
    expect(view.phase).toBe("CHECKED_OUT");
    expect(workedSeconds(view, at("23:00"))).toBe(7 * 3600);
    expect(hasActiveSession(view)).toBe(false);
  });
});

describe("overtime timer", () => {
  it("runs separately from normal work", () => {
    const view = deriveSession(
      state(
        {
          active_overtime: overtimeSession({ id: 3, started_at: T("18:00"), created_at: T("18:00"), updated_at: T("18:00") }),
          overtime: [],
        },
        { check_out: T("17:00") },
      ),
    );
    expect(view.phase).toBe("OVERTIME");
    expect(overtimeSeconds(view, at("19:30"))).toBe(5400);
    expect(workedSeconds(view, at("19:30"))).toBe(8 * 3600); // unaffected by overtime
    expect(hasActiveSession(view)).toBe(true);
  });
});

describe("offline overlay", () => {
  it("applies queued break events on top of server state, in time order", () => {
    const view = deriveSession(state(), [queued("BREAK_END", "13:20"), queued("BREAK_START", "13:00")]);
    expect(view.phase).toBe("WORKING");
    expect(view.completedBreakSeconds).toBe(1200);
    expect(view.pendingEvents).toBe(2);
    expect(view.breaks).toEqual([{ start: T("13:00"), end: T("13:20"), seconds: 1200, pending: true }]);
  });

  it("ignores queued events that do not fit the current state", () => {
    const view = deriveSession(state(), [queued("BREAK_END", "10:00"), queued("OVERTIME_END", "10:05")]);
    expect(view.phase).toBe("WORKING");
    expect(view.pendingEvents).toBe(0);
  });

  it("shows an offline overtime start after check-out", () => {
    const view = deriveSession(state({}, { check_out: T("17:00") }), [queued("OVERTIME_START", "17:30")]);
    expect(view.phase).toBe("OVERTIME");
    expect(overtimeSeconds(view, at("18:00"))).toBe(1800);
  });
});

describe("formatting and clocks", () => {
  it("formats clocks and durations", () => {
    expect(fmtClock(3725)).toBe("01:02:05");
    expect(fmtClock(-5)).toBe("00:00:00");
    expect(fmtDuration(3725)).toBe("1h 02m");
    expect(fmtDuration(null)).toBe("—");
  });

  it("derives the server clock offset", () => {
    expect(clockOffset(T("12:00"), at("11:59"))).toBe(60_000);
    expect(clockOffset("garbage", 0)).toBe(0);
  });

  it("reports disabled self attendance", () => {
    expect(deriveSession(state({ self_attendance_enabled: false })).phase).toBe("DISABLED");
  });
});

describe("meetings, non-working time and Resume Work", () => {
  const pause = (start: string) => ({
    id: 3,
    meeting: 11,
    meeting_title: "All hands",
    meeting_kind: "OVERALL" as const,
    started_at: T(start),
    ended_at: null,
    duration_seconds: null,
    status: "ACTIVE" as const,
    end_reason: "" as const,
  });

  it("pauses working time during a meeting and counts it as meeting time", () => {
    // 9:00 check-in, meeting since 11:00; at 11:30 working time is still 2h.
    const view = deriveSession(state({ active_pause: pause("11:00") }));
    expect(view.phase).toBe("IN_MEETING");
    expect(hasActiveSession(view)).toBe(true);
    expect(workedSeconds(view, at("11:30"))).toBe(2 * 3600);
    expect(meetingSeconds(view, at("11:30"))).toBe(1800);
    expect(totalBreakSeconds(view, at("11:30"))).toBe(0);
  });

  it("resumes after the meeting with the meeting excluded from working time", () => {
    const view = deriveSession(state({}, { total_meeting_seconds: 3600 }));
    expect(view.phase).toBe("WORKING");
    expect(workedSeconds(view, at("13:00"))).toBe(3 * 3600); // 9-11 and 12-13
    expect(meetingSeconds(view, at("13:00"))).toBe(3600);
  });

  it("does not let a queued break start during a meeting", () => {
    const view = deriveSession(state({ active_pause: pause("11:00") }), [queued("BREAK_START", "11:10")]);
    expect(view.phase).toBe("IN_MEETING");
    expect(view.pendingEvents).toBe(0);
  });

  it("keeps non-working time out of working and break time", () => {
    // Worked 9:00-14:00, automatic check-out at 14:00, resumed 15:00: 1h non-working.
    const view = deriveSession(state({}, { total_non_working_seconds: 3600, total_break_seconds: 1200 }));
    expect(workedSeconds(view, at("17:00"))).toBe(8 * 3600 - 3600 - 1200);
    expect(nonWorkingSeconds(view, at("17:00"))).toBe(3600);
    expect(totalBreakSeconds(view, at("17:00"))).toBe(1200);
  });

  it("counts the open non-working period after an automatic check-out", () => {
    const view = deriveSession(
      state(
        {
          open_non_working: { id: 1, started_at: T("14:00"), ended_at: null, duration_seconds: null, reason: "INACTIVITY_TIMEOUT", resume_request: null },
        },
        { check_out: T("14:00"), checkout_reason: "INACTIVITY_TIMEOUT" },
      ),
    );
    expect(view.phase).toBe("CHECKED_OUT");
    expect(view.resume).toBe("needed");
    expect(nonWorkingSeconds(view, at("14:40"))).toBe(2400);
    expect(workedSeconds(view, at("14:40"))).toBe(5 * 3600);
  });

  it.each([
    ["PENDING", "pending"],
    ["APPROVED", "approved"],
    ["REJECTED", "rejected"],
    ["USED", "needed"],
    ["CANCELLED", "needed"],
  ] as const)("a %s Resume Work request means %s", (status, expected) => {
    const view = deriveSession(
      state(
        {
          resume_request: {
            id: 2,
            employee: { id: 4, employee_code: "E-4", full_name: "Demo" },
            date: "2026-10-02",
            reason: "Offline discussion with the client",
            status,
            checked_out_at: T("14:00"),
            decided_by_name: null,
            decided_at: null,
            decision_note: "",
            used_at: null,
            created_at: T("14:05"),
          },
        },
        { check_out: T("14:00"), checkout_reason: "INACTIVITY_TIMEOUT" },
      ),
    );
    expect(view.resume).toBe(expected);
  });

  it("offers no Resume Work after a manual or geofence check-out", () => {
    expect(deriveSession(state({}, { check_out: T("17:00"), checkout_reason: "MANUAL" })).resume).toBe("none");
    expect(deriveSession(state({}, { check_out: T("12:00"), checkout_reason: "GEO_FENCE_EXIT" })).resume).toBe("none");
  });
});
