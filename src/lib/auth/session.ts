import { inArray } from "drizzle-orm";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
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

/** Admins only: others get a 404, as if the admin pages weren't there. */
export async function requireAdmin(): Promise<CurrentUser> {
  const me = await requireUser("/admin");
  if (!me.isAdmin) notFound();
  return me;
}

/** The signed-in user's name and email address (only to prefill their own forms), or null for visitors. */
export async function getCurrentContact(): Promise<{ displayName: string; email: string } | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  return session ? { displayName: session.user.displayName, email: session.user.email } : null;
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
