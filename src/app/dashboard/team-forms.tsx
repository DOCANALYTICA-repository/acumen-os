"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { checkTeamName, createTeam, joinTeam, renameTeam, uploadPayment } from "@/app/actions/team";
import type { FormState } from "@/app/actions/auth";
import { Alert, Field, cls } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

function Result({ state }: { state: FormState }) {
  if (state?.error) return <Alert tone="red">{state.error}</Alert>;
  if (state?.ok) return <Alert tone="green">{state.ok}</Alert>;
  return null;
}

function TeamNameInput({ defaultValue = "" }: { defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue);
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(null);
  const [, start] = useTransition();
  useEffect(() => {
    if (!value.trim() || value.trim() === defaultValue) return setCheck(null);
    const t = setTimeout(() => start(async () => setCheck(await checkTeamName(value))), 350);
    return () => clearTimeout(t);
  }, [value, defaultValue]);
  return (
    <Field label="Team name" hint="3–30 characters, unique across Acumen">
      <input name="name" required value={value} onChange={(e) => setValue(e.target.value)} className={cls.input} maxLength={30} />
      {check && <span className={`mt-1 block text-xs font-medium ${check.ok ? "text-emerald-700" : "text-red-600"}`}>{check.message}</span>}
    </Field>
  );
}

export function CreateTeamForm() {
  const [state, action] = useActionState<FormState, FormData>(createTeam, undefined);
  return (
    <form action={action} className="space-y-4">
      <Result state={state} />
      <TeamNameInput />
      <SubmitButton pendingText="Creating…">Create team</SubmitButton>
    </form>
  );
}

export function JoinTeamForm({ code = "" }: { code?: string }) {
  const [state, action] = useActionState<FormState, FormData>(joinTeam, undefined);
  return (
    <form action={action} className="space-y-4">
      <Result state={state} />
      <Field label="Invite code" hint="6 characters, from your team lead">
        <input name="code" required defaultValue={code} maxLength={6} className={`${cls.input} font-mono uppercase tracking-widest`} />
      </Field>
      <SubmitButton pendingText="Joining…">Join team</SubmitButton>
    </form>
  );
}

export function RenameTeamForm({ current }: { current: string }) {
  const [state, action] = useActionState<FormState, FormData>(renameTeam, undefined);
  return (
    <form action={action} className="space-y-3">
      <Result state={state} />
      <TeamNameInput defaultValue={current} />
      <SubmitButton variant="secondary">Rename</SubmitButton>
    </form>
  );
}

export function PaymentForm() {
  const [state, action] = useActionState<FormState, FormData>(uploadPayment, undefined);
  return (
    <form action={action} className="space-y-4">
      <Result state={state} />
      <Field label="Payment screenshot" hint="JPG, PNG, WEBP or PDF, up to 5 MB">
        <input name="screenshot" type="file" required accept="image/png,image/jpeg,image/webp,application/pdf" className={cls.input} />
      </Field>
      <Field label="Transaction / UTR ID">
        <input name="transactionId" required className={cls.input} maxLength={64} />
      </Field>
      <SubmitButton pendingText="Uploading…">Submit payment proof</SubmitButton>
    </form>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`${cls.btn} ${cls.secondary} px-3 py-1.5`}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}
