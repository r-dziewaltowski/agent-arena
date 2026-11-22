/**
 * Chat beside a live debate. Signed-in viewers post short comments while the debate plays; the
 * agents never see them (they aren't part of any prompt). Posting closes once viewers have seen the
 * last turn; the chat then stays on the page, read-only. Viewers get new comments through the same
 * once-a-second poll as the turns (`/api/debates/[id]/turns`).
 */
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { COMMENT_GAP_MS, COMMENT_MAX_LENGTH, COMMENTS_PER_DEBATE, cleanComment, type CommentView } from "./chat-shared";
import type { Db } from "./db/client";
import { debateComments, debateParticipants, debates, turns, user } from "./db/schema";
import { turnRevealEndsAt } from "./debate/pacing";
import { publish } from "./realtime/publish";

export { COMMENT_GAP_MS, COMMENT_MAX_LENGTH, COMMENTS_PER_DEBATE, type CommentView } from "./chat-shared";

/**
 * Posts are still accepted this long after the last word is shown: someone may have been typing
 * as it appeared. The chat box itself closes when the last turn ends.
 */
export const CHAT_GRACE_MS = 30_000;
/** Polls ask for comments since their previous poll; this overlap covers clocks and slow writes. */
export const COMMENT_POLL_OVERLAP_MS = 5_000;
/** The most comments a page shows (the latest ones). */
export const COMMENTS_SHOWN = 500;

export class ChatError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "CLOSED" | "EMPTY" | "TOO_LONG" | "TOO_FAST" | "TOO_MANY",
    message: string,
  ) {
    super(message);
  }
}

type TurnTiming = {
  kind: string;
  content: string;
  revealStartedAt: number | null;
  revealEndsAt: number | null;
};

/**
 * Whether people can post: while the debate runs, and after it has finished (or failed) until
 * viewers have seen its last turn, plus `graceMs`. Not in the lobby or once cancelled.
 */
export function chatOpen(status: string, turnRows: TurnTiming[], now: number, wordsPerSecond: number | null, graceMs = 0): boolean {
  if (status === "running") return true;
  if (status !== "completed" && status !== "failed") return false;
  let lastShown: number | null = null;
  for (const t of turnRows) {
    if (t.kind === "summary") continue;
    const end = turnRevealEndsAt(t, wordsPerSecond);
    if (end !== null && (lastShown === null || end > lastShown)) lastShown = end;
  }
  return lastShown !== null && now < lastShown + graceMs;
}

/** Saves a comment after checking the chat is open and the person's limits. Returns its id. */
export async function createComment(
  db: Db,
  input: { debateId: string; userId: string; body: string },
  now: number,
  wordsPerSecond: number | null,
): Promise<string> {
  const body = cleanComment(input.body);
  if (!body) throw new ChatError("EMPTY", "Write something first.");
  if (body.length > COMMENT_MAX_LENGTH) throw new ChatError("TOO_LONG", `Keep it under ${COMMENT_MAX_LENGTH} characters.`);

  const [debate] = await db.select({ status: debates.status }).from(debates).where(eq(debates.id, input.debateId));
  if (!debate) throw new ChatError("NOT_FOUND", "That debate no longer exists.");
  const timing = await db
    .select({
      kind: turns.kind,
      content: turns.content,
      revealStartedAt: turns.revealStartedAt,
      revealEndsAt: turns.revealEndsAt,
    })
    .from(turns)
    .where(eq(turns.debateId, input.debateId));
  if (!chatOpen(debate.status, timing, now, wordsPerSecond, CHAT_GRACE_MS)) {
    throw new ChatError("CLOSED", "The chat is open only while the debate is live.");
  }

  // Deleted comments count too, so deleting one doesn't make room for another.
  const mine = and(eq(debateComments.userId, input.userId), eq(debateComments.debateId, input.debateId));
  const [{ posted }] = await db.select({ posted: count() }).from(debateComments).where(mine);
  if (posted >= COMMENTS_PER_DEBATE) {
    throw new ChatError("TOO_MANY", `You've posted ${COMMENTS_PER_DEBATE} comments in this debate, the most allowed.`);
  }
  const [last] = await db
    .select({ at: debateComments.createdAt })
    .from(debateComments)
    .where(mine)
    .orderBy(desc(debateComments.createdAt))
    .limit(1);
  if (last && now - last.at < COMMENT_GAP_MS) {
    const wait = Math.ceil((COMMENT_GAP_MS - (now - last.at)) / 1000);
    throw new ChatError("TOO_FAST", `Wait ${wait} second${wait === 1 ? "" : "s"} before your next comment.`);
  }

  const row = { id: randomUUID(), debateId: input.debateId, userId: input.userId, body, createdAt: now, deletedAt: null, deletedBy: null };
  await db.insert(debateComments).values(row);
  await publishComment(db, row);
  return row.id;
}

