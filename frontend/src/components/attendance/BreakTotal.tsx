import { Badge } from "@/components/ui/Display";
import { fmtMinutes } from "@/lib/format";
import type { AttendanceRecord } from "@/lib/types";

/** Break time for a day, flagged when it exceeds the configured daily break allowance. */
export function BreakTotal({ record, empty = "—" }: { record: AttendanceRecord; empty?: string }) {
  const over = record.break_over_allowance_minutes ?? 0;
  return (
    <span className="inline-flex items-center gap-2">
      {record.break_minutes ? fmtMinutes(record.break_minutes) : empty}
      {over > 0 && <Badge tone="amber">+{fmtMinutes(over)} over allowance</Badge>}
    </span>
  );
}
