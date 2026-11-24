/**
 * Turns on Row Level Security for every table in the `public` schema.
 *
 * Supabase exposes `public` through its REST API (PostgREST) to anyone holding the project's anon key. Acumen never
 * uses that API: the site talks to Postgres through Prisma as the `postgres` role, which bypasses RLS. Enabling RLS
 * with no policies therefore locks the REST API out of every table without changing how the site works.
 *
 * Idempotent. `npm run db:setup` runs it after `prisma db push`, so new tables are covered too.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL || process.env.DATABASE_URL });

async function main() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    select tablename from pg_tables where schemaname = 'public' and rowsecurity = false order by tablename`;
  for (const { tablename } of tables) {
    await db.$executeRawUnsafe(`alter table public."${tablename.replace(/"/g, '""')}" enable row level security`);
  }
  console.log(tables.length ? `RLS enabled on ${tables.length} table(s): ${tables.map((t) => t.tablename).join(", ")}` : "RLS already enabled on all public tables.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
