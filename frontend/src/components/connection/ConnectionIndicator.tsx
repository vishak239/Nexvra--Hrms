"use client";

import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw, Wifi } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useConnection, type ConnectionStatus } from "@/lib/connection";
import { fmtDateTime, humanize } from "@/lib/format";

const LOOK: Record<ConnectionStatus, { label: string; className: string; icon: typeof Wifi }> = {
  ONLINE: { label: "Online", className: "text-green-700 bg-green-50 ring-green-200", icon: Wifi },
  OFFLINE: { label: "Offline mode", className: "text-amber-900 bg-amber-50 ring-amber-300", icon: CloudOff },
  SYNCING: { label: "Syncing", className: "text-sky-700 bg-sky-50 ring-sky-200", icon: RefreshCw },
  SYNCED: { label: "Synced", className: "text-green-700 bg-green-50 ring-green-200", icon: CheckCircle2 },
  SYNC_ERROR: { label: "Sync error", className: "text-red-700 bg-red-50 ring-red-200", icon: AlertTriangle },
};

/** Small, unobtrusive connection + synchronisation status for the header. */
export function ConnectionIndicator() {
  const { status, pending, failures, lastError, lastSyncAt, syncNow, dismissFailures, online, queue } = useConnection();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const look = LOOK[status];
  const Icon = look.icon;

  useEffect(() => {
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Quiet when everything is normal: just a dot. Expanded label otherwise.
  const quiet = status === "ONLINE" && pending.length === 0;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium ring-1 ring-inset ${look.className}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Connection: ${look.label}${pending.length ? `, ${pending.length} waiting to sync` : ""}`}
        data-testid="connection-status"
        data-status={status}
      >
        <Icon className={`h-3.5 w-3.5 ${status === "SYNCING" ? "animate-spin" : ""}`} aria-hidden="true" />
        <span className={quiet ? "sr-only sm:not-sr-only" : ""}>{look.label}</span>
        {pending.length > 0 && (
          <span className="rounded-full bg-white/70 px-1.5 text-[10px] font-semibold">{pending.length}</span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Connection details" className="absolute right-0 z-40 mt-2 w-80 rounded-xl border border-zinc-200 bg-white p-4 text-sm shadow-lg">
          <p className="font-semibold text-zinc-900">{look.label}</p>
          <p className="mt-1 text-zinc-500">
            {online
              ? "Connected to the Nexvra HRMS server."
              : "No connection. Break and overtime actions are saved on this device and sync automatically when you're back online. Check-in and check-out need a connection."}
          </p>
          {!queue?.persistent && (
            <p className="mt-2 text-xs text-amber-700">This browser blocks local storage: offline actions are kept only while this tab stays open.</p>
          )}
          {pending.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Waiting to sync</p>
              <ul className="mt-1 space-y-1">
                {pending.map((e) => (
                  <li key={e.id} className="flex justify-between gap-2 text-zinc-700">
                    <span>{humanize(e.type)}</span>
                    <span className="text-xs text-zinc-400">{fmtDateTime(e.occurredAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {lastError && <p className="mt-3 text-xs text-red-700">Last attempt failed: {lastError} It will retry automatically.</p>}
          {failures.length > 0 && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2">
              <p className="text-xs font-semibold text-red-800">Not applied by the server</p>
              <ul className="mt-1 space-y-1 text-xs text-red-800">
                {failures.map((f) => (
                  <li key={f.id}>
                    {humanize(f.type)}: {f.error || humanize(f.status)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {lastSyncAt && <p className="mt-3 text-xs text-zinc-400">Last synced {fmtDateTime(lastSyncAt)}</p>}
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => void syncNow()}
              disabled={!online || pending.length === 0}
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-40"
            >
              Retry now
            </button>
            {(failures.length > 0 || lastError) && (
              <button onClick={dismissFailures} className="rounded-md px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100">
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Full-width notice shown while offline. */
export function OfflineBanner() {
  const { online, pending } = useConnection();
  if (online) return null;
  return (
    <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
      <strong>Offline mode</strong> — you can keep using breaks and overtime; {pending.length ? `${pending.length} action(s) are` : "actions are"} saved on this device and will sync when the connection returns.
    </div>
  );
}
