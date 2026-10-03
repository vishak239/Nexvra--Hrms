"use client";

import { useState, type ReactNode } from "react";
import { OvertimeTable } from "@/components/attendance/OvertimeTable";
import { PriorityBadge, TaskStatusBadge } from "@/components/tasks/TaskBadges";
import { Badge, Card, CardHeader, StatusBadge } from "@/components/ui/Display";
import { FilterSelect } from "@/components/ui/Field";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import { PAGE_SIZE, Pagination, TBody, THead, Table, Td, Th } from "@/components/ui/Table";
import { fmtDate, fmtDateTime, fmtDays, fmtMinutes, fmtTime, humanize, todayISO } from "@/lib/format";
import { useResource } from "@/lib/hooks";
import type {
  AttendanceRecord,
  BreakSession,
  EmployeeRef,
  LeaveBalanceTransaction,
  LeaveRequest,
  OvertimeSession,
  Paginated,
  SyncEventRecord,
  Task,
} from "@/lib/types";
import { fmtDuration } from "@/lib/worksession";
import { BreakTotal } from "@/components/attendance/BreakTotal";

type View = "attendance" | "breaks" | "overtime" | "tasks" | "leave" | "balance" | "sync";

const VIEWS: { value: View; label: string }[] = [
  { value: "attendance", label: "Attendance" },
  { value: "breaks", label: "Breaks" },
  { value: "overtime", label: "Overtime" },
  { value: "tasks", label: "Tasks" },
  { value: "leave", label: "Leave decisions" },
  { value: "balance", label: "Leave balance changes" },
  { value: "sync", label: "Offline synchronisation" },
];

const SOURCES: Record<View, { path: string; dateKeys: [string, string]; extra?: Record<string, string> }> = {
  attendance: { path: "/api/attendance/", dateKeys: ["date_from", "date_to"] },
  breaks: { path: "/api/attendance/breaks/", dateKeys: ["date_from", "date_to"] },
  overtime: { path: "/api/attendance/overtime/", dateKeys: ["date_from", "date_to"] },
  tasks: { path: "/api/tasks/", dateKeys: ["created_from", "created_to"] },
  leave: { path: "/api/leaves/requests/", dateKeys: ["date_from", "date_to"] },
  balance: { path: "/api/leaves/balance-transactions/", dateKeys: ["date_from", "date_to"] },
  sync: { path: "/api/attendance/sync-events/", dateKeys: ["date_from", "date_to"], extra: { channel: "OFFLINE" } },
};

function Person({ e }: { e: EmployeeRef | null }) {
  if (!e) return <span className="text-outline">—</span>;
  return (
    <>
      <span className="font-medium text-primary">{e.full_name}</span>
      <span className="ml-2 font-code-mono text-code-mono text-outline">{e.employee_code}</span>
    </>
  );
}

function Rows<T>({ head, rows, render }: { head: string[]; rows: T[]; render: (row: T) => ReactNode }) {
  return (
    <Table>
      <THead>
        {head.map((h) => (
          <Th key={h}>{h}</Th>
        ))}
      </THead>
      <TBody>{rows.map(render)}</TBody>
    </Table>
  );
}

function monthStart() {
  return `${todayISO().slice(0, 8)}01`;
}

/**
 * HR / Super Admin (and managers, for their own team) monitoring of work sessions, tasks,
 * leave and offline sync. Every list comes from the same scoped API the modules use, so a
 * manager never receives company-wide data.
 */
