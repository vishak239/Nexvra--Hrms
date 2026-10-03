import type { ReactNode } from "react";
import { PageTrail } from "@/components/layout/PageTrail";
import { humanize, initials } from "@/lib/format";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl bg-surface-container-low ${className}`}>{children}</section>;
}

export function CardHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-surface-container-high/40 px-space-lg py-space-md">
      <div className="space-y-0.5">
        <h2 className="font-headline-md text-headline-md text-primary">{title}</h2>
        {description && <p className="text-body-sm text-on-surface-variant">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-space-xl flex flex-col justify-between gap-space-md lg:flex-row lg:items-end">
      <div className="min-w-0 space-y-1">
        <PageTrail />
        <h1 className="font-headline-xl-mobile text-headline-xl-mobile text-primary sm:font-headline-xl sm:text-headline-xl">
          {title}
        </h1>
        {description && <p className="text-body-md text-on-surface-variant">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// Stitch status chips (attendance hub / employee directory) plus the DESIGN.md amber "pending" chip.
type Tone = "neutral" | "green" | "amber" | "red" | "blue" | "lime" | "dark";
const TONES: Record<Tone, string> = {
  neutral: "bg-surface-container-high text-on-surface-variant",
  green: "bg-surface-container-high text-primary-fixed",
  amber: "bg-warning-container text-warning ring-1 ring-inset ring-warning-outline",
  red: "bg-error-container text-on-error-container",
  blue: "bg-surface-container-high text-on-surface",
  lime: "bg-primary-container text-on-primary-fixed",
  dark: "bg-surface-container-highest text-primary",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 font-label-sm text-label-sm ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  ACTIVE: "green",
  PROBATION: "blue",
  LATE: "amber",
  NOTICE_PERIOD: "amber",
  EXITED: "neutral",
  PRESENT: "green",
  HALF_DAY: "amber",
  ABSENT: "red",
  ON_LEAVE: "blue",
  HOLIDAY: "lime",
  WEEKLY_OFF: "neutral",
  NOT_MARKED: "neutral",
  PENDING: "amber",
  APPROVED: "green",
  REJECTED: "red",
  CANCELLED: "neutral",
  IN_PROGRESS: "blue",
  COMPLETED: "green",
  OVERDUE: "red",
  DRAFT: "amber",
  FINALIZED: "green",
  EARNING: "green",
  DEDUCTION: "red",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONES[status] ?? "neutral"}>{humanize(status)}</Badge>;
}

export function Avatar({ name, src, size = 36 }: { name: string; src?: string | null; size?: number }) {
  const style = { width: size, height: size };
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" style={style} className="shrink-0 rounded-[50%] bg-surface-container object-cover" />;
  }
  return (
    <span
      style={{ ...style, fontSize: Math.max(11, size * 0.36) }}
      className="inline-flex shrink-0 items-center justify-center rounded-[50%] bg-surface-container-high font-semibold text-primary-fixed"
      aria-hidden="true"
    >
      {initials(name) || "?"}
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Card className="flex flex-col justify-between p-space-md transition-colors hover:bg-surface-container">
      <div className="flex items-start justify-between gap-3">
        <p className="font-code-mono text-code-mono uppercase text-on-surface-variant">{label}</p>
        {icon && <span className="text-on-surface-variant">{icon}</span>}
      </div>
      <p className="mt-space-md font-data-metric text-data-metric text-primary">{value}</p>
      {hint && <p className="mt-1 text-body-sm text-on-surface-variant">{hint}</p>}
    </Card>
  );
}

/** Label/value pairs for detail views. */
export function DetailList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="font-label-sm text-label-sm uppercase text-on-surface-variant">{item.label}</dt>
          <dd className="mt-1 text-body-md text-on-surface">{item.value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
