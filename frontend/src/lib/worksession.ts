/**
 * Work-session view model.
 *
 * The server is the source of truth (GET /api/attendance/today/). While offline, actions are
 * queued locally; `deriveSession` overlays those queued events on the last server state so
 * the UI can show what the user did, clearly marked as "waiting to sync". Timers are computed
 * from timestamps (never by counting ticks), so they stay correct after the tab was in the
 * background or the browser was closed and reopened.
 */
import type { SyncEventType, WorkSessionState } from "./types";

export type Phase = "DISABLED" | "NOT_CHECKED_IN" | "WORKING" | "ON_BREAK" | "IN_MEETING" | "CHECKED_OUT" | "OVERTIME";

/** Where a Resume Work request stands after an automatic inactivity check-out. */
export type ResumeState = "none" | "needed" | "pending" | "approved" | "rejected";

export interface QueuedEvent {
  /** Client UUID - makes synchronisation idempotent. */
  id: string;
  type: SyncEventType;
  /** When it happened on this device (ISO, server-clock corrected). */
  occurredAt: string;
  attempts: number;
  lastError?: string;
}

export interface BreakView {
  start: string;
  end: string | null;
  seconds: number | null;
  pending: boolean;
}

export interface SessionView {
  phase: Phase;
  checkIn: string | null;
  checkOut: string | null;
  /** Start of the break in progress (server or queued). */
  breakStart: string | null;
  /** Sum of finished breaks (server + queued), seconds. */
  completedBreakSeconds: number;
  breaks: BreakView[];
  overtimeStart: string | null;
  completedOvertimeSeconds: number;
  /** Start of the meeting pause in progress (working time paused). */
  meetingStart: string | null;
  /** Finished meeting pauses today, seconds. */
  completedMeetingSeconds: number;
  /** Closed non-working periods today, seconds. */
  completedNonWorkingSeconds: number;
  /** Start of the open non-working period (after an automatic inactivity check-out). */
  nonWorkingStart: string | null;
  resume: ResumeState;
  /** Queued events that changed the displayed state. */
  pendingEvents: number;
}

function resumeState(state: WorkSessionState | null | undefined): ResumeState {
  const record = state?.record;
  if (!record?.check_out || record.checkout_reason !== "INACTIVITY_TIMEOUT") return "none";
  const status = state?.resume_request?.status;
  if (status === "PENDING") return "pending";
  if (status === "APPROVED") return "approved";
  // A rejection is shown until a new request is sent; older (used/cancelled/expired) need a new one.
  if (status === "REJECTED" && state?.resume_request && state.resume_request.checked_out_at === record.check_out) return "rejected";
  return "needed";
}

const ms = (iso: string) => Date.parse(iso);
const secondsBetween = (a: string, b: string) => Math.max(0, Math.floor((ms(b) - ms(a)) / 1000));

export function deriveSession(state: WorkSessionState | null | undefined, queued: QueuedEvent[] = []): SessionView {
  const record = state?.record ?? null;
  const view: SessionView = {
    phase: "NOT_CHECKED_IN",
    checkIn: record?.check_in ?? null,
    checkOut: record?.check_out ?? null,
    breakStart: state?.active_break?.started_at ?? null,
    completedBreakSeconds: record?.total_break_seconds ?? 0,
    breaks: (state?.breaks ?? []).map((b) => ({
      start: b.started_at,
      end: b.ended_at,
      seconds: b.duration_seconds,
      pending: false,
    })),
    overtimeStart: state?.active_overtime?.started_at ?? null,
    completedOvertimeSeconds: (state?.overtime ?? []).reduce((sum, o) => sum + (o.duration_seconds ?? 0), 0),
    meetingStart: record && !record.check_out ? (state?.active_pause?.started_at ?? null) : null,
    completedMeetingSeconds: record?.total_meeting_seconds ?? 0,
    completedNonWorkingSeconds: record?.total_non_working_seconds ?? 0,
    nonWorkingStart: state?.open_non_working?.started_at ?? null,
    resume: resumeState(state),
    pendingEvents: 0,
  };
  if (state && !state.self_attendance_enabled) view.phase = "DISABLED";
  else if (view.overtimeStart) view.phase = "OVERTIME";
  else if (view.checkOut) view.phase = "CHECKED_OUT";
  else if (view.breakStart) view.phase = "ON_BREAK";
  else if (view.meetingStart) view.phase = "IN_MEETING";
  else if (view.checkIn) view.phase = "WORKING";

  for (const event of [...queued].sort((a, b) => ms(a.occurredAt) - ms(b.occurredAt))) {
    const at = event.occurredAt;
    if (event.type === "BREAK_START" && view.phase === "WORKING") {
      view.phase = "ON_BREAK";
      view.breakStart = at;
      view.breaks.push({ start: at, end: null, seconds: null, pending: true });
    } else if (event.type === "BREAK_END" && view.phase === "ON_BREAK" && view.breakStart) {
      const seconds = secondsBetween(view.breakStart, at);
      view.completedBreakSeconds += seconds;
      const open = [...view.breaks].reverse().find((b) => b.end === null);
      if (open) Object.assign(open, { end: at, seconds, pending: true });
      view.phase = "WORKING";
      view.breakStart = null;
    } else if (event.type === "OVERTIME_START" && view.phase === "CHECKED_OUT") {
      view.phase = "OVERTIME";
      view.overtimeStart = at;
    } else if (event.type === "OVERTIME_END" && view.phase === "OVERTIME" && view.overtimeStart) {
      view.completedOvertimeSeconds += secondsBetween(view.overtimeStart, at);
      view.phase = "CHECKED_OUT";
      view.overtimeStart = null;
    } else {
      continue; // does not apply to the current state; the server will report it
    }
    view.pendingEvents += 1;
  }
  return view;
}

