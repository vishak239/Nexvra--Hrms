"use client";

import { KeyRound, Pencil } from "lucide-react";
import { useState, type FormEvent } from "react";
import { EmployeeProfile } from "@/components/employees/EmployeeProfile";
import { Button, ButtonLink } from "@/components/ui/Button";
import { TextAreaField, TextField } from "@/components/ui/Field";
import { Modal, useToast } from "@/components/ui/Overlay";
import { ErrorState, FormError, Loading } from "@/components/ui/States";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAction, useResource } from "@/lib/hooks";
import type { Employee } from "@/lib/types";

const FIELDS = ["phone", "address", "emergency_contact_name", "emergency_contact_phone", "emergency_contact_relation"] as const;
type ContactForm = Record<(typeof FIELDS)[number], string>;

export default function ProfilePage() {
  const { refresh } = useAuth();
  const toast = useToast();
  const { data, error, loading, reload } = useResource<Employee>("/api/employees/me/");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ContactForm>({} as ContactForm);
  const save = useAction();

  function openEdit() {
    if (!data) return;
    setForm(Object.fromEntries(FIELDS.map((f) => [f, data[f] ?? ""])) as ContactForm);
    save.setError(undefined);
    setEditing(true);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ok = await save.run(() => api("/api/employees/me/", { method: "PATCH", body: form }));
    if (ok) {
      toast("Profile updated.");
      setEditing(false);
      reload();
    }
  }

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorState error={error} onRetry={reload} />;
  const f = save.error?.fields ?? {};

  return (
    <>
      <EmployeeProfile
        employee={data}
        canEditPhoto
        onChange={() => {
          reload();
          void refresh();
        }}
        actions={
          <>
            <ButtonLink href="/change-password" variant="secondary" icon={<KeyRound className="h-4 w-4" />}>
              Change password
            </ButtonLink>
            <Button variant="dark" icon={<Pencil className="h-4 w-4" />} onClick={openEdit}>
              Edit contact details
            </Button>
          </>
        }
      />
      <p className="mt-4 text-xs text-zinc-500">
        To change your name, email, department or other employment details, contact HR.
      </p>

      <Modal
        open={editing}
        title="Edit contact details"
        onClose={() => setEditing(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(false)} disabled={save.pending}>
              Cancel
            </Button>
            <Button type="submit" form="contact-form" loading={save.pending}>
              Save
            </Button>
          </>
        }
      >
        <form id="contact-form" onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormError error={save.error} />
          <TextField label="Phone" value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} error={f.phone} />
          <TextAreaField label="Address" value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} error={f.address} />
          <TextField label="Emergency contact name" value={form.emergency_contact_name ?? ""} onChange={(e) => setForm({ ...form, emergency_contact_name: e.target.value })} error={f.emergency_contact_name} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Emergency phone" value={form.emergency_contact_phone ?? ""} onChange={(e) => setForm({ ...form, emergency_contact_phone: e.target.value })} error={f.emergency_contact_phone} />
            <TextField label="Relationship" value={form.emergency_contact_relation ?? ""} onChange={(e) => setForm({ ...form, emergency_contact_relation: e.target.value })} error={f.emergency_contact_relation} />
          </div>
        </form>
      </Modal>
    </>
  );
}
