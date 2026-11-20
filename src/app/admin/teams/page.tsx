import Link from "next/link";
import { db } from "@/lib/db";
import { TEAM_SIZE, teamStatus, TEAM_STATUS_LABEL, type TeamStatus } from "@/lib/rounds";
import { fileUrl } from "@/lib/files";
import { adminAddMember, adminRemoveMember, adminUpdateMember, saveTeamNote, setPaymentStatus, toggleDisqualify } from "@/app/actions/admin";
import { YEARS } from "@/lib/registration";
import { Badge, Card, Field, PageHeader, cls, fmtDate, statusTone, DownloadLink } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

type MemberDefaults = { fullName: string; email: string; phone: string; college: string; year: string };

/** Name, email, phone, college and year inputs shared by the edit and add forms. */
function MemberFields({ d }: { d?: MemberDefaults }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Field label="Full name"><input name="fullName" required defaultValue={d?.fullName} className={cls.input} /></Field>
      <Field label="Email"><input name="email" type="email" required defaultValue={d?.email} className={cls.input} /></Field>
      <Field label="Phone"><input name="phone" required defaultValue={d?.phone} className={cls.input} /></Field>
      <Field label="College"><input name="college" required defaultValue={d?.college} className={cls.input} /></Field>
      <Field label="Year / course">
        <select name="year" required defaultValue={d?.year && (YEARS as readonly string[]).includes(d.year) ? d.year : ""} className={cls.input}>
          <option value="" disabled>Select</option>
          {YEARS.map((y) => <option key={y}>{y}</option>)}
        </select>
      </Field>
    </div>
  );
}

const FILTERS: [string, string][] = [["all", "All"], ["INCOMPLETE", "Incomplete"], ["COMPLETE", "Payment due"], ["PAID", "Paid"], ["PAYMENT_REJECTED", "Rejected"], ["DISQUALIFIED", "Disqualified"], ["dup", "Duplicate txn"]];