/** Its author deletes a comment: viewers drop it (pushed, or on their next fetch). Returns whether it was theirs. */
export async function deleteOwnComment(db: Db, commentId: string, userId: string, now: number): Promise<boolean> {
  const done = await db
    .update(debateComments)
    .set({ body: "", deletedAt: now, deletedBy: "author" })
    .where(and(eq(debateComments.id, commentId), eq(debateComments.userId, userId), isNull(debateComments.deletedAt)))
    .returning();
  if (done[0]) await publishComment(db, done[0]);
  return done.length > 0;
}

/** Pushes a comment to everyone watching, as a visitor sees it (each browser knows its own). */
export async function publishComment(db: Db, row: CommentRow): Promise<void> {
  const [comment] = await commentViews(db, row.debateId, [row], null);
  if (comment) await publish(row.debateId, { type: "comment", comment });
}

type CommentRow = typeof debateComments.$inferSelect;

/** The latest comments of a debate for the page, oldest first (without ones their authors deleted). */
export async function loadComments(db: Db, debateId: string): Promise<CommentRow[]> {
  const rows = await db
    .select()
    .from(debateComments)
    .where(and(eq(debateComments.debateId, debateId), or(isNull(debateComments.deletedBy), eq(debateComments.deletedBy, "admin"))))
    .orderBy(desc(debateComments.createdAt))
    .limit(COMMENTS_SHOWN);
  return rows.reverse();
}

/** Comments posted, deleted or removed since `since` (with some overlap): what a poll returns. */
export async function commentsSince(db: Db, debateId: string, since: number): Promise<CommentRow[]> {
  const from = since - COMMENT_POLL_OVERLAP_MS;
  return db
    .select()
    .from(debateComments)
    .where(and(eq(debateComments.debateId, debateId), or(gte(debateComments.createdAt, from), gte(debateComments.deletedAt, from))))
    .orderBy(asc(debateComments.createdAt))
    .limit(COMMENTS_SHOWN);
}

/** Who has a stake in the debate: an agent's owner, or its creator. */
export type Stakes = {
  creatorId: string;
  agents: { userId: string; name: string }[];
};

export function roleOf(userId: string, stakes: Stakes): string | null {
  const own = stakes.agents.filter((a) => a.userId === userId).map((a) => a.name);
  if (own.length) return `owner of ${own.length === 1 ? own[0] : `${own.slice(0, -1).join(", ")} and ${own.at(-1)}`}`;
  return userId === stakes.creatorId ? "created the debate" : null;
}

/** Comments as viewers see them. */
export function toCommentViews(rows: CommentRow[], stakes: Stakes, names: Map<string, string>, viewerId: string | null): CommentView[] {
  return rows.map((c) => ({
    id: c.id,
    author: names.get(c.userId) ?? "Someone",
    role: roleOf(c.userId, stakes),
    body: c.deletedAt ? "" : c.body,
    createdAt: c.createdAt,
    removed: c.deletedBy === "admin",
    gone: c.deletedBy === "author",
    mine: viewerId !== null && c.userId === viewerId,
  }));
}

/** Loads what `toCommentViews` needs (names and who has a stake) and builds the views. */
export async function commentViews(db: Db, debateId: string, rows: CommentRow[], viewerId: string | null): Promise<CommentView[]> {
  if (rows.length === 0) return [];
  const [debate] = await db.select({ creatorId: debates.creatorId }).from(debates).where(eq(debates.id, debateId));
  const agents = await db
    .select({
      userId: debateParticipants.userId,
      name: debateParticipants.name,
    })
    .from(debateParticipants)
    .where(eq(debateParticipants.debateId, debateId))
    .orderBy(asc(debateParticipants.position));
  const stakes: Stakes = {
    creatorId: debate?.creatorId ?? "",
    agents: agents.map((a) => ({
      userId: a.userId,
      name: a.name ?? "an agent",
    })),
  };
  const people = await db
    .select({ id: user.id, displayName: user.displayName })
    .from(user)
    .where(inArray(user.id, [...new Set(rows.map((r) => r.userId))]));
  const names = new Map(people.map((p) => [p.id, p.displayName]));
  return toCommentViews(rows, stakes, names, viewerId);
}
