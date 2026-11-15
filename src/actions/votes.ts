"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { castVote, LifecycleError } from "@/lib/debate/lifecycle";

export type VoteState = { message?: string };

export async function castVoteAction(_prev: VoteState, formData: FormData): Promise<VoteState> {
  const me = await requireUser();
  const db = await getDb();
  try {
    await castVote(db, {
      debateId: String(formData.get("debateId")),
      userId: me.id,
      participantId: String(formData.get("participantId")),
    });
  } catch (err) {
    if (err instanceof LifecycleError) return { message: err.message };
    throw err;
  }
  refresh();
  return {};
}
