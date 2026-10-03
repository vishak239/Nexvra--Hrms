"use client";

import { AlertTriangle, CheckCircle2, CloudOff, RefreshCw, Wifi } from "@/components/ui/icons";
import { useEffect, useRef, useState } from "react";
import { useConnection, type ConnectionStatus } from "@/lib/connection";
import { fmtDateTime, humanize } from "@/lib/format";

const LOOK: Record<ConnectionStatus, { label: string; className: string; icon: typeof Wifi }> = {
  ONLINE: { label: "Online", className: "border-surface-container-high/40 bg-surface-container-low text-on-surface-variant", icon: Wifi },
  OFFLINE: { label: "Offline mode", className: "border-warning-outline bg-warning-container text-warning", icon: CloudOff },
  SYNCING: { label: "Syncing", className: "border-surface-container-high bg-surface-container text-on-surface", icon: RefreshCw },
  SYNCED: { label: "Synced", className: "border-primary-container/30 bg-surface-container-low text-primary-fixed", icon: CheckCircle2 },
  SYNC_ERROR: { label: "Sync error", className: "border-error-container bg-error-container/40 text-on-error-container", icon: AlertTriangle },
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
        className={`inline-flex h-8 items-center gap-1.5 rounded border px-space-sm font-code-mono text-code-mono ${look.className}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Connection: ${look.label}${pending.length ? `, ${pending.length} waiting to sync` : ""}`}
        data-testid="connection-status"
        data-status={status}
      >
        {status === "ONLINE" ? (
          <span className="h-1.5 w-1.5 rounded-[50%] bg-primary-container" aria-hidden="true" />
        ) : (
          <Icon className={`h-4 w-4 ${status === "SYNCING" ? "animate-spin" : ""}`} aria-hidden="true" />
        )}
        <span className={quiet ? "sr-only sm:not-sr-only" : ""}>{look.label}</span>
        {pending.length > 0 && (
          <span className="rounded-[9999px] bg-surface-container-highest px-1.5 text-[10px] font-semibold text-primary">{pending.length}</span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Connection details" className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-surface-container-high bg-surface-container p-4 text-body-md">
          <p className="font-headline-sm text-headline-sm text-primary">{look.label}</p>
          <p className="mt-1 text-on-surface-variant">
            {online
              ? "Connected to the Nexvra HRMS server."
              : "No connection. Break and overtime actions are saved on this device and sync automatically when you're back online. Check-in and check-out need a connection."}
          </p>
          {!queue?.persistent && (
            <p className="mt-2 text-xs text-warning">This browser blocks local storage: offline actions are kept only while this tab stays open.</p>
          )}
          {pending.length > 0 && (
            <div className="mt-3">
              <p className="font-label-sm text-label-sm uppercase text-on-surface-variant">Waiting to sync</p>
              <ul className="mt-1 space-y-1">
                {pending.map((e) => (
                  <li key={e.id} className="flex justify-between gap-2 text-on-surface">
                    <span>{humanize(e.type)}</span>
                    <span className="text-xs text-outline">{fmtDateTime(e.occurredAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {lastError && <p className="mt-3 text-xs text-error">Last attempt failed: {lastError} It will retry automatically.</p>}
          {failures.length > 0 && (
            <div className="mt-3 rounded-lg border border-error-container bg-error-container/25 p-2">
              <p className="text-xs font-semibold text-on-error-container">Not applied by the server</p>
              <ul className="mt-1 space-y-1 text-xs text-on-error-container">
                {failures.map((f) => (
                  <li key={f.id}>
                    {humanize(f.type)}: {f.error || humanize(f.status)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {lastSyncAt && <p className="mt-3 text-xs text-outline">Last synced {fmtDateTime(lastSyncAt)}</p>}
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => void syncNow()}
              disabled={!online || pending.length === 0}
              className="rounded bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface hover:bg-surface-container-highest disabled:opacity-40"
            >
              Retry now
            </button>
            {(failures.length > 0 || lastError) && (
              <button onClick={dismissFailures} className="rounded px-2.5 py-1 text-xs font-medium text-on-surface-variant hover:bg-surface-container-high">
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
    <div role="status" className="border-b border-warning-outline bg-warning-container px-4 py-2 text-center text-body-md text-warning">
      <strong>Offline mode</strong> — you can keep using breaks and overtime; {pending.length ? `${pending.length} action(s) are` : "actions are"} saved on this device and will sync when the connection returns.
    </div>
  );
}
