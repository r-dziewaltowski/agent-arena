import { user } from "../db/schema";
import type { Db } from "../db/client";

/**
 * Seeded users for development until real accounts arrive in M3. A cookie picks which one is
 * "signed in", so one browser can act as several users (entering a debate needs that).
 */
export const DEV_USERS = [
  { id: "dev-user-alice", name: "Alice", isAdmin: true },
  { id: "dev-user-bob", name: "Bob", isAdmin: false },
  { id: "dev-user-carol", name: "Carol", isAdmin: false },
] as const;

export const DEV_USER_COOKIE = "dev_user";

let seeded = false;

/**
 * Creates the dev users, or brings existing rows in line (the terminal debate script also
 * creates some of them, without admin rights). Cheap after the first call.
 */
export async function ensureDevUsers(db: Db): Promise<void> {
  if (seeded) return;
  const now = new Date(Date.now());
  for (const u of DEV_USERS) {
    await db
      .insert(user)
      .values({
        id: u.id,
        name: u.name,
        email: `${u.name.toLowerCase()}@example.test`,
        displayName: u.name,
        isAdmin: u.isAdmin,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: user.id,
        set: { displayName: u.name, isAdmin: u.isAdmin, updatedAt: now },
      });
  }
  seeded = true;
}
