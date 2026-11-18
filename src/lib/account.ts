/**
 * Deleting an account (the owner's decision, 2026-11-16): personal data goes, debates stay.
 * - Agents are deleted as usual: withdrawn from open debates; started and finished debates keep
 *   their snapshot ("agent deleted").
 * - Open debates the person created are deleted (as the creator could do anyway).
 * - Sessions, password, linked logins, messages sent from the Contact page and chat comments are
 *   removed.
 * - The user row is kept but anonymised ("Deleted user", no email, `deletedAt` set), so debates they
 *   created and votes they cast stay intact and other people's results don't change.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "./db/client";
import { account, agents, contactMessages, debateComments, debates, providerConnections, session, user, verification } from "./db/schema";
import { deleteAgent, deleteDebate } from "./debate/lifecycle";

export const DELETED_USER_NAME = "Deleted user";

/** An address that can't receive mail (`.invalid` is reserved) and keeps the email column unique. */
export const deletedEmail = (userId: string) => `deleted-${userId}@deleted.invalid`;

export async function deleteAccount(db: Db, userId: string, now = Date.now()): Promise<void> {
  const [person] = await db.select().from(user).where(eq(user.id, userId));
  if (!person || person.deletedAt !== null) return;

  for (const { id } of await db.select({ id: agents.id }).from(agents).where(eq(agents.ownerId, userId))) {
    await deleteAgent(db, { agentId: id, userId, isAdmin: false });
  }
  const openDebates = await db
    .select({ id: debates.id })
    .from(debates)
    .where(and(eq(debates.creatorId, userId), eq(debates.status, "open")));
  for (const { id } of openDebates) {
    await deleteDebate(db, { debateId: id, userId, isAdmin: false });
  }

  await db.transaction(async (tx) => {
    await tx.delete(session).where(eq(session.userId, userId));
    await tx.delete(account).where(eq(account.userId, userId));
    await tx.delete(providerConnections).where(eq(providerConnections.userId, userId)); // stored OpenRouter key
    await tx.delete(verification).where(eq(verification.identifier, person.email));
    // Messages sent from the Contact page while signed in (the user row stays, so no cascade).
    await tx.delete(contactMessages).where(eq(contactMessages.userId, userId));
    await tx.delete(debateComments).where(eq(debateComments.userId, userId));
    await tx
      .update(user)
      .set({
        name: DELETED_USER_NAME,
        displayName: DELETED_USER_NAME,
        email: deletedEmail(userId),
        emailVerified: false,
        image: null,
        isAdmin: false,
        deletedAt: now,
        updatedAt: new Date(now),
      })
      .where(eq(user.id, userId));
  });
}
