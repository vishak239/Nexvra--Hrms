"use client";

import { CheckCircle2, ExternalLink, LogOut } from "@/components/ui/icons";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Display";
import { TextAreaField } from "@/components/ui/Field";
import { Modal, useToast } from "@/components/ui/Overlay";
import { Alert, ErrorState, Loading } from "@/components/ui/States";
import { api } from "@/lib/api";
import { fmtDate, humanize } from "@/lib/format";
import { useAction, useResource } from "@/lib/hooks";
import type { Task } from "@/lib/types";

function TaskResponseForm({ task, onDone }: { task: Task; onDone: () => void }) {
  const toast = useToast();
  const [message, setMessage] = useState("");
  const { run, pending, error } = useAction();
  const handle = task.assigned_to.username ? `@${task.assigned_to.username}` : task.assigned_to.full_name;

  return (
    <li className="rounded-xl border border-warning-outline bg-warning-container/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-warning">Pending task</p>
          <p className="mt-0.5 font-medium text-primary">
            {handle} — {task.title}
          </p>
          <p className="mt-0.5 text-xs text-on-surface-variant">
            Assigned by {task.assigned_by?.full_name ?? "HR"}
            {task.due_date ? ` · due ${fmtDate(task.due_date)}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={task.priority === "URGENT" || task.priority === "HIGH" ? "red" : "neutral"}>{humanize(task.priority)}</Badge>
          <Link href={`/tasks?task=${task.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary-fixed hover:underline">
            Open task <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </div>
      {task.description && <p className="mt-2 whitespace-pre-line text-sm text-on-surface-variant">{task.description}</p>}
      <form
        className="mt-3 space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await run(() => api(`/api/tasks/${task.id}/respond/`, { body: { message } }));
          if (ok) {
            toast("Response submitted.");
            onDone();
          }
        }}
      >
        {error && <Alert>{error.message}</Alert>}
        <TextAreaField
          label="Response"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          error={error?.fields.message}
          placeholder="Your response or acknowledgement"
          required
        />
        <Button type="submit" size="sm" variant="dark" loading={pending} disabled={!message.trim()}>
          Submit response
        </Button>
      </form>
    </li>
  );
}

/**
 * Task checkout protection (UI side). The backend enforces the same rule on check-out, so
 * this dialog is a convenience, not the security boundary.
 */
export function CheckoutGuard({
  open,
  onClose,
  onCheckout,
  checkingOut,
}: {
  open: boolean;
  onClose: () => void;
  onCheckout: () => void;
  checkingOut: boolean;
}) {
  const { data, error, loading, reload } = useResource<{ count: number; results: Task[] }>(
    open ? "/api/tasks/blocking/" : null,
  );
  const clear = data && data.count === 0;

  return (
    <Modal
      open={open}
      size="lg"
      title={clear ? "Ready to check out" : "Respond to your tasks before checking out"}
      description="HR asked for a response on these tasks. Checkout becomes available once each one is answered."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={checkingOut}>
            Not now
          </Button>
          <Button variant="dark" icon={<LogOut className="h-4 w-4" />} onClick={onCheckout} disabled={!clear} loading={checkingOut}>
            Checkout
          </Button>
        </>
      }
    >
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : clear ? (
        <Alert tone="success">
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" /> All required responses are submitted. You can check out now.
          </span>
        </Alert>
      ) : (
        <ul className="space-y-3">
          {data?.results.map((task) => (
            <TaskResponseForm key={task.id} task={task} onDone={reload} />
          ))}
        </ul>
      )}
    </Modal>
  );
}
