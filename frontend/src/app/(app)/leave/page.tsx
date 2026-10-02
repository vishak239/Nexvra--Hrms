"use client";

import { BalanceCard } from "@/components/leave/BalanceCard";
import { LockedBadge, canCancelLeave } from "@/components/leave/LeaveLock";
import { CalendarRange, Check, Pencil, Plus, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Badge, Card, CardHeader, PageHeader, StatusBadge } from "@/components/ui/Display";
import { CheckboxField, FilterSelect, SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { ConfirmDialog, Modal, Tabs, useToast } from "@/components/ui/Overlay";
import { Alert, EmptyState, ErrorState, FormError, Loading, NoAccess, SkeletonRows } from "@/components/ui/States";
import { PAGE_SIZE, Pagination, TBody, THead, Table, Td, Th } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDate, fmtDays, humanize, todayISO } from "@/lib/format";
import { tryApi, useAction, useResource } from "@/lib/hooks";
import type { Employee, LeaveBalance, LeaveRequest, LeaveType, MyBalance, Paginated } from "@/lib/types";

type Tab = "mine" | "approvals" | "all" | "balances" | "types";

function dateRange(r: LeaveRequest) {
  if (r.start_date === r.end_date) {
    return `${fmtDate(r.start_date)}${r.is_half_day ? ` (${r.half_day_period === "FIRST" ? "first" : "second"} half)` : ""}`;
  }
  return `${fmtDate(r.start_date)} – ${fmtDate(r.end_date)}`;
}

// --- apply --------------------------------------------------------------------------

function ApplyModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const types = useResource<LeaveType[]>(open ? "/api/leaves/types/" : null, { is_active: true });
  const [form, setForm] = useState({ leave_type: "", start_date: "", end_date: "", is_half_day: false, half_day_period: "FIRST", reason: "" });
  const { run, pending, error, setError } = useAction();
  const selected = types.data?.find((t) => String(t.id) === form.leave_type);

  useEffect(() => {
    if (open) {
      setError(undefined);
      setForm({ leave_type: "", start_date: todayISO(), end_date: todayISO(), is_half_day: false, half_day_period: "FIRST", reason: "" });
    }
  }, [open, setError]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body = {
      leave_type: Number(form.leave_type),
      start_date: form.start_date,
      end_date: form.is_half_day ? form.start_date : form.end_date,
      is_half_day: form.is_half_day,
      half_day_period: form.is_half_day ? form.half_day_period : "",
      reason: form.reason,
    };
    const ok = await run(() => api("/api/leaves/requests/", { body }));
    if (ok) {
      toast("Leave request submitted.");
      onDone();
    }
  }
  const f = error?.fields ?? {};

  return (
    <Modal
      open={open}
      title="Apply for leave"
      description="Your manager (or HR) will be notified."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="apply-form" loading={pending} disabled={!form.leave_type}>
            Submit request
          </Button>
        </>
      }
    >
      <form id="apply-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError error={error} />
        {types.data && types.data.length === 0 && (
          <Alert tone="info">No leave types are set up yet. Please contact HR.</Alert>
        )}
        <SelectField label="Leave type" value={form.leave_type} onChange={(e) => setForm({ ...form, leave_type: e.target.value, is_half_day: false })} error={f.leave_type} required>
          <option value="">Select a leave type</option>
          {types.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.is_paid ? "" : " (unpaid)"}
            </option>
          ))}
        </SelectField>
        {selected?.allow_half_day && (
          <CheckboxField label="Half day" checked={form.is_half_day} onChange={(e) => setForm({ ...form, is_half_day: e.target.checked })} />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label={form.is_half_day ? "Date" : "From"} type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value, end_date: form.end_date < e.target.value ? e.target.value : form.end_date })} error={f.start_date} required />
          {form.is_half_day ? (
            <SelectField label="Which half" value={form.half_day_period} onChange={(e) => setForm({ ...form, half_day_period: e.target.value })} error={f.half_day_period}>
              <option value="FIRST">First half</option>
              <option value="SECOND">Second half</option>
            </SelectField>
          ) : (
            <TextField label="To" type="date" min={form.start_date} value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} error={f.end_date} required />
          )}
        </div>
        <TextAreaField label="Reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} error={f.reason} />
        <p className="text-xs text-zinc-500">
          Days are counted from configured working days and holidays, and checked against your balance.
        </p>
      </form>
    </Modal>
  );
}

