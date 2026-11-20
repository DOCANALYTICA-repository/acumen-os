"use client";

import { useActionState } from "react";
import { setRoundDone, submitLinks } from "@/app/actions/rounds";
import type { FormState } from "@/app/actions/auth";
import { Alert, Field, cls } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

/** Judged rounds: title, optional summary and up to 5 https:// links. Nothing is uploaded to the site. */
export function SubmissionForm({ roundId, maxLinks, late }: { roundId: string; maxLinks: number; late: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(submitLinks, undefined);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="roundId" value={roundId} />
      {late && <Alert tone="amber">The deadline has passed. This will be marked as a late submission.</Alert>}
      {state?.error && <Alert tone="red">{state.error}</Alert>}
      {state?.ok && <Alert tone="green">{state.ok}</Alert>}
      <Field label="Title">
        <input name="title" required maxLength={120} className={cls.input} />
      </Field>
      <Field label="Summary (optional)" hint="A short description for the judges">
        <textarea name="summary" rows={3} maxLength={3000} className={cls.input} />
      </Field>
      <Field label="Links" hint={`Google Drive, Classroom, YouTube or similar. Start each with https://, one per line, up to ${maxLinks}. Make sure the organisers can open them.`}>
        <textarea name="links" rows={3} required className={cls.input} placeholder="https://drive.google.com/…" />
      </Field>
      <SubmitButton pendingText="Submitting…">Submit</SubmitButton>
    </form>
  );
}

/** Off-platform rounds: mark done (optionally with a link to the work), or undo. */
export function MarkDoneForm({ roundId, done }: { roundId: string; done: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(setRoundDone, undefined);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="roundId" value={roundId} />
      <input type="hidden" name="done" value={done ? "0" : "1"} />
      {state?.error && <Alert tone="red">{state.error}</Alert>}
      {done ? (
        <SubmitButton variant="secondary" pendingText="Updating…" confirm="Undo 'done'? Only do this if your team has not actually finished.">Undo</SubmitButton>
      ) : (
        <>
          <Field label="Link to your work (optional)" hint="e.g. your Google Classroom submission or Drive folder. Must start with https://">
            <input name="link" type="url" inputMode="url" maxLength={500} placeholder="https://classroom.google.com/…" className={cls.input} />
          </Field>
          <SubmitButton pendingText="Saving…" confirm="Mark this round as done for your whole team?">Mark as done</SubmitButton>
        </>
      )}
    </form>
  );
}
