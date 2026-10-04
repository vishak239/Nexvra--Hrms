"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Display";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Overlay";
import { FormError } from "@/components/ui/States";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { humanize } from "@/lib/format";
import { useAction, useResource } from "@/lib/hooks";
import type { Department, Designation, Employee, Paginated, Role } from "@/lib/types";

const TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"];
const STATUSES = ["ACTIVE", "PROBATION", "NOTICE_PERIOD", "EXITED"];

type FormState = {
  first_name: string;
  last_name: string;
  email: string;
  username: string;
  employee_code: string;
  joining_date: string;
  employment_type: string;
  employment_status: string;
  exit_date: string;
  department: string;
  designation: string;
  manager: string;
  role: string;
  is_active: boolean;
  initial_password: string;
  phone: string;
  address: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  emergency_contact_relation: string;
};

function initial(e?: Employee): FormState {
  return {
    first_name: e?.first_name ?? "",
    last_name: e?.last_name ?? "",
    email: e?.email ?? "",
    username: e?.username ?? "",
    employee_code: e?.employee_code ?? "",
    joining_date: e?.joining_date ?? "",
    employment_type: e?.employment_type ?? "FULL_TIME",
    employment_status: e?.employment_status ?? "ACTIVE",
    exit_date: e?.exit_date ?? "",
    department: e?.department ? String(e.department.id) : "",
    designation: e?.designation ? String(e.designation.id) : "",
    manager: e?.manager ? String(e.manager.id) : "",
    role: e?.role ?? "EMPLOYEE",
    is_active: e?.is_active ?? true,
    initial_password: "",
    phone: e?.phone ?? "",
    address: e?.address ?? "",
    emergency_contact_name: e?.emergency_contact_name ?? "",
    emergency_contact_phone: e?.emergency_contact_phone ?? "",
    emergency_contact_relation: e?.emergency_contact_relation ?? "",
  };
}

export function EmployeeForm({ employee }: { employee?: Employee }) {
  const editing = !!employee;
  const router = useRouter();
  const toast = useToast();
  const { me } = useAuth();
  const [form, setForm] = useState<FormState>(() => initial(employee));
  const { run, pending, error } = useAction();
  const f = error?.fields ?? {};

  const departments = useResource<Paginated<Department>>("/api/departments/", { page_size: 100, is_active: true });
  const designations = useResource<Paginated<Designation>>("/api/designations/", { page_size: 100, is_active: true });
  const people = useResource<Paginated<Employee>>("/api/employees/", { page_size: 100 });
  const roles = useResource<Role[]>("/api/roles/");

  const isSuper = me?.role.code === "SUPER_ADMIN";
  const assignableRoles = (roles.data ?? []).filter((r) => isSuper || (me && r.level < me.role.level));
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((s) => ({ ...s, [key]: value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = {
      ...form,
      username: form.username.trim().replace(/^@/, ""),
      department: form.department ? Number(form.department) : null,
      designation: form.designation ? Number(form.designation) : null,
      manager: form.manager ? Number(form.manager) : null,
      exit_date: form.exit_date || null,
    };
    if (editing) {
      delete body.initial_password;
      if (!assignableRoles.some((r) => r.code === form.role)) delete body.role;
    } else {
      delete body.is_active;
      if (!body.initial_password) delete body.initial_password;
    }
    const saved = await run(() =>
      api<Employee>(editing ? `/api/employees/${employee.id}/` : "/api/employees/", {
        method: editing ? "PATCH" : "POST",
        body,
      }),
    );
    if (saved) {
      toast(editing ? "Employee updated." : "Employee created.");
      router.push(`/employees/${saved.id}`);
    }
  }

  const managerOptions = (people.data?.results ?? []).filter((p) => p.id !== employee?.id && p.employment_status !== "EXITED");

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <FormError error={error} />

      <Card>
        <CardHeader title="Personal & account" description="Name and email are used for sign-in." />
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <TextField label="First name" value={form.first_name} onChange={(e) => set("first_name", e.target.value)} error={f.first_name} required />
          <TextField label="Last name" value={form.last_name} onChange={(e) => set("last_name", e.target.value)} error={f.last_name} />
          <TextField label="Work email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} error={f.email} required />
          <TextField
            label="Username"
            value={form.username}
            onChange={(e) => set("username", e.target.value)}
            error={f.username}
            placeholder="e.g. vishak"
            hint="Public @handle for tasks and messages. Leave empty to generate one from the email."
          />
          <SelectField label="Role" value={form.role} onChange={(e) => set("role", e.target.value)} error={f.role} disabled={editing && !assignableRoles.some((r) => r.code === form.role)}>
            {editing && !assignableRoles.some((r) => r.code === form.role) && <option value={form.role}>{humanize(form.role)}</option>}
            {assignableRoles.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </SelectField>
          {!editing && (
            <TextField
              label="Initial password"
              type="password"
              autoComplete="new-password"
              value={form.initial_password}
              onChange={(e) => set("initial_password", e.target.value)}
              error={f.initial_password}
              hint="Optional. Leave empty to email a set-password link instead. The employee can change it later under Change password."
              className="sm:col-span-2"
            />
          )}
          {editing && (
            <CheckboxField
              label="Account active"
              hint="Inactive accounts cannot sign in."
              checked={form.is_active}
              onChange={(e) => set("is_active", e.target.checked)}
            />
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Employment" />
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <TextField label="Employee ID" value={form.employee_code} onChange={(e) => set("employee_code", e.target.value)} error={f.employee_code} required />
          <TextField label="Joining date" type="date" value={form.joining_date} onChange={(e) => set("joining_date", e.target.value)} error={f.joining_date} required />
          <SelectField label="Department" value={form.department} onChange={(e) => set("department", e.target.value)} error={f.department}>
            <option value="">— None —</option>
            {departments.data?.results.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Designation" value={form.designation} onChange={(e) => set("designation", e.target.value)} error={f.designation}>
            <option value="">— None —</option>
            {designations.data?.results.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Reporting manager" value={form.manager} onChange={(e) => set("manager", e.target.value)} error={f.manager}>
            <option value="">— None —</option>
            {managerOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name} ({p.employee_code})
              </option>
            ))}
          </SelectField>
          <SelectField label="Employment type" value={form.employment_type} onChange={(e) => set("employment_type", e.target.value)} error={f.employment_type} required>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </SelectField>
          <SelectField label="Status" value={form.employment_status} onChange={(e) => set("employment_status", e.target.value)} error={f.employment_status}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Exit date"
            type="date"
            value={form.exit_date}
            onChange={(e) => set("exit_date", e.target.value)}
            error={f.exit_date}
            hint="Required when status is Exited."
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Contact" description="Visible only to the employee and HR." />
        <div className="grid gap-5 p-5 sm:grid-cols-2">
          <TextField label="Phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} error={f.phone} />
          <div className="hidden sm:block" />
          <TextAreaField label="Address" value={form.address} onChange={(e) => set("address", e.target.value)} error={f.address} className="sm:col-span-2" />
          <TextField label="Emergency contact name" value={form.emergency_contact_name} onChange={(e) => set("emergency_contact_name", e.target.value)} error={f.emergency_contact_name} />
          <TextField label="Emergency contact phone" value={form.emergency_contact_phone} onChange={(e) => set("emergency_contact_phone", e.target.value)} error={f.emergency_contact_phone} />
          <TextField label="Relationship" value={form.emergency_contact_relation} onChange={(e) => set("emergency_contact_relation", e.target.value)} error={f.emergency_contact_relation} />
        </div>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          {editing ? "Save changes" : "Create employee"}
        </Button>
      </div>
    </form>
  );
}
