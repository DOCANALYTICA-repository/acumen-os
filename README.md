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
| Quiz, Excel and submission rounds | `src/app/rounds/[id]` |
| Admin panel | `src/app/admin` |
| Judge scoring | `src/app/judge` |
| CSV exports | `src/app/api/admin/export/[kind]` |
| Protected file downloads | `src/app/api/files/[...path]` |
| Database schema | `prisma/schema.prisma` |
| Scoring + leaderboard | `src/lib/scoring.ts` |

Uploaded files are stored in `./storage` (git-ignored).

## How the main rules work

- **Teams**: everyone registers individually, then creates a team (becomes lead, gets a 6-character invite code) or joins with a code. Team size limits and the registration deadline are set in Admin → Content & settings; rosters lock at the deadline.
- **Payment**: the lead uploads a screenshot + transaction ID. It is auto-accepted (team becomes Paid); admins can reject it on the Teams page. Duplicate transaction IDs are flagged.
- **Rounds**: only Paid, non-disqualified teams can enter. Scheduled rounds open/close on their dates (IST). Quiz and Excel have one attempt per team with a server-side timer.
- **Excel round**: teams download the case workbook and type answers into the answer sheet (autosaved), and can upload their .xlsx; empty answers are read from the workbook's answer cells. Answers are auto-scored against the admin's answer key with a tolerance.
- **Elimination**: on Results, pick "Top N by <round or overall>" for the next round; only those teams can enter it.
- **Leaderboard**: each round is converted to a percentage of its max marks, then weighted by the round weights.

## Not in v1 yet

- Email (OTP login, confirmations, announcements by email) — needs an email provider such as Resend or Brevo.
- Bulk ZIP download of submissions, certificate generation (handled outside the site per PRD), virus scanning.

## Deploying

Switch `provider` in `prisma/schema.prisma` to `postgresql`, set `DATABASE_URL` and a long random `AUTH_SECRET`, and move file storage from the local `storage/` folder to object storage (S3, R2 or Supabase Storage) — `src/lib/files.ts` is the only place that touches the disk.
