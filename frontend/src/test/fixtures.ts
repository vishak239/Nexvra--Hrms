import type { AttendanceRecord, BreakSession, OvertimeSession, Task, WorkSessionState } from "@/lib/types";

export const MIN = 60_000;
export const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
export const EMP = { id: 4, employee_code: "DEMO-004", full_name: "Demo Employee" };

export function record(overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    id: 1,
    employee: EMP,
    date: "2026-10-02",
    check_in: iso(240 * MIN),
    check_out: null,
    status: "PRESENT",
    is_late: false,
    worked_minutes: null,
    session_minutes: null,
    break_minutes: 0,
    total_break_seconds: 0,
    break_over_allowance_minutes: null,
    mode: "OFFICE",
    checkout_reason: "",
    check_in_distance_m: null,
    check_out_distance_m: null,
    last_activity_at: iso(0),
    location_issue: "",
    source: "SELF",
    remarks: "",
    updated_at: iso(0),
    ...overrides,
  };
}

export function breakSession(overrides: Partial<BreakSession> = {}): BreakSession {
  return {
    id: 5,
    employee: EMP,
    attendance: 1,
    date: "2026-10-02",
    started_at: iso(15 * MIN),
    ended_at: null,
    duration_seconds: null,
    status: "ACTIVE",
    end_reason: "",
    source: "ONLINE",
    created_at: iso(15 * MIN),
    ...overrides,
  };
}

export function overtimeSession(overrides: Partial<OvertimeSession> = {}): OvertimeSession {
  return {
    id: 8,
    employee: EMP,
    attendance: 1,
    date: "2026-10-02",
    started_at: iso(20 * MIN),
    ended_at: null,
    duration_seconds: null,
    status: "ACTIVE",
    trigger: "AFTER_CHECKOUT",
    source: "ONLINE",
    tasks: [],
    work_description: "Finish the attendance API integration.",
    other_reason: "",
    declaration_confirmed: true,
    requested_at: iso(40 * MIN),
    decided_by_name: "Demo HR",
    decided_at: iso(30 * MIN),
    decision_note: "",
    end_reason: "",
    last_activity_at: iso(0),
    created_at: iso(40 * MIN),
    updated_at: iso(0),
    ...overrides,
  };
}

export type SessionKind = "none" | "working" | "break" | "checked_out" | "overtime";

export function session(kind: SessionKind, extra: Partial<WorkSessionState> = {}): WorkSessionState {
  const rec =
    kind === "none"
      ? null
      : record({ check_out: kind === "checked_out" || kind === "overtime" ? iso(30 * MIN) : null });
  return {
    date: "2026-10-02",
    server_time: new Date().toISOString(),
    self_attendance_enabled: true,
    break_allowance_minutes: 60,
    break_used_seconds: 0,
    break_remaining_seconds: 3600,
    inactivity_timeout_minutes: 30,
    heartbeat_seconds: 120,
    overtime_requires_approval: true,
    workplace: { configured: false, latitude: null, longitude: null, radius_m: 20, max_accuracy_m: 100 },
    wfh_today: null,
    open_overtime_request: null,
    record: rec,
    breaks: [],
    active_break: kind === "break" ? breakSession() : null,
    overtime: kind === "overtime" ? [overtimeSession()] : [],
    active_overtime: kind === "overtime" ? overtimeSession() : null,
    blocking_tasks: 0,
    checkout_exempt: false,
    ...extra,
  };
}

export const TASK: Task = {
  id: 31,
  title: "Update employee database",
  description: "Fix phone numbers",
  priority: "HIGH",
  due_date: null,
  status: "PENDING",
  display_status: "PENDING",
  is_overdue: false,
  requires_response: true,
  assigned_to: { ...EMP, username: "vishak" },
  assigned_by: { id: 2, full_name: "Demo HR", username: "demo.hr" },
  acknowledged_at: null,
  response: "",
  responded_at: null,
  completed_at: null,
  cancelled_at: null,
  cancel_reason: "",
  created_at: iso(0),
  updated_at: iso(0),
  is_blocking: true,
  is_assignee: true,
  can_manage: false,
};
