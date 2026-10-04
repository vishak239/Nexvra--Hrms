"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Display";
import { CheckboxField, TextAreaField } from "@/components/ui/Field";
import { Modal, useToast } from "@/components/ui/Overlay";
import { Alert, ErrorState, Loading } from "@/components/ui/States";
import { api } from "@/lib/api";
import { fmtDate, humanize } from "@/lib/format";
import { useAction, useResource } from "@/lib/hooks";
import type { Paginated, Task, WorkSessionState } from "@/lib/types";

const MIN_DESCRIPTION = 10;
const MIN_OTHER = 15;

const PRIORITY_TONE = { LOW: "neutral", MEDIUM: "blue", HIGH: "amber", URGENT: "red" } as const;

/**
 * The overtime declaration: which pending tasks (or another, explained reason), what will be
 * done, and an explicit confirmation. The server validates the same rules and decides the
 * status (request for approval, or a direct start when no approval is required).
 */
export function OvertimeRequestModal({
  open,
  requiresApproval,
  onClose,
  onDone,
}: {
  open: boolean;
  requiresApproval: boolean;
  onClose: () => void;
  onDone: (state: WorkSessionState) => void;
}) {
  const toast = useToast();
  const { run, pending, error, setError } = useAction();
  const [selected, setSelected] = useState<number[]>([]);
  const [useOther, setUseOther] = useState(false);
  const [other, setOther] = useState("");
  const [description, setDescription] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const tasks = useResource<Paginated<Task>>(open ? "/api/tasks/" : null, { mine: true, status: "OPEN", page_size: 50 });

  useEffect(() => {
    if (!open) return;
    setSelected([]);
    setUseOther(false);
    setOther("");
    setDescription("");
    setConfirmed(false);
    setError(undefined);
  }, [open, setError]);

  const reasonOk = selected.length > 0 || (useOther && other.trim().length >= MIN_OTHER);
  const otherOk = !useOther || other.trim().length >= MIN_OTHER;
  const valid = reasonOk && otherOk && description.trim().length >= MIN_DESCRIPTION && confirmed;
  const f = error?.fields ?? {};

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || pending) return;
    const res = await run(() =>
      api<{ state: WorkSessionState }>("/api/attendance/overtime/request/", {
        body: {
          task_ids: selected,
          use_other_reason: useOther,
          other_reason: useOther ? other : "",
          work_description: description,
          declaration_confirmed: confirmed,
        },
      }),
    );
    if (res) {
      toast(requiresApproval ? "Overtime requested — HR will review it." : "Overtime started.");
      onDone(res.state);
    }
  }

  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <Modal
      open={open}
      size="lg"
      title={requiresApproval ? "Request overtime" : "Start overtime"}
      description={
        requiresApproval
          ? "HR or a Super Admin approves overtime before it can start. Each overtime session needs its own request."
          : "Declare the work before overtime starts."
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="overtime-form" loading={pending} disabled={!valid}>
            {requiresApproval ? "Send request" : "Start overtime"}
          </Button>
        </>
      }
    >
      <form id="overtime-form" onSubmit={onSubmit} className="space-y-5" noValidate>
        {error && !Object.keys(f).length && <Alert>{error.message}</Alert>}
        <fieldset>
          <legend className="mb-1.5 font-label-sm text-label-sm uppercase text-on-surface-variant">
            Pending tasks you will work on
          </legend>
          {tasks.error ? (
            <ErrorState error={tasks.error} onRetry={tasks.reload} />
          ) : tasks.loading && !tasks.data ? (
            <Loading label="Loading your tasks…" />
          ) : !tasks.data?.results.length ? (
            <p className="rounded-lg bg-surface-container p-3 text-body-md text-on-surface-variant">
              You have no pending tasks. Use “Other reason” below.
            </p>
          ) : (
            <ul className="max-h-64 space-y-2 overflow-y-auto" aria-label="Pending tasks">
              {tasks.data.results.map((t) => (
                <li key={t.id}>
                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                      selected.includes(t.id)
                        ? "border-primary-container bg-primary-container/10"
                        : "border-surface-container-high bg-surface-container hover:bg-surface-container-high"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 cursor-pointer"
                      checked={selected.includes(t.id)}
                      onChange={() => toggle(t.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-primary">{t.title}</span>
                        <Badge tone={PRIORITY_TONE[t.priority]}>{humanize(t.priority)}</Badge>
                        <Badge>{humanize(t.display_status)}</Badge>
                      </span>
                      {t.description && <span className="mt-0.5 line-clamp-2 block text-body-sm text-on-surface-variant">{t.description}</span>}
                      {t.due_date && <span className="mt-0.5 block text-body-sm text-on-surface-variant">Due {fmtDate(t.due_date)}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {f.task_ids && <p className="mt-1.5 text-body-sm text-error">{f.task_ids.join(" ")}</p>}
        </fieldset>

        <div className="space-y-3">
          <CheckboxField
            label="Other reason"
            hint="For work that is not one of the tasks above."
            checked={useOther}
            onChange={(e) => setUseOther(e.target.checked)}
          />
          {useOther && (
            <TextAreaField
              label="Explain the other reason"
              value={other}
              onChange={(e) => setOther(e.target.value)}
              error={f.other_reason ?? (other && other.trim().length < MIN_OTHER ? `At least ${MIN_OTHER} characters.` : undefined)}
              rows={3}
              maxLength={2000}
              required
            />
          )}
        </div>

        <TextAreaField
          label="What will you work on during overtime?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          error={f.work_description ?? (description && description.trim().length < MIN_DESCRIPTION ? `At least ${MIN_DESCRIPTION} characters.` : undefined)}
          placeholder="e.g. Complete API integration for the employee attendance module."
          rows={3}
          maxLength={2000}
          required
        />

        <CheckboxField
          label="I confirm that the above work is the reason for my overtime."
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        {f.declaration_confirmed && <p className="text-body-sm text-error">{f.declaration_confirmed.join(" ")}</p>}
        <p className="text-body-sm text-on-surface-variant">
          While overtime runs, 30 minutes without activity stops it automatically; continuing then needs a new request.
        </p>
      </form>
    </Modal>
  );
}
