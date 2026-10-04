"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { TextAreaField, TextField } from "@/components/ui/Field";
import { Modal, useToast } from "@/components/ui/Overlay";
import { FormError } from "@/components/ui/States";
import { api } from "@/lib/api";
import { useAction } from "@/lib/hooks";

function nextDay(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Ask HR for permission to work from home on a date. HR or a Super Admin decides. */
export function WfhRequestModal({
  open,
  defaultDate,
  minDate,
  onClose,
  onDone,
}: {
  open: boolean;
  /** Today when the employee has not checked in yet; otherwise the next day is suggested. */
  defaultDate?: string;
  minDate?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const { run, pending, error, setError } = useAction();
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");

  useEffect(() => {
    if (!open) return;
    setDate(defaultDate ?? (minDate ? nextDay(minDate) : ""));
    setReason("");
    setRemarks("");
    setError(undefined);
  }, [open, defaultDate, minDate, setError]);

  const valid = !!date && reason.trim().length >= 5;
  const f = error?.fields ?? {};

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || pending) return;
    const ok = await run(() => api("/api/attendance/wfh/", { body: { date, reason, remarks } }));
    if (ok) {
      toast("Work-from-home request sent to HR.");
      onDone();
    }
  }

  return (
    <Modal
      open={open}
      title="Request work from home"
      description="Once HR approves it, you can check in from home on that day."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="wfh-form" loading={pending} disabled={!valid}>
            Send request
          </Button>
        </>
      }
    >
      <form id="wfh-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError error={error && !Object.keys(f).length ? error : undefined} />
        <TextField label="Date" type="date" value={date} min={minDate} onChange={(e) => setDate(e.target.value)} error={f.date} required />
        <TextAreaField
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={f.reason ?? (reason && reason.trim().length < 5 ? "At least 5 characters." : undefined)}
          maxLength={500}
          required
        />
        <TextAreaField label="Remarks" hint="Optional." value={remarks} onChange={(e) => setRemarks(e.target.value)} error={f.remarks} maxLength={500} />
      </form>
    </Modal>
  );
}
