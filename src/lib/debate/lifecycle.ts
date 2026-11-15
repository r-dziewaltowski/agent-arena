import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { resolveSettings, type Provider } from "../ai/provider";
import type { Db } from "../db/client";
import { agents, debateParticipants, debates, turns, votes } from "../db/schema";
import { createDebateSchema, VOTING_DURATIONS, type CreateDebateInput, type VotingDuration } from "../validation/debate";
import { disambiguateNames } from "./prompt";
import type { Creativity, TurnLength } from "./traits";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DbOrTx = Db | Tx;

export type LifecycleErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "NOT_OPEN"
  | "WRONG_START_MODE"
  | "SLOT_INVALID"
  | "SLOT_TAKEN"
  | "ALREADY_ENTERED"
  | "ONE_ENTRY_PER_USER"
  | "NOT_ENOUGH_ENTRIES"
  | "NOT_COMPLETED"
  | "VOTING_CLOSED"
  | "OWN_AGENT"
  | "ALREADY_VOTED";

export class LifecycleError extends Error {
  constructor(
    public readonly code: LifecycleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LifecycleError";
  }
}

/** Prompt tokens allowed per turn when computing a debate's budget (checked against real runs). */
export const PROMPT_ALLOWANCE_PER_TURN = 1500;
/** Extra headroom for summary calls. */
export const BUDGET_HEADROOM = 1.2;

export function computeTokenBudget(rounds: number, maxOutputTokensPerParticipant: number[]): number {
  const perRound = maxOutputTokensPerParticipant.reduce((sum, m) => sum + m + PROMPT_ALLOWANCE_PER_TURN, 0);
  return Math.round(rounds * perRound * BUDGET_HEADROOM);
}

export function votingClosesAtFor(completedAt: number, duration: VotingDuration): number {
  return completedAt + VOTING_DURATIONS[duration];
}

/** Whether a viewer may see the vote counts right now. */
export function canSeeTally(
  debate: { tallyVisibility: "live" | "after_vote" | "after_close"; votingClosesAt: number | null },
  viewer: { hasVoted: boolean },
  now = Date.now(),
): boolean {
  if (debate.votingClosesAt !== null && now >= debate.votingClosesAt) return true;
  switch (debate.tallyVisibility) {
    case "live":
      return true;
    case "after_vote":
      return viewer.hasVoted;
    case "after_close":
      return false;
  }
}

export async function createDebate(
  db: Db,
  creatorId: string,
  input: CreateDebateInput,
  now = Date.now(),
): Promise<string> {
  const parsed = createDebateSchema.safeParse(input);
  if (!parsed.success) {
    throw new LifecycleError("INVALID_INPUT", parsed.error.issues.map((i) => i.message).join("; "));
  }
  const v = parsed.data;
  if (v.startMode === "scheduled" && (v.startAt ?? 0) <= now) {
    throw new LifecycleError("INVALID_INPUT", "The start time must be in the future.");
  }

  const id = randomUUID();
  await db.insert(debates).values({
    id,
    creatorId,
    topic: v.topic,
    rounds: v.rounds,
    maxParticipants: v.maxParticipants,
    startMode: v.startMode,
    startAt: v.startMode === "scheduled" ? v.startAt : null,
    allowMultipleEntries: v.allowMultipleEntries,
    votingDuration: v.votingDuration,
    tallyVisibility: v.tallyVisibility,
    createdAt: now,
  });
  return id;
}

async function loadDebate(db: DbOrTx, debateId: string) {
  const [debate] = await db.select().from(debates).where(eq(debates.id, debateId));
  if (!debate) throw new LifecycleError("NOT_FOUND", "Debate not found.");
  return debate;
}

