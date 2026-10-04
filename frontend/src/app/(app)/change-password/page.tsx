"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Card, PageHeader } from "@/components/ui/Display";
import { TextField } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Overlay";
import { FormError } from "@/components/ui/States";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAction } from "@/lib/hooks";

export default function ChangePasswordPage() {
  const { refresh } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const { run, pending, error } = useAction();
  const mismatch = confirm.length > 0 && next !== confirm;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    const ok = await run(() =>
      api("/api/auth/change-password/", { body: { current_password: current, new_password: next } }),
    );
    if (ok) {
      await refresh();
      toast("Password changed.");
      router.replace("/dashboard");
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Change password" />
      <Card className="p-6">
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          <FormError error={error} />
          <TextField
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            error={error?.fields.current_password}
            required
          />
          <TextField
            label="New password"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            error={error?.fields.new_password}
            hint="At least 8 characters. Avoid common or all-numeric passwords."
            required
          />
          <TextField
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            error={mismatch ? "Passwords don't match." : undefined}
            required
          />
          <div className="flex justify-end">
            <Button type="submit" loading={pending} disabled={!current || !next || mismatch}>
              Update password
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
