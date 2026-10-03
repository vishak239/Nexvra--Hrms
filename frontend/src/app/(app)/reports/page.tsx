"use client";

import { ActivityMonitor } from "@/components/reports/ActivityMonitor";
import { Download } from "@/components/ui/icons";
import { useState } from "react";
import { RequirePermission } from "@/components/layout/AppShell";
import { Card, CardHeader, PageHeader, StatCard, StatusBadge } from "@/components/ui/Display";
import { FilterSelect } from "@/components/ui/Field";
import { Tabs } from "@/components/ui/Overlay";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import { TBody, THead, Table, Td, Th } from "@/components/ui/Table";
import { buttonClass } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth";
import { fmtDays, fmtMoney, fmtPeriod, humanize, todayISO } from "@/lib/format";
import { useResource } from "@/lib/hooks";
import type { Department, Paginated, PayrollRun } from "@/lib/types";

type Tab = "headcount" | "attendance" | "leave" | "payroll" | "monitoring";
type Group = { key: string | number | null; label: string | null; count: number };

function csvHref(path: string, params: Record<string, string>) {
  const q = new URLSearchParams({ ...params, export: "csv" });
  return `${path}?${q}`;
}

function ExportLink({ href }: { href: string }) {
  return (
    <a href={href} className={buttonClass("secondary", "sm")}>
      <Download className="h-4 w-4" /> Export CSV
    </a>
  );
}

