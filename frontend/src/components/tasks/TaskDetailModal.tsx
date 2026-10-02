"use client";

import { Bell, CheckCircle2, Pencil, Play, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DetailList } from "@/components/ui/Display";
import { SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { ConfirmDialog, Modal, useToast } from "@/components/ui/Overlay";
import { Alert, ErrorState, Loading } from "@/components/ui/States";
import { api } from "@/lib/api";
import { fmtDate, fmtDateTime, humanize } from "@/lib/format";
import { useAction, useResource } from "@/lib/hooks";
import type { Task } from "@/lib/types";
import { PRIORITIES, PriorityBadge, TaskStatusBadge, handleOf } from "./TaskBadges";

export function TaskDetailModal({ taskId, onClose, onChanged }: { taskId: number | null; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { data: task, error, loading, reload } = useResource<Task>(taskId ? `/api/tasks/${taskId}/` : null);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState({ title: "", description: "", priority: "MEDIUM", due_date: "" });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const action = useAction();

  useEffect(() => {
    setMessage("");
    setEditing(false);
    setCancelOpen(false);
    setReason("");
    action.setError(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  async function act(path: string, body: unknown, done: string) {
    const result = await action.run(() => api<Task>(`/api/tasks/${taskId}/${path}`, { method: "POST", body }));
    if (result) {
      toast(done);
      setMessage("");
      reload();
      onChanged();
    }
    return result;
  }

  async function saveEdit() {
    const result = await action.run(() =>
      api<Task>(`/api/tasks/${taskId}/`, { method: "PATCH", body: { ...edit, due_date: edit.due_date || null } }),
    );
    if (result) {
      toast("Task updated.");
      setEditing(false);
      reload();
      onChanged();
    }
  }

  const open = taskId !== null;
  const isOpen = task && (task.status === "PENDING" || task.status === "IN_PROGRESS");

  return (
    <Modal open={open} size="lg" title={task?.title ?? "Task"} onClose={onClose}>
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading || !task ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <TaskStatusBadge task={task} />
            <PriorityBadge priority={task.priority} />
            {task.is_blocking && <span className="text-xs font-medium text-amber-800">Response needed before checkout</span>}
          </div>
          {action.error && <Alert>{action.error.message}</Alert>}

          {editing ? (
            <div className="space-y-3 rounded-lg border border-zinc-200 p-4">
              <TextField label="Title" value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} error={action.error?.fields.title} />
              <TextAreaField label="Description" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField label="Priority" value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value })}>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {humanize(p)}
                    </option>
                  ))}
                </SelectField>
                <TextField label="Due date" type="date" value={edit.due_date} onChange={(e) => setEdit({ ...edit, due_date: e.target.value })} />
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="dark" loading={action.pending} onClick={() => void saveEdit()}>
                  Save changes
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
                  Discard
                </Button>
              </div>
            </div>
          ) : (
            <>
              {task.description && <p className="whitespace-pre-line text-sm text-zinc-700">{task.description}</p>}
              <DetailList
                items={[
                  { label: "Assigned to", value: `${task.assigned_to.full_name} (${task.assigned_to.employee_code}${task.assigned_to.username ? ` · @${task.assigned_to.username}` : ""})` },
                  { label: "Assigned by", value: task.assigned_by ? handleOf(task.assigned_by) : "—" },
                  { label: "Due date", value: fmtDate(task.due_date) },
                  { label: "Created", value: fmtDateTime(task.created_at) },
                  { label: "Acknowledged", value: fmtDateTime(task.acknowledged_at) },
                  { label: "Responded", value: fmtDateTime(task.responded_at) },
                  { label: "Completed", value: fmtDateTime(task.completed_at) },
                  ...(task.cancelled_at ? [{ label: "Cancelled", value: `${fmtDateTime(task.cancelled_at)}${task.cancel_reason ? ` — ${task.cancel_reason}` : ""}` }] : []),
                ]}
              />
            </>
          )}

          <section aria-label="Responses">
            <h3 className="text-sm font-semibold text-zinc-900">Responses</h3>
            {task.responses?.length ? (
              <ul className="mt-2 space-y-2">
                {task.responses.map((r) => (
                  <li key={r.id} className="rounded-lg bg-zinc-50 px-3 py-2 text-sm">
                    <p className="whitespace-pre-line text-zinc-800">{r.message}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {r.author ? handleOf(r.author) : "—"} · {fmtDateTime(r.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-zinc-500">No response yet.</p>
            )}
          </section>

          {task.is_assignee && isOpen && (
            <div className="space-y-3 border-t border-zinc-100 pt-4">
              <TextAreaField label="Your response" value={message} onChange={(e) => setMessage(e.target.value)} error={action.error?.fields.message ?? action.error?.fields.response} placeholder="Update, answer or acknowledgement" />
              <div className="flex flex-wrap gap-2">
                {task.status === "PENDING" && (
                  <Button size="sm" variant="secondary" icon={<Play className="h-4 w-4" />} loading={action.pending} onClick={() => void act("start/", {}, "Task started.")}>
                    Acknowledge &amp; start
                  </Button>
                )}
                <Button size="sm" variant="dark" loading={action.pending} disabled={!message.trim()} onClick={() => void act("respond/", { message }, "Response submitted.")}>
                  Submit response
                </Button>
                <Button size="sm" icon={<CheckCircle2 className="h-4 w-4" />} loading={action.pending} disabled={task.requires_response && !task.responded_at && !message.trim()} onClick={() => void act("complete/", { message }, "Task marked as completed.")}>
                  Mark completed
                </Button>
              </div>
              {task.requires_response && !task.responded_at && <p className="text-xs text-zinc-500">A response is required before this task can be completed.</p>}
            </div>
          )}

          {task.can_manage && !editing && (
            <div className="flex flex-wrap gap-2 border-t border-zinc-100 pt-4">
              <Button
                size="sm"
                variant="secondary"
                icon={<Pencil className="h-4 w-4" />}
                onClick={() => {
                  setEdit({ title: task.title, description: task.description, priority: task.priority, due_date: task.due_date ?? "" });
                  setEditing(true);
                }}
              >
                Edit
              </Button>
              <Button size="sm" variant="secondary" icon={<Bell className="h-4 w-4" />} loading={action.pending} onClick={() => void act("remind/", {}, "Reminder sent.")}>
                Send reminder
              </Button>
              <Button size="sm" variant="danger" icon={<XCircle className="h-4 w-4" />} onClick={() => setCancelOpen(true)}>
                Cancel task
              </Button>
            </div>
          )}
        </div>
      )}
      <ConfirmDialog
        open={cancelOpen}
        title="Cancel this task?"
        message={
          <div className="space-y-3">
            <p>The employee is notified and the task no longer blocks their checkout.</p>
            <TextField label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        }
        confirmLabel="Cancel task"
        danger
        pending={action.pending}
        onClose={() => setCancelOpen(false)}
        onConfirm={async () => {
          await act("cancel/", { reason }, "Task cancelled.");
          setCancelOpen(false);
        }}
      />
    </Modal>
  );
}
