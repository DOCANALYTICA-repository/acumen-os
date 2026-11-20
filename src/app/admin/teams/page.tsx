import Link from "next/link";
import { db } from "@/lib/db";
import { TEAM_SIZE, teamStatus, TEAM_STATUS_LABEL, type TeamStatus } from "@/lib/rounds";
import { fileUrl } from "@/lib/files";
import { adminRemoveMember, saveTeamNote, setPaymentStatus, toggleDisqualify } from "@/app/actions/admin";
import { Badge, Card, PageHeader, cls, fmtDate, statusTone, DownloadLink } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

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
                <div className="mt-1 text-xs text-muted">Created {fmtDate(t.createdAt)} · code <span className="font-mono">{t.inviteCode}</span> · {t.members.length}/{TEAM_SIZE} members</div>
              </div>
              <div className="flex flex-wrap gap-2">
                {t.paymentStatus !== "PAID" && t.paymentScreenshot && (
                  <form action={setPaymentStatus}><input type="hidden" name="teamId" value={t.id} /><input type="hidden" name="status" value="PAID" /><SubmitButton variant="secondary" className="px-3 py-1.5 text-xs">Accept payment</SubmitButton></form>
                )}
                {t.paymentStatus === "PAID" && (
                  <form action={setPaymentStatus}><input type="hidden" name="teamId" value={t.id} /><input type="hidden" name="status" value="REJECTED" /><SubmitButton variant="secondary" className="px-3 py-1.5 text-xs" confirm={`Reject ${t.name}'s payment? They lose access to rounds until they re-upload.`}>Reject payment</SubmitButton></form>
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
                      <td className={cls.td}>{m.user.fullName} {m.isLead && <Badge tone="brand">Lead</Badge>}</td>
                      <td className={`${cls.td} text-xs`}>{m.user.email}<br />{m.user.phone}</td>
                      <td className={`${cls.td} text-xs`}>{m.user.college}<br />{m.user.year}</td>
                      <td className={cls.td}><form action={adminRemoveMember}><input type="hidden" name="memberId" value={m.id} /><SubmitButton variant="secondary" className="px-2 py-1 text-xs" confirm={`Remove ${m.user.fullName} from ${t.name}?`}>Remove</SubmitButton></form></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="space-y-3 rounded-lg bg-surface p-3 text-sm">
                <div>
                  <div className="text-xs font-medium text-muted">Payment</div>
                  {t.paymentScreenshot ? (
                    <>
                      <a href={fileUrl(t.paymentScreenshot)} target="_blank" className={cls.ghost}>View screenshot</a>
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
