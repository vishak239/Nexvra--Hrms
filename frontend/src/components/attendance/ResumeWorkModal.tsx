"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { TextAreaField } from "@/components/ui/Field";
import { Modal, useToast } from "@/components/ui/Overlay";
import { FormError } from "@/components/ui/States";
import { api } from "@/lib/api";
import { fmtTime } from "@/lib/format";
import { useAction } from "@/lib/hooks";
import type { WorkSessionState } from "@/lib/types";

const MIN_REASON = 10;

/**
 * Resume Work after an automatic inactivity check-out: the employee explains, HR / Admin decide.
 * Approval does not check anyone in - the employee checks in again (with the usual location /
 * work-from-home validation) and a new working segment starts.
 */
export function ResumeWorkModal({
  open,
  checkedOutAt,
  onClose,
  onDone,
}: {
  open: boolean;
  checkedOutAt: string | null;
  onClose: () => void;
  onDone: (state: WorkSessionState) => void;
}) {
  const toast = useToast();
  const { run, pending, error, setError } = useAction();
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) return;
    setReason("");
    setError(undefined);
  }, [open, setError]);

  const valid = reason.trim().length >= MIN_REASON;
  const f = error?.fields ?? {};

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || pending) return;
    const res = await run(() => api<{ state: WorkSessionState }>("/api/attendance/resume-requests/", { body: { reason } }));
    if (res) {
      toast("Request sent — waiting for HR/Admin approval.");
      onDone(res.state);
    }
  }

  return (
    <Modal
      open={open}
      title="Resume Work"
      description={
        checkedOutAt
          ? `You were checked out automatically at ${fmtTime(checkedOutAt)} after a period without activity. Tell HR / Admin why, to continue working today.`
          : "Tell HR / Admin why you were inactive, to continue working today."
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="resume-form" loading={pending} disabled={!valid}>
            Submit Request
          </Button>
        </>
      }
    >
      <form id="resume-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError error={error && !Object.keys(f).length ? error : undefined} />
        <TextAreaField
          label="Reason"
          placeholder="For example: I was attending an offline discussion."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={f.reason ?? (reason && reason.trim().length < MIN_REASON ? `At least ${MIN_REASON} characters.` : undefined)}
          hint="After approval, check in again to continue. The time until then is recorded as non-working time."
          maxLength={1000}
          required
        />
      </form>
    </Modal>
  );
}
