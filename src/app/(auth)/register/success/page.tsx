import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { getContent } from "@/lib/content";
import { Card, Container, cls } from "@/components/ui";

export const metadata = { title: "Registration complete · Acumen" };

/** Registration doesn't sign the captain in (as on Bidwave): they log in from here. */
export default async function RegisterSuccess({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const { team } = await searchParams;
  const content = await getContent();
  return (
    <Container className="max-w-md py-16">
      <Card>
        <div className="flex flex-col items-center gap-5 text-center">
          <CheckCircle2 className="h-12 w-12 text-emerald-600" />
          <div>
            <h1 className="text-2xl font-bold text-ink">You&apos;re in{team ? `, ${team.slice(0, 30)}` : ""}!</h1>
            <p className="mt-2 text-sm text-muted">
              Your team is registered and active. The organisers will check your payment receipt; round details appear on your dashboard as they open.
            </p>
          </div>
          {content.community && (
            <div className="w-full space-y-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-800">Join the {content.eventName} WhatsApp group</p>
              <p className="text-xs text-emerald-900/80">Both of you should join for updates and announcements.</p>
              <a href={content.community} target="_blank" rel="noopener noreferrer" className={`${cls.btn} ${cls.primary} w-full`}>Join on WhatsApp</a>
            </div>
          )}
          <Link href="/login" className={`${cls.btn} ${cls.secondary} w-full`}>Log in to your dashboard</Link>
          <p className="text-xs text-muted">Log in with the captain&apos;s email and the password you just set.</p>
        </div>
      </Card>
    </Container>
  );
}
