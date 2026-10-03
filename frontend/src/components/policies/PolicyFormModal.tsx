"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { Modal, useToast } from "@/components/ui/Overlay";
import { FormError } from "@/components/ui/States";
import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";
import type { Policy, PolicyCategory } from "@/lib/types";
import { POLICY_CATEGORIES } from "./categories";

type Form = { title: string; category: PolicyCategory; body: string; effective_date: string; is_published: boolean };

const EMPTY: Form = { title: "", category: "OTHER", body: "", effective_date: "", is_published: false };

/** Create or edit a policy. The server validates everything again (title, text, category). */
export function PolicyFormModal({
  open,
  policy,
  onClose,
  onSaved,
}: {
  open: boolean;
  policy: Policy | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { run, pending, error, setError } = useAction();
  const [form, setForm] = useState<Form>(EMPTY);

  useEffect(() => {
    if (!open) return;
    setError(undefined);
    setForm(
      policy
        ? {
            title: policy.title,
            category: policy.category,
            body: policy.body,
            effective_date: policy.effective_date ?? "",
            is_published: policy.is_published,
          }
        : EMPTY,
    );
  }, [open, policy, setError]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body = { ...form, effective_date: form.effective_date || null };
    const saved = await run(() =>
      policy ? api<Policy>(`/api/policies/${policy.id}/`, { method: "PATCH", body }) : api<Policy>("/api/policies/", { body }),
    );
    if (saved) {
      toast(policy ? "Policy updated." : form.is_published ? "Policy published." : "Draft saved.");
      onSaved();
    }
  }

  const f = error?.fields ?? {};
  return (
    <Modal
      open={open}
      size="lg"
      title={policy ? "Edit policy" : "New policy"}
      description="Write the rule in plain language. Drafts are visible only to HR until you publish them."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="policy-form" loading={pending}>
            {policy ? "Save changes" : form.is_published ? "Publish" : "Save draft"}
          </Button>
        </>
      }
    >
      <form id="policy-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError error={error && !Object.keys(f).length ? error : undefined} />
        <TextField label="Title" value={form.title} onChange={(e) => set("title", e.target.value)} error={f.title} maxLength={200} required />
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField label="Category" value={form.category} onChange={(e) => set("category", e.target.value as PolicyCategory)} error={f.category} required>
            {POLICY_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Effective from"
            type="date"
            value={form.effective_date}
            onChange={(e) => set("effective_date", e.target.value)}
            error={f.effective_date}
            hint="Optional."
          />
        </div>
        <TextAreaField
          label="Policy text"
          value={form.body}
          onChange={(e) => set("body", e.target.value)}
          error={f.body}
          rows={10}
          maxLength={20000}
          hint="Numbers the system enforces (working hours, grace time, break allowance) belong in Settings."
          required
        />
        <CheckboxField
          label="Published"
          hint="Visible to every employee. Leave unticked to keep it as a draft."
          checked={form.is_published}
          onChange={(e) => set("is_published", e.target.checked)}
        />
      </form>
    </Modal>
  );
}
