import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getContent, registrationOpen } from "@/lib/content";
import { Alert, Card, Container } from "@/components/ui";
import { RegisterWizard } from "./register-wizard";

export const metadata = { title: "Register your team · Acumen" };

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  const content = await getContent();
  return (
    <Container className="max-w-2xl py-12">
      <Card>
        <h1 className="mb-1 text-2xl font-bold text-ink">Register your team for {content.eventName}</h1>
        <p className="mb-6 text-sm text-muted">Teams of two. One person registers both of you and pays; it takes about five minutes.</p>
        {registrationOpen(content) ? (
          <RegisterWizard
            eventName={content.eventName}
            payment={{ fee: content.fee, instructions: content.paymentInstructions, link: content.paymentLink, steps: content.paymentSteps }}
          />
        ) : (
          <Alert tone="amber">Registrations are closed.</Alert>
        )}
      </Card>
    </Container>
  );
}
