"use server";

import { requireUser } from "@/lib/auth/session";
import { ChatError, commentViews, createComment, deleteOwnComment, type CommentView } from "@/lib/chat";
import { getDb } from "@/lib/db/client";
import { debateComments } from "@/lib/db/schema";
import { readingWordsPerSecond } from "@/lib/debate/pacing";
import { eq } from "drizzle-orm";

export type PostResult = { comment?: CommentView; message?: string };

/** Posts a chat comment; returns it as viewers see it, so it shows at once for its author. */
export async function postCommentAction(debateId: string, body: string): Promise<PostResult> {
  const me = await requireUser(`/debates/${debateId}`);
  const db = await getDb();
  try {
    const id = await createComment(db, { debateId, userId: me.id, body }, Date.now(), readingWordsPerSecond());
    const rows = await db.select().from(debateComments).where(eq(debateComments.id, id));
    const [comment] = await commentViews(db, debateId, rows, me.id);
    return { comment };
  } catch (err) {
    if (err instanceof ChatError) return { message: err.message };
    throw err;
  }
}

/** Deletes one of your own comments. */
export async function deleteCommentAction(commentId: string): Promise<{ ok: boolean }> {
  const me = await requireUser();
  return {
    ok: await deleteOwnComment(await getDb(), commentId, me.id, Date.now()),
  };
}
