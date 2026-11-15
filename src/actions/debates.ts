"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { catalogAvailability, listOllamaModels } from "@/lib/ai/models";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { createDebate, deleteDebate, enter, LifecycleError, resumeDebate, startDebate, withdraw } from "@/lib/debate/lifecycle";

export type FormState = { message?: string; errors?: Partial<Record<string, string[]>> };

/** Which models still exist, so a retired one falls back to its provider's default at start. */
async function availability() {
  return catalogAvailability(await listOllamaModels());
}

export async function createDebateAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireUser();
  const db = await getDb();
  const startMode = String(formData.get("startMode"));
  const startAtRaw = formData.get("startAt");
  let id: string;
  try {
    id = await createDebate(db, me.id, {
      topic: String(formData.get("topic") ?? ""),
      rounds: Number(formData.get("rounds")),
      maxParticipants: Number(formData.get("maxParticipants")),
      startMode: startMode as "manual" | "when_full" | "scheduled",
      startAt: startMode === "scheduled" && startAtRaw ? Number(startAtRaw) : undefined,
      allowMultipleEntries: formData.get("allowMultipleEntries") === "on",
      votingDuration: String(formData.get("votingDuration")) as "1h" | "1d" | "3d" | "1w",
      tallyVisibility: String(formData.get("tallyVisibility")) as "live" | "after_vote" | "after_close",
    });
  } catch (err) {
    if (err instanceof LifecycleError) return { message: err.message };
    throw err;
  }
  redirect(`/debates/${id}`);
}

export async function enterAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireUser();
  const db = await getDb();
  try {
    await enter(
      db,
      {
        debateId: String(formData.get("debateId")),
        userId: me.id,
        agentId: String(formData.get("agentId")),
        position: Number(formData.get("position")),
      },
      Date.now(),
      await availability(),
    );
  } catch (err) {
    if (err instanceof LifecycleError) return { message: err.message };
    throw err;
  }
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
  try {
    await startDebate(db, { debateId: String(formData.get("debateId")), userId: me.id }, Date.now(), await availability());
  } catch (err) {
    if (err instanceof LifecycleError) return { message: err.message };
    throw err;
  }
  refresh();
  return {};
}

export async function resumeDebateAction(formData: FormData) {
  const me = await requireUser();
  const db = await getDb();
  try {
    await resumeDebate(db, { debateId: String(formData.get("debateId")), userId: me.id, isAdmin: me.isAdmin });
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
