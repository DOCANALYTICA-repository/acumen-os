import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Card, Container } from "@/components/ui";
import { LoginForm } from "../auth-forms";

export const metadata = { title: "Log in · Acumen" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <Container className="max-w-md py-16">
      <Card>
        <h1 className="mb-1 text-2xl font-bold text-ink">Welcome back</h1>
        <p className="mb-6 text-sm text-muted">Log in to your Acumen account.</p>
        <LoginForm />
      </Card>
    </Container>
  );
}
