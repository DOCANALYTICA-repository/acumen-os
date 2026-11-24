# Deploying Acumen (Vercel + Supabase)

- **Vercel** runs the website.
- **Supabase** holds the database (Postgres) and uploaded files (Storage).

Data lives in Supabase, so redeploying or changing the site never touches registrations. Supabase
takes daily backups.

## 1. Create the Supabase project

1. At supabase.com: **New project.** Pick the region closest to participants (Mumbai: `ap-south-1`).
   Save the database password somewhere safe.
2. **Storage → New bucket** named `uploads`. Leave **Public** switched **off**. It holds only the
   payment receipts teams attach at registration; the site serves them to organisers and the team
   captain only.
3. **Project Settings → Database → Connection string** (choose the "ORM / Prisma" tab if shown):
   - **Transaction pooler** (port **6543**) → this is `DATABASE_URL`. Add
     `?pgbouncer=true&connection_limit=1` to the end.
   - **Session pooler or direct connection** (port **5432**) → this is `DIRECT_URL`.
4. **Project Settings → API:** copy the Project URL (`SUPABASE_URL`) and the `service_role` secret
   key (`SUPABASE_SERVICE_ROLE_KEY`). Treat the service key like a password.

## 2. Create the tables and the admin login (once)

On your computer, put the values in `.env` (see `.env.example`), plus `ADMIN_EMAIL` and
`ADMIN_PASSWORD` (12+ characters). Then run:

```
npm run db:setup
```

This creates the tables, the five rounds and one admin account. It never deletes anything, and it
does nothing if rounds already exist, so running it again is safe.

> `npm run db:reset` **wipes** whatever database `.env` points at and fills it with demo data.
> Never run it while `.env` points at the live Supabase project.

## 3. Deploy on Vercel

1. Push the branch to GitHub.
2. At vercel.com: **Add New → Project**, import the repository and pick the branch. The framework
   (Next.js) is detected automatically.
3. **Environment Variables:** add `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET` (`uploads`), `AUTH_SECRET`
   (generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) and the
   Brevo keys for staff sign-in (see below).
   `ADMIN_EMAIL`/`ADMIN_PASSWORD` aren't needed on Vercel.
4. **Settings → Functions:** set the region to the same one as Supabase (e.g. Mumbai `bom1`). Pages
   are much faster when the site and database are close.
5. **Deploy.** You get an `https://<name>.vercel.app` address. A custom domain can be added under
   **Settings → Domains**.

After a schema change, run `npm run db:setup` again before deploying, so the tables are updated.

## Limits to know

- **Registration rate limit:** 20 registration attempts per network (IP address) per hour, so a
  whole campus on one Wi-Fi still fits. Change it with `REGISTER_LIMIT_PER_HOUR` in Vercel's
  environment variables if many teams register from one place at once.
- **Fixing a team:** in **Admin → Teams**, **Edit** changes any member's details (that's also how
  you replace a teammate) and can set a new password for the captain, who is the team's login.
  **Remove** works on the teammate only and deletes their account so the email can register
  again; **Add a member** appears when a team is short.

- **Payment receipts are capped at 4 MB.** Vercel rejects requests over 4.5 MB; a receipt
  screenshot or PDF fits easily. Nothing else is uploaded: round work is on Google Classroom and
  teams paste links.
- **Live quiz and simulation screens poll the server about once a second.** Vercel's free plan
  allows 1 million requests a month, roughly 30 teams playing for 9 hours straight. For the event
  itself, consider Vercel Pro for that month.
- **Supabase free projects pause after a week with no activity.** Open the dashboard and press
  Restore if the site says it can't reach the database. Upgrade to Pro before the event so it can't
  pause on the day.

## After the first deploy

1. Log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
2. **Admin → Content:** set the event name, dates, registration deadline and FAQ.
3. **Admin → Rounds:** set real start/end dates. The setup creates rounds starting "now", so Round 1
   shows as live until you change it.
4. Rounds 3 and 5: paste the Google Classroom links.
5. **Admin → Content → Payment portal link / Guide for payment:** check the steps match the real
   portal (especially the event name in the second Category list), and add the WhatsApp group link
   shown on the registration success page.

## Staff sign-in by email code (Blossoms-style)

Admins and judges are invited in **Admin → Staff & access** and sign in at `/login?as=staff` with a
6-digit code that Acumen emails them through **Brevo** (no password). Codes last 10 minutes and only
the newest one works.

1. At brevo.com (free plan: 300 emails a day): **Senders, domains & IPs → Senders → Add a sender**
   and verify the address the codes come from. Verifying the domain too keeps them out of spam.
2. **SMTP & API → API keys → Generate a new API key.**
3. In Vercel's environment variables add `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` (the verified
   sender) and optionally `BREVO_SENDER_NAME` (default "Acumen"), then redeploy.

Locally, leave `BREVO_API_KEY` empty and the code is printed in the dev server's console. The seeded
`ADMIN_EMAIL` admin can still log in with its password on the Team tab.

## Testing registrations

1. Open `/register` on a phone. Go through the five steps: team name, both members, password,
   payment (open the portal and the guide, attach a receipt), review.
2. You land on "You're in!". Log in with the captain's email: the dashboard shows the team as active
   and the rounds unlocked.
3. In **Admin → Teams**, open the receipt (it should also be in Supabase **Storage → uploads**),
   then press **Reject receipt**. The captain's dashboard now asks for a new receipt; attaching one
   unlocks the team again.
4. Check both people appear in **Admin → Participants**, and in Supabase **Table editor → User**.
5. Try the obvious mistakes: an email that's already registered, the same email twice, passwords
   that don't match, no receipt, a file over 4 MB, a team name that's taken.
6. Export the participant list from Admin.
7. When testing is done, delete the test accounts from Admin.

## Local development

Local development also uses Postgres:

- **Option 1:** a second, free Supabase project just for testing. Point `.env` at it.
- **Option 2:** `npx prisma dev --name acumen-test` starts a local Postgres and prints a
  `postgres://…` URL. Use it for both `DATABASE_URL` and `DIRECT_URL`, adding
  `&pgbouncer=true&connection_limit=1`.

Then run `npm run db:reset` for demo data. Leave the `SUPABASE_*` values empty locally, and uploads
go to `./storage`.
