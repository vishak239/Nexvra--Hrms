"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Alert, FormError } from "@/components/ui/States";
import { api, ensureCsrf } from "@/lib/api";
import { useAction } from "@/lib/hooks";

function ResetForm() {
  const params = useSearchParams();
  const uid = params.get("uid") ?? "";
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const { run, pending, error } = useAction();
  const mismatch = confirm.length > 0 && password !== confirm;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (mismatch) return;
    const ok = await run(async () => {
      await ensureCsrf();
      return api("/api/auth/password-reset/confirm/", { body: { uid, token, new_password: password } });
    });
    if (ok) setDone(true);
  }

  if (!uid || !token) {
    return <Alert>This reset link is incomplete. Request a new one from the sign-in page.</Alert>;
  }
  if (done) {
    return (
      <div className="space-y-5">
        <Alert tone="success">Your password has been set. You can now sign in.</Alert>
        <Link href="/login" className="block text-center text-sm font-medium text-zinc-900 underline underline-offset-4">
          Go to sign in
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <FormError error={error} />
      <TextField
        label="New password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
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
      <Button type="submit" className="w-full" loading={pending} disabled={!password || mismatch}>
        Set password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="mb-8 text-2xl font-semibold tracking-tight text-zinc-900">Set a new password</h1>
      <Suspense>
        <ResetForm />
      </Suspense>
    </>
  );
}
