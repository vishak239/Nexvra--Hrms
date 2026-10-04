"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge, Card, CardHeader, StatusBadge } from "@/components/ui/Display";
import { History, LocateFixed, LocationOff, MapPin, Monitor, RotateCcw, Timer } from "@/components/ui/icons";
import { Alert, ErrorState, Loading } from "@/components/ui/States";
import { useAuth } from "@/lib/auth";
import { fmtDate, fmtDateTime, fmtTime } from "@/lib/format";
import {
  currentBreakSeconds,
  fmtClock,
  fmtDuration,
  hasActiveSession,
  overtimeSeconds,
  totalBreakSeconds,
  workedSeconds,
  type Phase,
} from "@/lib/worksession";
import { attendanceActions } from "./AttendanceActions";
import { useServerNow, useWorkSession, type WorkSessionValue } from "./WorkSessionProvider";

const PHASE_LABEL: Record<Phase, string> = {
  DISABLED: "Self check-in off",
  NOT_CHECKED_IN: "Not checked in",
  WORKING: "Working",
  ON_BREAK: "On break",
  CHECKED_OUT: "Checked out",
  OVERTIME: "Overtime running",
};
const PHASE_TONE: Record<Phase, "neutral" | "green" | "amber" | "blue" | "dark"> = {
  DISABLED: "neutral",
  NOT_CHECKED_IN: "neutral",
  WORKING: "green",
  ON_BREAK: "amber",
  CHECKED_OUT: "neutral",
  OVERTIME: "blue",
};

function Stat({
  label,
  value,
  testId,
  hint,
  hintTone = "muted",
}: {
  label: string;
  value: string;
  testId?: string;
  hint?: string;
  hintTone?: "muted" | "warning";
}) {
  return (
    <div>
      <p className="font-label-sm text-label-sm uppercase text-on-surface-variant">{label}</p>
      <p className="mt-1 font-headline-md text-headline-md text-primary" data-testid={testId}>
        {value}
      </p>
      {hint && (
        <p className={`mt-0.5 text-body-sm ${hintTone === "warning" ? "text-warning" : "text-on-surface-variant"}`} data-testid={testId && `${testId}-hint`}>
          {hint}
        </p>
      )}
    </div>
  );
}