/** Enters one of the user's own agents into a free slot of an open debate. Returns the entry id. */
export async function enter(
  db: Db,
  args: { debateId: string; userId: string; agentId: string; position: number },
  now = Date.now(),
): Promise<string> {
  return db.transaction(async (tx) => {
    const debate = await loadDebate(tx, args.debateId);
    if (debate.status !== "open") throw new LifecycleError("NOT_OPEN", "This debate is no longer open.");
    if (!Number.isInteger(args.position) || args.position < 1 || args.position > debate.maxParticipants) {
      throw new LifecycleError("SLOT_INVALID", `Pick a slot from 1 to ${debate.maxParticipants}.`);
    }

    const [agent] = await tx.select().from(agents).where(eq(agents.id, args.agentId));
    if (!agent) throw new LifecycleError("NOT_FOUND", "Agent not found.");
    if (agent.ownerId !== args.userId) {
      throw new LifecycleError("FORBIDDEN", "You can only enter your own agents.");
    }

    const entries = await tx
      .select()
      .from(debateParticipants)
      .where(eq(debateParticipants.debateId, args.debateId));
    if (entries.some((e) => e.agentId === args.agentId)) {
      throw new LifecycleError("ALREADY_ENTERED", "This agent is already in the debate.");
    }
    if (entries.some((e) => e.position === args.position)) {
      throw new LifecycleError("SLOT_TAKEN", "That slot is taken.");
    }
    if (!debate.allowMultipleEntries && entries.some((e) => e.userId === args.userId)) {
      throw new LifecycleError("ONE_ENTRY_PER_USER", "This debate allows one agent per user.");
    }

    const id = randomUUID();
    try {
      await tx.insert(debateParticipants).values({
        id,
        debateId: args.debateId,
        agentId: args.agentId,
        userId: args.userId,
        position: args.position,
        joinedAt: now,
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new LifecycleError("SLOT_TAKEN", "That slot was just taken.");
      throw err;
    }

    if (debate.startMode === "when_full" && entries.length + 1 >= debate.maxParticipants) {
      await startInTx(tx, args.debateId, now);
    }
    return id;
  });
}

/** Withdraws one of the user's entries from an open debate, freeing the slot. */
export async function withdraw(db: Db, args: { participantId: string; userId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(debateParticipants)
      .where(eq(debateParticipants.id, args.participantId));
    if (!entry) throw new LifecycleError("NOT_FOUND", "Entry not found.");
    if (entry.userId !== args.userId) throw new LifecycleError("FORBIDDEN", "This is not your entry.");
    const debate = await loadDebate(tx, entry.debateId);
    if (debate.status !== "open") {
      throw new LifecycleError("NOT_OPEN", "You can't withdraw after the debate has started.");
    }
    await tx.delete(debateParticipants).where(eq(debateParticipants.id, args.participantId));
  });
}

/** The creator's Start button for a manual debate. */
export async function startDebate(
  db: Db,
  args: { debateId: string; userId: string },
  now = Date.now(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const debate = await loadDebate(tx, args.debateId);
    if (debate.creatorId !== args.userId) {
      throw new LifecycleError("FORBIDDEN", "Only the creator can start this debate.");
    }
    if (debate.startMode !== "manual") {
      throw new LifecycleError("WRONG_START_MODE", "This debate starts automatically.");
    }
    await startInTx(tx, args.debateId, now);
  });
}

/**
 * Starts a debate inside a transaction: renumbers slots 1..n keeping their order, snapshots each
 * agent (suffixing duplicate names), computes the token budget and marks the debate running.
 */
export async function startInTx(tx: Tx, debateId: string, now: number): Promise<void> {
  const debate = await loadDebate(tx, debateId);
  if (debate.status !== "open") throw new LifecycleError("NOT_OPEN", "This debate is no longer open.");

  const entries = await tx
    .select()
    .from(debateParticipants)
    .where(eq(debateParticipants.debateId, debateId))
    .orderBy(asc(debateParticipants.position));
  if (entries.length < 2) {
    throw new LifecycleError("NOT_ENOUGH_ENTRIES", "A debate needs at least 2 agents to start.");
  }

  const agentIds = entries.map((e) => e.agentId).filter((id): id is string => id !== null);
  const agentRows = await tx.select().from(agents).where(inArray(agents.id, agentIds));
  const agentById = new Map(agentRows.map((a) => [a.id, a]));
  const ordered = entries.map((entry) => {
    const agent = entry.agentId ? agentById.get(entry.agentId) : undefined;
    if (!agent) throw new Error(`Entry ${entry.id} has no agent.`);
    return { entry, agent };
  });
  const names = disambiguateNames(ordered.map((o) => o.agent.name));

  const maxOutputs: number[] = [];
  // Ascending order means each new position is <= the old one and already vacated.
  for (const [i, { entry, agent }] of ordered.entries()) {
    const settings = resolveSettings(
      agent.provider as Provider,
      agent.creativity as Creativity,
      agent.turnLength as TurnLength,
    );
    maxOutputs.push(settings.maxOutputTokens);
    await tx
      .update(debateParticipants)
      .set({
        position: i + 1,
        name: names[i],
        persona: agent.persona,
        style: agent.style,
        tone: agent.tone,
        stance: agent.stance,
        provider: agent.provider,
        modelId: agent.modelId,
        creativity: agent.creativity,
        turnLength: agent.turnLength,
        temperature: settings.temperature,
        maxOutputTokens: settings.maxOutputTokens,
      })
      .where(eq(debateParticipants.id, entry.id));
  }

  const started = await tx
    .update(debates)
    .set({
      status: "running",
      startedAt: now,
      currentRound: 1,
      currentTurnIndex: 0,
      maxTotalTokens: computeTokenBudget(debate.rounds, maxOutputs),
    })
    .where(and(eq(debates.id, debateId), eq(debates.status, "open")))
    .returning({ id: debates.id });
  if (started.length === 0) throw new LifecycleError("NOT_OPEN", "This debate is no longer open.");
}

