/**
 * Reports: signed-in people flag part of a debate (its topic, a turn, an agent's name or
 * picture, or a chat comment) for the admins, who act on them from /admin. Nothing is hidden automatically:
 * on a small site, a few accounts could otherwise hide any debate they dislike.
 */
import { randomUUID } from "node:crypto";
import { and, count, eq, gt, inArray, type SQL } from "drizzle-orm";
import type { Db } from "./db/client";
import { agentImages, agents, debateComments, debateParticipants, debates, reports, turnAudio, turns } from "./db/schema";
import { isUniqueViolation } from "./debate/lifecycle";

import { REPORT_NOTE_MAX_LENGTH, type ReportReason, type ReportTarget } from "./reports-shared";

export { REPORT_NOTE_MAX_LENGTH, REPORT_REASONS, type ReportReason, type ReportTarget } from "./reports-shared";
/** Reports one person may send in a day, so nobody can flood the admins. */
export const REPORTS_PER_DAY = 20;

export class ReportError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "DUPLICATE" | "TOO_MANY",
    message: string,
  ) {
    super(message);
  }
}

export type NewReport = {
  debateId: string;
  target: ReportTarget;
  /** The turn, participant or comment reported; ignored for the topic. */
  targetId?: string | null;
  reason: ReportReason;
  note?: string | null;
  reporterId: string;
};

/** Saves a report after checking what it points at belongs to the debate. Returns its id. */
export async function createReport(db: Db, input: NewReport, now: number): Promise<string> {
  const [debate] = await db.select({ id: debates.id }).from(debates).where(eq(debates.id, input.debateId));
  if (!debate) throw new ReportError("NOT_FOUND", "That debate no longer exists.");

  let turnId: string | null = null;
  let participantId: string | null = null;
  let commentId: string | null = null;
  if (input.target === "turn") {
    const [turn] = await db
      .select({ id: turns.id, kind: turns.kind })
      .from(turns)
      .where(and(eq(turns.id, input.targetId ?? ""), eq(turns.debateId, input.debateId)));
    if (!turn || turn.kind === "summary") throw new ReportError("NOT_FOUND", "Pick one of the debate's turns.");
    turnId = turn.id;
  } else if (input.target === "agent") {
    const [entry] = await db
      .select({ id: debateParticipants.id })
      .from(debateParticipants)
      .where(and(eq(debateParticipants.id, input.targetId ?? ""), eq(debateParticipants.debateId, input.debateId)));
    if (!entry) throw new ReportError("NOT_FOUND", "Pick one of the debate's agents.");
    participantId = entry.id;
  } else if (input.target === "comment") {
    const [comment] = await db
      .select({ id: debateComments.id, userId: debateComments.userId, deletedAt: debateComments.deletedAt })
      .from(debateComments)
      .where(and(eq(debateComments.id, input.targetId ?? ""), eq(debateComments.debateId, input.debateId)));
    if (!comment || comment.deletedAt !== null) throw new ReportError("NOT_FOUND", "That comment has been deleted.");
    if (comment.userId === input.reporterId) throw new ReportError("NOT_FOUND", "You can delete your own comment instead.");
    commentId = comment.id;
  }

  const [{ sent }] = await db
    .select({ sent: count() })
    .from(reports)
    .where(and(eq(reports.reporterId, input.reporterId), gt(reports.createdAt, now - 24 * 60 * 60_000)));
  if (sent >= REPORTS_PER_DAY) throw new ReportError("TOO_MANY", "You've sent a lot of reports today. Please try again tomorrow.");

  const id = randomUUID();
  try {
    await db.insert(reports).values({
      id,
      debateId: input.debateId,
      target: input.target,
      turnId,
      participantId,
      commentId,
      targetKey: turnId ?? participantId ?? commentId ?? "",
      reason: input.reason,
      note: input.note?.trim().slice(0, REPORT_NOTE_MAX_LENGTH) || null,
      reporterId: input.reporterId,
      createdAt: now,
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ReportError("DUPLICATE", "You've already reported this. An admin will look at it.");
    throw err;
  }
  return id;
}

export async function openReportCount(db: Db): Promise<number> {
  const [{ open }] = await db.select({ open: count() }).from(reports).where(eq(reports.status, "open"));
  return open;
}

type Resolution = { adminId: string; now: number; resolution: string };

/** Closes every open report on the same thing (others may have reported it too). */
async function resolveMatching(db: Db, where: SQL, r: Resolution, status: "resolved" | "dismissed" = "resolved") {
  await db
    .update(reports)
    .set({ status, resolution: r.resolution, resolvedById: r.adminId, resolvedAt: r.now })
    .where(and(eq(reports.status, "open"), where));
}

/** Nothing to do: the report is closed as dismissed. */
export async function dismissReport(db: Db, reportId: string, adminId: string, now: number): Promise<void> {
  await resolveMatching(db, eq(reports.id, reportId), { adminId, now, resolution: "Dismissed: nothing to change" }, "dismissed");
}

/**
 * Removes one turn's text (it shows as removed by an admin) and its speech; the rest of the debate
 * stays. Closes the reports about that turn.
 */
export async function removeTurnText(db: Db, turnId: string, adminId: string, now: number): Promise<void> {
  await db.update(turns).set({ content: "", audioMarks: null, removedAt: now, updatedAt: now }).where(eq(turns.id, turnId));
  await db.delete(turnAudio).where(eq(turnAudio.turnId, turnId));
  await resolveMatching(db, eq(reports.turnId, turnId), { adminId, now, resolution: "Removed the turn's text" });
}

/** Removes a chat comment (it shows as removed by an admin) and closes the reports about it. */
export async function removeComment(db: Db, commentId: string, adminId: string, now: number): Promise<void> {
  await db.update(debateComments).set({ body: "", deletedAt: now, deletedBy: "admin" }).where(eq(debateComments.id, commentId));
  await resolveMatching(db, eq(reports.commentId, commentId), { adminId, now, resolution: "Removed the comment" });
}

/** The participant entries of an agent, in every debate (to close reports about it). */
async function entriesOf(db: Db, agentId: string): Promise<string[]> {
  const rows = await db.select({ id: debateParticipants.id }).from(debateParticipants).where(eq(debateParticipants.agentId, agentId));
  return rows.map((r) => r.id);
}

/** Removes an agent's uploaded picture (it gets a drawn face again) and closes reports about the agent. */
export async function removeAgentPicture(db: Db, agentId: string, adminId: string, now: number): Promise<void> {
  await db.delete(agentImages).where(eq(agentImages.agentId, agentId));
  await db.update(agents).set({ imageUpdatedAt: null }).where(eq(agents.id, agentId));
  const entries = await entriesOf(db, agentId);
  if (entries.length) {
    await resolveMatching(db, inArray(reports.participantId, entries), { adminId, now, resolution: "Removed the agent's picture" });
  }
}

/** Before an admin deletes an agent: close the reports about it (its debate entries stay). */
export async function resolveAgentReports(db: Db, agentId: string, adminId: string, now: number): Promise<void> {
  const entries = await entriesOf(db, agentId);
  if (entries.length) {
    await resolveMatching(db, inArray(reports.participantId, entries), { adminId, now, resolution: "Deleted the agent" });
  }
}
