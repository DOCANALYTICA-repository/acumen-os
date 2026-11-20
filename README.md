# Acumen event website

Website for Acumen: home page, registration with teams, 5 rounds (Round 1 host-led guesstimate, Rounds 2/3/5 played off the site with "mark as done" and organiser marks, Round 4 an economy simulation with a setup auction), organizer admin panel and analytics. Built from the Acumen PRD.

## Run it locally

Requires Node.js 20+.

```bash
npm install
npm run db:reset   # creates prisma/dev.db and loads rounds, sample guesstimates and demo teams
npm run dev        # http://localhost:3000
```

Test logins are listed at the top of `prisma/seed.ts` (admin, judge, demo participants). Change or delete them before going live. `SEED_DEMO=0 npm run db:reset` seeds without demo teams.

## What's where

| Area | Path |
| --- | --- |
| Home page (content editable in Admin → Content & settings) | `src/app/page.tsx` |
| Register / log in | `src/app/(auth)` |
| Team dashboard: create/join team, invite code, payment proof, rounds, results | `src/app/dashboard` |
| Round pages for teams (guesstimate answer screen, mark-as-done, simulation, legacy Excel/submission types) | `src/app/rounds/[id]` (`live-player.tsx` for the guesstimate) |
| Guesstimate: host screen (projector) | `src/app/host/[roundId]` |
| Guesstimate: state, scoring, polling API | `src/lib/live-quiz-types.ts` (scoring tiers), `src/lib/live-quiz.ts`, `src/lib/live-quiz-commands.ts`, `src/app/api/live/[roundId]` (GET state, POST commands/answers) |
| Admin panel | `src/app/admin` |
| Judge scoring | `src/app/judge` |
| CSV exports | `src/app/api/admin/export/[kind]` |
| Protected file downloads | `src/app/api/files/[...path]` |
| Database schema | `prisma/schema.prisma` |
| Scoring + leaderboard | `src/lib/scoring.ts` |
| Economy simulation: template, engine, auction, persistence | `src/lib/sim/` (`model.ts`, `engine.ts`, `service.ts`) |
| Simulation workspace (participants) | `src/app/rounds/[id]/sim-view.tsx`, `sim-workspace.tsx` |
| Simulation control room (organisers) | `src/app/admin/simulation/[roundId]` |

Uploaded files are stored in `./storage` (git-ignored).

## How the main rules work

- **Teams**: everyone registers individually, then creates a team (becomes lead, gets a 6-character invite code) or joins with a code. Team size limits and the registration deadline are set in Admin → Content & settings; rosters lock at the deadline.
- **Payment**: the lead uploads a screenshot + transaction ID. It is auto-accepted (team becomes Paid); admins can reject it on the Teams page. Duplicate transaction IDs are flagged.
- **Rounds**: only Paid, non-disqualified teams can enter. Scheduled rounds open/close on their dates (IST).
- **Round 1, Guesstimate (round type `QUIZ`)**: host-led. An admin opens the host screen (Admin → round → Open host screen) on the projector and opens the lobby; teams join by opening the round on any device. Whichever question the host shows (forwards or back, or by number), every team sees that question with a box for one number and a Save button. Any teammate can save; the latest save counts, and it can be changed while the host is on that question. Scoring per question by percentage error from the correct answer: within 5% = 3, within 10% = 2, within 20% = 1, otherwise 0 (tiers in `src/lib/live-quiz-types.ts`). "End round" locks all answers, writes marks and shows teams a read-only answer sheet (correct answers and points appear once results are published). "Reopen" undoes an accidental end; "Reset game" wipes answers and marks. State is polled about once a second.
- **Rounds 2, 3 and 5, off-platform (round type `MANUAL`)**: the round happens elsewhere (in person, or Google Classroom). Teams press "Mark as done" (and can undo until marks are entered). The admin round page lists every eligible team with its done status and a marks box; set maximum marks and an optional link (e.g. the Classroom assignment) in the round settings. Only organiser marks count on the leaderboard.
- **Elimination**: on Results, pick "Top N by <round or overall>" for the next round; only those teams can enter it.
- **Leaderboard**: each round is converted to a percentage of its max marks, then weighted by the round weights.
- **Round 4, Economy simulation (round type `SIMULATION`)**: about ten teams run companies in one shared electric-mobility economy for five simulated years (one decision window per year; 9 minutes each by default, about 45 minutes in total).
  - **Setup auction**: every team starts with the same budget. Lots are business identities (the ten industry roles: EV maker, battery maker, charging, swapping, fleet, delivery, leasing, recycling, fleet software, maintenance) and resources with lasting perks (prime location, patents, cheap power, skilled workforce, brand ambassador, land, permits, customer data). The organiser opens one lot at a time; bids are live with a soft close; budgets are enforced and every team must keep enough for an identity. Teams without an identity at the end get a leftover one at the reserve price. Unspent budget becomes starting cash. Organisers can skip the auction and auto-assign identities.
  - **Each year** teams set price, production, new capacity, bank borrowing/repayment and spending on six levers: marketing, sales force, customer service, employee welfare, technology & R&D, sustainability. Levers drive four indices (technology, brand, customer satisfaction, employee satisfaction, 0–100) that change demand, unit costs and effective capacity, with diminishing returns and carry-over between years.
  - **Deals**: supply contracts (only along real input relationships), technology licences, loans between companies and co-marketing alliances. The deal type fixes what it does; units, prices, fees, interest and duration are negotiated. Accepted deals are binding and change both companies' results. Everyone sees who has deals with whom; terms stay private.
  - **Economy**: GDP growth (market size), inflation (costs, wages, price level), interest rate, corporate tax (losses carry forward), consumer confidence and EV adoption. Every market also has a simulated incumbent, so market share is meaningful even with one team per role. Scheduled and live events, and the control room's economy controls, move these parameters.
  - **End**: awards for most profitable, highest revenue, highest market share, best return, fastest growing, happiest customers, best employer, most innovative, strongest brand, top deal-maker and biggest taxpayer. Marks combine profit (ROE), revenue, market share, satisfaction, brand and reliability (weights and floor configurable) and are written to the round's scores.
  - All outcomes come from a deterministic server-side engine (`src/lib/sim/engine.ts`). Participants may use any outside tools, including AI; there is no AI inside the platform.
  - Use the dry run in the control room to test a configuration with bot teams before the event. Do not deploy or migrate the schema while a simulation is running.
- **Legacy round types**: `EXCEL` (on-site Excel case) and `SUBMISSION` (file upload with judge rubric) still work if you create such rounds, but the seeded event no longer uses them.

## Not in v1 yet

- Email (OTP login, confirmations, announcements by email) — needs an email provider such as Resend or Brevo.
- Bulk ZIP download of submissions, certificate generation (handled outside the site per PRD), virus scanning.

## Deploying

Switch `provider` in `prisma/schema.prisma` to `postgresql`, set `DATABASE_URL` and a long random `AUTH_SECRET`, and move file storage from the local `storage/` folder to object storage (S3, R2 or Supabase Storage) — `src/lib/files.ts` is the only place that touches the disk.
