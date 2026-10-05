"use client";

/**
 * One shared work session for the whole app: the header actions, the attendance card and the
 * dashboard all read the same server state and use the same actions. It also runs the monitors
 * while a session is open, on every page:
 *
 * - activity: a privacy-safe heartbeat (moments of interaction as "seconds ago", never content)
 *   every `heartbeat_seconds`, and immediately when the inactivity limit is reached. Moments seen
 *   while offline are kept and reported when the connection returns. Open tabs share activity and
 *   only one of them sends each heartbeat. Activity is not watched during a meeting (working time
 *   is paused) or outside a work session;
 * - location (office sessions with a configured workplace): readings go with the heartbeat so the
 *   server can apply the geofence. Errors are reported as a status, never as "left";
 * - meetings and Resume Work: while a meeting pauses the session or a Resume Work request waits
 *   for HR, the state is refreshed regularly so the change shows without a reload.
 *
 * The server decides everything (geofence, WFH permission, inactivity, break allowance, meetings,
 * resume approval, overtime approval); the browser only reports and displays.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useToast } from "@/components/ui/Overlay";
import { ActivityTracker, lastSharedBeat, markSharedBeat, pageTracker } from "@/lib/activity";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useConnection } from "@/lib/connection";
import { checkInVerdict, type Fix, type GeoVerdict } from "@/lib/geo";
import { toApiError } from "@/lib/hooks";
import { currentLocation, watchLocation, type LocationStatus } from "@/lib/location";
import { UNREACHABLE_CODES, newEventId } from "@/lib/offline";
import type { AttendanceMode, SyncEventType, WorkSessionState } from "@/lib/types";
import { clockOffset, deriveSession, type SessionView } from "@/lib/worksession";
import { CheckoutGuard } from "./CheckoutGuard";
import { OvertimeRequestModal } from "./OvertimeRequestModal";
import { ResumeWorkModal } from "./ResumeWorkModal";
import { WfhRequestModal } from "./WfhRequestModal";

const ACTIONS: Record<SyncEventType, { path: string; done: string }> = {
  BREAK_START: { path: "/api/attendance/breaks/start/", done: "Break started." },
  BREAK_END: { path: "/api/attendance/breaks/end/", done: "Welcome back — break ended." },
  OVERTIME_START: { path: "/api/attendance/overtime/start/", done: "Overtime started." },
  OVERTIME_END: { path: "/api/attendance/overtime/end/", done: "Overtime ended." },
};

const AUTO_CHECKOUT_TEXT: Record<string, string> = {
  GEO_FENCE_EXIT: "You were checked out automatically because you left the workplace area.",
  INACTIVITY_TIMEOUT: "You were checked out automatically after a period without activity. Use Resume Work to continue.",
};

/** A location reading older than this is not sent as "current". */
const FIX_MAX_AGE_MS = 120_000;
/** Refresh interval while a meeting pauses the session or a Resume Work request is pending. */
const WAITING_POLL_MS = 60_000;
const WATCHDOG_MS = 30_000;
const STATE_CHANNEL = "nexvra-worksession";

export interface WorkSessionValue {
  enabled: boolean;
  state: WorkSessionState | null;
  view: SessionView;
  /** serverNow = Date.now() + offset */
  offset: number;
  loading: boolean;
  loadError: ApiError | null;
  staleSince: string | null;
  busy: string | null;
  actionError: ApiError | null;
  clearActionError: () => void;
  online: boolean;
  /** Increases after every state change caused by an action or a monitor. */
  version: number;
  location: { status: LocationStatus; fix: Fix | null; verdict: GeoVerdict; wanted: boolean };
  requestLocation: () => void;
  activity: { systemIdleSupported: boolean; systemIdleEnabled: boolean; enableSystemIdle: () => Promise<boolean> };
  load: () => Promise<void>;
  checkIn: (mode?: AttendanceMode) => Promise<void>;
  requestCheckOut: () => void;
  sessionAction: (type: SyncEventType) => Promise<void>;
  openOvertime: () => void;
  openWfh: () => void;
  openResume: () => void;
  cancelResume: (id: number) => Promise<void>;
  cancelOvertime: (id: number) => Promise<void>;
}

const EMPTY_VIEW = deriveSession(null);
const WorkSessionContext = createContext<WorkSessionValue | null>(null);

export function useWorkSession() {
  return useContext(WorkSessionContext);
}

/** Re-renders every second with the server-corrected time (timers derive from timestamps). */
export function useServerNow(offset: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now + offset;
}

