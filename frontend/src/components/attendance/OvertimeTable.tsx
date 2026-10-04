import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Display";
import { TBody, THead, Table, Td, Th } from "@/components/ui/Table";
import { fmtDate, fmtMinutes, fmtTime } from "@/lib/format";
import type { OvertimeSession, OvertimeStatus } from "@/lib/types";

const STATUS: Record<OvertimeStatus, { label: string; tone: "neutral" | "green" | "amber" | "red" | "blue" }> = {
  REQUESTED: { label: "Awaiting approval", tone: "amber" },
  APPROVED: { label: "Approved", tone: "green" },
  REJECTED: { label: "Rejected", tone: "red" },
  ACTIVE: { label: "Running", tone: "blue" },
  AUTO_STOPPED: { label: "Stopped — no activity", tone: "amber" },
  COMPLETED: { label: "Completed", tone: "green" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export function OvertimeStatusBadge({ session }: { session: OvertimeSession }) {
  const look = STATUS[session.status];
  return <Badge tone={look.tone}>{session.end_reason === "EXPIRED" ? "Expired" : look.label}</Badge>;
}

/** What the employee declared before the overtime (tasks or another reason + description). */
export function OvertimeDeclaration({ session }: { session: OvertimeSession }) {
  if (!session.work_description && !session.tasks.length && !session.other_reason) {
    return <span className="text-outline">—</span>;
  }
  return (
    <div className="max-w-md whitespace-normal">
      {session.tasks.length > 0 && <p className="text-body-sm text-on-surface-variant">Tasks: {session.tasks.map((t) => t.title).join(", ")}</p>}
      {session.other_reason && <p className="text-body-sm text-on-surface-variant">Other: {session.other_reason}</p>}
      {session.work_description && <p className="text-on-surface">{session.work_description}</p>}
    </div>
  );
}

export function OvertimeTable({
  rows,
  showEmployee,
  showDeclaration = false,
  actions,
}: {
  rows: OvertimeSession[];
  showEmployee: boolean;
  showDeclaration?: boolean;
  actions?: (session: OvertimeSession) => ReactNode;
}) {
  return (
    <Table>
      <THead>
        {showEmployee && <Th>Employee</Th>}
        <Th>Date</Th>
        {showDeclaration && <Th>Declared work</Th>}
        <Th>Start</Th>
        <Th>End</Th>
        <Th>Duration</Th>
        <Th>Status</Th>
        {actions && <Th className="text-right">Actions</Th>}
      </THead>
      <TBody>
        {rows.map((o) => (
          <tr key={o.id}>
            {showEmployee && (
              <Td>
                <span className="font-medium text-primary">{o.employee.full_name}</span>
                <span className="ml-2 font-code-mono text-code-mono text-outline">{o.employee.employee_code}</span>
              </Td>
            )}
            <Td>{fmtDate(o.date)}</Td>
            {showDeclaration && (
              <Td>
                <OvertimeDeclaration session={o} />
              </Td>
            )}
            <Td>{fmtTime(o.started_at)}</Td>
            <Td>{fmtTime(o.ended_at)}</Td>
            <Td>
              {o.status === "ACTIVE" ? "Running" : o.duration_seconds !== null ? fmtMinutes(Math.floor(o.duration_seconds / 60)) : "—"}
            </Td>
            <Td>
              <div className="flex flex-wrap gap-1.5">
                <OvertimeStatusBadge session={o} />
                {o.source === "OFFLINE" && <Badge>Synced offline</Badge>}
              </div>
              {o.decided_by_name && (
                <p className="mt-1 text-body-sm text-on-surface-variant">
                  {o.status === "REJECTED" ? "Rejected" : "Approved"} by {o.decided_by_name}
                  {o.decision_note ? ` — ${o.decision_note}` : ""}
                </p>
              )}
            </Td>
            {actions && <Td className="text-right">{actions(o)}</Td>}
          </tr>
        ))}
      </TBody>
    </Table>
  );
}