/** Current break length, seconds (0 when not on a break). */
export function currentBreakSeconds(view: SessionView, nowMs: number) {
  return view.phase === "ON_BREAK" && view.breakStart ? Math.max(0, Math.floor((nowMs - ms(view.breakStart)) / 1000)) : 0;
}

/** All break time today, including a break in progress. */
export function totalBreakSeconds(view: SessionView, nowMs: number) {
  return view.completedBreakSeconds + currentBreakSeconds(view, nowMs);
}

/** Meeting time today, including a meeting in progress. Never working time. */
export function meetingSeconds(view: SessionView, nowMs: number) {
  const running = view.meetingStart ? Math.max(0, Math.floor((nowMs - ms(view.meetingStart)) / 1000)) : 0;
  return view.completedMeetingSeconds + running;
}

/** Non-working time today: closed periods plus the open one (automatic check-out until resumed). */
export function nonWorkingSeconds(view: SessionView, nowMs: number) {
  const open = view.nonWorkingStart ? Math.max(0, Math.floor((nowMs - ms(view.nonWorkingStart)) / 1000)) : 0;
  return view.completedNonWorkingSeconds + open;
}

/** Actual working time = session time - breaks - meetings - non-working periods. */
export function workedSeconds(view: SessionView, nowMs: number) {
  if (!view.checkIn) return 0;
  const end = view.checkOut ? ms(view.checkOut) : nowMs;
  const gross = Math.max(0, Math.floor((end - ms(view.checkIn)) / 1000));
  const paused = totalBreakSeconds(view, end) + meetingSeconds(view, end) + view.completedNonWorkingSeconds;
  return Math.max(0, gross - paused);
}

/** Overtime today (completed + running). Never part of worked time. */
export function overtimeSeconds(view: SessionView, nowMs: number) {
  const running = view.phase === "OVERTIME" && view.overtimeStart ? Math.max(0, Math.floor((nowMs - ms(view.overtimeStart)) / 1000)) : 0;
  return view.completedOvertimeSeconds + running;
}

/** 3725 -> "01:02:05" */
export function fmtClock(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** 3725 -> "1h 02m" */
export function fmtDuration(totalSeconds: number | null | undefined) {
  if (totalSeconds === null || totalSeconds === undefined) return "—";
  const minutes = Math.floor(Math.max(0, totalSeconds) / 60);
  return `${Math.floor(minutes / 60)}h ${(minutes % 60).toString().padStart(2, "0")}m`;
}

/** Offset between the server clock and this device: serverNow = Date.now() + offset. */
export function clockOffset(serverTime: string, receivedAtMs: number) {
  const server = ms(serverTime);
  return Number.isFinite(server) ? server - receivedAtMs : 0;
}

/** True when the user left an unfinished session (used for "Active work session detected"). */
export function hasActiveSession(view: SessionView) {
  return view.phase === "WORKING" || view.phase === "ON_BREAK" || view.phase === "IN_MEETING" || view.phase === "OVERTIME";
}
