"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import { OfflineQueue, browserStore, flushQueue, retryDelay } from "./offline";
import type { SyncEventType, SyncResult, WorkSessionState } from "./types";
import type { QueuedEvent } from "./worksession";

export type ConnectionStatus = "ONLINE" | "OFFLINE" | "SYNCING" | "SYNCED" | "SYNC_ERROR";

interface ConnectionContextValue {
  status: ConnectionStatus;
  /** Browser online AND the HRMS server reachable. */
  online: boolean;
  queue: OfflineQueue | null;
  pending: QueuedEvent[];
  /** Events the server refused during the last synchronisation. */
  failures: SyncResult[];
  lastError: string | null;
  lastSyncAt: string | null;
  /** Increments whenever a synchronisation changed server state (consumers reload). */
  syncVersion: number;
  enqueue: (type: SyncEventType, occurredAt: string, id?: string) => QueuedEvent | null;
  syncNow: () => Promise<void>;
  /** Report that a request could not reach the server (switches to offline mode). */
  reportUnreachable: () => void;
  dismissFailures: () => void;
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

const HEALTH_PROBE_MS = 10_000;
const SYNCED_BADGE_MS = 4_000;

async function serverReachable() {
  try {
    const res = await fetch("/api/health/", { cache: "no-store", credentials: "same-origin" });
    return res.ok;
  } catch {
    return false;
  }
}

export function ConnectionProvider({ userId, children }: { userId: number; children: ReactNode }) {
  const queue = useMemo(() => new OfflineQueue(browserStore(), userId), [userId]);
  const [browserOnline, setBrowserOnline] = useState(true);
  const [reachable, setReachable] = useState(true);
  const [pending, setPending] = useState<QueuedEvent[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [failures, setFailures] = useState<SyncResult[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [justSynced, setJustSynced] = useState(false);
  const [syncVersion, setSyncVersion] = useState(0);
  const attempt = useRef(0);
  const [failCount, setFailCount] = useState(0);
  const inFlight = useRef(false);
  const online = browserOnline && reachable;

  const refreshPending = useCallback(() => setPending(queue.list()), [queue]);

  const syncNow = useCallback(async () => {
    if (inFlight.current) return;
    if (!queue.list().length) {
      refreshPending();
      return;
    }
    inFlight.current = true;
    setSyncing(true);
    const outcome = await flushQueue(queue, (events) =>
      api<{ results: SyncResult[]; state: WorkSessionState }>("/api/attendance/sync/", { body: { events } }),
    );
    inFlight.current = false;
    setSyncing(false);
    refreshPending();
    if (outcome.ok) {
      attempt.current = 0;
      setLastError(null);
      setLastSyncAt(new Date().toISOString());
      if (outcome.failed.length) setFailures((f) => [...f, ...outcome.failed]);
      if (outcome.sent) {
        setSyncVersion((v) => v + 1);
        setJustSynced(true);
      }
    } else {
      attempt.current += 1;
      setFailCount((c) => c + 1);
      setLastError(outcome.error ?? "Synchronisation failed.");
      if (!(await serverReachable())) setReachable(false);
    }
  }, [queue, refreshPending]);

  // Browser connectivity events.
  useEffect(() => {
    setBrowserOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    refreshPending();
    const up = () => {
      setBrowserOnline(true);
      void serverReachable().then(setReachable);
    };
    const down = () => setBrowserOnline(false);
    const onStorage = (e: StorageEvent) => e.key === queue.key && refreshPending(); // other tabs
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      window.removeEventListener("storage", onStorage);
    };
  }, [queue, refreshPending]);

  // While the server is unreachable (but the browser is online), probe its health endpoint.
  useEffect(() => {
    if (!browserOnline || reachable) return;
    const timer = window.setInterval(() => {
      void serverReachable().then((ok) => ok && setReachable(true));
    }, HEALTH_PROBE_MS);
    return () => window.clearInterval(timer);
  }, [browserOnline, reachable]);

  // Flush the queue as soon as we are online, then retry with back-off while events remain.
  useEffect(() => {
    if (!online || syncing || pending.length === 0) return;
    const delay = attempt.current === 0 ? 300 : retryDelay(attempt.current - 1);
    const timer = window.setTimeout(() => void syncNow(), delay);
    return () => window.clearTimeout(timer);
  }, [online, syncing, pending.length, syncNow, failCount]);

  useEffect(() => {
    if (!justSynced) return;
    const timer = window.setTimeout(() => setJustSynced(false), SYNCED_BADGE_MS);
    return () => window.clearTimeout(timer);
  }, [justSynced]);

  const enqueue = useCallback(
    (type: SyncEventType, occurredAt: string, id?: string) => {
      const event = queue.enqueue(type, occurredAt, id);
      refreshPending();
      return event;
    },
    [queue, refreshPending],
  );

  const reportUnreachable = useCallback(() => {
    if (typeof navigator !== "undefined" && !navigator.onLine) setBrowserOnline(false);
    else setReachable(false);
  }, []);

  const status: ConnectionStatus = !online
    ? "OFFLINE"
    : syncing
      ? "SYNCING"
      : lastError || failures.length
        ? "SYNC_ERROR"
        : justSynced
          ? "SYNCED"
          : "ONLINE";

  const value: ConnectionContextValue = {
    status,
    online,
    queue,
    pending,
    failures,
    lastError,
    lastSyncAt,
    syncVersion,
    enqueue,
    syncNow,
    reportUnreachable,
    dismissFailures: () => {
      setFailures([]);
      setLastError(null);
    },
  };
  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

const OFFLINE_FALLBACK: ConnectionContextValue = {
  status: "ONLINE",
  online: true,
  queue: null,
  pending: [],
  failures: [],
  lastError: null,
  lastSyncAt: null,
  syncVersion: 0,
  enqueue: () => null,
  syncNow: async () => undefined,
  reportUnreachable: () => undefined,
  dismissFailures: () => undefined,
};

export function useConnection() {
  return useContext(ConnectionContext) ?? OFFLINE_FALLBACK;
}
