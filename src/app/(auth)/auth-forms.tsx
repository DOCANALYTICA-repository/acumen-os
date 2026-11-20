"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, type FormState } from "@/app/actions/auth";
import { Alert, Field, cls } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export function LoginForm() {
  const [state, action] = useActionState<FormState, FormData>(login, undefined);
  return (
    <form action={action} className="space-y-4">
      {state?.error && <Alert tone="red">{state.error}</Alert>}
      <Field label="Email">
        <input name="email" type="email" required autoComplete="email" className={cls.input} />
      </Field>
      <Field label="Password">
        <input name="password" type="password" required autoComplete="current-password" className={cls.input} />
      </Field>
      <SubmitButton pendingText="Logging in…" className="w-full">Log in</SubmitButton>
      <p className="text-center text-sm text-muted">
        New to Acumen? <Link href="/register" className={cls.ghost}>Register</Link>
      </p>
    </form>
  );
}
