/**
 * Runs on Vercel before `next build` (the `vercel-build` script): applies pending migrations to
 * this environment's database, and on production checks that email is set up and creates or
 * updates the queue's sweep schedule.
 * Previews get no sweep schedule; they are short-lived and their debates rarely need rescuing.
 */
import "./load-env";
import { openDb } from "../src/lib/db/client";
import { runMigrations } from "../src/lib/db/migrate";
import { gmailConfigured } from "../src/lib/email/send";
import { encryptionConfigured } from "../src/lib/secrets";
import { appUrl, PRODUCTION_SWEEP_CRON } from "../src/lib/jobs/config";
import { ensureSweepSchedule, SWEEP_PATH } from "../src/lib/jobs/queue";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || url.startsWith("file:")) {
    throw new Error("DATABASE_URL must point to a Turso database (libsql://…) on Vercel.");
  }
  const { db, client } = await openDb(url);
  await runMigrations(db);
  client.close();
  console.log("Migrations applied.");

  if (process.env.VERCEL_ENV === "production") {
    // Without these, nobody could confirm their email or reset a password: fail the deploy instead.
    if (!gmailConfigured()) throw new Error("Set GMAIL_USER and GMAIL_APP_PASSWORD for Production (see the README).");
    // Users' OpenRouter keys are stored encrypted with it; a missing or malformed one must not ship.
    if (!encryptionConfigured()) throw new Error("Set USER_API_KEYS_ENCRYPTION_SECRET for Production (32 random bytes, base64; see the README).");
    const baseUrl = appUrl();
    if (!baseUrl.startsWith("https://")) throw new Error(`The production address isn't https: ${baseUrl}`);
    const cron = process.env.SWEEP_CRON ?? PRODUCTION_SWEEP_CRON;
    await ensureSweepSchedule({ baseUrl, cron });
    console.log(`Sweep schedule set: "${cron}" → ${baseUrl}${SWEEP_PATH}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
