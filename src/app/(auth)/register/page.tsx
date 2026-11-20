import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getContent, registrationOpen } from "@/lib/content";
import { TEAM_SIZE } from "@/lib/rounds";
import { Card, Container } from "@/components/ui";
import { RegisterForm } from "../auth-forms";

export const metadata = { title: "Register · Acumen" };

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  const content = await getContent();
  return (
    <Container className="max-w-2xl py-12">
      <Card>
        <h1 className="mb-1 text-2xl font-bold text-ink">Register for {content.eventName}</h1>
        <p className="mb-6 text-sm text-muted">
          Step 1 of 3: create your account. Next you create or join a team (exactly {TEAM_SIZE} people), then upload your payment proof.
        </p>
        <RegisterForm closed={!registrationOpen(content)} />
      </Card>
    </Container>
  );
}
