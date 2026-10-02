import { AlertTriangle, Inbox, Lock, ServerOff } from "lucide-react";
import type { ReactNode } from "react";
import type { ApiError } from "@/lib/api";

export function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-sm text-zinc-500" role="status">
      <Spinner />
      {label}
    </div>
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-5" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-4 animate-pulse rounded bg-zinc-100" style={{ width: `${90 - i * 8}%` }} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
        {icon ?? <Inbox className="h-5 w-5" />}
      </div>
      <p className="text-sm font-semibold text-zinc-900">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-zinc-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function NoAccess() {
  return (
    <EmptyState
      icon={<Lock className="h-5 w-5" />}
      title="You don't have access to this"
      description="Your role doesn't include permission for this page. Contact HR or an administrator if you need access."
    />
  );
}

/** Error codes meaning the HRMS backend could not be reached (set by the API proxy / client). */
const SERVER_UNREACHABLE = new Set(["backend_unavailable", "backend_timeout", "network_error"]);

export function ErrorState({ error, onRetry }: { error?: ApiError; onRetry?: () => void }) {
  if (error?.status === 403) return <NoAccess />;
  if (error?.status === 404) {
    return <EmptyState title="Not found" description="This record doesn't exist or isn't available to you." />;
  }
  const unreachable = !!error && SERVER_UNREACHABLE.has(error.code);
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600">
        {unreachable ? <ServerOff className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
      </div>
      <p className="text-sm font-semibold text-zinc-900">{unreachable ? "Can't reach the server" : "Something went wrong"}</p>
      <p className="mt-1 max-w-sm text-sm text-zinc-500">{error?.message ?? "Please try again."}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-4 text-sm font-medium text-zinc-900 underline underline-offset-4">
          Try again
        </button>
      )}
    </div>
  );
}

export function Alert({ tone = "error", children }: { tone?: "error" | "info" | "success" | "warning"; children: ReactNode }) {
  const tones = {
    error: "border-red-200 bg-red-50 text-red-800",
    info: "border-zinc-200 bg-zinc-50 text-zinc-700",
    success: "border-green-200 bg-green-50 text-green-800",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}>
      {children}
    </div>
  );
}

/** Shows the non-field message of a failed form submission. */
export function FormError({ error }: { error?: ApiError }) {
  if (!error) return null;
  return <Alert>{error.message}</Alert>;
}
