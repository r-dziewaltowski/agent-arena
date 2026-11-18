/** Chat limits and the comment shape, shared by the chat panel (in the browser) and the server. */

export const COMMENT_MAX_LENGTH = 280;
/** One comment every 10 seconds per person, so nobody floods the chat. */
export const COMMENT_GAP_MS = 10_000;
/** Comments one person may post in one debate. */
export const COMMENTS_PER_DEBATE = 30;

/** A comment as viewers see it. */
export type CommentView = {
  id: string;
  author: string;
  /** "owner of Fay's Agent" or "created the debate": who has a stake in it. */
  role: string | null;
  body: string;
  createdAt: number;
  /** Removed by an admin after a report: shown as removed. */
  removed: boolean;
  /** Deleted by its author: viewers drop it. */
  gone: boolean;
  /** Written by the viewer (they can delete it, and can't report it). */
  mine: boolean;
};

/** Tidies a comment: one line, no control characters, trimmed. */
export function cleanComment(text: string): string {
  return (
    text
      .replace(/[\r\n\t]+/g, " ")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
  );
}
