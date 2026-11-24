"use client";

import { useActionState } from "react";
import { staffLogin, type StaffLoginState } from "@/app/actions/staff";
import { Alert, Field, cls } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

const SPAM_NOTE = "The code can take a minute to arrive. Check spam or promotions if you don't see it.";

/** Blossoms-style staff sign-in: invited email, then the 6-digit one-time code Acumen emails to it through Brevo. No password. */
export function StaffLoginForm() {
  const [state, action] = useActionState<StaffLoginState, FormData>(staffLogin, { step: "email" });

  if (state.step === "code")
    return (
      <form action={action} className="space-y-4">
        <Alert tone="blue">
          We emailed a sign-in code to <strong className="break-all">{state.email}</strong>. {SPAM_NOTE}
        </Alert>
        {state.info && <Alert tone="green">{state.info}</Alert>}
        {state.error && <Alert tone="red">{state.error}</Alert>}
        <Field label="Code from the email">
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="••••••"
            autoFocus
            className={`${cls.input} text-center text-xl tracking-[0.4em] tabular-nums`}
          />
        </Field>
        <SubmitButton name="intent" value="verify" pendingText="Checking…" className="w-full">Sign in</SubmitButton>
        <div className="flex items-center justify-between text-sm">
          <button type="submit" name="intent" value="back" className={cls.ghost}>Use a different email</button>
          <button type="submit" name="intent" value="resend" className="font-medium text-muted hover:text-ink hover:underline">Resend code</button>
        </div>
      </form>
    );

  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert tone="red">{state.error}</Alert>}
      <Field label="Staff email" hint="The email an Acumen admin invited. We email you a sign-in code.">
        <input name="email" type="email" required autoComplete="email" defaultValue={state.email} className={cls.input} />
      </Field>
      <SubmitButton name="intent" value="send" pendingText="Sending code…" className="w-full">Email me a code</SubmitButton>
      <p className="text-center text-xs text-muted">{SPAM_NOTE}</p>
    </form>
  );
}
