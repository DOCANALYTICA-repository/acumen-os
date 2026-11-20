"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { checkTeamName, renameTeam, reuploadReceipt } from "@/app/actions/team";
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

/** Shown only after an organiser rejects the receipt. */
export function ReceiptForm() {
  const [state, action] = useActionState<FormState, FormData>(reuploadReceipt, undefined);
  return (
    <form action={action} className="space-y-4">
      <Result state={state} />
      <Field label="New payment receipt" hint="JPG, PNG, WEBP or PDF, up to 4 MB">
        <input name="receipt" type="file" required accept="image/png,image/jpeg,image/webp,application/pdf" className={cls.input} />
      </Field>
      <Field label="Transaction / reference ID (optional)">
        <input name="transactionId" className={cls.input} maxLength={64} />
      </Field>
      <SubmitButton pendingText="Uploading…">Send new receipt</SubmitButton>
    </form>
  );
}
