# Acumen event website

Website for Acumen: home page, registration with teams, 5 rounds (Quiz and Excel hosted on the site, 3 file-submission rounds), organizer admin panel, judging and analytics. Built from the Acumen PRD.

## Run it locally

Requires Node.js 20+.

```bash
npm install
npm run db:reset   # creates prisma/dev.db and loads rounds, sample questions, Excel case and demo teams
npm run dev        # http://localhost:3000
```

Test logins are listed at the top of `prisma/seed.ts` (admin, judge, demo participants). Change or delete them before going live. `SEED_DEMO=0 npm run db:reset` seeds without demo teams.

## What's where

| Area | Path |
| --- | --- |
| Home page (content editable in Admin → Content & settings) | `src/app/page.tsx` |
| Register / log in | `src/app/(auth)` |
| Team dashboard: create/join team, invite code, payment proof, rounds, results | `src/app/dashboard` |
| Excel and submission rounds, live quiz answer pad | `src/app/rounds/[id]` (`live-player.tsx` for the quiz) |
| Live quiz: host screen (projector) | `src/app/host/[roundId]` |
| Live quiz: state machine, scoring, polling API | `src/lib/live-quiz.ts`, `src/lib/live-quiz-commands.ts`, `src/app/api/live/[roundId]` (GET state, POST commands/answers) |
| Admin panel | `src/app/admin` |
| Judge scoring | `src/app/judge` |
| CSV exports | `src/app/api/admin/export/[kind]` |
| Protected file downloads | `src/app/api/files/[...path]` |
| Database schema | `prisma/schema.prisma` |
| Scoring + leaderboard | `src/lib/scoring.ts` |
| Startup Ecosystem simulation: template, engine, persistence | `src/lib/sim/` (`model.ts`, `engine.ts`, `service.ts`) |
| Simulation workspace (participants) | `src/app/rounds/[id]/sim-view.tsx`, `sim-workspace.tsx` |
| Simulation control room (organisers) | `src/app/admin/simulation/[roundId]` |

Uploaded files are stored in `./storage` (git-ignored).

## How the main rules work

- **Teams**: everyone registers individually, then creates a team (becomes lead, gets a 6-character invite code) or joins with a code. Team size limits and the registration deadline are set in Admin → Content & settings; rosters lock at the deadline.
- **Payment**: the lead uploads a screenshot + transaction ID. It is auto-accepted (team becomes Paid); admins can reject it on the Teams page. Duplicate transaction IDs are flagged.
- **Rounds**: only Paid, non-disqualified teams can enter. Scheduled rounds open/close on their dates (IST). Excel has one attempt per team with a server-side timer.
- **Live quiz (Round 1)**: host-led. An admin opens the host screen (Admin → round → Open host screen) on the projector and opens the lobby; teams join by opening the round on any device. The host moves everyone through each question together: a short get-ready countdown, a per-question timer, the answer reveal with how teams voted, and a leaderboard. One answer per team (first teammate wins). A correct answer earns `1000 × marks` points if instant, falling linearly to half at the buzzer, timed by the server clock. When the game ends each team's points are saved as marks (1,000 points = 1 mark). "Reset game" wipes the game and its marks. State is polled once a second.
- **Excel round**: teams download the case workbook and type answers into the answer sheet (autosaved), and can upload their .xlsx; empty answers are read from the workbook's answer cells. Answers are auto-scored against the admin's answer key with a tolerance.
- **Elimination**: on Results, pick "Top N by <round or overall>" for the next round; only those teams can enter it.
- **Leaderboard**: each round is converted to a percentage of its max marks, then weighted by the round weights.
- **Round 4, Startup Ecosystem (simulation)**: each team runs one of ten interconnected electric-mobility startups (EV maker, battery maker, charging, swapping, fleet, delivery, leasing, recycling, fleet software, maintenance) in one shared economy.
  - Organisers assign roles, then open the economy in Admin → Simulation control.
  - Each cycle, teams submit price, production, marketing, quality, capacity and financing decisions before the window closes. All decisions are processed together by a deterministic server-side engine (`src/lib/sim/engine.ts`).
  - Teams negotiate binding supply contracts with each other, chat, and can buy research on competitors. Prices, cash and debt are private; public reports show prices, volumes and market share.
  - Investments, loans, quality, brand and contracts persist across cycles. Scheduled and live-triggered events (lithium shock, rate hike, subsidies…) change the market.
  - Participants may use any outside tools, including AI; there is no AI inside the platform.
  - Final marks (ROE and brand relative to other teams, plus contract reliability) are written to the round's scores when the last cycle is processed, so cut-offs, the leaderboard and analytics work as for other rounds.
  - Use the dry run in the control room to test a configuration with bot teams before the event. Do not deploy or migrate the schema while a simulation is running.

## Not in v1 yet

- Email (OTP login, confirmations, announcements by email) — needs an email provider such as Resend or Brevo.
- Bulk ZIP download of submissions, certificate generation (handled outside the site per PRD), virus scanning.

## Deploying

Switch `provider` in `prisma/schema.prisma` to `postgresql`, set `DATABASE_URL` and a long random `AUTH_SECRET`, and move file storage from the local `storage/` folder to object storage (S3, R2 or Supabase Storage) — `src/lib/files.ts` is the only place that touches the disk.
