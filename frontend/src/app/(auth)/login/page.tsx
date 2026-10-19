"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Field, TextField } from "@/components/ui/Field";
import { Eye, EyeOff } from "@/components/ui/icons";
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
  const [showPassword, setShowPassword] = useState(false);
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
        <Field label="Password" error={error?.fields.password} required>
          {(id, describedBy, invalid) => (
            <div className="relative">
              <input
                id={id}
                type={showPassword ? "text" : "password"}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                required
                autoComplete="current-password"
                className={`block w-full rounded border bg-surface-container-lowest px-3 text-body-md text-on-surface placeholder:text-on-surface-variant/60 transition-colors focus:border-primary-container focus:outline-none focus:ring-1 focus:ring-primary-container disabled:cursor-not-allowed disabled:opacity-60 h-11 sm:h-9 pr-10 ${invalid ? "border-error" : "border-surface-container-high"}`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((s) => !s)}
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          )}
        </Field>
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
