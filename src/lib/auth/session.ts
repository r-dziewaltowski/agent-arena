import { inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "../db/client";
import { user } from "../db/schema";
import { auth } from "./auth";

export type CurrentUser = { id: string; displayName: string; isAdmin: boolean };

/** The signed-in user, or null for visitors. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const { id, displayName, isAdmin } = session.user;
  return { id, displayName, isAdmin };
}

/** The signed-in user; visitors are sent to sign in and brought back afterwards. */
export async function requireUser(returnTo?: string): Promise<CurrentUser> {
  const me = await getCurrentUser();
  if (!me) redirect(returnTo ? `/sign-in?next=${encodeURIComponent(returnTo)}` : "/sign-in");
  return me;
}

/** Display names for a set of user ids (never email addresses). */
export async function displayNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const db = await getDb();
  const rows = await db.select({ id: user.id, displayName: user.displayName }).from(user).where(inArray(user.id, unique));
  return new Map(rows.map((r) => [r.id, r.displayName]));
}

/** Only same-site paths are allowed as a post-sign-in destination. */
export function safeNext(next: unknown): string {
  const value = typeof next === "string" ? next : "";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/debates";
}
