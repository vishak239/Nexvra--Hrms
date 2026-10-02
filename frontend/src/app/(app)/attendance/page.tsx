"use client";

import { CalendarCheck, Pencil, Plus, Trash2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { OvertimeTable } from "@/components/attendance/OvertimeTable";
import { WorkSessionCard } from "@/components/attendance/WorkSessionCard";
import { Button } from "@/components/ui/Button";
import { Badge, Card, CardHeader, PageHeader, StatusBadge } from "@/components/ui/Display";
import { FilterSelect, SelectField, TextField } from "@/components/ui/Field";
import { ConfirmDialog, Modal, Tabs, useToast } from "@/components/ui/Overlay";
import { EmptyState, ErrorState, FormError, Loading, NoAccess, SkeletonRows } from "@/components/ui/States";
import { PAGE_SIZE, Pagination, TBody, THead, Table, Td, Th } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDate, fmtMinutes, fmtTime, humanize, todayISO } from "@/lib/format";
import { tryApi, useAction, useResource } from "@/lib/hooks";
import type { AttendanceRecord, Department, Employee, EmployeeRef, OvertimeSession, Paginated } from "@/lib/types";

type Tab = "mine" | "daily" | "records";

function monthStart() {
  return `${todayISO().slice(0, 8)}01`;
}

