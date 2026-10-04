"use client";

import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/Display";
import { ErrorState, SkeletonRows } from "@/components/ui/States";
import { Can } from "@/lib/auth";
import { useResource } from "@/lib/hooks";
import type { CompanySettings } from "@/lib/types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function workingDays(days: number[] | null) {
  if (!days?.length) return null;
  const sorted = [...days].sort((a, b) => a - b);
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  return contiguous && sorted.length > 2 ? `${DAYS[sorted[0]]} – ${DAYS[sorted[sorted.length - 1]]}` : sorted.map((d) => DAYS[d]).join(", ");
}

const hhmm = (t: string | null) => t?.slice(0, 5) ?? null;

/**
 * The rules the system enforces, read live from Settings (the single source of truth), so
 * the policy page never repeats a value that could drift. Empty = not specified, not applied.
 */
export function SystemRules() {
  const { data: s, error, loading, reload } = useResource<CompanySettings>("/api/settings/");

  const rules = s
    ? [
        { label: "Working days", value: workingDays(s.working_days) },
        {
          label: "Working hours",
          value: s.work_start_time && s.work_end_time ? `${hhmm(s.work_start_time)} – ${hhmm(s.work_end_time)}` : hhmm(s.work_start_time) && `From ${hhmm(s.work_start_time)}`,
        },
        { label: "Late after", value: s.late_grace_minutes != null && s.work_start_time ? `${s.late_grace_minutes} min grace` : null },
        { label: "Daily break allowance", value: s.break_allowance_minutes ? `${s.break_allowance_minutes} min` : null },
        {
          label: "Office check-in area",
          value: s.workplace_latitude && s.workplace_longitude ? `Within ${s.geofence_radius_m} m of the workplace` : null,
        },
        { label: "Inactivity limit", value: s.inactivity_timeout_minutes ? `${s.inactivity_timeout_minutes} min` : null },
        { label: "Overtime", value: s.overtime_requires_approval ? "Needs HR approval" : "Starts on declaration" },
        {
          label: "Half day / full day",
          value: s.half_day_min_hours && s.full_day_min_hours ? `${Number(s.half_day_min_hours)} h / ${Number(s.full_day_min_hours)} h` : null,
        },
        { label: "Leave year starts", value: MONTHS[(s.leave_year_start_month ?? 1) - 1] },
        { label: "Self check-in", value: s.self_attendance_enabled ? "Allowed" : "HR records attendance" },
      ]
    : [];

  return (
    <Card>
      <CardHeader
        title="Rules applied by the system"
        description="Set by HR in Settings and enforced automatically. “Not set” means the rule is not applied."
        actions={
          <Can perm="settings.manage">
            <Link href="/settings" className="text-label-lg font-medium text-primary-fixed hover:underline">
              Edit in Settings →
            </Link>
          </Can>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !s ? (
        <SkeletonRows rows={3} />
      ) : (
        <dl className="grid grid-cols-1 gap-space-sm p-space-lg sm:grid-cols-2 xl:grid-cols-4">
          {rules.map((r) => (
            <div key={r.label} className="rounded-lg bg-surface-container p-3">
              <dt className="font-label-sm text-label-sm uppercase text-on-surface-variant">{r.label}</dt>
              <dd className={`mt-1 font-headline-sm text-headline-sm ${r.value ? "text-primary" : "text-outline"}`}>{r.value ?? "Not set"}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}
