/**
 * Seeds a local Acumen database with the 5 rounds, sample quiz questions, an Excel case,
 * rubrics, Home content and (optionally) demo teams for analytics.
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
import * as XLSX from "xlsx";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";

const db = new PrismaClient();
const DAY = 86_400_000;

function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
}

function buildExcelCase() {
  const regions = ["North", "South", "East", "West"];
  const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
  const rand = rng(42);
  const rows: { Region: string; Month: string; Units: number; Price: number }[] = [];
  for (const Region of regions)
    for (const Month of months)
      rows.push({ Region, Month, Units: 200 + Math.floor(rand() * 600), Price: 40 + Math.floor(rand() * 4) * 5 });

  const revenue = (r: (typeof rows)[number]) => r.Units * r.Price;
  const total = rows.reduce((s, r) => s + revenue(r), 0);
  const byRegion = regions.map((g) => [g, rows.filter((r) => r.Region === g).reduce((s, r) => s + revenue(r), 0)] as const);
  const best = [...byRegion].sort((a, b) => b[1] - a[1])[0][0];
  const northAvg = rows.filter((r) => r.Region === "North").reduce((s, r) => s + r.Units, 0) / months.length;
  const southMar = revenue(rows.find((r) => r.Region === "South" && r.Month === "2026-03")!);
  const over500 = rows.filter((r) => r.Units > 500).length;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Data");
  const answers = XLSX.utils.aoa_to_sheet([
    ["Question", "Your answer"],
    ["Q1. Total revenue (Units x Price) across all rows", ""],
    ["Q2. Region with the highest total revenue", ""],
    ["Q3. Average monthly units sold in North (2 decimals)", ""],
    ["Q4. Revenue for South in 2026-03", ""],
    ["Q5. Number of rows where Units > 500", ""],
  ]);
  XLSX.utils.book_append_sheet(wb, answers, "Answers");

  const rel = "rounds/excel/acumen-excel-case.xlsx";
  const abs = path.join(process.cwd(), "storage", rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));

  const key = [
    { cell: "Answers!B2", label: "Q1. Total revenue across all rows", value: String(total), tolerance: 0.01, marks: 4 },
    { cell: "Answers!B3", label: "Q2. Region with the highest total revenue", value: best, tolerance: 0, marks: 3 },
    { cell: "Answers!B4", label: "Q3. Average monthly units sold in North", value: northAvg.toFixed(2), tolerance: 0.01, marks: 4 },
    { cell: "Answers!B5", label: "Q4. Revenue for South in 2026-03", value: String(southMar), tolerance: 0.01, marks: 4 },
    { cell: "Answers!B6", label: "Q5. Rows where Units > 500", value: String(over500), tolerance: 0, marks: 5 },
  ];
  return { rel, key };
}

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
  const judge = await db.user.create({
    data: { fullName: "Demo Judge", email: "judge@acumen.test", passwordHash: await bcrypt.hash("Acumen@Judge2026", 10), role: "JUDGE", college: "Industry panel" },
  });

  const excel = buildExcelCase();

  const quiz = await db.round.create({
    data: {
      order: 1, name: "Round 1 — Quiz", type: "QUIZ", weight: 20, status: "SCHEDULED", durationMinutes: 20,
      startsAt: new Date(now - DAY), endsAt: new Date(now + 7 * DAY),
      description: "A timed quiz on business, finance and current affairs.",
      instructions: "One attempt per team. 20 minutes. Answers save automatically. Switching tabs is logged.",
    },
  });
  const quizQs = [
    { type: "SINGLE", text: "Which financial statement shows a company's assets, liabilities and equity at a point in time?", options: ["Income statement", "Balance sheet", "Cash flow statement", "Statement of retained earnings"], answer: 1 },
    { type: "SINGLE", text: "If revenue is 500 and cost of goods sold is 300, what is the gross margin?", options: ["20%", "40%", "60%", "66%"], answer: 1 },
    { type: "MULTI", text: "Which of these are current assets? (select all that apply)", options: ["Inventory", "Accounts receivable", "Machinery", "Cash"], answer: [0, 1, 3] },
    { type: "TRUEFALSE", text: "A higher P/E ratio always means a company is overvalued.", options: [], answer: false },
    { type: "SINGLE", text: "What does CAGR stand for?", options: ["Compound Annual Growth Rate", "Capital Asset Growth Ratio", "Cumulative Average Gross Return", "Current Asset Growth Rate"], answer: 0 },
    { type: "SHORT", text: "A product sells 1,200 units at 50 each. What is the revenue? (number only)", options: [], answer: "60000" },
    { type: "SINGLE", text: "Which Excel function returns a value from a table by matching a key in the first column?", options: ["SUMIF", "VLOOKUP", "COUNTA", "CONCAT"], answer: 1 },
    { type: "TRUEFALSE", text: "Break-even point is where total revenue equals total costs.", options: [], answer: true },
  ];
  for (const [i, q] of quizQs.entries())
    await db.question.create({
      data: { roundId: quiz.id, order: i, type: q.type, text: q.text, options: JSON.stringify(q.options), answer: JSON.stringify(q.answer), marks: 2, negativeMarks: q.type === "SINGLE" ? 0.5 : 0 },
    });

  const excelRound = await db.round.create({
    data: {
      order: 2, name: "Round 2 — Excel Case", type: "EXCEL", weight: 20, status: "SCHEDULED", durationMinutes: 60,
      startsAt: new Date(now - DAY), endsAt: new Date(now + 7 * DAY),
      description: "Analyse a sales dataset and answer five questions.",
      instructions: "Download the workbook, analyse the Data sheet, and enter answers below — or fill the Answers sheet and upload the file.",
      excelTemplate: excel.rel, excelAnswerKey: JSON.stringify(excel.key),
    },
  });

  const subRounds = [];
  for (const [i, s] of [
    { name: "Round 3 — Case Brief", desc: "Submit a 2-page written analysis of the case.", types: ["pdf", "docx"], start: -DAY, end: 10 },
    { name: "Round 4 — Strategy Deck", desc: "Submit a 10-slide strategy deck.", types: ["pdf", "pptx"], start: 12 * DAY, end: 20 },
    { name: "Round 5 — Final Pitch", desc: "Submit your final deck and a pitch video link.", types: ["pdf", "pptx", "mp4"], start: 22 * DAY, end: 28 },
  ].entries()) {
    const r = await db.round.create({
      data: {
        order: 3 + i, name: s.name, type: "SUBMISSION", weight: 20, status: i === 0 ? "SCHEDULED" : "DRAFT",
        startsAt: new Date(now + s.start), endsAt: new Date(now + s.end * DAY), description: s.desc,
        instructions: "Upload before the deadline. You can replace your file until the round closes; the latest version counts.",
        settings: JSON.stringify({ allowedTypes: s.types, maxSizeMB: 25, maxFiles: i === 2 ? 2 : 1, allowResubmit: true, allowLate: false, latePenaltyPct: 0, allowLinks: i === 2, anonymousJudging: true }),
      },
    });
    for (const c of [["Insight", 30], ["Feasibility", 25], ["Presentation", 20], ["Use of data", 25]] as const)
      await db.rubricCriterion.create({ data: { roundId: r.id, name: c[0], maxMarks: c[1] } });
    subRounds.push(r);
  }

  await db.announcement.create({ data: { message: "Registrations are open. Round 1 (Quiz) and Round 2 (Excel) are live for paid teams." } });

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
  const quizQuestions = await db.question.findMany({ where: { roundId: quiz.id } });
  const quizMax = quizQuestions.reduce((s, q) => s + q.marks, 0);
  const excelMax = excel.key.reduce((s, k) => s + k.marks, 0);
  const criteria = await db.rubricCriterion.findMany({ where: { roundId: subRounds[0].id } });

  let n = 0;
  for (const [ti, name] of teamNames.entries()) {
    const created = new Date(now - (20 - ti) * DAY * 0.9 - rand() * DAY);
    const size = ti % 5 === 4 ? 1 : 2 + Math.floor(rand() * 3);
    const college = colleges[Math.floor(rand() * colleges.length)];
    const paid = ti % 5 !== 4 && ti !== 11;
    const team = await db.team.create({
      data: {
        name, inviteCode: `D${String(ti).padStart(2, "0")}${Math.floor(rand() * 9000 + 1000)}`, createdAt: created,
        paymentStatus: paid ? "PAID" : "UNPAID", transactionId: paid ? `UPI${Math.floor(rand() * 1e10)}` : null,
      },
    });
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
      await db.teamMember.create({ data: { teamId: team.id, userId: u.id, isLead: m === 0, joinedAt: u.createdAt } });
    }
    if (!paid) continue;
    const skill = 0.35 + rand() * 0.6;
    await db.attempt.create({
      data: { roundId: quiz.id, teamId: team.id, startedAt: new Date(now - DAY / 2), submittedAt: new Date(now - DAY / 2 + 15 * 60_000), autoScore: Math.round(quizMax * skill), tabSwitches: rand() > 0.8 ? 3 : 0 },
    });
    if (ti % 3 !== 2)
      await db.attempt.create({
        data: { roundId: excelRound.id, teamId: team.id, startedAt: new Date(now - DAY / 3), submittedAt: new Date(now - DAY / 3 + 40 * 60_000), autoScore: Math.round(excelMax * Math.min(1, skill + (rand() - 0.5) * 0.3)) },
      });
    if (ti % 2 === 0) {
      await db.judgeAssignment.create({ data: { roundId: subRounds[0].id, teamId: team.id, judgeId: judge.id } });
      if (ti % 4 === 0)
        for (const c of criteria)
          await db.score.create({ data: { roundId: subRounds[0].id, teamId: team.id, judgeId: judge.id, criterionId: c.id, marks: Math.round(c.maxMarks * Math.min(1, skill + 0.1)) } });
    }
  }
}

main()
  .then(() => console.log("Seed complete."))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