export default async function AdminTeams({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string }> }) {
  const { q = "", filter = "all" } = await searchParams;
  const teams = await db.team.findMany({ include: { members: { include: { user: true }, orderBy: { joinedAt: "asc" } } }, orderBy: { createdAt: "desc" } });
  const txnCount = new Map<string, number>();
  for (const t of teams) if (t.transactionId) txnCount.set(t.transactionId, (txnCount.get(t.transactionId) ?? 0) + 1);

  const rows = teams
    .map((t) => ({ t, status: teamStatus(t, t.members.length) as TeamStatus, dup: !!t.transactionId && txnCount.get(t.transactionId)! > 1 }))
    .filter(({ t, status, dup }) => {
      if (filter === "dup" && !dup) return false;
      if (filter !== "all" && filter !== "dup" && status !== filter) return false;
      if (!q) return true;
      const hay = [t.name, t.transactionId, ...t.members.flatMap((m) => [m.user.fullName, m.user.email, m.user.college])].join(" ").toLowerCase();
      return hay.includes(q.toLowerCase());
    });

  return (
    <>
      <PageHeader title="Teams" subtitle={`${rows.length} of ${teams.length} teams`} actions={<DownloadLink href="/api/admin/export/teams">Export CSV</DownloadLink>} />
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Search team, member, email, college, txn ID" className={`${cls.input} max-w-sm`} />
        <input type="hidden" name="filter" value={filter} />
        <button className={`${cls.btn} ${cls.secondary}`}>Search</button>
      </form>
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map(([k, label]) => (
          <Link key={k} href={`/admin/teams?filter=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`rounded-full px-3 py-1 text-xs font-medium ${filter === k ? "bg-brand text-white" : "bg-white text-ink border border-line"}`}>{label}</Link>
        ))}
      </div>

      <div className="space-y-4">
        {rows.map(({ t, status, dup }) => (
          <Card key={t.id}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold text-ink">{t.name}</h3>
                  <Badge tone={statusTone(status)}>{TEAM_STATUS_LABEL[status]}</Badge>
                  {dup && <Badge tone="red">Duplicate txn ID</Badge>}
                </div>
                <div className="mt-1 text-xs text-muted">Registered {fmtDate(t.createdAt)} · {t.members.length}/{TEAM_SIZE} members</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {t.paymentStatus !== "PAID" && t.paymentScreenshot && (
                  <form action={setPaymentStatus}><input type="hidden" name="teamId" value={t.id} /><input type="hidden" name="status" value="PAID" /><SubmitButton variant="secondary" className="px-3 py-1.5 text-xs">Accept receipt</SubmitButton></form>
                )}
                {t.paymentStatus === "PAID" && (
                  <form action={setPaymentStatus}><input type="hidden" name="teamId" value={t.id} /><input type="hidden" name="status" value="REJECTED" /><SubmitButton variant="secondary" className="px-3 py-1.5 text-xs" confirm={`Reject ${t.name}'s payment? They lose access to rounds until the captain attaches a new receipt.`}>Reject receipt</SubmitButton></form>
                )}
                <form action={toggleDisqualify}><input type="hidden" name="teamId" value={t.id} /><SubmitButton variant={t.disqualified ? "secondary" : "danger"} className="px-3 py-1.5 text-xs" confirm={t.disqualified ? `Reinstate ${t.name}?` : `Disqualify ${t.name}?`}>{t.disqualified ? "Reinstate" : "Disqualify"}</SubmitButton></form>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-[1fr_260px]">
              <table className="w-full">
                <thead><tr><th className={cls.th}>Member</th><th className={cls.th}>Contact</th><th className={cls.th}>College</th><th className={cls.th}></th></tr></thead>
                <tbody>
                  {t.members.map((m) => (
                    <tr key={m.id} className="border-t border-line">
                      <td className={cls.td}>{m.user.fullName} {m.isLead && <Badge tone="brand">Captain</Badge>}</td>
                      <td className={`${cls.td} text-xs`}>{m.user.email}<br />{m.user.phone}</td>
                      <td className={`${cls.td} text-xs`}>{m.user.college}<br />{m.user.year}</td>
                      <td className={`${cls.td} align-top`}>
                        <details>
                          <summary className="cursor-pointer text-xs font-medium text-brand">Edit</summary>
                          <form action={adminUpdateMember} className="mt-2 w-[min(80vw,26rem)] space-y-2">
                            <input type="hidden" name="memberId" value={m.id} />
                            <MemberFields d={m.user} />
                            {m.isLead && <Field label="New password (optional)" hint="Sets a new login password for the captain; tell them privately"><input name="newPassword" type="password" minLength={8} autoComplete="new-password" className={cls.input} /></Field>}
                            <SubmitButton variant="secondary" className="px-2 py-1 text-xs">Save member</SubmitButton>
                          </form>
                        </details>
                        {!m.isLead && <form action={adminRemoveMember} className="mt-1"><input type="hidden" name="memberId" value={m.id} /><SubmitButton variant="secondary" className="px-2 py-1 text-xs" confirm={`Remove ${m.user.fullName} from ${t.name}? Their account is deleted so the email can register again.`}>Remove</SubmitButton></form>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {t.members.length < TEAM_SIZE && (
                <details className="md:col-start-1">
                  <summary className="cursor-pointer text-sm font-medium text-brand">Add a member ({t.members.length}/{TEAM_SIZE})</summary>
                  <form action={adminAddMember} className="mt-2 max-w-xl space-y-2">
                    <input type="hidden" name="teamId" value={t.id} />
                    <MemberFields />
                    <SubmitButton variant="secondary" className="px-3 py-1.5 text-xs">Add member</SubmitButton>
                  </form>
                </details>
              )}
              <div className="space-y-3 rounded-lg bg-surface p-3 text-sm md:col-start-2 md:row-start-1">
                <div>
                  <div className="text-xs font-medium text-muted">Payment</div>
                  {t.paymentScreenshot ? (
                    <>
                      <a href={fileUrl(t.paymentScreenshot)} target="_blank" className={cls.ghost}>View receipt</a>
                      <div className="font-mono text-xs">{t.transactionId}</div>
                    </>
                  ) : <div className="text-muted">Not uploaded</div>}
                </div>
                <form action={saveTeamNote} className="space-y-2">
                  <input type="hidden" name="teamId" value={t.id} />
                  <textarea name="notes" rows={2} defaultValue={t.notes ?? ""} placeholder="Internal notes" className={cls.input} />
                  <SubmitButton variant="secondary" className="px-2 py-1 text-xs">Save note</SubmitButton>
                </form>
              </div>
            </div>
          </Card>
        ))}
        {rows.length === 0 && <p className="text-sm text-muted">No teams match.</p>}
      </div>
    </>
  );
}
