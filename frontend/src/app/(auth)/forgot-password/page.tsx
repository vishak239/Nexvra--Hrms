"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Alert, FormError } from "@/components/ui/States";
import { api, ensureCsrf } from "@/lib/api";
import { useAction } from "@/lib/hooks";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const { run, pending, error } = useAction();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ok = await run(async () => {
      await ensureCsrf();
      return api("/api/auth/password-reset/", { body: { email } });
    });
    if (ok) setSent(true);
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Reset your password</h1>
      <p className="mt-1 text-sm text-zinc-500">Enter your work email and we&apos;ll send you a reset link.</p>
      <div className="mt-8 space-y-5">
        {sent ? (
          <Alert tone="success">If an account exists for {email}, a reset link has been sent. Check your inbox.</Alert>
        ) : (
          <form onSubmit={onSubmit} className="space-y-5" noValidate>
            <FormError error={error} />
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={error?.fields.email}
              required
              autoFocus
            />
            <Button type="submit" className="w-full" loading={pending} disabled={!email}>
              Send reset link
            </Button>
          </form>
        )}
        <Link href="/login" className="block text-center text-sm font-medium text-zinc-700 underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </div>
    </>
  );
}
