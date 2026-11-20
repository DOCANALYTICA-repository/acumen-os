/**
 * Seeds a local Acumen database with the 5 rounds (Round 1 host-led guesstimate, Rounds 2/3/5 played
 * off the platform with "mark as done" and organiser marks, Round 4 the economy simulation with its
 * setup auction), sample guesstimate questions, Home content and (optionally) demo teams.
 *
 * Local test accounts (development only — change or delete before going live):
 *   Admin:  admin@acumen.test  / Acumen@Admin2026
 *   Judge:  judge@acumen.test  / Acumen@Judge2026
 *   Demo participants: <first>.<last>@demo.acumen.test / Demo@2026
 *
 * Run: npm run db:reset   (wipes and reseeds)   |   SEED_DEMO=0 to skip demo teams
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { EV_TEMPLATE } from "../src/lib/sim/model";
import { initialMarket } from "../src/lib/sim/engine";

const db = new PrismaClient();
const DAY = 86_400_000;

function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

/** Demo guesstimates. The numbers are approximate public figures: check them before using these at the event. */
const GUESSTIMATES: { text: string; answer: number; note: string }[] = [
  { text: "How many passenger vehicles were sold in India in FY 2023-24?", answer: 4_220_000, note: "About 4.2 million (SIAM). Demo figure: verify before the event." },
  { text: "How many UPI transactions were made in India in December 2024?", answer: 16_730_000_000, note: "About 16.7 billion (NPCI). Demo figure: verify before the event." },
  { text: "How many smartphones were shipped in India in calendar year 2024?", answer: 151_000_000, note: "About 151 million (IDC). Demo figure: verify before the event." },
  { text: "How many retail petrol pumps are there in India?", answer: 90_000, note: "Roughly 88,000–90,000 in 2024 (PPAC). Demo figure: verify before the event." },
  { text: "How many passengers does Indian Railways carry on an average day?", answer: 19_000_000, note: "About 6.9 billion passengers a year ÷ 365. Demo figure: verify before the event." },
  { text: "How long is India's national highway network, in kilometres?", answer: 146_000, note: "About 1.46 lakh km (MoRTH, 2024). Demo figure: verify before the event." },
];