export function ActivityMonitor() {
  const [view, setView] = useState<View>("attendance");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());
  const [page, setPage] = useState(1);
  const source = SOURCES[view];
  const { data, error, loading, reload } = useResource<Paginated<unknown>>(source.path, {
    [source.dateKeys[0]]: from,
    [source.dateKeys[1]]: to,
    ...source.extra,
    page,
    page_size: PAGE_SIZE,
  });
  const rows = data?.results ?? [];

  let table: ReactNode = null;
  if (view === "attendance") {
    table = (
      <Rows
        head={["Employee", "Date", "Check-in", "Check-out", "Session", "Breaks", "Actual working", "Status"]}
        rows={rows as AttendanceRecord[]}
        render={(r) => (
          <tr key={r.id}>
            <Td><Person e={r.employee} /></Td>
            <Td>{fmtDate(r.date)}</Td>
            <Td>{fmtTime(r.check_in)}</Td>
            <Td>{fmtTime(r.check_out)}</Td>
            <Td>{fmtMinutes(r.session_minutes)}</Td>
            <Td><BreakTotal record={r} empty={fmtMinutes(0)} /></Td>
            <Td className="font-medium text-primary">{fmtMinutes(r.worked_minutes)}</Td>
            <Td><StatusBadge status={r.status} /></Td>
          </tr>
        )}
      />
    );
  } else if (view === "breaks") {
    table = (
      <Rows
        head={["Employee", "Date", "Break start", "Break end", "Duration", "Source"]}
        rows={rows as BreakSession[]}
        render={(b) => (
          <tr key={b.id}>
            <Td><Person e={b.employee} /></Td>
            <Td>{fmtDate(b.date)}</Td>
            <Td>{fmtTime(b.started_at)}</Td>
            <Td>{b.ended_at ? fmtTime(b.ended_at) : <Badge tone="amber">On break</Badge>}</Td>
            <Td>{fmtDuration(b.duration_seconds)}</Td>
            <Td>{b.source === "OFFLINE" ? <Badge>Offline sync</Badge> : "Online"}</Td>
          </tr>
        )}
      />
    );
  } else if (view === "overtime") {
    table = <OvertimeTable rows={rows as OvertimeSession[]} showEmployee />;
  } else if (view === "tasks") {
    table = (
      <Rows
        head={["Assigned to", "Task", "Assigned by", "Priority", "Status", "Response", "Completed"]}
        rows={rows as Task[]}
        render={(t) => (
          <tr key={t.id}>
            <Td><Person e={t.assigned_to} /></Td>
            <Td className="max-w-xs whitespace-normal font-medium text-primary">{t.title}</Td>
            <Td>{t.assigned_by?.full_name ?? "—"}</Td>
            <Td><PriorityBadge priority={t.priority} /></Td>
            <Td><TaskStatusBadge task={t} /></Td>
            <Td className="max-w-[16rem] truncate" title={t.response || undefined}>{t.response || "—"}</Td>
            <Td>{fmtDateTime(t.completed_at)}</Td>
          </tr>
        )}
      />
    );
  } else if (view === "leave") {
    table = (
      <Rows
        head={["Employee", "Leave type", "Dates", "Days", "Status", "Decided", "Deducted"]}
        rows={rows as LeaveRequest[]}
        render={(r) => (
          <tr key={r.id}>
            <Td><Person e={r.employee} /></Td>
            <Td>{r.leave_type_name}</Td>
            <Td>{fmtDate(r.start_date)} – {fmtDate(r.end_date)}</Td>
            <Td>{fmtDays(r.days)}</Td>
            <Td><StatusBadge status={r.status} /></Td>
            <Td>{r.decided_at ? `${fmtDateTime(r.decided_at)}${r.decided_by_name ? ` · ${r.decided_by_name}` : ""}` : "—"}</Td>
            <Td>{r.balance_deducted ? fmtDays(r.balance_deducted) : "—"}</Td>
          </tr>
        )}
      />
    );
  } else if (view === "balance") {
    table = (
      <Rows
        head={["Employee", "Leave type", "Year", "Change", "Before", "After", "Leave dates", "By", "When"]}
        rows={rows as LeaveBalanceTransaction[]}
        render={(t) => (
          <tr key={t.id}>
            <Td><Person e={t.employee} /></Td>
            <Td>{t.leave_type_name}</Td>
            <Td>{t.year}</Td>
            <Td className="font-medium text-error">−{fmtDays(t.days)}</Td>
            <Td>{fmtDays(t.balance_before)}</Td>
            <Td>{fmtDays(t.balance_after)}</Td>
            <Td>{fmtDate(t.leave_request.start_date)} – {fmtDate(t.leave_request.end_date)}</Td>
            <Td>{t.created_by_name ?? "—"}</Td>
            <Td>{fmtDateTime(t.created_at)}</Td>
          </tr>
        )}
      />
    );
  } else {
    table = (
      <Rows
        head={["Employee", "Event", "Happened (device)", "Received", "Status", "Error"]}
        rows={rows as SyncEventRecord[]}
        render={(e) => (
          <tr key={e.id}>
            <Td><Person e={e.employee} /></Td>
            <Td>{humanize(e.event_type)}</Td>
            <Td>{fmtDateTime(e.client_timestamp)}</Td>
            <Td>{fmtDateTime(e.received_at)}</Td>
            <Td><Badge tone={e.status === "APPLIED" ? "green" : e.status === "CONFLICT" ? "amber" : "red"}>{humanize(e.status)}</Badge></Td>
            <Td className="max-w-xs whitespace-normal text-xs text-on-surface-variant">{e.error || "—"}</Td>
          </tr>
        )}
      />
    );
  }

  return (
    <Card>
      <CardHeader
        title="Activity monitoring"
        description="Records within your access: your team for managers, the whole company for HR and Super Admin."
        actions={
          <>
            <FilterSelect label="Dataset" value={view} onChange={(e) => { setView(e.target.value as View); setPage(1); }}>
              {VIEWS.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </FilterSelect>
            <input type="date" aria-label="From" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="h-10 rounded-lg border border-surface-container-high px-2 text-sm" />
            <input type="date" aria-label="To" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="h-10 rounded-lg border border-surface-container-high px-2 text-sm" />
          </>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <SkeletonRows />
      ) : !rows.length ? (
        <EmptyState title="No records in this period" />
      ) : (
        <>
          {table}
          <Pagination page={page} pageSize={PAGE_SIZE} count={data?.count ?? 0} onPage={setPage} />
        </>
      )}
    </Card>
  );
}
