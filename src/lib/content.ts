import "server-only";
import { db, parseJson } from "./db";

export type SiteContent = {
  eventName: string;
  tagline: string;
  eventDates: string;
  registrationDeadline: string; // ISO date-time, "" = not set
  heroBlurb: string;
  about: string;
  prizes: string;
  teamMin: number;
  teamMax: number;
  fee: string;
  paymentInstructions: string;
  contactEmail: string;
  contactPhone: string;
  instagram: string;
  community: string;
  faq: { q: string; a: string }[];
  sponsors: { name: string; url: string }[];
};

export const DEFAULT_CONTENT: SiteContent = {
  eventName: "Acumen",
  tagline: "Think sharp. Solve sharper.",
  eventDates: "Dates to be announced",
  registrationDeadline: "",
  heroBlurb:
    "A five-round business challenge for college teams: a live guesstimate round, an on-ground challenge, a case brief, a five-year economy simulation with a setup auction, and a final pitch.",
  about:
    "Acumen is an inter-college competition that tests how teams think with numbers, data and strategy. Teams move through five rounds, with the strongest advancing at each stage.",
  prizes: "Prize pool, internships and certificates to be announced.",
  teamMin: 2,
  teamMax: 4,
  fee: "To be announced",
  paymentInstructions:
    "Pay the registration fee by UPI or bank transfer to the details shared by the organizers, then upload a screenshot and the transaction ID here.",
  contactEmail: "acumen@example.com",
  contactPhone: "",
  instagram: "",
  community: "",
  faq: [
    { q: "Who can participate?", a: "Acumen is open to college students only. Teams can include students from different colleges." },
    { q: "How do teams work?", a: "One member creates the team and shares the invite code; teammates join with that code." },
    { q: "How do rounds work?", a: "Round 1 is a live guesstimate: the host shows each question on the main screen and your team answers with one number on this site; the closer you are, the more points. Round 2 happens in person, and Rounds 3 and 5 are submitted on Google Classroom: for these, mark the round done here and the organisers enter your marks. Round 4 is an economy simulation: teams bid for a business identity and resources at an auction, then run their companies for five simulated years, striking deals with each other as the economy shifts. Top teams advance after each cut-off." },
    { q: "How do I pay?", a: "Pay outside the site and upload your payment screenshot and transaction ID from your team dashboard." },
  ],
  sponsors: [],
};

export async function getContent(): Promise<SiteContent> {
  const row = await db.content.findUnique({ where: { key: "site" } });
  return { ...DEFAULT_CONTENT, ...parseJson<Partial<SiteContent>>(row?.value, {}) };
}

export async function saveContent(content: SiteContent) {
  await db.content.upsert({
    where: { key: "site" },
    create: { key: "site", value: JSON.stringify(content) },
    update: { value: JSON.stringify(content) },
  });
}

export function registrationOpen(c: SiteContent, now = new Date()) {
  return !c.registrationDeadline || new Date(c.registrationDeadline) > now;
}
