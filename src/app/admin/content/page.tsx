import Link from "next/link";
import { db } from "@/lib/db";
import { getContent } from "@/lib/content";
import { addAnnouncement, deleteAsset, saveSiteContent, toggleAnnouncement, addAsset } from "@/app/actions/admin";
import { Badge, Card, Field, PageHeader, cls, fmtDate } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

function toIstInput(iso: string) {
  return iso ? new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 16) : "";
}

export default async function AdminContent() {
  const [c, announcements, assets] = await Promise.all([
    getContent(),
    db.announcement.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
    db.asset.findMany({ orderBy: { createdAt: "desc" } }),
  ]);
  return (
    <>
      <PageHeader title="Content & settings" subtitle="Home page text, event rules, announcements, and downloads" />

      <Card title="Event settings & Home page" className="mb-6">
        <form action={saveSiteContent} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Event name"><input name="eventName" defaultValue={c.eventName} className={cls.input} /></Field>
            <Field label="Tagline"><input name="tagline" defaultValue={c.tagline} className={cls.input} /></Field>
            <Field label="Event dates (shown on Home)"><input name="eventDates" defaultValue={c.eventDates} className={cls.input} /></Field>
            <Field label="Registration deadline (IST)" hint="Rosters lock after this. Leave empty to keep open."><input type="datetime-local" name="registrationDeadline" defaultValue={toIstInput(c.registrationDeadline)} className={cls.input} /></Field>
            <Field label="Registration fee (text)"><input name="fee" defaultValue={c.fee} className={cls.input} /></Field>
            <Field label="Contact email"><input name="contactEmail" defaultValue={c.contactEmail} className={cls.input} /></Field>
            <Field label="Contact phone"><input name="contactPhone" defaultValue={c.contactPhone} className={cls.input} /></Field>
            <Field label="Instagram URL"><input name="instagram" defaultValue={c.instagram} className={cls.input} /></Field>
            <Field label="WhatsApp group link" hint="Shown on the registration success page so every member joins"><input name="community" defaultValue={c.community} className={cls.input} /></Field>
            <Field label="Payment portal link" hint="The “Open payment portal” button in the registration payment step"><input name="paymentLink" type="url" defaultValue={c.paymentLink} className={cls.input} /></Field>
          </div>
          <Field label="Payment instructions" hint="Short note above the payment guide (fee, what the receipt must show)"><textarea name="paymentInstructions" rows={2} defaultValue={c.paymentInstructions} className={cls.input} /></Field>
          <Field label="Guide for payment" hint="One step per line, shown in the “Guide for payment” dialog during registration"><textarea name="paymentSteps" rows={8} defaultValue={c.paymentSteps.join("\n")} className={cls.input} /></Field>
          <Field label="Hero text"><textarea name="heroBlurb" rows={2} defaultValue={c.heroBlurb} className={cls.input} /></Field>
          <Field label="About"><textarea name="about" rows={4} defaultValue={c.about} className={cls.input} /></Field>
          <Field label="Prizes"><textarea name="prizes" rows={2} defaultValue={c.prizes} className={cls.input} /></Field>
          <Field label="FAQ" hint="Question on the first line, answer below; blank line between entries"><textarea name="faq" rows={8} defaultValue={c.faq.map((f) => `${f.q}\n${f.a}`).join("\n\n")} className={cls.input} /></Field>
          <Field label="Sponsors" hint="One per line: Name | https://link"><textarea name="sponsors" rows={3} defaultValue={c.sponsors.map((s) => `${s.name} | ${s.url}`).join("\n")} className={cls.input} /></Field>
          <SubmitButton>Save</SubmitButton>
        </form>
      </Card>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card title="Announcement banner">
          <form action={addAnnouncement} className="mb-4 flex gap-2">
            <input name="message" placeholder="e.g. Quiz round goes live at 6 PM" className={cls.input} />
            <SubmitButton>Post</SubmitButton>
          </form>
          <ul className="space-y-2">
            {announcements.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3 text-sm">
                <span>{a.message} <span className="block text-xs text-muted">{fmtDate(a.createdAt)}</span></span>
                <form action={toggleAnnouncement}><input type="hidden" name="id" value={a.id} /><SubmitButton variant="secondary" className="px-2 py-1 text-xs">{a.active ? "Hide" : "Show"}</SubmitButton></form>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Staff accounts">
          <p className="text-sm text-muted">Admins and judges are invited by email in <Link href="/admin/staff" className={cls.ghost}>Staff &amp; access</Link>. They sign in with a code, no password.</p>
        </Card>
      </div>

      <Card title="Assets & downloads">
        <form action={addAsset} className="mb-4 grid gap-2 md:grid-cols-[1fr_160px_180px_1fr_auto]">
          <input name="title" placeholder="Title (e.g. Rulebook)" className={cls.input} />
          <input name="category" placeholder="Category" className={cls.input} />
          <select name="visibility" className={cls.input}><option value="PUBLIC">Public</option><option value="PARTICIPANTS">Participants only</option></select>
          <input name="url" type="url" required placeholder="https://drive.google.com/…" className={cls.input} />
          <SubmitButton>Add link</SubmitButton>
        </form>
        <ul className="divide-y divide-line">
          {assets.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-2 text-sm">
              <span><a href={a.url} target="_blank" rel="noreferrer" className={cls.ghost}>{a.title}</a> <span className="text-xs text-muted">{a.category}</span> <Badge>{a.visibility === "PUBLIC" ? "public" : "participants"}</Badge></span>
              <form action={deleteAsset}><input type="hidden" name="id" value={a.id} /><SubmitButton variant="secondary" className="px-2 py-1 text-xs" confirm={`Delete ${a.title}?`}>Delete</SubmitButton></form>
            </li>
          ))}
          {assets.length === 0 && <li className="py-2 text-sm text-muted">No resources yet. Add Google Drive or Docs links; set sharing to “Anyone with the link”. “Participants only” hides the link from the public home page.</li>}
        </ul>
      </Card>
    </>
  );
}