export const NOT_ENOUGH_AT_START_REASON =
  "Fewer than 2 agents had entered when the scheduled start time arrived.";

/** Starts (or cancels, with fewer than 2 entries) every scheduled debate whose start time has passed. */
export async function startDueScheduled(
  db: Db,
  now = Date.now(),
): Promise<{ started: string[]; cancelled: string[] }> {
  const due = await db
    .select({ id: debates.id })
    .from(debates)
    .where(and(eq(debates.status, "open"), eq(debates.startMode, "scheduled"), lte(debates.startAt, now)))
    .orderBy(asc(debates.startAt), asc(debates.createdAt));

  const started: string[] = [];
  const cancelled: string[] = [];
  for (const { id } of due) {
    await db.transaction(async (tx) => {
      const entries = await tx
        .select({ id: debateParticipants.id })
        .from(debateParticipants)
        .where(eq(debateParticipants.debateId, id));
      if (entries.length >= 2) {
        await startInTx(tx, id, now);
        started.push(id);
      } else {
        const rows = await tx
          .update(debates)
          .set({ status: "cancelled", cancelReason: NOT_ENOUGH_AT_START_REASON })
          .where(and(eq(debates.id, id), eq(debates.status, "open")))
          .returning({ id: debates.id });
        if (rows.length) cancelled.push(id);
      }
    });
  }
  return { started, cancelled };
}

/** Creators may delete their debate while it is open; admins may delete any debate at any time. */
export async function deleteDebate(
  db: Db,
  args: { debateId: string; userId: string; isAdmin: boolean },
): Promise<void> {
  await db.transaction(async (tx) => {
    const debate = await loadDebate(tx, args.debateId);
    if (!args.isAdmin) {
      if (debate.creatorId !== args.userId) {
        throw new LifecycleError("FORBIDDEN", "Only the creator can delete this debate.");
      }
      if (debate.status !== "open") {
        throw new LifecycleError("NOT_OPEN", "A debate can't be deleted after it has started.");
      }
    }
    await tx.delete(votes).where(eq(votes.debateId, args.debateId));
    await tx.delete(turns).where(eq(turns.debateId, args.debateId));
    await tx.delete(debateParticipants).where(eq(debateParticipants.debateId, args.debateId));
    await tx.delete(debates).where(eq(debates.id, args.debateId));
  });
}

/**
 * Hard-deletes an agent (owner or admin). Its entries in open debates are withdrawn; started and
 * finished debates keep their snapshot with `agentId` set to null.
 */
export async function deleteAgent(
  db: Db,
  args: { agentId: string; userId: string; isAdmin: boolean },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [agent] = await tx.select().from(agents).where(eq(agents.id, args.agentId));
    if (!agent) throw new LifecycleError("NOT_FOUND", "Agent not found.");
    if (!args.isAdmin && agent.ownerId !== args.userId) {
      throw new LifecycleError("FORBIDDEN", "You can only delete your own agents.");
    }

    const openDebateIds = (
      await tx.select({ id: debates.id }).from(debates).where(eq(debates.status, "open"))
    ).map((d) => d.id);
    if (openDebateIds.length) {
      await tx
        .delete(debateParticipants)
        .where(
          and(eq(debateParticipants.agentId, args.agentId), inArray(debateParticipants.debateId, openDebateIds)),
        );
    }
    await tx
      .update(debateParticipants)
      .set({ agentId: null })
      .where(eq(debateParticipants.agentId, args.agentId));
    await tx.delete(agents).where(eq(agents.id, args.agentId));
  });
}

/** One vote per user per completed debate, while voting is open, never for your own agent. */
export async function castVote(
  db: Db,
  args: { debateId: string; userId: string; participantId: string },
  now = Date.now(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const debate = await loadDebate(tx, args.debateId);
    if (debate.status !== "completed") {
      throw new LifecycleError("NOT_COMPLETED", "Voting opens when the debate completes.");
    }
    if (debate.votingClosesAt === null || now >= debate.votingClosesAt) {
      throw new LifecycleError("VOTING_CLOSED", "Voting has closed.");
    }
    const [participant] = await tx
      .select()
      .from(debateParticipants)
      .where(and(eq(debateParticipants.id, args.participantId), eq(debateParticipants.debateId, args.debateId)));
    if (!participant) throw new LifecycleError("NOT_FOUND", "Participant not found.");
    if (participant.userId === args.userId) {
      throw new LifecycleError("OWN_AGENT", "You can't vote for your own agent.");
    }
    try {
      await tx.insert(votes).values({
        id: randomUUID(),
        debateId: args.debateId,
        userId: args.userId,
        participantId: args.participantId,
        createdAt: now,
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new LifecycleError("ALREADY_VOTED", "You have already voted.");
      throw err;
    }
  });
}

export function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) {
    if (String((e as { message?: unknown }).message ?? e).includes("UNIQUE constraint failed")) return true;
  }
  return false;
}
