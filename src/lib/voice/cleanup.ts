import { inArray, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { turnAudio, turns } from "../db/schema";

/** Speech is only for listening live: it is deleted this long after its turn has been shown. */
export const AUDIO_KEPT_AFTER_SHOWN_MS = 2 * 60_000;

/**
 * Deletes the speech of turns that everyone has already heard. Runs at every debate step and at
 * every sweep, so a finished debate's audio is gone within the sweep interval.
 */
export async function deleteHeardAudio(db: Db, now: number): Promise<void> {
  const heard = db
    .select({ id: turns.id })
    .from(turns)
    .where(lt(turns.revealEndsAt, now - AUDIO_KEPT_AFTER_SHOWN_MS));
  await db.delete(turnAudio).where(inArray(turnAudio.turnId, heard));
}
