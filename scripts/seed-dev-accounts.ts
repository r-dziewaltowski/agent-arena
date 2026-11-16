/**
 * Development only: makes the dev users (Alice, Bob, Carol) sign-in-able with email + password,
 * creating them if needed. Their agents and debates from earlier development stay theirs.
 *
 *   npm run db:seed-dev
 *
 * Test credentials for local use only; never use them on a deployed instance.
 */
import "./load-env";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { openDb } from "../src/lib/db/client";
import { runMigrations } from "../src/lib/db/migrate";
import { account, user } from "../src/lib/db/schema";

export const DEV_PASSWORD = "arena-dev-password";

const DEV_USERS = [
  { id: "dev-user-alice", name: "Alice", email: "alice@example.test", isAdmin: true },
  { id: "dev-user-bob", name: "Bob", email: "bob@example.test", isAdmin: false },
  { id: "dev-user-carol", name: "Carol", email: "carol@example.test", isAdmin: false },
];

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed dev accounts in production.");
  const { db, client } = await openDb();
  await runMigrations(db);
  const hash = await hashPassword(DEV_PASSWORD);
  const now = new Date();

  for (const u of DEV_USERS) {
    await db
      .insert(user)
      .values({ id: u.id, name: u.name, email: u.email, emailVerified: true, displayName: u.name, isAdmin: u.isAdmin, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: user.id, set: { email: u.email, emailVerified: true, displayName: u.name, isAdmin: u.isAdmin, updatedAt: now } });

    // Better Auth signs in with the "credential" account whose accountId is the user's id.
    const [existing] = await db
      .select({ id: account.id })
      .from(account)
      .where(and(eq(account.userId, u.id), eq(account.providerId, "credential")));
    if (existing) {
      await db.update(account).set({ password: hash, updatedAt: now }).where(eq(account.id, existing.id));
    } else {
      await db.insert(account).values({
        id: randomUUID(),
        userId: u.id,
        accountId: u.id,
        providerId: "credential",
        password: hash,
        createdAt: now,
        updatedAt: now,
      });
    }
    console.log(`${u.name.padEnd(6)} ${u.email}${u.isAdmin ? "  (admin)" : ""}`);
  }
  console.log("Dev accounts ready (password in scripts/seed-dev-accounts.ts).");
  client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
