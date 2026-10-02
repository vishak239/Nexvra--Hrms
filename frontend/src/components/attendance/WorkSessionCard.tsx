"use client";

import { Clock, Coffee, History, LogIn, LogOut, Moon, Play, RotateCcw, Square, Timer } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge, Card, CardHeader, StatusBadge } from "@/components/ui/Display";
import { useToast } from "@/components/ui/Overlay";
import { Alert, ErrorState, Loading } from "@/components/ui/States";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useConnection } from "@/lib/connection";
import { fmtDate, fmtDateTime, fmtTime } from "@/lib/format";
import { toApiError } from "@/lib/hooks";
import { UNREACHABLE_CODES, newEventId } from "@/lib/offline";
import type { SyncEventType, WorkSessionState } from "@/lib/types";
import {
  clockOffset,
  currentBreakSeconds,
  deriveSession,
  fmtClock,
  fmtDuration,
  hasActiveSession,
  overtimeSeconds,
  totalBreakSeconds,
  workedSeconds,
  type Phase,
} from "@/lib/worksession";
import { CheckoutGuard } from "./CheckoutGuard";

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

const ACTIONS: Record<SyncEventType, { path: string; done: string }> = {
  BREAK_START: { path: "/api/attendance/breaks/start/", done: "Break started." },
  BREAK_END: { path: "/api/attendance/breaks/end/", done: "Welcome back — break ended." },
  OVERTIME_START: { path: "/api/attendance/overtime/start/", done: "Overtime started." },
  OVERTIME_END: { path: "/api/attendance/overtime/end/", done: "Overtime ended." },
};

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 font-mono text-base font-semibold tabular-nums text-zinc-900 sm:text-lg" data-testid={testId}>
        {value}
      </p>
    </div>
  );
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

/**
 * Today's work session: check-in/out, breaks with a live timer, overtime with a live timer,
 * offline queueing and session recovery. Server state is authoritative; this component only
 * displays it (plus clearly-marked queued offline actions).
 */
