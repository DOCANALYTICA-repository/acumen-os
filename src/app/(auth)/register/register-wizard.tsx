"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Compass, Crown, ExternalLink } from "lucide-react";
import { registerTeam, type FormState } from "@/app/actions/auth";
import { checkTeamName } from "@/app/actions/team";
import { Alert, Field, cls } from "@/components/ui";
import { memberSchema, receiptError, registrationSchema, SOURCES, teamNameSchema, YEARS, type MemberInput } from "@/lib/registration";

const STEPS = ["Team", "Members", "Login", "Payment", "Review"] as const;

type Member = { [K in keyof MemberInput]: string };
const emptyMember = (): Member => ({ fullName: "", email: "", phone: "", college: "", year: "" });

type Values = {
  teamName: string;
  members: [Member, Member];
  city: string;
  source: string;
  password: string;
  passwordConfirm: string;
  transactionId: string;
  receipt: File | null;
  consent: boolean;
};

export type PaymentInfo = { fee: string; instructions: string; link: string; steps: string[] };

export function RegisterWizard({ payment, eventName }: { payment: PaymentInfo; eventName: string }) {
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Values>({
    teamName: "",
    members: [emptyMember(), emptyMember()],
    city: "",
    source: "",
    password: "",
    passwordConfirm: "",
    transactionId: "",
    receipt: null,
    consent: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [nameCheck, setNameCheck] = useState<{ ok: boolean; message: string } | null>(null);
  const [state, formAction, submitting] = useActionState<FormState, FormData>(registerTeam, undefined);

  // Server rejected (duplicate email/name, closed…): show it on the review step.
  useEffect(() => {
    if (state?.error) setError(state.error);
  }, [state]);

  // Live team-name availability.
  useEffect(() => {
    const name = values.teamName.trim();
    if (!teamNameSchema.safeParse(name).success) {
      setNameCheck(null);
      return;
    }
    const t = setTimeout(async () => setNameCheck(await checkTeamName(name)), 350);
    return () => clearTimeout(t);
  }, [values.teamName]);

  // Any edit clears the step's error: it described the old input, not what's there now.
  const patch = (p: Partial<Values>) => {
    setError(null);
    setValues((v) => ({ ...v, ...p }));
  };
  const patchMember = (i: 0 | 1, p: Partial<Member>) => {
    setError(null);
    setValues((v) => {
      const members = [...v.members] as [Member, Member];
      members[i] = { ...members[i], ...p };
      return { ...v, members };
    });
  };

  /** Validates only what the current step owns. */
  function stepError(i: number): string | null {
    if (i === 0) {
      const r = teamNameSchema.safeParse(values.teamName);
      if (!r.success) return r.error.issues[0].message;
      if (nameCheck && !nameCheck.ok) return nameCheck.message;
      return null;
    }
    if (i === 1) {
      for (const [k, m] of values.members.entries()) {
        const r = memberSchema.safeParse(m);
        if (!r.success) return `${k === 0 ? "Captain" : "Teammate"}: ${r.error.issues[0].message}`;
      }
      if (values.members[0].email.trim().toLowerCase() === values.members[1].email.trim().toLowerCase()) return "Each member needs a different email.";
      return null;
    }
    if (i === 2) {
      if (values.password.length < 8) return "Password must be at least 8 characters.";
      if (values.password !== values.passwordConfirm) return "Passwords do not match.";
      return null;
    }
    if (i === 3) return receiptError(values.receipt);
    if (i === 4) {
      if (!values.consent) return "Please accept to continue.";
      const r = registrationSchema.safeParse(values);
      return r.success ? null : r.error.issues[0].message;
    }
    return null;
  }

  function next() {
    const e = stepError(step);
    setError(e);
    if (!e) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function submit() {
    for (let i = 0; i < STEPS.length; i++) {
      const e = stepError(i);
      if (e) {
        setError(e);
        setStep(i);
        return;
      }
    }
    setError(null);
    const fd = new FormData();
    fd.set("teamName", values.teamName.trim());
    fd.set("members", JSON.stringify(values.members));
    fd.set("password", values.password);
    fd.set("passwordConfirm", values.passwordConfirm);
    fd.set("city", values.city);
    fd.set("source", values.source);
    fd.set("transactionId", values.transactionId);
    if (values.consent) fd.set("consent", "on");
    if (values.receipt) fd.set("receipt", values.receipt);
    startTransition(() => formAction(fd));
  }

  return (
    <div>
      <ol className="mb-6 grid grid-cols-5 gap-1.5" aria-label="Registration steps">
        {STEPS.map((label, i) => (
          <li key={label} className="min-w-0" aria-current={i === step ? "step" : undefined}>
            <div className={`h-1.5 rounded-full ${i <= step ? "bg-brand" : "bg-line"}`} />
            <div className={`mt-1.5 truncate text-[11px] font-medium ${i === step ? "text-ink" : "text-muted"}`}>
              {i < step ? <Check className="mr-0.5 inline h-3 w-3" /> : null}
              {label}
            </div>
          </li>
        ))}
      </ol>

      {error && <div className="mb-4"><Alert tone="red">{error}</Alert></div>}

      {step === 0 && (
        <div className="space-y-4">
          <p className="text-sm text-muted">One of you (the captain) registers the whole team of two. The captain&apos;s email and password become the team&apos;s login.</p>
          <Field label="Team name" hint="3–30 characters, unique across Acumen">
            <input value={values.teamName} onChange={(e) => patch({ teamName: e.target.value })} maxLength={30} className={cls.input} autoFocus />
            {nameCheck && <span className={`mt-1 block text-xs font-medium ${nameCheck.ok ? "text-emerald-700" : "text-red-600"}`}>{nameCheck.message}</span>}
          </Field>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-6">
          {([0, 1] as const).map((i) => (
            <fieldset key={i} className="min-w-0 rounded-2xl border border-line p-4">
              <legend className="px-1 text-sm font-semibold text-ink">
                {i === 0 ? <><Crown className="mr-1 inline h-4 w-4 text-amber-500" />Captain (you)</> : "Teammate"}
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Full name" hint="As it should appear on certificates"><input value={values.members[i].fullName} onChange={(e) => patchMember(i, { fullName: e.target.value })} className={cls.input} autoComplete={i === 0 ? "name" : "off"} /></Field>
                <Field label="Email" hint={i === 0 ? "Your team's login" : "For updates; your teammate doesn't log in"}><input type="email" value={values.members[i].email} onChange={(e) => patchMember(i, { email: e.target.value })} className={cls.input} autoComplete={i === 0 ? "email" : "off"} /></Field>
                <Field label="Phone"><input type="tel" value={values.members[i].phone} onChange={(e) => patchMember(i, { phone: e.target.value })} className={cls.input} placeholder="+91 98xxxxxxxx" /></Field>
                <Field label="College"><input value={values.members[i].college} onChange={(e) => patchMember(i, { college: e.target.value })} className={cls.input} /></Field>
                <Field label="Year / course">
                  <select value={values.members[i].year} onChange={(e) => patchMember(i, { year: e.target.value })} className={cls.input}>
                    <option value="" disabled>Select</option>
                    {YEARS.map((y) => <option key={y}>{y}</option>)}
                  </select>
                </Field>
              </div>
            </fieldset>
          ))}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="City (optional)"><input value={values.city} onChange={(e) => patch({ city: e.target.value })} className={cls.input} /></Field>
            <Field label={`How did you hear about ${eventName}? (optional)`}>
              <select value={values.source} onChange={(e) => patch({ source: e.target.value })} className={cls.input}>
                <option value="">Select</option>
                {SOURCES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="break-words text-sm text-muted">The team logs in with <strong className="text-ink">{values.members[0].email || "the captain's email"}</strong> and this password.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Password" hint="At least 8 characters"><input type="password" value={values.password} onChange={(e) => patch({ password: e.target.value })} className={cls.input} autoComplete="new-password" /></Field>
            <Field label="Confirm password"><input type="password" value={values.passwordConfirm} onChange={(e) => patch({ passwordConfirm: e.target.value })} className={cls.input} autoComplete="new-password" /></Field>
          </div>
        </div>
      )}

      {step === 3 && <PaymentStep payment={payment} values={values} patch={patch} />}

      {step === 4 && (
        <div className="space-y-4">
          <div className="space-y-3 rounded-2xl border border-line p-4 text-sm">
            <div><div className="text-xs font-semibold uppercase tracking-wide text-muted">Team</div><div className="text-base font-semibold text-ink">{values.teamName}</div></div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">Members</div>
              <ul className="mt-1 space-y-1">
                {values.members.map((m, i) => (
                  <li key={i} className="break-words">{i === 0 && <Crown className="mr-1 inline h-3.5 w-3.5 text-amber-500" />}{m.fullName} <span className="text-muted">· {m.email} · {m.phone} · {m.college} · {m.year}</span></li>
                ))}
              </ul>
            </div>
            <div><div className="text-xs font-semibold uppercase tracking-wide text-muted">Payment receipt</div><div className="break-all">{values.receipt?.name ?? "—"}{values.transactionId ? ` · ref ${values.transactionId}` : ""}</div></div>
          </div>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" checked={values.consent} onChange={(e) => patch({ consent: e.target.checked })} className="mt-1" />
            <span>We are college students and agree that our details are used to run {eventName} and are visible to the organisers.</span>
          </label>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between gap-3">
        {step > 0 ? (
          <button type="button" onClick={() => { setError(null); setStep(step - 1); }} disabled={submitting} className={`${cls.btn} ${cls.secondary}`}>Back</button>
        ) : (
          <span className="text-sm text-muted">Already registered? <Link href="/login" className={cls.ghost}>Log in</Link></span>
        )}
        {step < STEPS.length - 1 ? (
          <button type="button" onClick={next} className={`${cls.btn} ${cls.primary}`}>Continue</button>
        ) : (
          <button type="button" onClick={submit} disabled={submitting} className={`${cls.btn} ${cls.primary}`}>{submitting ? "Registering…" : "Complete registration"}</button>
        )}
      </div>
    </div>
  );
}

function PaymentStep({ payment, values, patch }: { payment: PaymentInfo; values: Values; patch: (p: Partial<Values>) => void }) {
  const guide = useRef<HTMLDialogElement>(null);
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-surface p-4 text-sm">
        <div className="font-semibold text-ink">Registration fee: {payment.fee}</div>
        {payment.instructions && <p className="mt-1 whitespace-pre-line text-muted">{payment.instructions}</p>}
        {payment.link && (
          <a href={payment.link} target="_blank" rel="noopener noreferrer" className={`${cls.btn} ${cls.primary} mt-3`}>
            Open payment portal <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>

      {payment.steps.length > 0 && (
        <>
          <button type="button" onClick={() => guide.current?.showModal()} className="flex w-full items-center gap-2 rounded-2xl border border-line p-3 text-left text-sm transition-colors hover:bg-surface">
            <Compass className="h-4 w-4 shrink-0 text-muted" />
            <span className="font-semibold text-ink">Guide for payment</span>
            <span className="ml-auto text-muted">View steps →</span>
          </button>
          <dialog
            ref={guide}
            aria-label="Guide for payment"
            className="m-auto w-[min(92vw,28rem)] rounded-3xl border border-line bg-white p-6 text-ink shadow-2xl backdrop:bg-slate-900/40"
            onClick={(e) => { if (e.target === guide.current) guide.current?.close(); }}
          >
            <h2 className="text-lg font-semibold">Guide for payment</h2>
            <p className="mt-1 text-sm text-muted">Follow these steps on the payment portal, then attach your receipt.</p>
            <ol className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {payment.steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sky-50 text-xs font-semibold text-sky-700">{i + 1}</span>
                  <span className="pt-0.5 text-sm text-ink/80">{s}</span>
                </li>
              ))}
            </ol>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              {payment.link && <a href={payment.link} target="_blank" rel="noopener noreferrer" className={`${cls.btn} ${cls.secondary}`}>Open portal</a>}
              <button type="button" onClick={() => guide.current?.close()} className={`${cls.btn} ${cls.primary}`}>Got it</button>
            </div>
          </dialog>
        </>
      )}

      <Field label="Payment receipt" hint="Screenshot or PDF of the receipt: JPG, PNG, WEBP or PDF, up to 4 MB">
        <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => patch({ receipt: e.target.files?.[0] ?? null })} className={cls.input} />
        {values.receipt && <span className="mt-1 block break-all text-xs text-muted">Attached: {values.receipt.name}</span>}
      </Field>
      <Field label="Transaction / reference ID (optional)" hint="From the receipt; helps the organisers match your payment">
        <input value={values.transactionId} onChange={(e) => patch({ transactionId: e.target.value })} maxLength={64} className={cls.input} />
      </Field>
    </div>
  );
}