// --- my leave -----------------------------------------------------------------------

function MyLeave({ employeeId }: { employeeId: number }) {
  const toast = useToast();
  const [applying, setApplying] = useState(false);
  const [cancelling, setCancelling] = useState<LeaveRequest | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [page, setPage] = useState(1);
  const balances = useResource<{ year: number | null; results: MyBalance[] }>("/api/leaves/balances/mine/");
  const requests = useResource<Paginated<LeaveRequest>>("/api/leaves/requests/", { employee: employeeId, page, page_size: PAGE_SIZE });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="My balances"
          description={balances.data?.year ? `Leave year ${balances.data.year}` : undefined}
          actions={
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setApplying(true)}>
              Apply for leave
            </Button>
          }
        />
        {balances.error ? (
          <ErrorState error={balances.error} onRetry={balances.reload} />
        ) : !balances.data ? (
          <SkeletonRows rows={2} />
        ) : balances.data.results.length === 0 ? (
          <EmptyState title="No leave types yet" description="HR hasn't set up leave types." />
        ) : (
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {balances.data.results.map((b) => (
              <BalanceCard key={b.leave_type} balance={b} />
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="My requests" />
        {requests.error ? (
          <ErrorState error={requests.error} onRetry={requests.reload} />
        ) : requests.loading && !requests.data ? (
          <SkeletonRows />
        ) : !requests.data?.results.length ? (
          <EmptyState icon={<CalendarRange className="h-5 w-5" />} title="No leave requests yet" />
        ) : (
          <>
            <Table>
              <THead>
                <Th>Type</Th>
                <Th>Dates</Th>
                <Th>Days</Th>
                <Th>Status</Th>
                <Th>Decision</Th>
                <Th className="text-right">Actions</Th>
              </THead>
              <TBody>
                {requests.data.results.map((r) => {
                  // The server decides: only the applicant, only while pending (approved leave is locked).
                  const cancellable = canCancelLeave(r);
                  return (
                    <tr key={r.id}>
                      <Td className="font-medium text-zinc-900">{r.leave_type_name}</Td>
                      <Td>{dateRange(r)}</Td>
                      <Td>{fmtDays(r.days)}</Td>
                      <Td>
                        <div className="flex gap-1.5">
                          <StatusBadge status={r.status} />
                          <LockedBadge request={r} />
                        </div>
                      </Td>
                      <Td className="max-w-xs truncate text-xs text-zinc-500">
                        {r.decided_by_name ? `${r.decided_by_name}${r.decision_note ? `: ${r.decision_note}` : ""}` : "—"}
                        {r.balance_deducted && <span className="block text-zinc-400">{fmtDays(r.balance_deducted)} day(s) deducted</span>}
                      </Td>
                      <Td className="text-right">
                        {cancellable && (
                          <Button size="sm" variant="secondary" onClick={() => setCancelling(r)}>
                            Cancel
                          </Button>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} count={requests.data.count} onPage={setPage} />
          </>
        )}
      </Card>

      <ApplyModal
        open={applying}
        onClose={() => setApplying(false)}
        onDone={() => {
          setApplying(false);
          requests.reload();
          balances.reload();
        }}
      />
      <ConfirmDialog
        open={!!cancelling}
        title="Cancel leave request?"
        message={cancelling ? `${cancelling.leave_type_name}, ${dateRange(cancelling)}.` : ""}
        confirmLabel="Cancel request"
        danger
        pending={cancelPending}
        onClose={() => setCancelling(null)}
        onConfirm={async () => {
          if (!cancelling) return;
          setCancelPending(true);
          const r = await tryApi(() => api(`/api/leaves/requests/${cancelling.id}/cancel/`, { method: "POST" }));
          setCancelPending(false);
          toast(r.ok ? "Request cancelled." : r.error.message, r.ok ? "success" : "error");
          setCancelling(null);
          requests.reload();
          balances.reload();
        }}
      />
    </div>
  );
}

// --- approvals ----------------------------------------------------------------------

function DecisionModal({
  request,
  approve,
  onClose,
  onDone,
}: {
  request: LeaveRequest | null;
  approve: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const { run, pending, error, setError } = useAction();
  useEffect(() => {
    setNote("");
    setError(undefined);
  }, [request, setError]);

  async function decide() {
    if (!request) return;
    const ok = await run(() => api(`/api/leaves/requests/${request.id}/${approve ? "approve" : "reject"}/`, { body: { note } }));
    if (ok) {
      toast(approve ? "Leave approved." : "Leave rejected.");
      onDone();
    }
  }

  return (
    <Modal
      open={!!request}
      title={approve ? "Approve leave" : "Reject leave"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Back
          </Button>
          <Button variant={approve ? "primary" : "danger"} onClick={decide} loading={pending}>
            {approve ? "Approve" : "Reject"}
          </Button>
        </>
      }
    >
      {request && (
        <div className="space-y-4">
          <FormError error={error} />
          <div className="rounded-lg bg-zinc-50 p-4 text-sm">
            <p className="font-medium text-zinc-900">{request.employee.full_name}</p>
            <p className="text-zinc-600">
              {request.leave_type_name} · {dateRange(request)} · {fmtDays(request.days)} day(s)
            </p>
            {request.reason && <p className="mt-2 text-zinc-600">“{request.reason}”</p>}
          </div>
          <TextAreaField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} error={error?.fields.note} />
        </div>
      )}
    </Modal>
  );
}

function RequestsTable({
  rows,
  onDecide,
}: {
  rows: LeaveRequest[];
  onDecide?: (r: LeaveRequest, approve: boolean) => void;
}) {
  return (
    <Table>
      <THead>
        <Th>Employee</Th>
        <Th>Type</Th>
        <Th>Dates</Th>
        <Th>Days</Th>
        <Th>Reason</Th>
        <Th>Status</Th>
        {onDecide && <Th className="text-right">Actions</Th>}
      </THead>
      <TBody>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td>
              <span className="font-medium text-zinc-900">{r.employee.full_name}</span>
              <span className="ml-2 font-mono text-xs text-zinc-400">{r.employee.employee_code}</span>
            </Td>
            <Td>{r.leave_type_name}</Td>
            <Td>{dateRange(r)}</Td>
            <Td>{fmtDays(r.days)}</Td>
            <Td className="max-w-[16rem] truncate" title={r.reason}>
              {r.reason || "—"}
            </Td>
            <Td>
              <StatusBadge status={r.status} />
            </Td>
            {onDecide && (
              <Td className="text-right">
                {r.can_decide && (
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="secondary" icon={<X className="h-4 w-4" />} onClick={() => onDecide(r, false)}>
                      Reject
                    </Button>
                    <Button size="sm" icon={<Check className="h-4 w-4" />} onClick={() => onDecide(r, true)}>
                      Approve
                    </Button>
                  </div>
                )}
              </Td>
            )}
          </tr>
        ))}
      </TBody>
    </Table>
  );
}

function Approvals() {
  const [page, setPage] = useState(1);
  const [decision, setDecision] = useState<{ request: LeaveRequest; approve: boolean } | null>(null);
  const { data, error, loading, reload } = useResource<Paginated<LeaveRequest>>("/api/leaves/requests/pending-approvals/", { page, page_size: PAGE_SIZE });
  return (
    <Card>
      <CardHeader title="Waiting for your decision" />
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <SkeletonRows />
      ) : !data?.results.length ? (
        <EmptyState icon={<Check className="h-5 w-5" />} title="All caught up" description="There are no leave requests waiting for you." />
      ) : (
        <>
          <RequestsTable rows={data.results} onDecide={(request, approve) => setDecision({ request, approve })} />
          <Pagination page={page} pageSize={PAGE_SIZE} count={data.count} onPage={setPage} />
        </>
      )}
      <DecisionModal
        request={decision?.request ?? null}
        approve={decision?.approve ?? true}
        onClose={() => setDecision(null)}
        onDone={() => {
          setDecision(null);
          reload();
        }}
      />
    </Card>
  );
}

function AllRequests() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [decision, setDecision] = useState<{ request: LeaveRequest; approve: boolean } | null>(null);
  const { data, error, loading, reload } = useResource<Paginated<LeaveRequest>>("/api/leaves/requests/", { status, page, page_size: PAGE_SIZE });
  return (
    <Card>
      <CardHeader
        title="Leave requests"
        actions={
          <FilterSelect label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {["PENDING", "APPROVED", "REJECTED", "CANCELLED"].map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </FilterSelect>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <SkeletonRows />
      ) : !data?.results.length ? (
        <EmptyState icon={<CalendarRange className="h-5 w-5" />} title="No leave requests" />
      ) : (
        <>
          <RequestsTable rows={data.results} onDecide={(request, approve) => setDecision({ request, approve })} />
          <Pagination page={page} pageSize={PAGE_SIZE} count={data.count} onPage={setPage} />
        </>
      )}
      <DecisionModal
        request={decision?.request ?? null}
        approve={decision?.approve ?? true}
        onClose={() => setDecision(null)}
        onDone={() => {
          setDecision(null);
          reload();
        }}
      />
    </Card>
  );
}

// --- balances (HR) ------------------------------------------------------------------

function Balances() {
  const toast = useToast();
  const year = new Date().getFullYear();
  const [filterYear, setFilterYear] = useState(String(year));
  const [page, setPage] = useState(1);
  const [allocating, setAllocating] = useState(false);
  const [editing, setEditing] = useState<LeaveBalance | null>(null);
  const [allocated, setAllocated] = useState("");
  const types = useResource<LeaveType[]>("/api/leaves/types/");
  const people = useResource<Paginated<Employee>>(allocating ? "/api/employees/" : null, { page_size: 100 });
  const { data, error, loading, reload } = useResource<Paginated<LeaveBalance>>("/api/leaves/balances/", { year: filterYear, page, page_size: PAGE_SIZE });
  const alloc = useAction();
  const edit = useAction();
  const [form, setForm] = useState({ leave_type: "", year: String(year), allocated: "", employees: [] as string[], overwrite: false });

  async function onAllocate(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = { leave_type: Number(form.leave_type), year: Number(form.year), overwrite: form.overwrite };
    if (form.allocated) body.allocated = form.allocated;
    if (form.employees.length) body.employees = form.employees.map(Number);
    const res = await alloc.run(() => api<{ created: number; updated: number; skipped: number }>("/api/leaves/balances/allocate/", { body }));
    if (res) {
      toast(`Allocated: ${res.created} created, ${res.updated} updated, ${res.skipped} skipped.`);
      setAllocating(false);
      reload();
    }
  }

  return (
    <Card>
      <CardHeader
        title="Leave balances"
        description="Days are deducted once, when a request is approved. Pending days are shown for information."
        actions={
          <>
            <FilterSelect label="Year" value={filterYear} onChange={(e) => { setFilterYear(e.target.value); setPage(1); }}>
              {[year - 1, year, year + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </FilterSelect>
            <Button
              size="sm"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => {
                alloc.setError(undefined);
                setForm({ leave_type: "", year: filterYear, allocated: "", employees: [], overwrite: false });
                setAllocating(true);
              }}
            >
              Allocate
            </Button>
          </>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <SkeletonRows />
      ) : !data?.results.length ? (
        <EmptyState title="No balances for this year" description="Use Allocate to give employees their leave for the year." />
      ) : (
        <>
          <Table>
            <THead>
              <Th>Employee</Th>
              <Th>Leave type</Th>
              <Th>Year</Th>
              <Th>Allocated</Th>
              <Th>Used</Th>
              <Th>Pending</Th>
              <Th>Available</Th>
              <Th className="text-right">Actions</Th>
            </THead>
            <TBody>
              {data.results.map((b) => (
                <tr key={b.id}>
                  <Td className="font-medium text-zinc-900">{b.employee_detail.full_name}</Td>
                  <Td>{b.leave_type_name}</Td>
                  <Td>{b.year}</Td>
                  <Td>{fmtDays(b.allocated)}</Td>
                  <Td>{fmtDays(b.used)}</Td>
                  <Td>{fmtDays(b.pending)}</Td>
                  <Td className="font-medium text-zinc-900">{fmtDays(b.available)}</Td>
                  <Td className="text-right">
                    <button
                      onClick={() => {
                        edit.setError(undefined);
                        setAllocated(b.allocated);
                        setEditing(b);
                      }}
                      className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                      aria-label={`Edit balance for ${b.employee_detail.full_name}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </Td>
                </tr>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} count={data.count} onPage={setPage} />
        </>
      )}

      <Modal
        open={allocating}
        title="Allocate leave"
        description="Creates balances for employees who don't have one yet."
        onClose={() => setAllocating(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAllocating(false)} disabled={alloc.pending}>
              Cancel
            </Button>
            <Button type="submit" form="allocate-form" loading={alloc.pending} disabled={!form.leave_type}>
              Allocate
            </Button>
          </>
        }
      >
        <form id="allocate-form" onSubmit={onAllocate} className="space-y-4" noValidate>
          <FormError error={alloc.error} />
          <SelectField label="Leave type" value={form.leave_type} onChange={(e) => setForm({ ...form, leave_type: e.target.value })} error={alloc.error?.fields.leave_type} required>
            <option value="">Select</option>
            {types.data?.filter((t) => t.is_active && t.tracks_balance).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} (default {fmtDays(t.annual_allocation)} days)
              </option>
            ))}
          </SelectField>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Year" type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} error={alloc.error?.fields.year} required />
            <TextField label="Days" type="number" step="0.5" min="0" value={form.allocated} onChange={(e) => setForm({ ...form, allocated: e.target.value })} error={alloc.error?.fields.allocated} hint="Empty = type default" />
          </div>
          <SelectField
            label="Employees"
            multiple
            value={form.employees}
            onChange={(e) => setForm({ ...form, employees: Array.from(e.target.selectedOptions).map((o) => o.value) })}
            hint="Leave empty for all current employees. Hold Ctrl/Cmd to select several."
            className="[&_select]:h-40"
          >
            {people.data?.results.filter((p) => p.employment_status !== "EXITED").map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name} ({p.employee_code})
              </option>
            ))}
          </SelectField>
          <CheckboxField label="Overwrite existing balances" checked={form.overwrite} onChange={(e) => setForm({ ...form, overwrite: e.target.checked })} />
          <p className="text-xs text-zinc-500">You can&apos;t allocate leave to yourself; another administrator must do that.</p>
        </form>
      </Modal>

      <Modal
        open={!!editing}
        title="Edit balance"
        description={editing ? `${editing.employee_detail.full_name} · ${editing.leave_type_name} · ${editing.year}` : undefined}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={edit.pending}>
              Cancel
            </Button>
            <Button
              loading={edit.pending}
              onClick={async () => {
                if (!editing) return;
                const ok = await edit.run(() => api(`/api/leaves/balances/${editing.id}/`, { method: "PATCH", body: { allocated } }));
                if (ok) {
                  toast("Balance updated.");
                  setEditing(null);
                  reload();
                }
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormError error={edit.error} />
          <TextField label="Allocated days" type="number" step="0.5" min="0" value={allocated} onChange={(e) => setAllocated(e.target.value)} error={edit.error?.fields.allocated} />
        </div>
      </Modal>
    </Card>
  );
}

// --- leave types (HR) ---------------------------------------------------------------

function LeaveTypes() {
  const toast = useToast();
  const { data, error, loading, reload } = useResource<LeaveType[]>("/api/leaves/types/");
  const [editing, setEditing] = useState<LeaveType | "new" | null>(null);
  const [form, setForm] = useState({ name: "", code: "", description: "", is_paid: true, annual_allocation: "", allow_half_day: false, is_active: true });
  const { run, pending, error: saveError, setError } = useAction();

  function open(t: LeaveType | "new") {
    setError(undefined);
    setForm(
      t === "new"
        ? { name: "", code: "", description: "", is_paid: true, annual_allocation: "", allow_half_day: false, is_active: true }
        : { name: t.name, code: t.code, description: t.description, is_paid: t.is_paid, annual_allocation: t.annual_allocation ?? "", allow_half_day: t.allow_half_day, is_active: t.is_active },
    );
    setEditing(t);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body = { ...form, annual_allocation: form.annual_allocation === "" ? null : form.annual_allocation };
    const isNew = editing === "new";
    const ok = await run(() =>
      api(isNew ? "/api/leaves/types/" : `/api/leaves/types/${(editing as LeaveType).id}/`, { method: isNew ? "POST" : "PATCH", body }),
    );
    if (ok) {
      toast(isNew ? "Leave type created." : "Leave type updated.");
      setEditing(null);
      reload();
    }
  }
  const f = saveError?.fields ?? {};

  return (
    <Card>
      <CardHeader
        title="Leave types"
        description="Nexvra's leave policy has not been specified. Create the types HR decides on."
        actions={
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => open("new")}>
            Add leave type
          </Button>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <SkeletonRows />
      ) : !data?.length ? (
        <EmptyState title="No leave types" description="Add the leave types your company offers." />
      ) : (
        <Table>
          <THead>
            <Th>Name</Th>
            <Th>Code</Th>
            <Th>Paid</Th>
            <Th>Yearly allocation</Th>
            <Th>Half day</Th>
            <Th>Status</Th>
            <Th className="text-right">Actions</Th>
          </THead>
          <TBody>
            {data.map((t) => (
              <tr key={t.id}>
                <Td className="font-medium text-zinc-900">{t.name}</Td>
                <Td className="font-mono text-xs">{t.code}</Td>
                <Td>{t.is_paid ? "Paid" : "Unpaid"}</Td>
                <Td>{t.tracks_balance ? `${fmtDays(t.annual_allocation)} days` : "Not tracked"}</Td>
                <Td>{t.allow_half_day ? "Allowed" : "No"}</Td>
                <Td>{t.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
                <Td className="text-right">
                  <button onClick={() => open(t)} className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900" aria-label={`Edit ${t.name}`}>
                    <Pencil className="h-4 w-4" />
                  </button>
                </Td>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
      <Modal
        open={!!editing}
        title={editing === "new" ? "Add leave type" : "Edit leave type"}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form="type-form" loading={pending}>
              Save
            </Button>
          </>
        }
      >
        <form id="type-form" onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormError error={saveError} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={f.name} required />
            <TextField label="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} error={f.code} required />
          </div>
          <TextField
            label="Yearly allocation (days)"
            type="number"
            step="0.5"
            min="0"
            value={form.annual_allocation}
            onChange={(e) => setForm({ ...form, annual_allocation: e.target.value })}
            error={f.annual_allocation}
            hint="Leave empty if this type has no balance limit."
          />
          <TextAreaField label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} error={f.description} />
          <CheckboxField label="Paid leave" checked={form.is_paid} onChange={(e) => setForm({ ...form, is_paid: e.target.checked })} />
          <CheckboxField label="Allow half-day requests" checked={form.allow_half_day} onChange={(e) => setForm({ ...form, allow_half_day: e.target.checked })} />
          <CheckboxField label="Active" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
        </form>
      </Modal>
    </Card>
  );
}

function LeaveContent() {
  const { me, can } = useAuth();
  const params = useSearchParams();
  const pending = useResource<Paginated<LeaveRequest>>(can("leave.approve_team", "leave.approve_all") ? "/api/leaves/requests/pending-approvals/" : null, { page_size: 1 });
  const tabs = [
    ...(can("leave.apply") && me?.employee ? [{ value: "mine" as Tab, label: "My leave" }] : []),
    ...(can("leave.approve_team", "leave.approve_all") ? [{ value: "approvals" as Tab, label: "Approvals", count: pending.data?.count }] : []),
    ...(can("leave.view_team", "leave.view_all") ? [{ value: "all" as Tab, label: can("leave.view_all") ? "All requests" : "Team requests" }] : []),
    ...(can("leave.manage_balances") ? [{ value: "balances" as Tab, label: "Balances" }] : []),
    ...(can("leave.manage_types") ? [{ value: "types" as Tab, label: "Leave types" }] : []),
  ];
  const requested = params.get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(tabs.find((t) => t.value === requested)?.value ?? tabs[0]?.value ?? "mine");

  if (tabs.length === 0) return <NoAccess />;
  return (
    <>
      <PageHeader title="Leave" description="Requests, approvals and balances." />
      {tabs.length > 1 && (
        <Tabs
          tabs={tabs}
          value={tab}
          onChange={(t) => {
            setTab(t);
            pending.reload();
          }}
        />
      )}
      {tab === "mine" && me?.employee && <MyLeave employeeId={me.employee.id} />}
      {tab === "approvals" && <Approvals />}
      {tab === "all" && <AllRequests />}
      {tab === "balances" && <Balances />}
      {tab === "types" && <LeaveTypes />}
    </>
  );
}

export default function LeavePage() {
  return (
    <Suspense fallback={<Loading />}>
      <LeaveContent />
    </Suspense>
  );
}