export function WorkSessionCard({ onChange }: { onChange?: () => void }) {
  const { me } = useAuth();
  const conn = useConnection();
  const toast = useToast();
  const [state, setState] = useState<WorkSessionState | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [staleSince, setStaleSince] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [guardOpen, setGuardOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const recoveryChecked = useRef(false);
  const { queue, online, reportUnreachable, syncVersion } = conn;

  const apply = useCallback(
    (next: WorkSessionState, receivedAt = Date.now()) => {
      setState(next);
      setOffset(clockOffset(next.server_time, receivedAt));
      setStaleSince(null);
      queue?.saveSnapshot(next);
    },
    [queue],
  );

  const load = useCallback(async () => {
    try {
      const next = await api<WorkSessionState>("/api/attendance/today/");
      apply(next);
      setLoadError(null);
    } catch (e) {
      const err = toApiError(e);
      const snapshot = queue?.loadSnapshot();
      if (UNREACHABLE_CODES.has(err.code)) reportUnreachable();
      if (UNREACHABLE_CODES.has(err.code) && snapshot) {
        setState(snapshot.state);
        setStaleSince(snapshot.savedAt);
        setLoadError(null);
      } else {
        setLoadError(err);
      }
    } finally {
      setLoading(false);
    }
  }, [apply, queue, reportUnreachable]);

  // Initial load, after every successful synchronisation, and whenever we come back online.
  useEffect(() => {
    void load();
  }, [load, syncVersion, online]);

  // Returning to a minimised / background tab: refresh from the server.
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  // Timers are derived from timestamps; this tick only re-renders.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const view = useMemo(() => deriveSession(state, conn.pending), [state, conn.pending]);
  const serverNow = now + offset;

  // "Active work session detected" once per browser session (e.g. after the browser was closed).
  useEffect(() => {
    if (!me || !state || recoveryChecked.current) return;
    recoveryChecked.current = true;
    if (!sessionSeen(me.id) && (hasActiveSession(view) || conn.pending.length > 0)) setRecovery(true);
    else markSessionSeen(me.id);
  }, [me, state, view, conn.pending.length]);

  async function sessionAction(type: SyncEventType) {
    const id = newEventId();
    const occurredAt = new Date(Date.now() + offset).toISOString();
    setActionError(null);
    if (!online || conn.pending.length > 0) {
      // Offline, or earlier offline actions still syncing: queue it so events stay in order.
      conn.enqueue(type, occurredAt, id);
      if (online) void conn.syncNow();
      else toast("Saved on this device — it will sync when you're back online.");
      return;
    }
    setBusy(type);
    try {
      const res = await api<{ duplicate: boolean; state: WorkSessionState }>(ACTIONS[type].path, {
        body: { client_event_id: id },
      });
      apply(res.state);
      toast(ACTIONS[type].done);
      onChange?.();
    } catch (e) {
      const err = toApiError(e);
      if (UNREACHABLE_CODES.has(err.code)) {
        // Same id: if the request did reach the server, the later sync is a harmless duplicate.
        reportUnreachable();
        conn.enqueue(type, occurredAt, id);
        toast("Connection lost — saved on this device and will sync automatically.");
      } else {
        setActionError(err);
      }
    } finally {
      setBusy(null);
    }
  }

  async function checkIn() {
    setActionError(null);
    setBusy("check-in");
    try {
      await api("/api/attendance/check-in/", { method: "POST" });
      toast("Checked in.");
      await load();
      onChange?.();
    } catch (e) {
      setActionError(toApiError(e));
    } finally {
      setBusy(null);
    }
  }

  async function checkOut() {
    setActionError(null);
    setBusy("check-out");
    try {
      await api("/api/attendance/check-out/", { method: "POST" });
      setGuardOpen(false);
      toast("Checked out.");
      await load();
      onChange?.();
    } catch (e) {
      const err = toApiError(e);
      if (err.code === "checkout_blocked_by_tasks") setGuardOpen(true);
      else {
        setGuardOpen(false);
        setActionError(err);
      }
    } finally {
      setBusy(null);
    }
  }

  function requestCheckOut() {
    if (state && state.blocking_tasks > 0 && !state.checkout_exempt) setGuardOpen(true);
    else void checkOut();
  }

  if (loading && !state) {
    return (
      <Card>
        <Loading label="Loading your work session…" />
      </Card>
    );
  }
  if (loadError && !state) {
    return (
      <Card>
        <ErrorState error={loadError} onRetry={() => void load()} />
      </Card>
    );
  }
  if (!state) return null;

  const phase = view.phase;
  const record = state.record;
  const breakNow = currentBreakSeconds(view, serverNow);
  const needsConnection = !online;

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
            <span data-testid="session-phase" data-phase={phase}>
              <Badge tone={PHASE_TONE[phase]}>{PHASE_LABEL[phase]}</Badge>
            </span>
          </div>
        }
      />
      <div className="space-y-5 p-5">
        {recovery && me && (
          <Alert tone="info">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                <strong>Active work session detected.</strong>{" "}
                {view.checkIn && `Checked in at ${fmtTime(view.checkIn)}`}
                {phase === "ON_BREAK" && view.breakStart && ` · on break since ${fmtTime(view.breakStart)}`}
                {phase === "OVERTIME" && view.overtimeStart && ` · overtime running since ${fmtTime(view.overtimeStart)}`}
                {conn.pending.length > 0 && ` · ${conn.pending.length} offline action(s) waiting to sync`}. Your timers continue from the server's records.
              </span>
              <Button
                size="sm"
                variant="dark"
                icon={<RotateCcw className="h-4 w-4" />}
                onClick={() => {
                  markSessionSeen(me.id);
                  setRecovery(false);
                  void load();
                }}
              >
                Resume session
              </Button>
            </div>
          </Alert>
        )}
        {staleSince && (
          <Alert tone="warning">Offline — showing your last known session from {fmtDateTime(staleSince)}. It refreshes automatically when the connection returns.</Alert>
        )}
        {actionError && <Alert>{actionError.message}</Alert>}

        {phase !== "NOT_CHECKED_IN" && phase !== "DISABLED" && (
          <div
            className={`rounded-xl px-5 py-4 ${phase === "ON_BREAK" ? "bg-amber-50" : phase === "OVERTIME" ? "bg-sky-50" : "bg-zinc-50"}`}
          >
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{headline.label}</p>
            <p role="timer" aria-label={headline.label} data-testid={headline.testId} className="mt-1 font-mono text-3xl font-semibold tabular-nums text-zinc-900 sm:text-4xl">
              {fmtClock(headline.seconds)}
            </p>
            {phase === "ON_BREAK" && view.breakStart && <p className="mt-1 text-xs text-zinc-500">Since {fmtTime(view.breakStart)} — break time is not counted as work.</p>}
            {phase === "OVERTIME" && view.overtimeStart && <p className="mt-1 text-xs text-zinc-500">Since {fmtTime(view.overtimeStart)} — recorded separately from normal hours.</p>}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Stat label="Check-in" value={fmtTime(view.checkIn)} />
          <Stat label="Check-out" value={fmtTime(view.checkOut)} />
          <Stat label="Total break" value={fmtDuration(totalBreakSeconds(view, serverNow))} testId="total-break" />
          <Stat label="Actual working" value={fmtDuration(workedSeconds(view, serverNow))} testId="actual-working" />
          <Stat label="Overtime" value={fmtDuration(overtimeSeconds(view, serverNow))} testId="overtime-total" />
        </div>

        {record && (
          <div className="flex flex-wrap gap-2">
            <StatusBadge status={record.status} />
            {record.is_late && <Badge tone="amber">Late</Badge>}
          </div>
        )}

        {phase === "DISABLED" ? (
          <Alert tone="info">Self check-in is turned off in company settings. HR records attendance.</Alert>
        ) : (
          <div className="flex flex-wrap gap-2">
            {phase === "NOT_CHECKED_IN" && (
              <Button icon={<LogIn className="h-4 w-4" />} loading={busy === "check-in"} disabled={needsConnection} onClick={() => void checkIn()}>
                Check in
              </Button>
            )}
            {phase === "WORKING" && (
              <>
                <Button variant="secondary" icon={<Coffee className="h-4 w-4" />} loading={busy === "BREAK_START"} onClick={() => void sessionAction("BREAK_START")}>
                  Start break
                </Button>
                <Button variant="dark" icon={<LogOut className="h-4 w-4" />} loading={busy === "check-out"} disabled={needsConnection || view.pendingEvents > 0} onClick={requestCheckOut}>
                  Check out
                </Button>
              </>
            )}
            {phase === "ON_BREAK" && (
              <Button icon={<Play className="h-4 w-4" />} loading={busy === "BREAK_END"} onClick={() => void sessionAction("BREAK_END")}>
                Back to work
              </Button>
            )}
            {phase === "CHECKED_OUT" && (
              <>
                <p className="flex items-center gap-2 text-sm text-zinc-500">
                  <Clock className="h-4 w-4" /> Normal work is done for today.
                </p>
                <Button variant="secondary" icon={<Moon className="h-4 w-4" />} loading={busy === "OVERTIME_START"} onClick={() => void sessionAction("OVERTIME_START")}>
                  Start Overtime
                </Button>
              </>
            )}
            {phase === "OVERTIME" && (
              <Button variant="dark" icon={<Square className="h-4 w-4" />} loading={busy === "OVERTIME_END"} onClick={() => void sessionAction("OVERTIME_END")}>
                End Overtime
              </Button>
            )}
          </div>
        )}
        {needsConnection && (phase === "NOT_CHECKED_IN" || phase === "WORKING") && (
          <p className="text-xs text-zinc-500">Check-in and check-out need a connection (the server verifies them). Breaks work offline.</p>
        )}
        {phase === "WORKING" && view.pendingEvents > 0 && online && (
          <p className="text-xs text-zinc-500">Check-out is available once your offline actions have synced.</p>
        )}

        {view.breaks.length > 0 && (
          <div className="border-t border-zinc-100 pt-4">
            <button onClick={() => setShowHistory((s) => !s)} className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700 hover:underline" aria-expanded={showHistory}>
              <History className="h-4 w-4" /> Break history ({view.breaks.length})
            </button>
            {showHistory && (
              <ul className="mt-3 divide-y divide-zinc-100 rounded-lg border border-zinc-100" aria-label="Break history">
                {view.breaks.map((b, i) => (
                  <li key={`${b.start}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="flex items-center gap-2 text-zinc-700">
                      <Timer className="h-4 w-4 text-zinc-400" />
                      {fmtTime(b.start)} – {b.end ? fmtTime(b.end) : "now"}
                    </span>
                    <span className="flex items-center gap-2">
                      {b.pending && <Badge tone="amber">Waiting to sync</Badge>}
                      <span className="font-mono text-zinc-900">{b.end ? fmtDuration(b.seconds) : fmtClock(breakNow)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <CheckoutGuard
        open={guardOpen}
        onClose={() => setGuardOpen(false)}
        onCheckout={() => void checkOut()}
        checkingOut={busy === "check-out"}
      />
    </Card>
  );
}
