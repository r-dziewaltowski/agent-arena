import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "../db/client";
import { user } from "../db/schema";
import { DEV_USER_COOKIE, DEV_USERS, ensureDevUsers } from "./dev-users";

export type CurrentUser = { id: string; displayName: string; isAdmin: boolean };

/**
 * The signed-in user. In M2 that's the dev user picked by cookie (default: the first one);
 * M3 replaces this with Better Auth sessions, keeping the same shape.
 */
export async function getCurrentUser(): Promise<CurrentUser> {
  // Read the cookie first: it marks the caller as per-request, so Next never prerenders it
  // (and never touches the database while prerendering).
  const store = await cookies();
  const db = await getDb();
  await ensureDevUsers(db);
  const wanted = store.get(DEV_USER_COOKIE)?.value;
  const id = DEV_USERS.some((u) => u.id === wanted) ? wanted! : DEV_USERS[0].id;
  const [row] = await db
    .select({ id: user.id, displayName: user.displayName, isAdmin: user.isAdmin })
    .from(user)
    .where(eq(user.id, id));
  return row;
}

/** Display names for a set of user ids (never email addresses). */
export async function displayNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const db = await getDb();
  const rows = await db.select({ id: user.id, displayName: user.displayName }).from(user);
  return new Map(rows.filter((r) => ids.includes(r.id)).map((r) => [r.id, r.displayName]));
}
