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
  fee: string;
  paymentInstructions: string;
  /** Where teams pay (e.g. the university payment portal). Shown as a button in the registration payment step. */
  paymentLink: string;
  /** Step-by-step guide shown in the "Guide for payment" dialog, one step per entry. */
  paymentSteps: string[];
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
  fee: "To be announced",
  paymentInstructions: "Pay the registration fee on the payment portal, then attach the receipt below.",
  paymentLink: "https://christuniversity.in/online-payment-portal",
  paymentSteps: [
    "Open the payment portal (button above)",
    "Select Office: Other",
    "Select Category: Other",
    "Scroll down and select Bangalore Central Campus (you will be redirected to a new page)",
    "Select Fee Name: Events",
    "Select Category: Fest",
    "Select the Acumen event in the second Category list (organisers: check the exact name in Admin → Content)",
    "Continue and fill in the payment form (you may put \"-\" for PAN if you don't have one)",
    "Once paid, download or screenshot the receipt and attach it in the next field",
  ],
  contactEmail: "acumen@example.com",
  contactPhone: "",
  instagram: "",
  community: "",
  faq: [
    { q: "Who can participate?", a: "Acumen is open to college students only. Teams can include students from different colleges." },
    { q: "How do teams work?", a: "Teams are exactly two people. One of you (the captain) registers the whole team: team name, both members' details, payment receipt. The captain's email and password are the team's login." },
    { q: "How do rounds work?", a: "Round 1 is a live guesstimate: the host shows each question on the main screen and your team answers with one number on this site; the closer you are, the more points. Round 2 happens in person, and Rounds 3 and 5 are submitted on Google Classroom: for these, mark the round done here and the organisers enter your marks. Round 4 is an economy simulation: teams bid for a business identity and resources at an auction, then run their companies for five simulated years, striking deals with each other as the economy shifts. Top teams advance after each cut-off." },
    { q: "How do I pay?", a: "Registration has a payment step: open the payment portal, follow the guide, pay, and attach the receipt. Your team is active as soon as you finish registering; the organisers check receipts afterwards." },
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
