"use client";

import { Pencil, Plus, Trash2, Wallet } from "@/components/ui/icons";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { RequirePermission } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Badge, Card, CardHeader, PageHeader, StatusBadge } from "@/components/ui/Display";
import { CheckboxField, FilterSelect, SelectField, TextField } from "@/components/ui/Field";
import { ConfirmDialog, Modal, Tabs, useToast } from "@/components/ui/Overlay";
import { Alert, EmptyState, ErrorState, FormError, SkeletonRows } from "@/components/ui/States";
import { PAGE_SIZE, Pagination, TBody, THead, Table, Td, Th } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { MONTHS, fmtDate, fmtMoney, fmtPeriod, humanize } from "@/lib/format";
import { tryApi, useAction, useResource } from "@/lib/hooks";
import type { CompanySettings, Employee, Paginated, PayComponent, PayrollRun, SalaryStructure } from "@/lib/types";

type Tab = "runs" | "salaries" | "components";

function Runs({ manage, currency }: { manage: boolean; currency: string }) {
  const router = useRouter();
  const toast = useToast();
  const now = new Date();
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [period, setPeriod] = useState({ year: String(now.getFullYear()), month: String(now.getMonth() + 1) });
  const { run, pending, error, setError } = useAction();
  const { data, error: loadError, loading, reload } = useResource<Paginated<PayrollRun>>("/api/payroll/runs/", { page, page_size: PAGE_SIZE });

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const created = await run(() => api<PayrollRun>("/api/payroll/runs/", { body: { year: Number(period.year), month: Number(period.month) } }));
    if (created) {
      toast("Payroll run created.");
      router.push(`/payroll/runs/${created.id}`);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Payroll runs"
        description="One run per month: generate payslips, review, then finalize to publish them."
        actions={
          manage && (
            <Button
              size="sm"
              icon={<Plus className="h-4 w-4" />}
              onClick={() => {
                setError(undefined);
                setCreating(true);
              }}
            >
              New payroll run
            </Button>
          )
        }
      />
      {loadError ? (
        <ErrorState error={loadError} onRetry={reload} />
      ) : loading && !data ? (
        <SkeletonRows />
      ) : !data?.results.length ? (
        <EmptyState icon={<Wallet className="h-5 w-5" />} title="No payroll runs yet" description="Create a run for a month to generate payslips." />
      ) : (
        <>
          <Table>
            <THead>
              <Th>Period</Th>
              <Th>Status</Th>
              <Th className="text-right">Payslips</Th>
              <Th className="text-right">Total net pay</Th>
              <Th>Finalized</Th>
            </THead>
            <TBody>
              {data.results.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-surface-container" onClick={() => router.push(`/payroll/runs/${r.id}`)}>
                  <Td className="font-medium text-primary">{fmtPeriod(r.year, r.month)}</Td>
                  <Td>
                    <StatusBadge status={r.status} />
                  </Td>
                  <Td className="text-right tabular-nums">{r.payslip_count}</Td>
                  <Td className="text-right tabular-nums">{fmtMoney(r.total_net ?? "0", r.currency || currency)}</Td>
                  <Td>{r.finalized_at ? fmtDate(r.finalized_at) : "—"}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} count={data.count} onPage={setPage} />
        </>
      )}
      <Modal
        open={creating}
        title="New payroll run"
        onClose={() => setCreating(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form="run-form" loading={pending}>
              Create
            </Button>
          </>
        }
      >
        <form id="run-form" onSubmit={onCreate} className="space-y-4" noValidate>
          <FormError error={error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Month" value={period.month} onChange={(e) => setPeriod({ ...period, month: e.target.value })} error={error?.fields.month}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </SelectField>
            <TextField label="Year" type="number" value={period.year} onChange={(e) => setPeriod({ ...period, year: e.target.value })} error={error?.fields.year} />
          </div>
          <p className="text-xs text-on-surface-variant">
            No statutory deductions, proration or loss-of-pay are applied automatically. Use adjustments on draft payslips where needed.
          </p>
        </form>
      </Modal>
    </Card>
  );
}

type Line = { component: string; amount: string };

function Salaries({ manage, currency }: { manage: boolean; currency: string }) {
  const toast = useToast();
  const { me } = useAuth();
  const [employee, setEmployee] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<SalaryStructure | "new" | null>(null);
  const [deleting, setDeleting] = useState<SalaryStructure | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ employee: string; effective_from: string; notes: string; items: Line[] }>({
    employee: "",
    effective_from: "",
    notes: "",
    items: [],
  });
  const { run, pending, error, setError } = useAction();
  const people = useResource<Paginated<Employee>>("/api/employees/", { page_size: 100 });
  const components = useResource<PayComponent[]>("/api/payroll/components/", { is_active: true });
  const { data, error: loadError, loading, reload } = useResource<Paginated<SalaryStructure>>("/api/payroll/salary-structures/", {
    employee,
    page,
    page_size: PAGE_SIZE,
  });

  function open(s: SalaryStructure | "new") {
    setError(undefined);
    setForm(
      s === "new"
        ? { employee, effective_from: "", notes: "", items: [{ component: "", amount: "" }] }
        : {
            employee: String(s.employee),
            effective_from: s.effective_from,
            notes: s.notes,
            items: s.items.map((i) => ({ component: String(i.component), amount: i.amount })),
          },
    );
    setEditing(s);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const isNew = editing === "new";
    const body = {
      employee: Number(form.employee),
      effective_from: form.effective_from,
      notes: form.notes,
      items: form.items.filter((i) => i.component && i.amount !== "").map((i) => ({ component: Number(i.component), amount: i.amount })),
    };
    const ok = await run(() =>
      api(isNew ? "/api/payroll/salary-structures/" : `/api/payroll/salary-structures/${(editing as SalaryStructure).id}/`, {
        method: isNew ? "POST" : "PUT",
        body,
      }),
    );
    if (ok) {
      toast("Salary structure saved.");
      setEditing(null);
      reload();
    }
  }
  const f = error?.fields ?? {};
  const itemErrors = Array.isArray(f.items) ? (f.items as unknown[]).filter((x) => x && typeof x === "object").map((x) => Object.values(x as Record<string, string[]>).flat().join(" ")) : [];

  return (
    <Card>
      <CardHeader
        title="Salary structures"
        description="Monthly amounts per component. The latest structure effective before the month end is used."
        actions={
          <>
            <FilterSelect label="Employee" value={employee} onChange={(e) => { setEmployee(e.target.value); setPage(1); }}>
              <option value="">All employees</option>
              {people.data?.results.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </FilterSelect>
            {manage && (
              <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => open("new")}>
                Add structure
              </Button>
            )}
          </>
        }
      />
      {loadError ? (
        <ErrorState error={loadError} onRetry={reload} />
      ) : loading && !data ? (
        <SkeletonRows />
      ) : !data?.results.length ? (
        <EmptyState title="No salary structures" description="Employees without a structure are skipped when payslips are generated." />
      ) : (
        <>
          <Table>
            <THead>
              <Th>Employee</Th>
              <Th>Effective from</Th>
              <Th className="text-right">Gross</Th>
              <Th className="text-right">Deductions</Th>
              <Th className="text-right">Net</Th>
              {manage && <Th className="text-right">Actions</Th>}
            </THead>
            <TBody>
              {data.results.map((s) => (
                <tr key={s.id}>
                  <Td className="font-medium text-primary">{s.employee_detail.full_name}</Td>
                  <Td>{fmtDate(s.effective_from)}</Td>
                  <Td className="text-right tabular-nums">{fmtMoney(s.gross_earnings, currency)}</Td>
                  <Td className="text-right tabular-nums">{fmtMoney(s.total_deductions, currency)}</Td>
                  <Td className="text-right font-medium tabular-nums text-primary">{fmtMoney(s.net_pay, currency)}</Td>
                  {manage && (
                    <Td className="text-right">
                      {s.employee !== me?.employee?.id || me?.role.code === "SUPER_ADMIN" ? (
                        <div className="flex justify-end gap-1">
                          <button onClick={() => open(s)} className="rounded-md p-1.5 text-on-surface-variant hover:bg-surface-container-high hover:text-primary" aria-label={`Edit structure for ${s.employee_detail.full_name}`}>
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button onClick={() => setDeleting(s)} className="rounded-md p-1.5 text-on-surface-variant hover:bg-error-container/25 hover:text-error" aria-label={`Delete structure for ${s.employee_detail.full_name}`}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-outline">Your own</span>
                      )}
                    </Td>
                  )}
                </tr>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} count={data.count} onPage={setPage} />
        </>
      )}

      <Modal
        open={!!editing}
        size="lg"
        title={editing === "new" ? "Add salary structure" : "Edit salary structure"}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form="salary-form" loading={pending}>
              Save
            </Button>
          </>
        }
      >
        <form id="salary-form" onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormError error={error} />
          {components.data && components.data.length === 0 && (
            <Alert tone="info">Create pay components first (Pay components tab).</Alert>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Employee" value={form.employee} onChange={(e) => setForm({ ...form, employee: e.target.value })} error={f.employee} disabled={editing !== "new"} required>
              <option value="">Select an employee</option>
              {people.data?.results.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name} ({p.employee_code})
                </option>
              ))}
            </SelectField>
            <TextField label="Effective from" type="date" value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} error={f.effective_from} required />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-on-surface">Components (monthly)</p>
            <div className="space-y-2">
              {form.items.map((item, idx) => (
                <div key={idx} className="flex gap-2">
                  <select
                    aria-label={`Component ${idx + 1}`}
                    value={item.component}
                    onChange={(e) => setForm({ ...form, items: form.items.map((x, i) => (i === idx ? { ...x, component: e.target.value } : x)) })}
                    className="h-10 flex-1 rounded-lg border border-surface-container-high bg-surface-container-low px-3 text-sm"
                  >
                    <option value="">Select component</option>
                    {components.data?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({humanize(c.kind)})
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={`Amount ${idx + 1}`}
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={item.amount}
                    onChange={(e) => setForm({ ...form, items: form.items.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)) })}
                    className="h-10 w-36 rounded-lg border border-surface-container-high px-3 text-right text-sm tabular-nums"
                  />
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })}
                    className="rounded-md px-2 text-outline hover:bg-error-container/25 hover:text-error"
                    aria-label={`Remove component ${idx + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            {itemErrors.length > 0 && <p className="mt-1.5 text-xs text-error">{itemErrors.join(" ")}</p>}
            {typeof f.items?.[0] === "string" && <p className="mt-1.5 text-xs text-error">{f.items.join(" ")}</p>}
            <Button size="sm" variant="ghost" className="mt-2" icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ ...form, items: [...form.items, { component: "", amount: "" }] })}>
              Add component
            </Button>
          </div>
          <TextField label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} error={f.notes} />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Delete salary structure?"
        message={deleting ? `${deleting.employee_detail.full_name}, effective ${fmtDate(deleting.effective_from)}.` : ""}
        confirmLabel="Delete"
        danger
        pending={busy}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          setBusy(true);
          const r = await tryApi(() => api(`/api/payroll/salary-structures/${deleting.id}/`, { method: "DELETE" }));
          setBusy(false);
          toast(r.ok ? "Structure deleted." : r.error.message, r.ok ? "success" : "error");
          setDeleting(null);
          reload();
        }}
      />
    </Card>
  );
}

function Components({ manage }: { manage: boolean }) {
  const toast = useToast();
  const { data, error, loading, reload } = useResource<PayComponent[]>("/api/payroll/components/");
  const [editing, setEditing] = useState<PayComponent | "new" | null>(null);
  const [form, setForm] = useState({ name: "", code: "", kind: "EARNING", is_active: true });
  const save = useAction();

  useEffect(() => {
    if (!editing) return;
    save.setError(undefined);
    setForm(editing === "new" ? { name: "", code: "", kind: "EARNING", is_active: true } : { name: editing.name, code: editing.code, kind: editing.kind, is_active: editing.is_active });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const isNew = editing === "new";
    const ok = await save.run(() =>
      api(isNew ? "/api/payroll/components/" : `/api/payroll/components/${(editing as PayComponent).id}/`, { method: isNew ? "POST" : "PATCH", body: form }),
    );
    if (ok) {
      toast("Component saved.");
      setEditing(null);
      reload();
    }
  }

  return (
    <Card>
      <CardHeader
        title="Pay components"
        description="Earnings and deductions used in salary structures. None are predefined."
        actions={
          manage && (
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")}>
              Add component
            </Button>
          )
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <SkeletonRows />
      ) : !data?.length ? (
        <EmptyState title="No pay components" description="Add earnings (e.g. base pay) and deductions your company uses." />
      ) : (
        <Table>
          <THead>
            <Th>Name</Th>
            <Th>Code</Th>
            <Th>Kind</Th>
            <Th>Status</Th>
            {manage && <Th className="text-right">Actions</Th>}
          </THead>
          <TBody>
            {data.map((c) => (
              <tr key={c.id}>
                <Td className="font-medium text-primary">{c.name}</Td>
                <Td className="font-code-mono text-code-mono text-on-surface-variant">{c.code}</Td>
                <Td>
                  <StatusBadge status={c.kind} />
                </Td>
                <Td>{c.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
                {manage && (
                  <Td className="text-right">
                    <button onClick={() => setEditing(c)} className="rounded-md p-1.5 text-on-surface-variant hover:bg-surface-container-high hover:text-primary" aria-label={`Edit ${c.name}`}>
                      <Pencil className="h-4 w-4" />
                    </button>
                  </Td>
                )}
              </tr>
            ))}
          </TBody>
        </Table>
      )}
      <Modal
        open={!!editing}
        title={editing === "new" ? "Add pay component" : "Edit pay component"}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={save.pending}>
              Cancel
            </Button>
            <Button type="submit" form="component-form" loading={save.pending}>
              Save
            </Button>
          </>
        }
      >
        <form id="component-form" onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormError error={save.error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={save.error?.fields.name} required />
            <TextField label="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} error={save.error?.fields.code} required />
          </div>
          <SelectField label="Kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} error={save.error?.fields.kind}>
            <option value="EARNING">Earning</option>
            <option value="DEDUCTION">Deduction</option>
          </SelectField>
          <CheckboxField label="Active" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
        </form>
      </Modal>
    </Card>
  );
}

function PayrollContent() {
  const { can } = useAuth();
  const manage = can("payroll.manage");
  const settings = useResource<CompanySettings>("/api/settings/");
  const currency = settings.data?.currency ?? "";
  const [tab, setTab] = useState<Tab>("runs");
  return (
    <>
      <PageHeader title="Payroll" description="Basic monthly payroll. Statutory deductions are not configured." />
      <Tabs
        tabs={[
          { value: "runs", label: "Payroll runs" },
          { value: "salaries", label: "Salary structures" },
          { value: "components", label: "Pay components" },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "runs" && <Runs manage={manage} currency={currency} />}
      {tab === "salaries" && <Salaries manage={manage} currency={currency} />}
      {tab === "components" && <Components manage={manage} />}
    </>
  );
}

export default function PayrollPage() {
  return (
    <RequirePermission perms={["payroll.view_all", "payroll.manage"]}>
      <PayrollContent />
    </RequirePermission>
  );
}
