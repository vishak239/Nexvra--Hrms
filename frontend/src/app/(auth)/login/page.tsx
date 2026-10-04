"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { FormError } from "@/components/ui/States";
import { useAuth } from "@/lib/auth";
import { useAction } from "@/lib/hooks";

/** Only allow same-site relative redirects after login. */
function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

function LoginForm() {
  const { login, me, loading } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { run, pending, error } = useAction();

  useEffect(() => {
    if (!loading && me) router.replace(next);
  }, [loading, me, next, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const user = await run(() => login(email, password));
    if (user) router.replace(next);
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight text-primary">Sign in</h1>
      <p className="mt-1 text-sm text-on-surface-variant">Use your Nexvra work email and password.</p>
      <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
        <FormError error={error} />
        <TextField
          label="Email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={error?.fields.email}
          required
          autoFocus
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={error?.fields.password}
          required
        />
        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-sm font-medium text-primary-fixed underline-offset-4 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={pending} disabled={!email || !password}>
          Sign in
        </Button>
      </form>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
