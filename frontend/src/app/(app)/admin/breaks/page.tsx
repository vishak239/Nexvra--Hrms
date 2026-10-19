"use client";

import { Clock, Timer, Users } from "@/components/ui/icons";
import { useEffect, useState } from "react";
import { RequirePermission } from "@/components/layout/AppShell";
import { Card, PageHeader } from "@/components/ui/Display";
import { FilterSelect, SearchInput } from "@/components/ui/Field";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import { PAGE_SIZE, Pagination, TBody, THead, Table, Td, Th } from "@/components/ui/Table";
import { fmtDateTime, fmtMinutes, humanize } from "@/lib/format";
import { useResource } from "@/lib/hooks";
import type { BreakSession, Paginated } from "@/lib/types";

function elapsedSeconds(startedAt: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
}

function formatElapsed(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

type StatusFilter = "ALL" | "ACTIVE" | "COMPLETED";

function BreakContent() {
  const [employee, setEmployee] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [_tick, setTick] = useState(0);

  const { data, error, loading, reload } = useResource<Paginated<BreakSession>>("/api/attendance/breaks/", {
    employee: employee || undefined,
    status: status === "ALL" ? undefined : status,
    date_from: from || undefined,
    date_to: to || undefined,
    page,
    page_size: PAGE_SIZE,
    ordering: "-started_at",
  });

  // Re-render every second so the live elapsed timer (computed from the server-side started_at) ticks.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const results = data?.results ?? [];
  const active = results.filter((b) => b.status === "ACTIVE");

  return (
    <>
      <PageHeader
        title="Break monitoring"
        description="Employees currently on break and historical break records. Times are shown in India time."
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-surface-container-high/40 p-4 sm:flex-row sm:items-center sm:gap-4">
          <SearchInput
            label="Search employee"
            value={employee}
            onChange={(e) => { setEmployee(e.target.value); setPage(1); }}
          />
          <FilterSelect
            label="Status"
            aria-label="Break status"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
          >
            <option value="ALL">All</option>
            <option value="ACTIVE">Active (on break now)</option>
            <option value="COMPLETED">Completed</option>
          </FilterSelect>
          <input
            type="date"
            aria-label="From"
            value={from}
            onChange={(e) => { setFrom(e.target.value); setPage(1); }}
            className="h-10 rounded-lg border border-surface-container-high px-2 text-sm"
          />
          <input
            type="date"
            aria-label="To"
            value={to}
            onChange={(e) => { setTo(e.target.value); setPage(1); }}
            className="h-10 rounded-lg border border-surface-container-high px-2 text-sm"
          />
        </div>

        {/* Currently on break */}
        <div className="p-4">
          <div className="flex items-center gap-2 mb-3"><Timer className="h-5 w-5" /><span className="font-semibold text-label-sm uppercase tracking-wider text-on-surface-variant">Currently on break</span></div>
          {active.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant">No employees are currently on break.</p>
          ) : (
            <div className="space-y-1.5">
              {active.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-surface-container-high bg-surface-container-low">
                  <div className="min-w-0 flex-1">
                    <p className="text-body-sm font-medium text-on-surface truncate">{b.employee?.full_name ?? "—"}</p>
                    <p className="text-body-sm text-on-surface-variant">{b.employee?.employee_code ?? ""}</p>
                  </div>
                  <div className="text-right hidden sm:block">
                    <p className="text-body-sm text-on-surface-variant">{fmtDateTime(b.started_at)}</p>
                    <p className="font-mono text-code-mono text-primary">{formatElapsed(elapsedSeconds(b.started_at))}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* History */}
        <div className="p-4">
          <div className="flex items-center gap-2 mb-3"><Clock className="h-5 w-5" /><span className="font-semibold text-label-sm uppercase tracking-wider text-on-surface-variant">Break history</span></div>
          {error ? (
            <ErrorState error={error} onRetry={reload} />
          ) : loading && !data ? (
            <SkeletonRows />
          ) : !results.length ? (
            <EmptyState icon={<Users className="h-5 w-5" />} title="No break records match" />
          ) : (
            <>
              <Table>
                <THead>
                  <tr>
                    <Th>Employee</Th>
                    <Th>Date</Th>
                    <Th>Started</Th>
                    <Th>Ended</Th>
                    <Th>Duration</Th>
                    <Th>Status</Th>
                  </tr>
                </THead>
                <TBody>
                  {results.map((b) => (
                    <tr key={b.id} className={b.status === "ACTIVE" ? "bg-primary-container/10" : ""}>
                      <Td>{b.employee?.full_name ?? "—"}</Td>
                      <Td className="font-code-mono text-code-mono text-on-surface-variant">{b.date}</Td>
                      <Td>{fmtDateTime(b.started_at)}</Td>
                      <Td>{b.ended_at ? fmtDateTime(b.ended_at) : <span className="text-outline">—</span>}</Td>
                      <Td className="font-mono text-code-mono text-on-surface-variant">
                        {b.duration_seconds != null ? fmtMinutes(b.duration_seconds) : <span className="text-outline">ongoing</span>}
                      </Td>
                      <Td>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                            b.status === "ACTIVE"
                              ? "border-primary-container bg-primary-container/20 text-primary"
                              : "border-surface-container-high bg-surface-container-low text-on-surface-variant"
                          }`}
                        >
                          {humanize(b.status)}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </TBody>
              </Table>
              <Pagination page={page} pageSize={PAGE_SIZE} count={data?.count ?? 0} onPage={setPage} />
            </>
          )}
        </div>
      </Card>
    </>
  );
}

export default function BreaksPage() {
  return (
    <RequirePermission perms={["attendance.view_team", "attendance.view_all"]}>
      <BreakContent />
    </RequirePermission>
  );
}
