"use client";

import { useActionState } from "react";
import { submitFiles } from "@/app/actions/rounds";
import type { FormState } from "@/app/actions/auth";
import { Alert, Field, cls } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export function SubmissionForm({ roundId, accept, maxFiles, maxSizeMB, allowLinks, late }: {
  roundId: string; accept: string[]; maxFiles: number; maxSizeMB: number; allowLinks: boolean; late: boolean;
}) {
  const [state, action] = useActionState<FormState, FormData>(submitFiles, undefined);
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
      <Field label={`File${maxFiles > 1 ? "s" : ""}`} hint={`${accept.join(", ").toUpperCase()} · up to ${maxSizeMB} MB each · max ${maxFiles} file${maxFiles > 1 ? "s" : ""}`}>
        <input
          type="file"
          name="files"
          multiple={maxFiles > 1}
          accept={accept.map((a) => `.${a}`).join(",")}
          className="block w-full cursor-pointer rounded-lg border-2 border-dashed border-line bg-surface px-4 py-6 text-sm file:mr-4 file:rounded-md file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-white"
        />
      </Field>
      {allowLinks && (
        <Field label="Links (optional)" hint="Drive, YouTube, GitHub or Figma — https:// links, separated by spaces or new lines">
          <textarea name="links" rows={2} className={cls.input} />
        </Field>
      )}
      <SubmitButton pendingText="Uploading…">Submit</SubmitButton>
    </form>
  );
}
