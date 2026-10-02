import { Badge } from "@/components/ui/Display";
import { TBody, THead, Table, Td, Th } from "@/components/ui/Table";
import { fmtDate, fmtMinutes, fmtTime } from "@/lib/format";
import type { OvertimeSession } from "@/lib/types";

export function OvertimeTable({ rows, showEmployee }: { rows: OvertimeSession[]; showEmployee: boolean }) {
  return (
    <Table>
      <THead>
        {showEmployee && <Th>Employee</Th>}
        <Th>Date</Th>
        <Th>Start</Th>
        <Th>End</Th>
        <Th>Duration</Th>
        <Th>Status</Th>
      </THead>
      <TBody>
        {rows.map((o) => (
          <tr key={o.id}>
            {showEmployee && (
              <Td>
                <span className="font-medium text-zinc-900">{o.employee.full_name}</span>
                <span className="ml-2 font-mono text-xs text-zinc-400">{o.employee.employee_code}</span>
              </Td>
            )}
            <Td>{fmtDate(o.date)}</Td>
            <Td>{fmtTime(o.started_at)}</Td>
            <Td>{fmtTime(o.ended_at)}</Td>
            <Td>{o.duration_seconds !== null ? fmtMinutes(Math.floor(o.duration_seconds / 60)) : "Running"}</Td>
            <Td>
              <div className="flex gap-1.5">
                <Badge tone={o.status === "ACTIVE" ? "blue" : "green"}>{o.status === "ACTIVE" ? "Running" : "Completed"}</Badge>
                {o.source === "OFFLINE" && <Badge>Synced offline</Badge>}
              </div>
            </Td>
          </tr>
        ))}
      </TBody>
    </Table>
  );
}
