"use client";

import { useActionState, useEffect, useRef } from "react";
import { inviteStaff, type InviteState } from "@/app/actions/staff";
import { Alert, cls } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export function InviteForm() {
  const [state, action] = useActionState<InviteState, FormData>(inviteStaff, undefined);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={action} className="space-y-3">
      {state?.error && <Alert tone="red">{state.error}</Alert>}
      {state?.ok && <Alert tone="green">{state.ok}</Alert>}
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_140px_auto]">
        <input name="fullName" required placeholder="Full name" aria-label="Full name" className={cls.input} />
        <input name="email" type="email" required placeholder="Email" aria-label="Email" className={cls.input} />
        <select name="role" defaultValue="ADMIN" aria-label="Role" className={cls.input}>
          <option value="ADMIN">Admin</option>
          <option value="JUDGE">Judge</option>
        </select>
        <SubmitButton pendingText="Inviting…">Invite</SubmitButton>
      </div>
    </form>
  );
}