function Bars({ rows, enumLabels = false }: { rows: Group[]; enumLabels?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (rows.length === 0) return <EmptyState title="No data" />;
  return (
    <ul className="space-y-3 p-5">
      {rows.map((r) => (
        <li key={String(r.key)}>
          <div className="mb-1 flex justify-between text-sm">
            <span className="text-on-surface">{r.label ? (enumLabels ? humanize(String(r.label)) : r.label) : "Unassigned"}</span>
            <span className="font-medium tabular-nums text-primary">{r.count}</span>
          </div>
          <div className="h-2 rounded-full bg-surface-container-high">
            <div className="h-2 rounded-full bg-primary-container" style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Headcount() {
  const { data, error, loading, reload } = useResource<{
    total_current: number;
    by_status: Group[];
    by_department: Group[];
    by_employment_type: Group[];
  }>("/api/reports/headcount/");
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading || !data) return <SkeletonRows />;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <StatCard label="Current employees" value={data.total_current} hint="Excludes exited employees" />
        <ExportLink href={csvHref("/api/reports/headcount/", {})} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="By department" />
          <Bars rows={data.by_department} />
        </Card>
        <Card>
          <CardHeader title="By employment type" />
          <Bars rows={data.by_employment_type} enumLabels />
        </Card>
        <Card>
          <CardHeader title="By status" description="Includes exited" />
          <Bars rows={data.by_status} enumLabels />
        </Card>
      </div>
    </div>
  );
}

type AttendanceRow = {
  employee_id: number;
  employee_code: string;
  full_name: string;
  department: string | null;
  present: number;
  half_day: number;
  absent: number;
  late: number;
  on_leave: number;
  holiday: number;
  weekly_off: number;
  not_marked: number;
};

function AttendanceSummary() {
  const [from, setFrom] = useState(`${todayISO().slice(0, 8)}01`);
  const [to, setTo] = useState(todayISO());
  const [department, setDepartment] = useState("");
  const departments = useResource<Paginated<Department>>("/api/departments/", { page_size: 100 });
  const { data, error, loading, reload } = useResource<{ results: AttendanceRow[] }>("/api/reports/attendance-summary/", {
    date_from: from,
    date_to: to,
    department,
  });
  const cols: [keyof AttendanceRow, string][] = [
    ["present", "Present"],
    ["half_day", "Half day"],
    ["absent", "Absent"],
    ["late", "Late"],
    ["on_leave", "On leave"],
    ["holiday", "Holiday"],
    ["weekly_off", "Weekly off"],
    ["not_marked", "Not marked"],
  ];
  return (
    <Card>
      <CardHeader
        title="Attendance summary"
        description="Up to 93 days. Absence is counted only when working days are configured."
        actions={
          <>
            <input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-lg border border-surface-container-high px-2 text-sm" />
            <input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-lg border border-surface-container-high px-2 text-sm" />
            <FilterSelect label="Department" value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">All departments</option>
              {departments.data?.results.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </FilterSelect>
            <ExportLink href={csvHref("/api/reports/attendance-summary/", { date_from: from, date_to: to, department })} />
          </>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <SkeletonRows />
      ) : !data?.results.length ? (
        <EmptyState title="No employees in scope" />
      ) : (
        <Table>
          <THead>
            <Th>Employee</Th>
            <Th>Department</Th>
            {cols.map(([, label]) => (
              <Th key={label} className="text-right">
                {label}
              </Th>
            ))}
          </THead>
          <TBody>
            {data.results.map((r) => (
              <tr key={r.employee_id}>
                <Td>
                  <span className="font-medium text-primary">{r.full_name}</span>
                  <span className="ml-2 font-code-mono text-code-mono text-outline">{r.employee_code}</span>
                </Td>
                <Td>{r.department ?? "—"}</Td>
                {cols.map(([key]) => (
                  <Td key={key} className="text-right tabular-nums">
                    {r[key] as number}
                  </Td>
                ))}
              </tr>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

function LeaveSummary() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(String(thisYear));
  const { data, error, loading, reload } = useResource<{
    by_type: { leave_type: string; requests: Record<string, number>; approved_days: string }[];
    approved_by_employee: { employee_id: number; employee_code: string; full_name: string; leave_type: string; days: string }[];
  }>("/api/reports/leave-summary/", { year });
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Leave by type"
          actions={
            <>
              <FilterSelect label="Year" value={year} onChange={(e) => setYear(e.target.value)}>
                {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </FilterSelect>
              <ExportLink href={csvHref("/api/reports/leave-summary/", { year })} />
            </>
          }
        />
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <SkeletonRows />
        ) : !data?.by_type.length ? (
          <EmptyState title="No leave requests for this year" />
        ) : (
          <Table>
            <THead>
              <Th>Leave type</Th>
              {["PENDING", "APPROVED", "REJECTED", "CANCELLED"].map((s) => (
                <Th key={s} className="text-right">
                  {humanize(s)}
                </Th>
              ))}
              <Th className="text-right">Approved days</Th>
            </THead>
            <TBody>
              {data.by_type.map((t) => (
                <tr key={t.leave_type}>
                  <Td className="font-medium text-primary">{t.leave_type}</Td>
                  {["PENDING", "APPROVED", "REJECTED", "CANCELLED"].map((s) => (
                    <Td key={s} className="text-right tabular-nums">
                      {t.requests[s] ?? 0}
                    </Td>
                  ))}
                  <Td className="text-right font-medium tabular-nums">{fmtDays(t.approved_days)}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {data && data.approved_by_employee.length > 0 && (
        <Card>
          <CardHeader title="Approved leave by employee" />
          <Table>
            <THead>
              <Th>Employee</Th>
              <Th>Leave type</Th>
              <Th className="text-right">Days</Th>
            </THead>
            <TBody>
              {data.approved_by_employee.map((r) => (
                <tr key={`${r.employee_id}-${r.leave_type}`}>
                  <Td className="font-medium text-primary">{r.full_name}</Td>
                  <Td>{r.leave_type}</Td>
                  <Td className="text-right tabular-nums">{fmtDays(r.days)}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function PayrollSummary() {
  const runs = useResource<Paginated<PayrollRun>>("/api/payroll/runs/", { page_size: 24 });
  const [run, setRun] = useState("");
  const { data, error, loading, reload } = useResource<{
    run: number | null;
    year?: number;
    month?: number;
    status?: string;
    currency?: string;
    payslips?: number;
    gross_earnings?: string;
    total_deductions?: string;
    net_pay?: string;
    by_department?: { department: string | null; count: number; gross: string; net: string }[];
  }>("/api/reports/payroll-summary/", { run });

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !data) return <SkeletonRows />;
  if (!data || data.run === null) return <Card><EmptyState title="No payroll runs yet" /></Card>;
  const currency = data.currency ?? "";
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterSelect label="Payroll run" value={run || String(data.run)} onChange={(e) => setRun(e.target.value)}>
          {runs.data?.results.map((r) => (
            <option key={r.id} value={r.id}>
              {fmtPeriod(r.year, r.month)} ({humanize(r.status)})
            </option>
          ))}
        </FilterSelect>
        <ExportLink href={csvHref("/api/reports/payroll-summary/", { run: run || String(data.run) })} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Period" value={data.year && data.month ? fmtPeriod(data.year, data.month) : "—"} hint={data.status && <StatusBadge status={data.status} />} />
        <StatCard label="Payslips" value={data.payslips ?? 0} />
        <StatCard label="Gross earnings" value={fmtMoney(data.gross_earnings, currency)} />
        <StatCard label="Net pay" value={fmtMoney(data.net_pay, currency)} hint={`Deductions ${fmtMoney(data.total_deductions, currency)}`} />
      </div>
      <Card>
        <CardHeader title="By department" />
        {!data.by_department?.length ? (
          <EmptyState title="No payslips in this run" />
        ) : (
          <Table>
            <THead>
              <Th>Department</Th>
              <Th className="text-right">Payslips</Th>
              <Th className="text-right">Gross</Th>
              <Th className="text-right">Net</Th>
            </THead>
            <TBody>
              {data.by_department.map((r) => (
                <tr key={r.department ?? "none"}>
                  <Td className="font-medium text-primary">{r.department ?? "Unassigned"}</Td>
                  <Td className="text-right tabular-nums">{r.count}</Td>
                  <Td className="text-right tabular-nums">{fmtMoney(r.gross, currency)}</Td>
                  <Td className="text-right tabular-nums">{fmtMoney(r.net, currency)}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function ReportsContent() {
  const { can } = useAuth();
  const tabs = [
    { value: "headcount" as Tab, label: "Headcount" },
    { value: "attendance" as Tab, label: "Attendance" },
    { value: "leave" as Tab, label: "Leave" },
    ...(can("payroll.view_all") ? [{ value: "payroll" as Tab, label: "Payroll" }] : []),
    { value: "monitoring" as Tab, label: "Activity monitoring" },
  ];
  const [tab, setTab] = useState<Tab>("headcount");
  return (
    <>
      <PageHeader
        title="Reports"
        description={can("reports.view_all") ? "Company-wide HR reports." : "Reports for you and your direct reports."}
      />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "headcount" && <Headcount />}
      {tab === "attendance" && <AttendanceSummary />}
      {tab === "leave" && <LeaveSummary />}
      {tab === "payroll" && <PayrollSummary />}
      {tab === "monitoring" && <ActivityMonitor />}
    </>
  );
}

export default function ReportsPage() {
  return (
    <RequirePermission perms={["reports.view_team", "reports.view_all"]}>
      <ReportsContent />
    </RequirePermission>
  );
}
