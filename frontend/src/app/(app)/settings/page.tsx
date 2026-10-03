"use client";

import { Pencil, Plus, Trash2 } from "@/components/ui/icons";
import { useEffect, useState, type FormEvent } from "react";
import { RequirePermission } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/Display";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { ConfirmDialog, Modal, Tabs, useToast } from "@/components/ui/Overlay";
import { Alert, EmptyState, ErrorState, FormError, Loading, SkeletonRows } from "@/components/ui/States";
import { TBody, THead, Table, Td, Th } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { MONTHS, WEEKDAYS } from "@/lib/format";
import { tryApi, useAction, useResource } from "@/lib/hooks";
import type { Company, CompanySettings, Department, Designation, Employee, Paginated } from "@/lib/types";

type Tab = "company" | "policies" | "departments" | "designations";

function CompanyTab() {
  const { can } = useAuth();
  const toast = useToast();
  const edit = can("company.manage");
  const { data, error, loading, reload } = useResource<Company>("/api/company/");
  const [form, setForm] = useState<Partial<Company>>({});
  const save = useAction();
  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorState error={error} onRetry={reload} />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const { name, legal_name, email, phone, website, address } = form;
    const ok = await save.run(() => api("/api/company/", { method: "PATCH", body: { name, legal_name, email, phone, website, address } }));
    if (ok) {
      toast("Company profile saved.");
      reload();
    }
  }
  const f = save.error?.fields ?? {};
  return (
    <Card>
      <CardHeader title="Company profile" description={edit ? undefined : "Only a Super Admin can edit the company profile."} />
      <form onSubmit={onSubmit} className="grid gap-5 p-5 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <FormError error={save.error} />
        </div>
        <TextField label="Company name" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} error={f.name} disabled={!edit} required />
        <TextField label="Legal name" value={form.legal_name ?? ""} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} error={f.legal_name} disabled={!edit} />
        <TextField label="Email" type="email" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} error={f.email} disabled={!edit} />
        <TextField label="Phone" value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} error={f.phone} disabled={!edit} />
        <TextField label="Website" type="url" value={form.website ?? ""} onChange={(e) => setForm({ ...form, website: e.target.value })} error={f.website} disabled={!edit} placeholder="https://" />
        <TextAreaField label="Address" value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} error={f.address} disabled={!edit} className="sm:col-span-2" />
        {edit && (
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" loading={save.pending}>
              Save changes
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

type PolicyForm = {
  timezone: string;
  currency: string;
  working_days: number[];
  work_start_time: string;
  work_end_time: string;
  late_grace_minutes: string;
  break_allowance_minutes: string;
  half_day_min_hours: string;
  full_day_min_hours: string;
  self_attendance_enabled: boolean;
  leave_year_start_month: string;
  employee_document_upload_enabled: boolean;
  deactivate_user_on_exit: boolean;
  max_upload_size_mb: string;
};

function toForm(s: CompanySettings): PolicyForm {
  return {
    timezone: s.timezone,
    currency: s.currency,
    working_days: s.working_days ?? [],
    work_start_time: s.work_start_time?.slice(0, 5) ?? "",
    work_end_time: s.work_end_time?.slice(0, 5) ?? "",
    late_grace_minutes: s.late_grace_minutes?.toString() ?? "",
    break_allowance_minutes: s.break_allowance_minutes?.toString() ?? "",
    half_day_min_hours: s.half_day_min_hours ?? "",
    full_day_min_hours: s.full_day_min_hours ?? "",
    self_attendance_enabled: s.self_attendance_enabled,
    leave_year_start_month: s.leave_year_start_month?.toString() ?? "",
    employee_document_upload_enabled: s.employee_document_upload_enabled,
    deactivate_user_on_exit: s.deactivate_user_on_exit,
    max_upload_size_mb: s.max_upload_size_mb?.toString() ?? "",
  };
}

const orNull = (v: string) => (v === "" ? null : v);

function PoliciesTab() {
  const { can } = useAuth();
  const toast = useToast();
  const edit = can("settings.manage");
  const { data, error, loading, reload } = useResource<CompanySettings>("/api/settings/");
  const [form, setForm] = useState<PolicyForm | null>(null);
  const save = useAction();
  useEffect(() => {
    if (data) setForm(toForm(data));
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error || !data || !form) return <ErrorState error={error} onRetry={reload} />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const body = {
      timezone: form.timezone,
      currency: form.currency,
      working_days: form.working_days.length ? form.working_days : null,
      work_start_time: orNull(form.work_start_time),
      work_end_time: orNull(form.work_end_time),
      late_grace_minutes: orNull(form.late_grace_minutes),
      break_allowance_minutes: orNull(form.break_allowance_minutes),
      half_day_min_hours: orNull(form.half_day_min_hours),
      full_day_min_hours: orNull(form.full_day_min_hours),
      self_attendance_enabled: form.self_attendance_enabled,
      leave_year_start_month: orNull(form.leave_year_start_month),
      employee_document_upload_enabled: form.employee_document_upload_enabled,
      deactivate_user_on_exit: form.deactivate_user_on_exit,
      max_upload_size_mb: orNull(form.max_upload_size_mb),
    };
    const ok = await save.run(() => api("/api/settings/", { method: "PATCH", body }));
    if (ok) {
      toast("Settings saved.");
      reload();
    }
  }
  const f = save.error?.fields ?? {};
  const set = <K extends keyof PolicyForm>(k: K, v: PolicyForm[K]) => setForm({ ...form, [k]: v });

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <Alert tone="info">
        Nexvra&apos;s HR policies have not been specified, so every rule here is optional. <strong>Leave a field empty and that rule is not applied.</strong>{" "}
        Changes are recorded in the audit log.
      </Alert>
      <FormError error={save.error} />

      <Card>
        <CardHeader title="General" />
        <div className="grid gap-5 p-5 sm:grid-cols-3">
          <TextField label="Time zone" value={form.timezone} onChange={(e) => set("timezone", e.target.value)} error={f.timezone} placeholder="e.g. Asia/Kolkata" hint="IANA name. Empty = server default." disabled={!edit} />
          <TextField label="Currency" value={form.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} error={f.currency} placeholder="e.g. INR" maxLength={3} hint="3-letter ISO code" disabled={!edit} />
          <TextField label="Max upload size (MB)" type="number" min="1" max="50" value={form.max_upload_size_mb} onChange={(e) => set("max_upload_size_mb", e.target.value)} error={f.max_upload_size_mb} hint="Empty = 10 MB" disabled={!edit} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Working time & attendance" />
        <div className="space-y-5 p-5">
          <fieldset>
            <legend className="mb-1.5 font-label-sm text-label-sm uppercase text-on-surface-variant">Working days</legend>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((d, i) => {
                const on = form.working_days.includes(i);
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={!edit}
                    aria-pressed={on}
                    onClick={() => set("working_days", on ? form.working_days.filter((x) => x !== i) : [...form.working_days, i].sort())}
                    className={`h-9 w-14 rounded-lg border text-sm font-medium transition-colors disabled:cursor-not-allowed ${
                      on ? "border-primary-container bg-primary-container text-on-primary-fixed" : "border-surface-container-high bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container"
                    }`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-on-surface-variant">
              {f.working_days ? <span className="text-error">{f.working_days.join(" ")}</span> : "None selected = weekends and absences are not calculated."}
            </p>
          </fieldset>
          <div className="grid gap-5 sm:grid-cols-3">
            <TextField label="Work start time" type="time" value={form.work_start_time} onChange={(e) => set("work_start_time", e.target.value)} error={f.work_start_time} disabled={!edit} />
            <TextField label="Work end time" type="time" value={form.work_end_time} onChange={(e) => set("work_end_time", e.target.value)} error={f.work_end_time} disabled={!edit} />
            <TextField label="Late grace (minutes)" type="number" min="0" value={form.late_grace_minutes} onChange={(e) => set("late_grace_minutes", e.target.value)} error={f.late_grace_minutes} hint="Needs a start time." disabled={!edit} />
            <TextField label="Half-day minimum hours" type="number" step="0.25" min="0" value={form.half_day_min_hours} onChange={(e) => set("half_day_min_hours", e.target.value)} error={f.half_day_min_hours} disabled={!edit} />
            <TextField label="Full-day minimum hours" type="number" step="0.25" min="0" value={form.full_day_min_hours} onChange={(e) => set("full_day_min_hours", e.target.value)} error={f.full_day_min_hours} hint="Set both or neither." disabled={!edit} />
            <TextField label="Daily break allowance (minutes)" type="number" min="1" max="480" value={form.break_allowance_minutes} onChange={(e) => set("break_allowance_minutes", e.target.value)} error={f.break_allowance_minutes} hint="e.g. 60 for a 1-hour break. Empty = no limit." disabled={!edit} />
          </div>
          <CheckboxField label="Allow employees to check in and out themselves" checked={form.self_attendance_enabled} onChange={(e) => set("self_attendance_enabled", e.target.checked)} disabled={!edit} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Leave, documents & accounts" />
        <div className="space-y-5 p-5">
          <SelectField label="Leave year starts in" value={form.leave_year_start_month} onChange={(e) => set("leave_year_start_month", e.target.value)} error={f.leave_year_start_month} hint="Not set = calendar year (January)." className="sm:max-w-xs" disabled={!edit}>
            <option value="">Not set</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </SelectField>
          <CheckboxField label="Employees can upload their own documents" checked={form.employee_document_upload_enabled} onChange={(e) => set("employee_document_upload_enabled", e.target.checked)} disabled={!edit} />
          <CheckboxField label="Disable sign-in when an employee exits" checked={form.deactivate_user_on_exit} onChange={(e) => set("deactivate_user_on_exit", e.target.checked)} disabled={!edit} />
        </div>
      </Card>

      {edit && (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setForm(toForm(data))} disabled={save.pending}>
            Reset
          </Button>
          <Button type="submit" loading={save.pending}>
            Save settings
          </Button>
        </div>
      )}
    </form>
  );
}

function OrgListTab({ kind }: { kind: "departments" | "designations" }) {
  const toast = useToast();
  const isDept = kind === "departments";
  const { data, error, loading, reload } = useResource<Paginated<Department | Designation>>(`/api/${kind}/`, { page_size: 100 });
  const people = useResource<Paginated<Employee>>(isDept ? "/api/employees/" : null, { page_size: 100 });
  const [editing, setEditing] = useState<Department | Designation | "new" | null>(null);
  const [deleting, setDeleting] = useState<Department | Designation | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", description: "", head: "", is_active: true });
  const save = useAction();

  function open(item: Department | Designation | "new") {
    save.setError(undefined);
    if (item === "new") setForm({ name: "", code: "", description: "", head: "", is_active: true });
    else {
      const d = item as Department;
      setForm({ name: d.name, code: d.code ?? "", description: d.description, head: d.head ? String(d.head) : "", is_active: d.is_active });
    }
    setEditing(item);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = { name: form.name, description: form.description, is_active: form.is_active };
    if (isDept) {
      body.code = form.code;
      body.head = form.head ? Number(form.head) : null;
    }
    const isNew = editing === "new";
    const ok = await save.run(() =>
      api(isNew ? `/api/${kind}/` : `/api/${kind}/${(editing as Department).id}/`, { method: isNew ? "POST" : "PATCH", body }),
    );
    if (ok) {
      toast("Saved.");
      setEditing(null);
      reload();
    }
  }
  const label = isDept ? "department" : "designation";
  const f = save.error?.fields ?? {};

  return (
    <Card>
      <CardHeader
        title={isDept ? "Departments" : "Designations"}
        description="Records in use can't be deleted. Deactivate them instead."
        actions={
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => open("new")}>
            Add {label}
          </Button>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <SkeletonRows />
      ) : !data?.results.length ? (
        <EmptyState title={`No ${kind} yet`} />
      ) : (
        <Table>
          <THead>
            <Th>Name</Th>
            {isDept && <Th>Code</Th>}
            {isDept && <Th>Head</Th>}
            <Th className="text-right">Employees</Th>
            <Th>Status</Th>
            <Th className="text-right">Actions</Th>
          </THead>
          <TBody>
            {data.results.map((item) => (
              <tr key={item.id}>
                <Td className="font-medium text-primary">{item.name}</Td>
                {isDept && <Td className="font-code-mono text-code-mono text-on-surface-variant">{(item as Department).code}</Td>}
                {isDept && <Td>{(item as Department).head_name ?? "—"}</Td>}
                <Td className="text-right tabular-nums">{item.employee_count}</Td>
                <Td>{item.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => open(item)} className="rounded-md p-1.5 text-on-surface-variant hover:bg-surface-container-high hover:text-primary" aria-label={`Edit ${item.name}`}>
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button onClick={() => setDeleting(item)} className="rounded-md p-1.5 text-on-surface-variant hover:bg-error-container/25 hover:text-error" aria-label={`Delete ${item.name}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
      <Modal
        open={!!editing}
        title={editing === "new" ? `Add ${label}` : `Edit ${label}`}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={save.pending}>
              Cancel
            </Button>
            <Button type="submit" form="org-form" loading={save.pending}>
              Save
            </Button>
          </>
        }
      >
        <form id="org-form" onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormError error={save.error} />
          <div className={isDept ? "grid gap-4 sm:grid-cols-2" : ""}>
            <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={f.name} required />
            {isDept && <TextField label="Code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} error={f.code} required />}
          </div>
          {isDept && (
            <SelectField label="Department head" value={form.head} onChange={(e) => setForm({ ...form, head: e.target.value })} error={f.head}>
              <option value="">— None —</option>
              {people.data?.results.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </SelectField>
          )}
          <TextAreaField label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} error={f.description} />
          <CheckboxField label="Active" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
        </form>
      </Modal>
      <ConfirmDialog
        open={!!deleting}
        title={`Delete ${label}?`}
        message={deleting ? `"${deleting.name}" will be deleted. This fails if it's still assigned to employees.` : ""}
        confirmLabel="Delete"
        danger
        pending={busy}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          setBusy(true);
          const r = await tryApi(() => api(`/api/${kind}/${deleting.id}/`, { method: "DELETE" }));
          setBusy(false);
          toast(r.ok ? "Deleted." : r.error.message, r.ok ? "success" : "error");
          setDeleting(null);
          reload();
        }}
      />
    </Card>
  );
}

function SettingsContent() {
  const { can } = useAuth();
  const tabs = [
    { value: "company" as Tab, label: "Company" },
    ...(can("settings.manage") ? [{ value: "policies" as Tab, label: "HR policies" }] : []),
    ...(can("departments.manage") ? [{ value: "departments" as Tab, label: "Departments" }] : []),
    ...(can("designations.manage") ? [{ value: "designations" as Tab, label: "Designations" }] : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[1]?.value ?? "company");
  return (
    <>
      <PageHeader title="Settings" description="Company profile, HR policy rules and organisation structure." />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "company" && <CompanyTab />}
      {tab === "policies" && <PoliciesTab />}
      {tab === "departments" && <OrgListTab key="departments" kind="departments" />}
      {tab === "designations" && <OrgListTab key="designations" kind="designations" />}
    </>
  );
}

export default function SettingsPage() {
  return (
    <RequirePermission perms={["settings.manage", "company.manage", "departments.manage", "designations.manage"]}>
      <SettingsContent />
    </RequirePermission>
  );
}
