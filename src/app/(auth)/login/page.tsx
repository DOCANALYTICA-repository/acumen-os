import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Card, Container } from "@/components/ui";
import { LoginForm } from "../auth-forms";
import { StaffLoginForm } from "../staff-login-form";

export const metadata = { title: "Log in · Acumen" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const user = await getCurrentUser();
  if (user) redirect(user.role === "ADMIN" ? "/admin" : user.role === "JUDGE" ? "/judge" : "/dashboard");
  const staff = (await searchParams).as === "staff";
  const tab = (active: boolean) =>
    `rounded-full px-4 py-2 text-center text-sm font-semibold transition ${active ? "bg-white text-ink shadow-soft" : "text-muted hover:text-ink"}`;
  return (
    <Container className="max-w-md py-16">
      <nav aria-label="Sign in as" className="mb-4 grid grid-cols-2 gap-1 rounded-full border border-line/80 bg-white/50 p-1">
        <Link href="/login" aria-current={!staff ? "page" : undefined} className={tab(!staff)}>Team</Link>
        <Link href="/login?as=staff" aria-current={staff ? "page" : undefined} className={tab(staff)}>Staff</Link>
      </nav>
      <Card>
        {staff ? (
          <>
            <h1 className="mb-1 text-2xl font-bold text-ink">Staff sign in</h1>
            <p className="mb-6 text-sm text-muted">For organisers and judges invited by an Acumen admin.</p>
            <StaffLoginForm />
          </>
        ) : (
          <>
            <h1 className="mb-1 text-2xl font-bold text-ink">Welcome back</h1>
            <p className="mb-6 text-sm text-muted">Teams log in with the captain&apos;s email and the password set at registration.</p>
            <LoginForm />
          </>
        )}
      </Card>
    </Container>
  );
}