async function main() {
  // wipe in dependency order
  await db.$transaction([
    db.score.deleteMany(),
    db.judgeAssignment.deleteMany(),
    db.resultOverride.deleteMany(),
    db.qualification.deleteMany(),
    db.submission.deleteMany(),
    db.attempt.deleteMany(),
    db.rubricCriterion.deleteMany(),
    db.question.deleteMany(),
    db.round.deleteMany(),
    db.teamMember.deleteMany(),
    db.team.deleteMany(),
    db.user.deleteMany(),
    db.asset.deleteMany(),
    db.announcement.deleteMany(),
    db.content.deleteMany(),
    db.auditLog.deleteMany(),
  ]);

  const now = Date.now();
  await db.user.create({
    data: { fullName: "Acumen Admin", email: "admin@acumen.test", passwordHash: await bcrypt.hash("Acumen@Admin2026", 10), role: "ADMIN", college: "Organizing team" },
  });
  await db.user.create({
    data: { fullName: "Demo Judge", email: "judge@acumen.test", passwordHash: await bcrypt.hash("Acumen@Judge2026", 10), role: "JUDGE", college: "Industry panel" },
  });

  // Round 1: host-led guesstimate.
  const quiz = await db.round.create({
    data: {
      order: 1, name: "Round 1 — Guesstimate", type: "QUIZ", weight: 20, status: "SCHEDULED",
      startsAt: new Date(now - DAY), endsAt: new Date(now + 7 * DAY),
      description: "Estimate the numbers behind the Indian economy. The host shows one question at a time on the main screen.",
      instructions:
        "Keep this page open on a phone or laptop. For each question, type one number and press Save; any teammate can save and the latest save counts. " +
        "You can change your answer while the host is on that question, even if the host comes back to it later.\n" +
        "Scoring per question: within 5% of the correct answer = 3 points, within 10% = 2, within 20% = 1, otherwise 0. " +
        "When the round ends you get a read-only answer sheet.",
    },
  });
  for (const [i, q] of GUESSTIMATES.entries())
    await db.question.create({ data: { roundId: quiz.id, order: i, type: "NUMBER", text: q.text, options: "[]", answer: JSON.stringify(q.answer), marks: 3, explanation: q.note } });

  // Rounds 2, 3 and 5 happen off the platform: teams mark them done, organisers enter marks.
  const manual = [
    { order: 2, name: "Round 2 — On-ground Challenge", status: "SCHEDULED", start: -DAY, end: 7 * DAY, maxMarks: 50, link: "", linkLabel: "Open assignment",
      description: "This round happens in person at the venue. There is nothing to submit here.",
      instructions: "When your team has finished the challenge, press “Mark as done”. The organisers verify your work and enter your marks." },
    { order: 3, name: "Round 3 — Case Brief", status: "SCHEDULED", start: -DAY, end: 10 * DAY, maxMarks: 100, link: "", linkLabel: "Open Google Classroom",
      description: "Write a 2-page analysis of the case. Submit it on Google Classroom.",
      instructions: "Upload your file to the Round 3 assignment on Google Classroom, then press “Mark as done” here so the organisers know to check it." },
    { order: 5, name: "Round 5 — Final Pitch", status: "DRAFT", start: 22 * DAY, end: 28 * DAY, maxMarks: 100, link: "", linkLabel: "Open Google Classroom",
      description: "Submit your final deck on Google Classroom and pitch to the jury.",
      instructions: "Upload your deck to the Round 5 assignment on Google Classroom, then press “Mark as done” here." },
  ];
  const manualRounds = [];
  for (const m of manual)
    manualRounds.push(
      await db.round.create({
        data: {
          order: m.order, name: m.name, type: "MANUAL", weight: 20, status: m.status, startsAt: new Date(now + m.start), endsAt: new Date(now + m.end),
          description: m.description, instructions: m.instructions, settings: JSON.stringify({ maxMarks: m.maxMarks, link: m.link, linkLabel: m.linkLabel }),
        },
      }),
    );

  // Round 4: the economy simulation. Starts in SETUP; run the auction from Admin → Simulation control.
  const simRound = await db.round.create({
    data: {
      order: 4, name: "Round 4 — Economy Simulation", type: "SIMULATION", weight: 20, status: "SCHEDULED",
      startsAt: new Date(now - DAY), endsAt: new Date(now + 10 * DAY),
      description: "Build a company in a shared electric-mobility economy. Win your business identity and resources at auction, then run your company for five simulated years against the other teams.",
      instructions:
        "Setup auction: every team starts with the same budget. Bid for one business identity and, if you like, resources that give a lasting edge. Money you don't spend is your starting cash.\n" +
        "Each year (about 9 minutes): set price, production, capacity, bank borrowing and spending on marketing, sales, customer service, employees, technology and sustainability. All teams' decisions are processed together.\n" +
        "Deals: negotiate supply contracts, technology licences, loans and co-marketing alliances with other teams. The deal type is fixed; the numbers are yours to negotiate. Signed deals are binding.\n" +
        "The economy moves: GDP growth, inflation, interest rates, tax and events change demand and costs.\n" +
        "You may use any outside tools, including AI. The simulation engine alone decides outcomes.\n" +
        "At the end: awards for most profitable, highest revenue, highest market share and more. Marks combine profit, revenue, market share, satisfaction, brand and reliability.",
    },
  });
  const simEcon = await db.simEconomy.create({ data: { roundId: simRound.id, config: JSON.stringify(EV_TEMPLATE), market: JSON.stringify(initialMarket(EV_TEMPLATE)) } });
  await db.simEvent.createMany({ data: EV_TEMPLATE.scheduledEvents.map((e) => ({ economyId: simEcon.id, cycle: e.cycle, title: e.title, description: e.description, effects: JSON.stringify(e.effects) })) });


  if (process.env.SEED_DEMO === "0") return;

  // ---- demo teams for analytics ----
  const rand = rng(7);
  const colleges = ["St. Xavier's College", "Christ University", "SRCC", "NMIMS", "Loyola College", "IIM Indore (IPM)", "Symbiosis", "Hindu College"];
  const cities = ["Mumbai", "Bengaluru", "Delhi", "Chennai", "Pune", "Indore"];
  const sources = ["Instagram", "Friend", "College club", "LinkedIn", "WhatsApp"];
  const first = ["Aarav", "Diya", "Kabir", "Meera", "Rohan", "Ananya", "Vihaan", "Isha", "Arjun", "Sara", "Neel", "Tara", "Dev", "Riya", "Kiran", "Maya"];
  const last = ["Shah", "Iyer", "Mehta", "Rao", "Kapoor", "Nair", "Das", "Singh"];
  const teamNames = ["Bull Run", "Margin Masters", "Pivot Table", "Quant Squad", "Cash Flow Crew", "Delta Force", "Alpha Seekers", "Ledger Legends", "Data Dons", "Blue Chips", "Hedgehogs", "The Arbitrageurs", "Spreadsheet Sages", "Market Makers"];
  const pw = await bcrypt.hash("Demo@2026", 10);
  const [round2, round3] = manualRounds;

  let n = 0;
  for (const [ti, name] of teamNames.entries()) {
    const created = new Date(now - (20 - ti) * DAY * 0.9 - rand() * DAY);
    const size = ti % 5 === 4 ? 1 : 2; // teams are pairs; every 5th demo team is still waiting for its partner
    const college = colleges[Math.floor(rand() * colleges.length)];
    const paid = ti % 5 !== 4 && ti !== 11;
    const team = await db.team.create({
      data: {
        name, inviteCode: `D${String(ti).padStart(2, "0")}${Math.floor(rand() * 9000 + 1000)}`, createdAt: created,
        paymentStatus: paid ? "PAID" : "UNPAID", transactionId: paid ? `UPI${Math.floor(rand() * 1e10)}` : null,
      },
    });
    let leadName = "";
    for (let m = 0; m < size; m++) {
      const f = first[n % first.length], l = last[(n * 3) % last.length];
      n++;
      const u = await db.user.create({
        data: {
          fullName: `${f} ${l}`, email: `${f.toLowerCase()}.${l.toLowerCase()}${n}@demo.acumen.test`, passwordHash: pw,
          phone: `+91 98${Math.floor(rand() * 1e8).toString().padStart(8, "0")}`, college, year: ["1st year", "2nd year", "3rd year"][m % 3],
          city: cities[Math.floor(rand() * cities.length)], source: sources[Math.floor(rand() * sources.length)], createdAt: new Date(created.getTime() + m * 3600_000),
        },
      });
      if (m === 0) leadName = u.fullName;
      await db.teamMember.create({ data: { teamId: team.id, userId: u.id, isLead: m === 0, joinedAt: u.createdAt } });
    }
    if (!paid) continue;
    const skill = 0.35 + rand() * 0.6;
    // Round 2 (on-ground): most teams marked done and were scored. Round 3: some marked done, not yet scored.
    if (ti % 3 !== 2)
      await db.attempt.create({
        data: {
          roundId: round2.id, teamId: team.id, startedAt: new Date(now - DAY / 3), submittedAt: new Date(now - DAY / 3 + 40 * 60_000),
          answers: JSON.stringify({ markedBy: leadName }), manualScore: Math.round(50 * Math.min(1, skill + (rand() - 0.5) * 0.3) * 2) / 2,
        },
      });
    if (ti % 2 === 0)
      await db.attempt.create({ data: { roundId: round3.id, teamId: team.id, submittedAt: new Date(now - DAY / 6), answers: JSON.stringify({ markedBy: leadName }) } });
  }
}

main()
  .then(() => console.log("Seed complete."))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
