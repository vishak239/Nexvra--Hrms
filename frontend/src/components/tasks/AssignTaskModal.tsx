"use client";

import { CheckCircle2, Search } from "@/components/ui/icons";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { CheckboxField, SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { Modal, useToast } from "@/components/ui/Overlay";
import { Alert, FormError } from "@/components/ui/States";
import { api } from "@/lib/api";
import { humanize, todayISO } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import type { AssigneeLookup, Task } from "@/lib/types";
import { PRIORITIES } from "./TaskBadges";

type LookupBy = "employee_code" | "username";

export function lookupParams(by: LookupBy, value: string) {
  const v = value.trim();
  return by === "username" ? { username: v.replace(/^@/, "") } : { employee_code: v };
}

/** HR assigns a task to ONE employee, identified by Employee ID OR @username (server-resolved). */
export function AssignTaskModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (t: Task) => void }) {
  const toast = useToast();
  const [by, setBy] = useState<LookupBy>("employee_code");
  const [identifier, setIdentifier] = useState("");
  const [found, setFound] = useState<AssigneeLookup | null>(null);
  const [form, setForm] = useState({ title: "", description: "", priority: "MEDIUM", due_date: "", requires_response: true });
  const lookup = useAction();
  const save = useAction();

  useEffect(() => {
    if (!open) return;
    setBy("employee_code");
    setIdentifier("");
    setFound(null);
    setForm({ title: "", description: "", priority: "MEDIUM", due_date: "", requires_response: true });
    lookup.setError(undefined);
    save.setError(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function find() {
    setFound(null);
    if (!identifier.trim()) return;
    const result = await lookup.run(() => api<AssigneeLookup>("/api/tasks/lookup/", { params: lookupParams(by, identifier) }));
    if (result) setFound(result);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!found) return;
    const task = await save.run(() =>
      api<Task>("/api/tasks/", {
        body: {
          ...lookupParams(by, identifier),
          title: form.title,
          description: form.description,
          priority: form.priority,
          due_date: form.due_date || null,
          requires_response: form.requires_response,
        },
      }),
    );
    if (task) {
      toast(`Task assigned to ${found.employee.full_name}.`);
      onCreated(task);
    }
  }

  const lookupError = lookup.error?.fields.employee_code ?? lookup.error?.fields.username ?? (lookup.error ? [lookup.error.message] : undefined);
  const f = save.error?.fields ?? {};

  return (
    <Modal
      open={open}
      size="lg"
      title="Assign a task"
      description="Find the employee by Employee ID or by username — either one is enough."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.pending}>
            Cancel
          </Button>
          <Button type="submit" form="assign-task-form" loading={save.pending} disabled={!found || found.employee.is_self}>
            Assign task
          </Button>
        </>
      }
    >
      <form id="assign-task-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError error={save.error} />
        <fieldset>
          <legend className="mb-1.5 font-label-sm text-label-sm uppercase text-on-surface-variant">Find employee by</legend>
          <div className="flex gap-2" role="radiogroup">
            {(["employee_code", "username"] as LookupBy[]).map((option) => (
              <label key={option} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${by === option ? "border-primary-container bg-primary-container font-semibold text-on-primary-fixed" : "border-surface-container-high text-on-surface"}`}>
                <input
                  type="radio"
                  name="lookup-by"
                  value={option}
                  checked={by === option}
                  onChange={() => {
                    setBy(option);
                    setFound(null);
                    lookup.setError(undefined);
                  }}
                  className="sr-only"
                />
                {option === "employee_code" ? "Employee ID" : "Username"}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex items-end gap-2">
          <TextField
            className="flex-1"
            label={by === "employee_code" ? "Employee ID" : "Username"}
            placeholder={by === "employee_code" ? "e.g. EMP-1024" : "e.g. @vishak"}
            value={identifier}
            onChange={(e) => {
              setIdentifier(e.target.value);
              setFound(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void find();
              }
            }}
            error={lookupError}
            required
          />
          <Button variant="secondary" icon={<Search className="h-4 w-4" />} loading={lookup.pending} onClick={() => void find()} className="mb-[1px]">
            Find
          </Button>
        </div>
        {found && (
          found.employee.is_self ? (
            <Alert>You cannot assign a task to yourself.</Alert>
          ) : (
            <div className="flex items-start gap-3 rounded-lg border border-primary-container/30 bg-primary-container/10 px-4 py-3 text-sm" data-testid="assignee-confirmation">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary-fixed" />
              <div>
                <p className="font-medium text-primary">
                  {found.employee.full_name}
                  {found.employee.username && <span className="ml-2 text-on-surface-variant">@{found.employee.username}</span>}
                </p>
                <p className="text-on-surface-variant">
                  {found.employee.employee_code}
                  {found.employee.designation && ` · ${found.employee.designation}`}
                  {found.employee.department && ` · ${found.employee.department}`}
                </p>
              </div>
            </div>
          )
        )}
        {found && !found.employee.is_self && (
          <>
            <TextField label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} error={f.title} required maxLength={200} />
            <TextAreaField label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} error={f.description} />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField label="Priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} error={f.priority}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {humanize(p)}
                  </option>
                ))}
              </SelectField>
              <TextField label="Due date" type="date" min={todayISO()} value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} error={f.due_date} />
            </div>
            <CheckboxField
              label="Response required before checkout"
              hint="The employee must respond to this task before they can check out."
              checked={form.requires_response}
              onChange={(e) => setForm({ ...form, requires_response: e.target.checked })}
            />
          </>
        )}
      </form>
    </Modal>
  );
}