export function WorkSessionProvider({ children }: { children: ReactNode }) {
  const { me, can } = useAuth();
  const enabled = !!me?.employee && can("attendance.self");
  const conn = useConnection();
  const toast = useToast();
  const { queue, online, reportUnreachable, syncVersion } = conn;

  const [state, setState] = useState<WorkSessionState | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(enabled);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [staleSince, setStaleSince] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [version, setVersion] = useState(0);
  const [guardOpen, setGuardOpen] = useState(false);
  const [overtimeOpen, setOvertimeOpen] = useState(false);
  const [wfhOpen, setWfhOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [locationWanted, setLocationWanted] = useState(false);
  const [locStatus, setLocStatus] = useState<LocationStatus>("idle");
  const [fix, setFix] = useState<Fix | null>(null);
  const [systemIdleEnabled, setSystemIdleEnabled] = useState(false);
  const fixRef = useRef<Fix | null>(null);
  const locStatusRef = useRef<LocationStatus>("idle");
  const channel = useRef<BroadcastChannel | null>(null);
  fixRef.current = fix;
  locStatusRef.current = locStatus;

  const apply = useCallback(
    (next: WorkSessionState, receivedAt = Date.now(), share = true) => {
      setState(next);
      setOffset(clockOffset(next.server_time, receivedAt));
      setStaleSince(null);
      queue?.saveSnapshot(next);
      if (share) {
        try {
          channel.current?.postMessage({ state: next });
        } catch {
          // other tabs refresh on their own
        }
      }
    },
    [queue],
  );

  // Other tabs share fresh server state (one tab sends the heartbeat for all of them).
  useEffect(() => {
    if (!enabled || typeof BroadcastChannel !== "function") return;
    const ch = new BroadcastChannel(STATE_CHANNEL);
    channel.current = ch;
    ch.onmessage = (e: MessageEvent<{ state?: WorkSessionState }>) => {
      if (e.data?.state) apply(e.data.state, Date.now(), false);
    };
    return () => {
      ch.close();
      channel.current = null;
    };
  }, [enabled, apply]);

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      apply(await api<WorkSessionState>("/api/attendance/today/"));
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
  }, [enabled, apply, queue, reportUnreachable]);

  // Initial load, after every successful synchronisation, and whenever we come back online.
  useEffect(() => {
    void load();
  }, [load, syncVersion, online]);

  // Returning to a minimised / background tab: refresh from the server.
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [enabled, load]);

  const view = useMemo(() => (state ? deriveSession(state, conn.pending) : EMPTY_VIEW), [state, conn.pending]);
  const phase = view.phase;
  const officeSession = state?.record?.mode !== "WORK_FROM_HOME";
  const geofenced = !!state?.workplace.configured;

  // --- location ---------------------------------------------------------------------------
  const watching =
    enabled &&
    geofenced &&
    ((phase === "NOT_CHECKED_IN" && locationWanted) ||
      (view.resume === "approved" && locationWanted) ||
      ((phase === "WORKING" || phase === "ON_BREAK") && officeSession));
  useEffect(() => {
    if (!watching) return;
    return watchLocation(setFix, setLocStatus);
  }, [watching]);

  const requestLocation = useCallback(() => setLocationWanted(true), []);

  // --- activity heartbeat ---------------------------------------------------------------------
  // Watched while working, on a break or in overtime - also offline, so the activity can be
  // reported later. Not during a meeting (working time is paused) and not outside a session.
  const monitoring = enabled && (phase === "WORKING" || phase === "ON_BREAK" || phase === "OVERTIME");
  const heartbeatSeconds = state?.heartbeat_seconds ?? 60;
  const timeoutMinutes = state?.inactivity_timeout_minutes ?? null;
  const inFlight = useRef(false);
  const reportedIdle = useRef(false);

  // The latest values for the (stable) heartbeat loop, so a state change never restarts it.
  const ctx = useRef({ apply, geofenced, officeSession, phase, reportUnreachable, toast, heartbeatSeconds });
  ctx.current = { apply, geofenced, officeSession, phase, reportUnreachable, toast, heartbeatSeconds };

  const sendHeartbeat = useCallback(async (force: boolean) => {
    const t = pageTracker();
    const c = ctx.current;
    if (inFlight.current) return;
    // Another tab of this browser delivered a heartbeat moments ago: it carried the shared activity.
    const other = lastSharedBeat();
    if (!force && Date.now() - other < (c.heartbeatSeconds - 5) * 1000) {
      t.acknowledge(other - 5_000);
      return;
    }
    const report = t.report();
    const body: Record<string, unknown> = {
      idle_seconds: report.idle_seconds,
      activity: report.activity,
      observed_seconds: report.observed_seconds,
    };
    const current = fixRef.current;
    if (c.geofenced && c.officeSession && c.phase === "WORKING") {
      if (current && Date.now() - current.at < FIX_MAX_AGE_MS && locStatusRef.current === "ok") {
        Object.assign(body, { location_status: "ok", latitude: current.latitude, longitude: current.longitude, accuracy: current.accuracy });
      } else if (["denied", "unavailable", "timeout", "unsupported"].includes(locStatusRef.current)) {
        body.location_status = locStatusRef.current;
      }
    }
    inFlight.current = true;
    try {
      const res = await api<{ changed: boolean; state: WorkSessionState }>("/api/attendance/heartbeat/", { body });
      t.acknowledge(report.takenAt);
      markSharedBeat(Date.now());
      c.apply(res.state);
      if (res.changed) {
        setVersion((v) => v + 1);
        const reason = res.state.record?.checkout_reason;
        if (reason && AUTO_CHECKOUT_TEXT[reason]) c.toast(AUTO_CHECKOUT_TEXT[reason], "error");
        else if (!res.state.active_overtime && c.phase === "OVERTIME") c.toast("Overtime was stopped automatically after a period without activity.", "error");
      }
    } catch (e) {
      // Not inactivity: the moments stay queued and go with the next successful heartbeat.
      if (UNREACHABLE_CODES.has(toApiError(e).code)) c.reportUnreachable();
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!monitoring) return;
    const t = pageTracker();
    t.start();
    reportedIdle.current = false;
    const offActivity = t.onActivity(() => {
      reportedIdle.current = false;
    });
    // Device-wide activity (Idle Detection) comes back by itself after a reload when allowed.
    void t.resumeSystemIdleDetection().then((ok) => setSystemIdleEnabled(ok || t.systemIdleEnabled));
    return () => {
      offActivity();
      t.stop();
      setSystemIdleEnabled(false);
    };
  }, [monitoring]);

  useEffect(() => {
    if (!monitoring) return;
    void sendHeartbeat(true);
    const beat = window.setInterval(() => void sendHeartbeat(false), heartbeatSeconds * 1000);
    // Report the moment the limit is reached instead of waiting for the next beat.
    const watchdog = window.setInterval(() => {
      if (timeoutMinutes && !reportedIdle.current && pageTracker().idleSeconds() >= timeoutMinutes * 60) {
        reportedIdle.current = true;
        void sendHeartbeat(true);
      }
    }, WATCHDOG_MS);
    return () => {
      window.clearInterval(beat);
      window.clearInterval(watchdog);
    };
  }, [monitoring, heartbeatSeconds, timeoutMinutes, sendHeartbeat]);

  // Waiting on someone else (a running meeting, an HR decision): refresh regularly.
  const waiting = enabled && online && (phase === "IN_MEETING" || view.resume === "pending");
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => void load(), WAITING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [waiting, load]);

  const enableSystemIdle = useCallback(async () => {
    const t = pageTracker();
    const ok = await t.enableSystemIdleDetection();
    setSystemIdleEnabled(ok);
    toast(ok ? "Activity in other apps on this device now counts." : "Your browser did not allow it.", ok ? "success" : "error");
    return ok;
  }, [toast]);

  // --- actions ----------------------------------------------------------------------------------
  const changed = useCallback(() => setVersion((v) => v + 1), []);

  const sessionAction = useCallback(
    async (type: SyncEventType) => {
      const id = newEventId();
      const occurredAt = new Date(Date.now() + offset).toISOString();
      setActionError(null);
      pageTracker().mark();
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
        changed();
      } catch (e) {
        const err = toApiError(e);
        if (UNREACHABLE_CODES.has(err.code)) {
          // Same id: if the request did reach the server, the later sync is a harmless duplicate.
          reportUnreachable();
          conn.enqueue(type, occurredAt, id);
          toast("Connection lost — saved on this device and will sync automatically.");
        } else {
          setActionError(err);
          void load();
        }
      } finally {
        setBusy(null);
      }
    },
    [offset, online, conn, toast, apply, changed, reportUnreachable, load],
  );

  const checkIn = useCallback(
    async (mode: AttendanceMode = "OFFICE") => {
      setActionError(null);
      setBusy(mode === "WORK_FROM_HOME" ? "check-in-wfh" : "check-in");
      try {
        const body: Record<string, unknown> = { mode };
        if (mode === "OFFICE" && geofenced) {
          setLocationWanted(true);
          const reading =
            fixRef.current && Date.now() - fixRef.current.at < 30_000 ? fixRef.current : await currentLocation();
          setFix(reading);
          setLocStatus("ok");
          Object.assign(body, { latitude: reading.latitude, longitude: reading.longitude, accuracy: reading.accuracy });
        }
        await api("/api/attendance/check-in/", { body });
        const resumed = view.resume === "approved";
        toast(resumed ? "Checked in — working time continues." : mode === "WORK_FROM_HOME" ? "Checked in — working from home." : "Checked in.");
        await load();
        changed();
      } catch (e) {
        if (e instanceof Error && !(e instanceof ApiError) && ["denied", "unavailable", "timeout", "unsupported"].includes(e.message)) {
          setLocStatus(e.message as LocationStatus);
          setActionError(
            new ApiError(0, "location_unavailable", e.message === "denied"
              ? "Location permission is blocked. Allow location for this site to check in at the workplace."
              : "Your location could not be determined. Try again (GPS / Wi-Fi on)."),
          );
        } else {
          setActionError(toApiError(e));
          void load();
        }
      } finally {
        setBusy(null);
      }
    },
    [geofenced, load, changed, toast, view.resume],
  );

  const checkOut = useCallback(async () => {
    setActionError(null);
    setBusy("check-out");
    try {
      const body: Record<string, unknown> = {};
      const current = fixRef.current;
      if (geofenced && officeSession && current && Date.now() - current.at < FIX_MAX_AGE_MS) {
        Object.assign(body, { latitude: current.latitude, longitude: current.longitude });
      }
      await api("/api/attendance/check-out/", { body });
      setGuardOpen(false);
      toast("Checked out.");
      await load();
      changed();
    } catch (e) {
      const err = toApiError(e);
      if (err.code === "checkout_blocked_by_tasks") setGuardOpen(true);
      else {
        setGuardOpen(false);
        setActionError(err);
        void load();
      }
    } finally {
      setBusy(null);
    }
  }, [geofenced, officeSession, load, changed, toast]);

  const requestCheckOut = useCallback(() => {
    if (state && state.blocking_tasks > 0 && !state.checkout_exempt) setGuardOpen(true);
    else void checkOut();
  }, [state, checkOut]);

  const cancelOvertime = useCallback(
    async (id: number) => {
      setActionError(null);
      setBusy("overtime-cancel");
      try {
        const res = await api<{ state: WorkSessionState }>(`/api/attendance/overtime/${id}/cancel/`, { method: "POST" });
        apply(res.state);
        toast("Overtime request cancelled.");
        changed();
      } catch (e) {
        setActionError(toApiError(e));
      } finally {
        setBusy(null);
      }
    },
    [apply, changed, toast],
  );

  const cancelResume = useCallback(
    async (id: number) => {
      setActionError(null);
      setBusy("resume-cancel");
      try {
        const res = await api<{ state: WorkSessionState }>(`/api/attendance/resume-requests/${id}/cancel/`, { method: "POST" });
        apply(res.state);
        toast("Resume Work request cancelled.");
        changed();
      } catch (e) {
        setActionError(toApiError(e));
      } finally {
        setBusy(null);
      }
    },
    [apply, changed, toast],
  );

  const value: WorkSessionValue = {
    enabled,
    state,
    view,
    offset,
    loading,
    loadError,
    staleSince,
    busy,
    actionError,
    clearActionError: () => setActionError(null),
    online,
    version,
    location: { status: locStatus, fix, verdict: checkInVerdict(state?.workplace, fix), wanted: locationWanted },
    requestLocation,
    activity: { systemIdleSupported: ActivityTracker.systemIdleSupported(), systemIdleEnabled, enableSystemIdle },
    load,
    checkIn,
    requestCheckOut,
    sessionAction,
    openOvertime: () => setOvertimeOpen(true),
    openWfh: () => setWfhOpen(true),
    openResume: () => setResumeOpen(true),
    cancelResume,
    cancelOvertime,
  };

  return (
    <WorkSessionContext.Provider value={value}>
      {children}
      {enabled && (
        <>
          <CheckoutGuard
            open={guardOpen}
            onClose={() => setGuardOpen(false)}
            onCheckout={() => void checkOut()}
            checkingOut={busy === "check-out"}
          />
          <OvertimeRequestModal
            open={overtimeOpen}
            requiresApproval={state?.overtime_requires_approval ?? true}
            onClose={() => setOvertimeOpen(false)}
            onDone={(next) => {
              apply(next);
              setOvertimeOpen(false);
              changed();
            }}
          />
          <WfhRequestModal
            open={wfhOpen}
            defaultDate={state && phase === "NOT_CHECKED_IN" ? state.date : undefined}
            minDate={state?.date}
            onClose={() => setWfhOpen(false)}
            onDone={() => {
              setWfhOpen(false);
              void load();
              changed();
            }}
          />
          <ResumeWorkModal
            open={resumeOpen}
            checkedOutAt={state?.record?.check_out ?? null}
            onClose={() => setResumeOpen(false)}
            onDone={(next) => {
              apply(next);
              setResumeOpen(false);
              changed();
            }}
          />
        </>
      )}
    </WorkSessionContext.Provider>
  );
}
