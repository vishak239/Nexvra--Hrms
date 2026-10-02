"use client";

import { Clock, LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, StatusBadge, Badge } from "@/components/ui/Display";
import { useToast } from "@/components/ui/Overlay";
import { Alert } from "@/components/ui/States";
import { api } from "@/lib/api";
import { fmtDate, fmtMinutes, fmtTime } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import type { AttendanceRecord } from "@/lib/types";

export function CheckInCard({
  date,
  record,
  enabled,
  onChange,
}: {
  date: string;
  record: AttendanceRecord | null;
  enabled: boolean;
  onChange: () => void;
}) {
  const toast = useToast();
  const { run, pending, error } = useAction();
  const checkedIn = !!record?.check_in;
  const checkedOut = !!record?.check_out;

  async function act(kind: "check-in" | "check-out") {
    const ok = await run(() => api(`/api/attendance/${kind}/`, { method: "POST" }));
    if (ok) {
      toast(kind === "check-in" ? "Checked in." : "Checked out.");
      onChange();
    }
  }

  return (
    <Card>
      <CardHeader title="Today's attendance" description={fmtDate(date)} />
      <div className="space-y-4 p-5">
        {error && <Alert>{error.message}</Alert>}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Check-in</p>
            <p className="mt-1 text-lg font-semibold text-zinc-900">{fmtTime(record?.check_in)}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Check-out</p>
            <p className="mt-1 text-lg font-semibold text-zinc-900">{fmtTime(record?.check_out)}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Worked</p>
            <p className="mt-1 text-lg font-semibold text-zinc-900">{fmtMinutes(record?.worked_minutes)}</p>
          </div>
        </div>
        {record && (
          <div className="flex flex-wrap gap-2">
            <StatusBadge status={record.status} />
            {record.is_late && <Badge tone="amber">Late</Badge>}
          </div>
        )}
        {!enabled ? (
          <Alert tone="info">Self check-in is turned off in company settings. HR records attendance.</Alert>
        ) : checkedOut ? (
          <p className="flex items-center gap-2 text-sm text-zinc-500">
            <Clock className="h-4 w-4" /> You&apos;re done for today.
          </p>
        ) : checkedIn ? (
          <Button variant="dark" icon={<LogOut className="h-4 w-4" />} loading={pending} onClick={() => act("check-out")}>
            Check out
          </Button>
        ) : (
          <Button icon={<LogIn className="h-4 w-4" />} loading={pending} onClick={() => act("check-in")}>
            Check in
          </Button>
        )}
      </div>
    </Card>
  );
}
