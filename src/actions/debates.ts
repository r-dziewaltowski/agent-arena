"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { catalogAvailability, listOllamaModels } from "@/lib/ai/models";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import type { Db } from "@/lib/db/client";
import { agents } from "@/lib/db/schema";
import { createDebate, deleteDebate, enter, LifecycleError, resumeDebate, startDebate, withdraw } from "@/lib/debate/lifecycle";
import { isSide, type Side } from "@/lib/debate/sides";
import { queueDebate } from "@/lib/jobs/advance";
import { getQueue } from "@/lib/jobs/queue";
import { pickValues, type FormValues } from "@/lib/form-values";
import { canUsePaidModels } from "@/lib/paid-models";
import { localToEpoch } from "@/lib/time";

export type FormState = { message?: string; errors?: Partial<Record<string, string[]>>; values?: FormValues };

/** Which models still exist, so a retired one falls back to its provider's default at start. */
async function availability() {
  return catalogAvailability(await listOllamaModels());
}

/**
 * Queues the debate's next message after a change (see `queueDebate`). A queue failure is logged,
 * not shown: the change itself succeeded, and the sweep picks the debate up later.
 */
async function queueSafely(db: Db, debateId: string, opts: { runningOnly?: boolean } = {}) {
  try {
    await queueDebate(db, debateId, getQueue(), opts);
  } catch (err) {
    console.error(`[jobs] couldn't queue debate ${debateId}; the sweep will pick it up.`, err);
  }
}

const DEBATE_FIELDS = [
  "topic",
  "mode",
  "rounds",
  "maxParticipants",
  "startMode",
  "startAtLocal",
  "allowMultipleEntries",
  "votingDuration",
  "tallyVisibility",
] as const;

export async function createDebateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireUser();
  const db = await getDb();
  const startMode = String(formData.get("startMode"));
  // The form sends the local date and time as typed plus the browser's time zone.
  const startAt =
    startMode === "scheduled"
      ? (localToEpoch(String(formData.get("startAtLocal") ?? ""), String(formData.get("timeZone") || "UTC")) ?? undefined)
      : undefined;
  let id: string;
  try {
    id = await createDebate(db, me.id, {
      topic: String(formData.get("topic") ?? ""),
      mode: formData.get("mode") === "sides" ? "sides" : "open",
      rounds: Number(formData.get("rounds")),
      maxParticipants: Number(formData.get("maxParticipants")),
      startMode: startMode as "manual" | "when_full" | "scheduled",
      startAt,
      allowMultipleEntries: formData.get("allowMultipleEntries") === "on",
      votingDuration: String(formData.get("votingDuration")) as "1h" | "1d" | "3d" | "1w",
      tallyVisibility: String(formData.get("tallyVisibility")) as "live" | "after_vote" | "after_close",
    });
  } catch (err) {
    if (err instanceof LifecycleError) return { message: err.message, values: pickValues(formData, DEBATE_FIELDS) };
    throw err;
  }
  await queueSafely(db, id); // a scheduled debate gets a message at its start time
  redirect(`/debates/${id}`);
}

export async function enterAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireUser();
  const db = await getDb();
  const debateId = String(formData.get("debateId"));
  const agentId = String(formData.get("agentId"));
  // An agent on an OpenRouter model speaks on its owner's own account, so it needs one connected.
  const [agent] = await db.select({ provider: agents.provider }).from(agents).where(eq(agents.id, agentId));
  if (agent?.provider === "openrouter" && !(await canUsePaidModels(db, me.id))) {
    return { message: "This agent uses an OpenRouter model. Connect your OpenRouter account on your account page first." };
  }
  try {
    await enter(
      db,
      {
        debateId,
        userId: me.id,
        agentId,
        position: Number(formData.get("position")),
        side: isSide(formData.get("side")) ? (formData.get("side") as Side) : null,
      },
      Date.now(),
      await availability(),
    );
  } catch (err) {
    if (err instanceof LifecycleError) return { message: err.message };
    throw err;
  }
  await queueSafely(db, debateId, { runningOnly: true }); // the last entry starts a "when full" debate
  refresh();
  return {};
}

export async function withdrawAction(formData: FormData) {
  const me = await requireUser();
  const db = await getDb();
  try {
    await withdraw(db, { participantId: String(formData.get("participantId")), userId: me.id });
  } catch (err) {
    if (!(err instanceof LifecycleError)) throw err;
  }
  refresh();
}

export async function startAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireUser();
  const db = await getDb();
  const debateId = String(formData.get("debateId"));
  try {
    await startDebate(db, { debateId, userId: me.id }, Date.now(), await availability());
  } catch (err) {
    if (err instanceof LifecycleError) return { message: err.message };
    throw err;
  }
  await queueSafely(db, debateId);
  refresh();
  return {};
}

export async function resumeDebateAction(formData: FormData) {
  const me = await requireUser();
  const db = await getDb();
  const debateId = String(formData.get("debateId"));
  try {
    await resumeDebate(db, { debateId, userId: me.id, isAdmin: me.isAdmin }, await availability());
    await queueSafely(db, debateId);
  } catch (err) {
    if (!(err instanceof LifecycleError)) throw err;
  }
  refresh();
}

export async function deleteDebateAction(formData: FormData) {
  const me = await requireUser();
  const db = await getDb();
  try {
    await deleteDebate(db, { debateId: String(formData.get("debateId")), userId: me.id, isAdmin: me.isAdmin });
  } catch (err) {
    if (err instanceof LifecycleError) return;
    throw err;
  }
  redirect("/debates");
}