const minutes = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60)} min`;

/** Break used / remaining for the day (server allowance; a running break is capped at it). */
function breakAllowance(allowanceMinutes: number | null, usedSeconds: number) {
  if (!allowanceMinutes) return null;
  const allowance = allowanceMinutes * 60;
  const used = Math.min(usedSeconds, allowance);
  return { used, remaining: allowance - used, allowance };
}

const SEEN_KEY = (userId: number) => `nexvra.session-seen.${userId}`;

function sessionSeen(userId: number) {
  try {
    return window.sessionStorage.getItem(SEEN_KEY(userId)) === "1";
  } catch {
    return true;
  }
}

function markSessionSeen(userId: number) {
  try {
    window.sessionStorage.setItem(SEEN_KEY(userId), "1");
  } catch {
    // sessionStorage unavailable: the recovery notice simply is not shown again.
  }
}

function LocationPanel({ ws }: { ws: WorkSessionValue }) {
  const { verdict, status } = ws.location;
  const radius = ws.state?.workplace.radius_m ?? 20;
  if (verdict.kind === "not-required") return null;
  if (verdict.kind === "inside") {
    return (
      <p className="flex items-center gap-2 text-body-md text-primary-fixed" data-testid="geofence-status" data-verdict="inside">
        <MapPin className="h-4 w-4" /> You are at the workplace (about {Math.round(verdict.distance)} m away). Check-in is available.
      </p>
    );
  }
  if (verdict.kind === "outside") {
    return (
      <Alert tone="warning">
        <span data-testid="geofence-status" data-verdict="outside">
          <strong>You are outside the workplace check-in area.</strong> You are about {Math.round(verdict.distance)} m away;
          check-in is allowed within {radius} m.
        </span>
      </Alert>
    );
  }
  if (verdict.kind === "imprecise") {
    return (
      <Alert tone="warning">
        <span data-testid="geofence-status" data-verdict="imprecise">
          Your location is not precise enough yet (±{Math.round(verdict.accuracy)} m). Turn on GPS / Wi-Fi or move near a window.
        </span>
      </Alert>
    );
  }
  const text: Record<string, string> = {
    idle: "Your location is needed to check in at the workplace.",
    locating: "Finding your location…",
    denied: "Location permission is blocked. Allow location for this site to check in at the workplace.",
    unavailable: "Your location could not be determined. Check that location services are on.",
    timeout: "Finding your location is taking long. Try again.",
    unsupported: "This browser cannot share its location, so office check-in is not possible here.",
    ok: "Finding your location…",
  };
  const problem = ["denied", "unavailable", "timeout", "unsupported"].includes(status);
  return (
    <div className="flex flex-wrap items-center gap-2 text-body-md text-on-surface-variant" data-testid="geofence-status" data-verdict="unknown">
      {problem ? <LocationOff className="h-4 w-4 text-warning" /> : <LocateFixed className="h-4 w-4" />}
      <span>{text[status] ?? text.idle}</span>
      {status !== "locating" && status !== "unsupported" && (
        <Button size="sm" variant="secondary" onClick={ws.requestLocation}>
          {problem ? "Try again" : "Share location"}
        </Button>
      )}
    </div>
  );
}

/**
 * Today's work session (check-in/out, breaks, overtime, WFH) rendered from the shared work
 * session. The same actions are available in the header; both use the server state.
 */
export function WorkSessionCard({ onChange }: { onChange?: () => void }) {
  const { me } = useAuth();
  const ws = useWorkSession();
  const [showHistory, setShowHistory] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const recoveryChecked = useRef(false);
  const lastVersion = useRef<number | null>(null);
  const serverNow = useServerNow(ws?.offset ?? 0);
  const state = ws?.state ?? null;
  const view = ws?.view;
  const phase = view?.phase;

  // Pages listening for changes (history tables) refresh after every state change.
  useEffect(() => {
    if (!ws) return;
    if (lastVersion.current !== null && lastVersion.current !== ws.version) onChange?.();
    lastVersion.current = ws.version;
  }, [ws, ws?.version, onChange]);

  // Opening the attendance card is the moment to look up the location for office check-in.
  const requestLocation = ws?.requestLocation;
  useEffect(() => {
    if (phase === "NOT_CHECKED_IN" && state?.workplace.configured) requestLocation?.();
  }, [phase, state?.workplace.configured, requestLocation]);

  // "Active work session detected" once per browser session (e.g. after the browser was closed).
  useEffect(() => {
    if (!me || !state || !view || recoveryChecked.current) return;
    recoveryChecked.current = true;
    if (!sessionSeen(me.id) && hasActiveSession(view)) setRecovery(true);
    else markSessionSeen(me.id);
  }, [me, state, view]);

  if (!ws?.enabled) return null;
  if (ws.loading && !state) {
    return (
      <Card>
        <Loading label="Loading your work session…" />
      </Card>
    );
  }
  if (ws.loadError && !state) {
    return (
      <Card>
        <ErrorState error={ws.loadError} onRetry={() => void ws.load()} />
      </Card>
    );
  }
  if (!state || !view || !phase) return null;

  const record = state.record;
  const breakNow = currentBreakSeconds(view, serverNow);
  const allowance = breakAllowance(state.break_allowance_minutes, totalBreakSeconds(view, serverNow));
  const actions = attendanceActions(ws);
  const lastOvertime = state.overtime[state.overtime.length - 1];
  const openOt = state.open_overtime_request;
  const autoCheckout =
    record?.checkout_reason === "GEO_FENCE_EXIT" || record?.checkout_reason === "INACTIVITY_TIMEOUT" ? record : null;

  let headline = { label: "Worked today", seconds: workedSeconds(view, serverNow), testId: "work-timer" };
  if (phase === "ON_BREAK") headline = { label: "Break timer", seconds: breakNow, testId: "break-timer" };
  if (phase === "OVERTIME") headline = { label: "Overtime timer", seconds: overtimeSeconds(view, serverNow), testId: "overtime-timer" };

  return (
    <Card>
      <CardHeader
        title="Today's work session"
        description={fmtDate(state.date)}
        actions={
          <div className="flex items-center gap-2">
            {view.pendingEvents > 0 && <Badge tone="amber">{view.pendingEvents} waiting to sync</Badge>}
            {record?.check_in && <Badge tone={record.mode === "WORK_FROM_HOME" ? "blue" : "neutral"}>{record.mode === "WORK_FROM_HOME" ? "Work from home" : "Office"}</Badge>}
            <span data-testid="session-phase" data-phase={phase}>
              <Badge tone={PHASE_TONE[phase]}>{PHASE_LABEL[phase]}</Badge>
            </span>
          </div>
        }
      />
      <div className="space-y-5 p-space-lg">
        {recovery && me && (
          <Alert tone="info">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                <strong>Active work session detected.</strong>{" "}
                {view.checkIn && `Checked in at ${fmtTime(view.checkIn)}`}
                {phase === "ON_BREAK" && view.breakStart && ` · on break since ${fmtTime(view.breakStart)}`}
                {phase === "OVERTIME" && view.overtimeStart && ` · overtime running since ${fmtTime(view.overtimeStart)}`}. Your
                timers continue from the server&apos;s records.
              </span>
              <Button
                size="sm"
                variant="dark"
                icon={<RotateCcw className="h-4 w-4" />}
                onClick={() => {
                  markSessionSeen(me.id);
                  setRecovery(false);
                  void ws.load();
                }}
              >
                Resume session
              </Button>
            </div>
          </Alert>
        )}
        {ws.staleSince && (
          <Alert tone="warning">Offline — showing your last known session from {fmtDateTime(ws.staleSince)}. It refreshes automatically when the connection returns.</Alert>
        )}
        {ws.actionError && <Alert>{ws.actionError.message}</Alert>}
        {autoCheckout?.check_out && (
          <Alert tone="warning">
            <span data-testid="auto-checkout">
              You were checked out automatically at {fmtTime(autoCheckout.check_out)}
              {autoCheckout.checkout_reason === "GEO_FENCE_EXIT"
                ? ` because you left the workplace area${autoCheckout.check_out_distance_m != null ? ` (about ${autoCheckout.check_out_distance_m} m away)` : ""}.`
                : ` after ${state.inactivity_timeout_minutes ?? 30} minutes without activity.`}
            </span>
          </Alert>
        )}

        {phase === "NOT_CHECKED_IN" && (
          <>
            {state.wfh_today?.status === "APPROVED" && (
              <Alert tone="success">Work from home is approved for today. Use “WFH check in” to start; no location is needed.</Alert>
            )}
            {state.wfh_today?.status === "PENDING" && (
              <Alert tone="info">Your work-from-home request for today is waiting for HR. You can still check in at the office.</Alert>
            )}
            <LocationPanel ws={ws} />
          </>
        )}

        {phase !== "NOT_CHECKED_IN" && phase !== "DISABLED" && (
          <div
            className={`rounded-xl px-5 py-4 ${phase === "ON_BREAK" ? "bg-warning-container" : phase === "OVERTIME" ? "bg-surface-container-high" : "bg-surface-container"}`}
          >
            <p className="font-label-sm text-label-sm uppercase text-on-surface-variant">{headline.label}</p>
            <p role="timer" aria-label={headline.label} data-testid={headline.testId} className="mt-1 font-display text-display-lg-mobile font-bold text-primary sm:text-display-lg">
              {fmtClock(headline.seconds)}
            </p>
            {phase === "ON_BREAK" && view.breakStart && <p className="mt-1 text-xs text-on-surface-variant">Since {fmtTime(view.breakStart)} — break time is not counted as work.</p>}
            {phase === "OVERTIME" && view.overtimeStart && <p className="mt-1 text-xs text-on-surface-variant">Since {fmtTime(view.overtimeStart)} — recorded separately from normal hours.</p>}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Stat label="Check-in" value={fmtTime(view.checkIn)} />
          <Stat label="Check-out" value={fmtTime(view.checkOut)} />
          <Stat
            label="Break used"
            value={fmtDuration(totalBreakSeconds(view, serverNow))}
            testId="total-break"
            hint={allowance ? (allowance.remaining > 0 ? `${minutes(allowance.remaining)} remaining of ${minutes(allowance.allowance)}` : "Break unavailable for the day") : undefined}
            hintTone={allowance && allowance.remaining === 0 ? "warning" : "muted"}
          />
          <Stat label="Actual working" value={fmtDuration(workedSeconds(view, serverNow))} testId="actual-working" />
          <Stat label="Overtime" value={fmtDuration(overtimeSeconds(view, serverNow))} testId="overtime-total" />
        </div>
        {allowance && phase !== "NOT_CHECKED_IN" && (
          <p className="text-body-md text-on-surface" data-testid="break-allowance">
            Break used: <strong>{minutes(allowance.used)}</strong> · Break remaining:{" "}
            <strong className={allowance.remaining === 0 ? "text-warning" : ""}>{minutes(allowance.remaining)}</strong>
          </p>
        )}

        {record && (
          <div className="flex flex-wrap gap-2">
            <StatusBadge status={record.status} />
            {record.is_late && <Badge tone="amber">Late</Badge>}
            {record.check_in_distance_m != null && <Badge>{record.check_in_distance_m} m from workplace at check-in</Badge>}
          </div>
        )}

        {phase === "DISABLED" ? (
          <Alert tone="info">Self check-in is turned off in company settings. HR records attendance.</Alert>
        ) : (
          <div className="flex flex-wrap gap-2" data-testid="session-actions">
            {actions.map((a) => (
              <Button
                key={a.key}
                variant={a.primary ? "primary" : "secondary"}
                icon={a.icon}
                loading={a.busy}
                disabled={a.disabled}
                title={a.title}
                onClick={a.onClick}
              >
                {a.label}
              </Button>
            ))}
          </div>
        )}

        {openOt && (
          <Alert tone={openOt.status === "APPROVED" ? "success" : "info"}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span data-testid="overtime-request-status">
                {openOt.status === "REQUESTED"
                  ? "Your overtime request is waiting for HR approval."
                  : `Overtime approved${openOt.decided_by_name ? ` by ${openOt.decided_by_name}` : ""} — you can start it now.`}
              </span>
              <Button size="sm" variant="secondary" loading={ws.busy === "overtime-cancel"} onClick={() => void ws.cancelOvertime(openOt.id)}>
                Cancel request
              </Button>
            </div>
          </Alert>
        )}
        {phase === "CHECKED_OUT" && !openOt && lastOvertime?.status === "AUTO_STOPPED" && lastOvertime.ended_at && (
          <Alert tone="warning">
            Overtime stopped automatically at {fmtTime(lastOvertime.ended_at)} after a period without activity. To continue, send a new overtime request.
          </Alert>
        )}
        {!ws.online && (phase === "NOT_CHECKED_IN" || phase === "WORKING") && (
          <p className="text-xs text-on-surface-variant">Check-in and check-out need a connection (the server verifies them). Breaks work offline.</p>
        )}
        {phase === "WORKING" && view.pendingEvents > 0 && ws.online && (
          <p className="text-xs text-on-surface-variant">Check-out is available once your offline actions have synced.</p>
        )}
        {(phase === "WORKING" || phase === "OVERTIME") && state.inactivity_timeout_minutes && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
            <span>
              Activity check: {state.inactivity_timeout_minutes} minutes without any activity in Nexvra HRMS ends the session automatically. Only the
              time of your last activity is recorded — never what you type or view.
            </span>
            {ws.activity.systemIdleSupported && !ws.activity.systemIdleEnabled && (
              <Button size="sm" variant="ghost" icon={<Monitor className="h-4 w-4" />} onClick={() => void ws.activity.enableSystemIdle()}>
                Also count activity in other apps
              </Button>
            )}
          </div>
        )}
        {record?.location_issue && phase === "WORKING" && record.mode === "OFFICE" && (
          <p className="text-xs text-warning">
            Location monitoring problem ({record.location_issue.toLowerCase().replace("_", " ")}). This is recorded for HR; it does not check you out.
          </p>
        )}

        {view.breaks.length > 0 && (
          <div className="border-t border-surface-container-high/40 pt-4">
            <button onClick={() => setShowHistory((s) => !s)} className="inline-flex items-center gap-2 text-sm font-medium text-primary-fixed hover:underline" aria-expanded={showHistory}>
              <History className="h-4 w-4" /> Break history ({view.breaks.length})
            </button>
            {showHistory && (
              <ul className="mt-3 divide-y divide-surface-container-high/40 rounded-lg bg-surface-container" aria-label="Break history">
                {view.breaks.map((b, i) => (
                  <li key={`${b.start}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="flex items-center gap-2 text-on-surface">
                      <Timer className="h-4 w-4 text-outline" />
                      {fmtTime(b.start)} – {b.end ? fmtTime(b.end) : "now"}
                    </span>
                    <span className="flex items-center gap-2">
                      {b.pending && <Badge tone="amber">Waiting to sync</Badge>}
                      <span className="text-primary">{b.end ? fmtDuration(b.seconds) : fmtClock(breakNow)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
