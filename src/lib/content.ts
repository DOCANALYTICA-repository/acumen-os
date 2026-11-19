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
    "A five-round business and analytics challenge for college teams: a live quiz, an Excel case, a startup ecosystem simulation, and two case submissions judged by industry experts.",
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
    { q: "How do rounds work?", a: "Round 1 is a live quiz: the host shows each question on the main screen and every team answers from a phone or laptop at the same time, with faster correct answers scoring more. Round 2 is an Excel case on this site. Round 3 is a written case submission. Round 4 is a live business simulation: every team runs a startup in one shared economy, negotiating and competing over several cycles. Round 5 is the final pitch. Top teams advance after each cut-off." },
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