function RecordsTable({
  records,
  showEmployee,
  onEdit,
  onDelete,
}: {
  records: AttendanceRecord[];
  showEmployee: boolean;
  onEdit?: (r: AttendanceRecord) => void;
  onDelete?: (r: AttendanceRecord) => void;
}) {
  return (
    <Table>
      <THead>
        {showEmployee && <Th>Employee</Th>}
        <Th>Date</Th>
        <Th>Check-in</Th>
        <Th>Check-out</Th>
        <Th>Breaks</Th>
        <Th>Worked</Th>
        <Th>Status</Th>
        <Th>Source</Th>
        {(onEdit || onDelete) && <Th className="text-right">Actions</Th>}
      </THead>
      <TBody>
        {records.map((r) => (
          <tr key={r.id}>
            {showEmployee && (
              <Td>
                <span className="font-medium text-zinc-900">{r.employee.full_name}</span>
                <span className="ml-2 font-mono text-xs text-zinc-400">{r.employee.employee_code}</span>
              </Td>
            )}
            <Td>{fmtDate(r.date)}</Td>
            <Td>{fmtTime(r.check_in)}</Td>
            <Td>{fmtTime(r.check_out)}</Td>
            <Td>{r.break_minutes ? fmtMinutes(r.break_minutes) : "—"}</Td>
            <Td>{fmtMinutes(r.worked_minutes)}</Td>
            <Td>
              <div className="flex gap-1.5">
                <StatusBadge status={r.status} />
                {r.is_late && <Badge tone="amber">Late</Badge>}
              </div>
            </Td>
            <Td>
              <span title={r.remarks || undefined}>{r.source === "ADMIN" ? "HR" : "Self"}</span>
            </Td>
            {(onEdit || onDelete) && (
              <Td className="text-right">
                <div className="flex justify-end gap-1">
                  {onEdit && (
                    <button onClick={() => onEdit(r)} className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900" aria-label={`Edit record for ${r.employee.full_name} on ${r.date}`}>
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  {onDelete && (
                    <button onClick={() => onDelete(r)} className="rounded-md p-1.5 text-zinc-500 hover:bg-red-50 hover:text-red-600" aria-label={`Delete record for ${r.employee.full_name} on ${r.date}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </Td>
            )}
          </tr>
        ))}
      </TBody>
    </Table>
  );
}

function MyAttendance({ employeeId }: { employeeId: number }) {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());
  const [page, setPage] = useState(1);
  const history = useResource<Paginated<AttendanceRecord>>("/api/attendance/", {
    employee: employeeId,
    date_from: from,
    date_to: to,
    page,
    page_size: PAGE_SIZE,
  });

  return (
    <div className="space-y-6">
      <WorkSessionCard onChange={history.reload} />
      <MyOvertime />
      <Card>
        <CardHeader
          title="My history"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" aria-label="From" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="h-9 rounded-lg border border-zinc-300 px-2 text-sm" />
              <span className="text-sm text-zinc-400">to</span>
              <input type="date" aria-label="To" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="h-9 rounded-lg border border-zinc-300 px-2 text-sm" />
            </div>
          }
        />
        {history.error ? (
          <ErrorState error={history.error} onRetry={history.reload} />
        ) : history.loading && !history.data ? (
          <SkeletonRows />
        ) : !history.data?.results.length ? (
          <EmptyState icon={<CalendarCheck className="h-5 w-5" />} title="No attendance records in this period" />
        ) : (
          <>
            <RecordsTable records={history.data.results} showEmployee={false} />
            <Pagination page={page} pageSize={PAGE_SIZE} count={history.data.count} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}

function MyOvertime() {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useResource<Paginated<OvertimeSession>>("/api/attendance/overtime/", {
    page,
    page_size: 10,
  });
  if (!loading && !error && !data?.count) return null;
  return (
    <Card>
      <CardHeader title="My overtime" description="Recorded separately from normal working hours." />
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <SkeletonRows rows={2} />
      ) : (
        <>
          <OvertimeTable rows={data?.results ?? []} showEmployee={false} />
          <Pagination page={page} pageSize={10} count={data?.count ?? 0} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

function DailyStatus() {
  const [date, setDate] = useState(todayISO());
  const [department, setDepartment] = useState("");
  const departments = useResource<Paginated<Department>>("/api/departments/", { page_size: 100 });
  const { data, error, loading, reload } = useResource<{
    date: string;
    results: { employee: EmployeeRef; status: string; record: AttendanceRecord | null }[];
  }>("/api/attendance/daily/", { date, department });

  const counts = (data?.results ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Card>
      <CardHeader
        title="Daily status"
        description="Combines check-ins, approved leave, holidays and configured working days."
        actions={
          <>
            <input type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 rounded-lg border border-zinc-300 px-2 text-sm" />
            <FilterSelect label="Department" value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">All departments</option>
              {departments.data?.results.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </FilterSelect>
          </>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <SkeletonRows />
      ) : !data?.results.length ? (
        <EmptyState title="No one to show for this date" />
      ) : (
        <>
          <div className="flex flex-wrap gap-2 border-b border-zinc-100 px-5 py-3">
            {Object.entries(counts).map(([status, n]) => (
              <span key={status} className="inline-flex items-center gap-1.5 text-sm text-zinc-600">
                <StatusBadge status={status} /> {n}
              </span>
            ))}
          </div>
          <Table>
            <THead>
              <Th>Employee</Th>
              <Th>Status</Th>
              <Th>Check-in</Th>
              <Th>Check-out</Th>
              <Th>Worked</Th>
            </THead>
            <TBody>
              {data.results.map((r) => (
                <tr key={r.employee.id}>
                  <Td>
                    <span className="font-medium text-zinc-900">{r.employee.full_name}</span>
                    <span className="ml-2 font-mono text-xs text-zinc-400">{r.employee.employee_code}</span>
                  </Td>
                  <Td>
                    <div className="flex gap-1.5">
                      <StatusBadge status={r.status} />
                      {r.record?.is_late && <Badge tone="amber">Late</Badge>}
                    </div>
                  </Td>
                  <Td>{fmtTime(r.record?.check_in)}</Td>
                  <Td>{fmtTime(r.record?.check_out)}</Td>
                  <Td>{fmtMinutes(r.record?.worked_minutes)}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
        </>
      )}
    </Card>
  );
}

function toISO(date: string, time: string) {
  return time ? new Date(`${date}T${time}`).toISOString() : null;
}
function toLocalTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function RecordModal({
  open,
  record,
  onClose,
  onSaved,
}: {
  open: boolean;
  record: AttendanceRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const people = useResource<Paginated<Employee>>(open && !record ? "/api/employees/" : null, {
    page_size: 100,
    employment_status: "ACTIVE",
  });
  const [form, setForm] = useState({ employee: "", date: todayISO(), check_in: "", check_out: "", status: "", remarks: "" });
  const { run, pending, error, setError } = useAction();

  useEffect(() => {
    if (!open) return;
    setError(undefined);
    setForm(
      record
        ? {
            employee: String(record.employee.id),
            date: record.date,
            check_in: toLocalTime(record.check_in),
            check_out: toLocalTime(record.check_out),
            status: record.status,
            remarks: record.remarks,
          }
        : { employee: "", date: todayISO(), check_in: "", check_out: "", status: "", remarks: "" },
    );
  }, [open, record, setError]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {
      date: form.date,
      check_in: toISO(form.date, form.check_in),
      check_out: toISO(form.date, form.check_out),
      remarks: form.remarks,
    };
    if (form.status) body.status = form.status;
    if (!record) body.employee = Number(form.employee);
    const ok = await run(() =>
      api(record ? `/api/attendance/${record.id}/` : "/api/attendance/", { method: record ? "PATCH" : "POST", body }),
    );
    if (ok) {
      toast(record ? "Attendance updated." : "Attendance recorded.");
      onSaved();
    }
  }
  const f = error?.fields ?? {};

  return (
    <Modal
      open={open}
      title={record ? "Correct attendance" : "Record attendance"}
      description="Changes are recorded in the audit log."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="attendance-form" loading={pending}>
            Save
          </Button>
        </>
      }
    >
      <form id="attendance-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError error={error} />
        {record ? (
          <p className="text-sm text-zinc-600">
            <span className="font-medium text-zinc-900">{record.employee.full_name}</span> · {fmtDate(record.date)}
          </p>
        ) : (
          <>
            <SelectField label="Employee" value={form.employee} onChange={(e) => setForm({ ...form, employee: e.target.value })} error={f.employee} required>
              <option value="">Select an employee</option>
              {people.data?.results.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name} ({p.employee_code})
                </option>
              ))}
            </SelectField>
            <TextField label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} error={f.date} required />
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Check-in" type="time" value={form.check_in} onChange={(e) => setForm({ ...form, check_in: e.target.value })} error={f.check_in} />
          <TextField label="Check-out" type="time" value={form.check_out} onChange={(e) => setForm({ ...form, check_out: e.target.value })} error={f.check_out} />
        </div>
        <SelectField
          label="Status"
          value={form.status}
          onChange={(e) => setForm({ ...form, status: e.target.value })}
          error={f.status}
          hint="Automatic uses the configured attendance rules."
        >
          <option value="">Automatic</option>
          {["PRESENT", "HALF_DAY", "ABSENT"].map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </SelectField>
        <TextField label="Remarks" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} error={f.remarks} />
      </form>
    </Modal>
  );
}

function AllRecords() {
  const { can } = useAuth();
  const toast = useToast();
  const manage = can("attendance.manage");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayISO());
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<AttendanceRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<AttendanceRecord | null>(null);
  const [deletingPending, setDeletingPending] = useState(false);
  const attempt = async <T,>(fn: () => Promise<T>) => {
    setDeletingPending(true);
    try {
      return await tryApi(fn);
    } finally {
      setDeletingPending(false);
    }
  };
  const { data, error, loading, reload } = useResource<Paginated<AttendanceRecord>>("/api/attendance/", {
    date_from: from,
    date_to: to,
    status,
    page,
    page_size: PAGE_SIZE,
  });

  return (
    <Card>
      <CardHeader
        title="Attendance records"
        actions={
          <>
            <input type="date" aria-label="From" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="h-9 rounded-lg border border-zinc-300 px-2 text-sm" />
            <input type="date" aria-label="To" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="h-9 rounded-lg border border-zinc-300 px-2 text-sm" />
            <FilterSelect label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">All statuses</option>
              {["PRESENT", "HALF_DAY", "ABSENT"].map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </FilterSelect>
            {manage && (
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                Record attendance
              </Button>
            )}
          </>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <SkeletonRows />
      ) : !data?.results.length ? (
        <EmptyState icon={<CalendarCheck className="h-5 w-5" />} title="No records in this period" />
      ) : (
        <>
          <RecordsTable
            records={data.results}
            showEmployee
            onEdit={manage ? setEditing : undefined}
            onDelete={manage ? setDeleting : undefined}
          />
          <Pagination page={page} pageSize={PAGE_SIZE} count={data.count} onPage={setPage} />
        </>
      )}

      <RecordModal
        open={creating || !!editing}
        record={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          reload();
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Delete attendance record?"
        message={deleting ? `This removes ${deleting.employee.full_name}'s record for ${fmtDate(deleting.date)}. The deletion is audited.` : ""}
        confirmLabel="Delete"
        danger
        pending={deletingPending}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const result = await attempt(() => api(`/api/attendance/${deleting.id}/`, { method: "DELETE" }));
          toast(result.ok ? "Record deleted." : result.error.message, result.ok ? "success" : "error");
          setDeleting(null);
          reload();
        }}
      />
    </Card>
  );
}

function AttendanceContent() {
  const { me, can } = useAuth();
  const params = useSearchParams();
  const hasSelf = can("attendance.self") && !!me?.employee;
  const hasTeam = can("attendance.view_team", "attendance.view_all");
  const tabs = [
    ...(hasSelf ? [{ value: "mine" as Tab, label: "My attendance" }] : []),
    ...(hasTeam ? [{ value: "daily" as Tab, label: can("attendance.view_all") ? "Daily status" : "Team today" }] : []),
    ...(hasTeam ? [{ value: "records" as Tab, label: "Records" }] : []),
  ];
  const requested = params.get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(tabs.find((t) => t.value === requested)?.value ?? tabs[0]?.value ?? "mine");

  if (tabs.length === 0) return <NoAccess />;
  return (
    <>
      <PageHeader title="Attendance" description="Check-ins, daily status and attendance history." />
      {tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={setTab} />}
      {tab === "mine" && me?.employee && <MyAttendance employeeId={me.employee.id} />}
      {tab === "daily" && <DailyStatus />}
      {tab === "records" && <AllRecords />}
    </>
  );
}

export default function AttendancePage() {
  return (
    <Suspense fallback={<Loading />}>
      <AttendanceContent />
    </Suspense>
  );
}
