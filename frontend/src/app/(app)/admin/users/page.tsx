"use client";

import { Pencil, Plus, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { RequirePermission } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/Display";
import { CheckboxField, FilterSelect, SearchInput, SelectField, TextField } from "@/components/ui/Field";
import { Modal, Tabs, useToast } from "@/components/ui/Overlay";
import { Alert, EmptyState, ErrorState, FormError, SkeletonRows } from "@/components/ui/States";
import { PAGE_SIZE, Pagination, TBody, THead, Table, Td, Th } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { useAction, useResource } from "@/lib/hooks";
import type { Paginated, Permission, Role, UserAccount } from "@/lib/types";

type Tab = "users" | "roles";

function UsersTab() {
  const { can, me } = useAuth();
  const toast = useToast();
  const manage = can("users.manage");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<UserAccount | "new" | null>(null);
  const [form, setForm] = useState({ email: "", first_name: "", last_name: "", role: "EMPLOYEE", is_active: true, password: "" });
  const save = useAction();
  const roles = useResource<Role[]>("/api/roles/");
  const { data, error, loading, reload } = useResource<Paginated<UserAccount>>("/api/users/", { search, role__code: role, page, page_size: PAGE_SIZE });

  useEffect(() => setPage(1), [search, role]);

  function open(u: UserAccount | "new") {
    save.setError(undefined);
    setForm(
      u === "new"
        ? { email: "", first_name: "", last_name: "", role: "EMPLOYEE", is_active: true, password: "" }
        : { email: u.email, first_name: u.first_name, last_name: u.last_name, role: u.role, is_active: u.is_active, password: "" },
    );
    setEditing(u);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const isNew = editing === "new";
    const body: Record<string, unknown> = { ...form };
    if (!form.password) delete body.password;
    if (!isNew && (editing as UserAccount).id === me?.id) {
      delete body.role;
      delete body.is_active;
    }
    const ok = await save.run(() =>
      api(isNew ? "/api/users/" : `/api/users/${(editing as UserAccount).id}/`, { method: isNew ? "POST" : "PATCH", body }),
    );
    if (ok) {
      toast(isNew ? "User created." : "User updated.");
      setEditing(null);
      reload();
    }
  }
  const f = save.error?.fields ?? {};
  const self = editing !== null && editing !== "new" && editing.id === me?.id;

  return (
    <Card>
      <CardHeader
        title="User accounts"
        description="Sign-in accounts. Employees get an account automatically when HR creates them."
        actions={
          manage && (
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => open("new")}>
              Add user
            </Button>
          )
        }
      />
      <div className="flex flex-col gap-3 border-b border-zinc-100 p-4 sm:flex-row">
        <SearchInput label="Search name or email" value={search} onChange={(e) => setSearch(e.target.value)} />
        <FilterSelect label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">All roles</option>
          {roles.data?.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </FilterSelect>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <SkeletonRows />
      ) : !data?.results.length ? (
        <EmptyState title="No users found" />
      ) : (
        <>
          <Table>
            <THead>
              <Th>User</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Employee record</Th>
              <Th>Last sign-in</Th>
              {manage && <Th className="text-right">Actions</Th>}
            </THead>
            <TBody>
              {data.results.map((u) => (
                <tr key={u.id}>
                  <Td>
                    <p className="font-medium text-zinc-900">{u.full_name || "—"}</p>
                    <p className="text-xs text-zinc-500">{u.email}</p>
                  </Td>
                  <Td>
                    <Badge tone={u.role === "SUPER_ADMIN" ? "dark" : "neutral"}>{roles.data?.find((r) => r.code === u.role)?.name ?? u.role}</Badge>
                  </Td>
                  <Td>
                    {u.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Disabled</Badge>}
                    {u.must_change_password && <span className="ml-2 text-xs text-zinc-500">must change password</span>}
                  </Td>
                  <Td>{u.employee_id ? <Link href={`/employees/${u.employee_id}`} className="text-zinc-900 underline-offset-4 hover:underline">View</Link> : "—"}</Td>
                  <Td>{fmtDateTime(u.last_login)}</Td>
                  {manage && (
                    <Td className="text-right">
                      <button onClick={() => open(u)} className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900" aria-label={`Edit ${u.email}`}>
                        <Pencil className="h-4 w-4" />
                      </button>
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
        title={editing === "new" ? "Add user" : "Edit user"}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={save.pending}>
              Cancel
            </Button>
            <Button type="submit" form="user-form" loading={save.pending}>
              Save
            </Button>
          </>
        }
      >
        <form id="user-form" onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormError error={save.error} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="First name" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} error={f.first_name} required />
            <TextField label="Last name" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} error={f.last_name} />
          </div>
          <TextField label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={f.email} required />
          <SelectField label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} error={f.role} disabled={self}>
            {roles.data?.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </SelectField>
          <TextField
            label={editing === "new" ? "Initial password" : "Set a new password"}
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            error={f.password}
            hint={editing === "new" ? "Optional. Empty = email a set-password link. The user must change it at first sign-in." : "Optional. Leave empty to keep the current password."}
          />
          {editing !== "new" && (
            <CheckboxField label="Account active" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} disabled={self} />
          )}
          {self && <Alert tone="info">You can&apos;t change your own role or deactivate your own account.</Alert>}
        </form>
      </Modal>
    </Card>
  );
}

function RolesTab() {
  const { can } = useAuth();
  const toast = useToast();
  const manage = can("roles.manage");
  const { data: roles, error, loading, reload } = useResource<Role[]>("/api/roles/");
  const perms = useResource<Permission[]>("/api/permissions/");
  const [editing, setEditing] = useState<Role | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const save = useAction();

  const groups = useMemo(() => {
    const map = new Map<string, Permission[]>();
    for (const p of perms.data ?? []) {
      const area = p.codename.split(".")[0];
      map.set(area, [...(map.get(area) ?? []), p]);
    }
    return Array.from(map.entries());
  }, [perms.data]);

  async function onSave() {
    if (!editing) return;
    const ok = await save.run(() => api(`/api/roles/${editing.id}/`, { method: "PATCH", body: { permissions: Array.from(selected) } }));
    if (ok) {
      toast("Role permissions updated.");
      setEditing(null);
      reload();
    }
  }

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !roles) return <SkeletonRows />;
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        {roles?.map((r) => (
          <Card key={r.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-zinc-400" />
                  <h3 className="text-sm font-semibold text-zinc-900">{r.name}</h3>
                  {r.is_system && <Badge>System</Badge>}
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  Level {r.level} · {r.user_count} user(s) · {r.permissions.length} permission(s)
                </p>
              </div>
              {manage && r.code !== "SUPER_ADMIN" && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    save.setError(undefined);
                    setSelected(new Set(r.permissions));
                    setEditing(r);
                  }}
                >
                  Edit permissions
                </Button>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {r.code === "SUPER_ADMIN" ? (
                <Badge tone="dark">All permissions</Badge>
              ) : (
                r.permissions.map((p) => (
                  <span key={p} className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-600">
                    {p}
                  </span>
                ))
              )}
            </div>
          </Card>
        ))}
      </div>
      <Modal
        open={!!editing}
        size="lg"
        title={editing ? `Permissions: ${editing.name}` : ""}
        description="Changes take effect immediately and are recorded in the audit log."
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={save.pending}>
              Cancel
            </Button>
            <Button onClick={onSave} loading={save.pending}>
              Save permissions
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <FormError error={save.error} />
          {groups.map(([area, items]) => (
            <fieldset key={area}>
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{area}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {items.map((p) => (
                  <CheckboxField
                    key={p.codename}
                    label={p.description}
                    hint={p.codename}
                    checked={selected.has(p.codename)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(p.codename);
                      else next.delete(p.codename);
                      setSelected(next);
                    }}
                  />
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </Modal>
    </>
  );
}

function UsersContent() {
  const { can } = useAuth();
  const tabs = [
    ...(can("users.view") ? [{ value: "users" as Tab, label: "Users" }] : []),
    ...(can("roles.view") ? [{ value: "roles" as Tab, label: "Roles & permissions" }] : []),
  ];
  const [tab, setTab] = useState<Tab>(tabs[0]?.value ?? "users");
  return (
    <>
      <PageHeader title="Users & roles" description="Sign-in accounts and role-based access control." />
      {tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={setTab} />}
      {tab === "users" && <UsersTab />}
      {tab === "roles" && <RolesTab />}
    </>
  );
}

export default function AdminUsersPage() {
  return (
    <RequirePermission perms={["users.view", "roles.view"]}>
      <UsersContent />
    </RequirePermission>
  );
}
