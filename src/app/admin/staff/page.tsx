import { headers } from "next/headers";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { cancelInvite, removeStaff, setStaffRole } from "@/app/actions/staff";
import { Badge, Card, PageHeader, cls, fmtDate } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { InviteForm } from "./invite-form";

export const metadata = { title: "Staff & access · Acumen admin" };

export default async function AdminStaff() {
  const me = await requireAdmin();
  const [staff, invites, h] = await Promise.all([
    db.user.findMany({ where: { role: { in: ["ADMIN", "JUDGE"] } }, orderBy: [{ role: "asc" }, { createdAt: "asc" }] }),
    db.staffInvite.findMany({ where: { claimedAt: null }, orderBy: { createdAt: "asc" } }),
    headers(),
  ]);
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const signInLink = `${proto}://${host}/login?as=staff`;

  return (
    <>
      <PageHeader title="Staff & access" subtitle="Invite admins and judges by email. They sign in with a code sent to that email, no password." />

      <Card title="Invite someone" className="mb-6">
        <InviteForm />
        <p className="mt-3 text-sm text-muted">
          Then send them the staff sign-in link: <code className="break-all rounded bg-white/70 px-1.5 py-0.5 text-ink">{signInLink}</code>
        </p>
        <p className="mt-1 text-xs text-muted">Admins can manage everything. Judges only see the judging pages for submissions assigned to them.</p>
      </Card>

      <Card title={`Waiting to sign in (${invites.length})`} className="mb-6">
        {invites.length === 0 ? (
          <p className="text-sm text-muted">No pending invites.</p>
        ) : (
          <ul className="divide-y divide-line">
            {invites.map((i) => (
              <li key={i.email} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  {i.fullName} <span className="break-all text-xs text-muted">{i.email}</span>{" "}
                  <Badge tone={i.role === "ADMIN" ? "brand" : "blue"}>{i.role.toLowerCase()}</Badge>{" "}
                  <span className="text-xs text-muted">invited {fmtDate(i.createdAt)}</span>
                </span>
                <form action={cancelInvite}>
                  <input type="hidden" name="email" value={i.email} />
                  <SubmitButton variant="secondary" className="px-2 py-1 text-xs" confirm={`Cancel the invite for ${i.email}?`}>Cancel invite</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Staff accounts (${staff.length})`}>
        <ul className="divide-y divide-line">
          {staff.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0">
                {u.fullName} <span className="break-all text-xs text-muted">{u.email}</span>{" "}
                <Badge tone={u.role === "ADMIN" ? "brand" : "blue"}>{u.role.toLowerCase()}</Badge>
                {u.id === me.id && <span className="ml-1 text-xs text-muted">(you)</span>}
              </span>
              {u.id !== me.id && (
                <span className="flex items-center gap-2">
                  <form action={setStaffRole} className="flex items-center gap-1">
                    <input type="hidden" name="id" value={u.id} />
                    <select name="role" defaultValue={u.role} aria-label={`Role for ${u.fullName}`} className={`${cls.input} w-28 py-1 text-xs`}>
                      <option value="ADMIN">Admin</option>
                      <option value="JUDGE">Judge</option>
                    </select>
                    <SubmitButton variant="secondary" className="px-2 py-1 text-xs">Save</SubmitButton>
                  </form>
                  <form action={removeStaff}>
                    <input type="hidden" name="id" value={u.id} />
                    <SubmitButton variant="secondary" className="px-2 py-1 text-xs" confirm={`Remove ${u.email}? They lose access immediately.`}>Remove</SubmitButton>
                  </form>
                </span>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
