"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, register, type FormState } from "@/app/actions/auth";
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

export function RegisterForm({ closed }: { closed: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(register, undefined);
  if (closed) return <Alert tone="amber">Registrations are closed.</Alert>;
  return (
    <form action={action} className="space-y-4">
      {state?.error && <Alert tone="red">{state.error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" hint="As it should appear on certificates">
          <input name="fullName" required className={cls.input} autoComplete="name" />
        </Field>
        <Field label="Email">
          <input name="email" type="email" required className={cls.input} autoComplete="email" />
        </Field>
        <Field label="Password" hint="At least 8 characters">
          <input name="password" type="password" required minLength={8} className={cls.input} autoComplete="new-password" />
        </Field>
        <Field label="Phone" hint="With country code, e.g. +91 98xxxxxxxx">
          <input name="phone" type="tel" required className={cls.input} autoComplete="tel" />
        </Field>
        <Field label="College">
          <input name="college" required className={cls.input} list="colleges" />
        </Field>
        <Field label="Year / course">
          <select name="year" required className={cls.input} defaultValue="">
            <option value="" disabled>Select</option>
            <option>1st year</option>
            <option>2nd year</option>
            <option>3rd year</option>
            <option>4th year</option>
            <option>Postgraduate</option>
          </select>
        </Field>
        <Field label="City (optional)">
          <input name="city" className={cls.input} />
        </Field>
        <Field label="How did you hear about Acumen? (optional)">
          <select name="source" className={cls.input} defaultValue="">
            <option value="">Select</option>
            <option>Instagram</option>
            <option>LinkedIn</option>
            <option>WhatsApp</option>
            <option>Friend</option>
            <option>College club</option>
            <option>Other</option>
          </select>
        </Field>
      </div>
      <label className="flex items-start gap-2 text-sm text-ink">
        <input type="checkbox" name="consent" required className="mt-1" />
        <span>I am a college student and agree that my details are used to run Acumen and are visible to the organizers.</span>
      </label>
      <SubmitButton pendingText="Creating account…" className="w-full">Create account</SubmitButton>
      <p className="text-center text-sm text-muted">
        Already registered? <Link href="/login" className={cls.ghost}>Log in</Link>
      </p>
    </form>
  );
}
