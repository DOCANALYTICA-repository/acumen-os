import { db } from "@/lib/db";
import { Badge, Card, PageHeader, cls, fmtDate, DownloadLink } from "@/components/ui";

export default async function AdminParticipants({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const users = await db.user.findMany({ where: { role: "PARTICIPANT" }, include: { membership: { include: { team: true } } }, orderBy: { createdAt: "desc" } });
  const rows = q
    ? users.filter((u) => [u.fullName, u.email, u.phone, u.college, u.city, u.membership?.team.name].join(" ").toLowerCase().includes(q.toLowerCase()))
    : users;
  return (
    <>
      <PageHeader title="Participants" subtitle={`${rows.length} of ${users.length} registered students`} actions={<DownloadLink href="/api/admin/export/participants">Export CSV</DownloadLink>} />
      <form className="mb-4 flex gap-2">
        <input name="q" defaultValue={q} placeholder="Search name, email, phone, college, team" className={`${cls.input} max-w-sm`} />
        <button className={`${cls.btn} ${cls.secondary}`}>Search</button>
      </form>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr><th className={cls.th}>Name</th><th className={cls.th}>Contact</th><th className={cls.th}>College</th><th className={cls.th}>City</th><th className={cls.th}>Source</th><th className={cls.th}>Team</th><th className={cls.th}>Joined</th></tr></thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-t border-line">
                  <td className={cls.td}>{u.fullName}</td>
                  <td className={`${cls.td} text-xs`}>{u.email}<br />{u.phone}</td>
                  <td className={`${cls.td} text-xs`}>{u.college}<br />{u.year}</td>
                  <td className={cls.td}>{u.city ?? "—"}</td>
                  <td className={cls.td}>{u.source ?? "—"}</td>
                  <td className={cls.td}>{u.membership ? <>{u.membership.team.name} {u.membership.isLead && <Badge tone="brand">Lead</Badge>}</> : <Badge tone="amber">No team</Badge>}</td>
                  <td className={`${cls.td} text-xs`}>{fmtDate(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
