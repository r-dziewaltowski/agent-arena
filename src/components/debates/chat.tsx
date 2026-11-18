"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { deleteCommentAction, postCommentAction } from "@/actions/chat";
import { Button, Card, cx, inputClass } from "@/components/ui";
import { COMMENT_MAX_LENGTH, type CommentView } from "@/lib/chat-shared";
import { ReportDialog } from "./report-button";

/**
 * The chat's comments in this browser. The transcript's poll (live-debate.tsx) asks for comments
 * since its previous poll and merges them in here, so the chat needs no polling of its own.
 */
type Feed = {
  comments: CommentView[];
  /** The server time of the last poll: the next one asks for comments since then. */
  cursor: () => number;
  merge: (list: CommentView[], serverNow?: number) => void;
};

const FeedContext = createContext<Feed | null>(null);

/** The transcript's poll uses it when the page has a chat; null otherwise. */
export function useChatFeed(): Feed | null {
  return useContext(FeedContext);
}

export function ChatFeedProvider({ initial, since, children }: { initial: CommentView[]; since: number; children: ReactNode }) {
  const [comments, setComments] = useState(initial);
  const cursorRef = useRef(since);
  const cursor = useCallback(() => cursorRef.current, []);
  const merge = useCallback((list: CommentView[], serverNow?: number) => {
    if (serverNow) cursorRef.current = serverNow;
    if (list.length === 0) return;
    setComments((prev) => {
      const byId = new Map(prev.map((c) => [c.id, c]));
      // A poll doesn't know who's asking unless it has new comments; keep "mine" once known.
      for (const c of list) byId.set(c.id, { ...c, mine: c.mine || !!byId.get(c.id)?.mine });
      return [...byId.values()].filter((c) => !c.gone).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    });
  }, []);
  const value = useMemo(() => ({ comments, cursor, merge }), [comments, cursor, merge]);
  return <FeedContext.Provider value={value}>{children}</FeedContext.Provider>;
}

/**
 * The chat beside a live debate: what viewers say while it plays. The agents never see it.
 * `open`: posting is allowed (the debate is live); afterwards it's a read-only record.
 */
export function ChatPanel({ debateId, open, signedIn }: { debateId: string; open: boolean; signedIn: boolean }) {
  const feed = useChatFeed();
  const comments = feed?.comments ?? [];
  const listRef = useRef<HTMLOListElement>(null);
  // Follow new comments while the reader is at the bottom; leave them be if they scrolled up.
  const stickRef = useRef(true);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && stickRef.current) list.scrollTop = list.scrollHeight;
  }, [comments.length]);

  const dialog = useRef<HTMLDialogElement>(null);
  const [reporting, setReporting] = useState<CommentView | null>(null);
  useEffect(() => {
    if (reporting) dialog.current?.showModal();
  }, [reporting]);

  const [, startDelete] = useTransition();
  const remove = (c: CommentView) =>
    startDelete(async () => {
      const { ok } = await deleteCommentAction(c.id);
      if (ok) feed?.merge([{ ...c, gone: true }]);
    });

  return (
    <Card className={cx("flex flex-col gap-3", open && "md:sticky md:top-4")}>
      <div>
        <h2 className="text-sm font-semibold">
          Chat
          {comments.length > 0 && <span className="font-normal text-zinc-500 dark:text-zinc-400"> · {comments.length}</span>}
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {open ? "For viewers while the debate plays. The agents don't see it." : "What viewers said while the debate played."}
        </p>
      </div>

      {comments.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{open ? "No comments yet." : "Nobody commented."}</p>
      ) : (
        <ol
          ref={listRef}
          aria-label="Chat comments"
          onScroll={(e) => {
            const el = e.currentTarget;
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
          className="max-h-96 space-y-2.5 overflow-y-auto pr-1"
        >
          {comments.map((c) => (
            <li key={c.id} className="group text-sm" aria-label={`Comment by ${c.author}`}>
              <p className="text-xs">
                <span className="font-semibold">{c.author}</span>
                {c.role && <span className="text-zinc-500 dark:text-zinc-400"> · {c.role}</span>}
              </p>
              {c.removed ? (
                <p className="italic text-zinc-500 dark:text-zinc-400">Removed by an admin.</p>
              ) : (
                <p className="break-words">{c.body}</p>
              )}
              {!c.removed && (c.mine || signedIn) && (
                <div className="mt-0.5 flex gap-3 text-[11px] text-zinc-500 opacity-70 group-hover:opacity-100 dark:text-zinc-400">
                  {c.mine ? (
                    <button type="button" className="hover:underline" onClick={() => remove(c)}>
                      Delete
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="hover:underline"
                      onClick={() => setReporting(c)}
                      aria-label={`Report ${c.author}'s comment`}
                    >
                      Report
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {open &&
        (signedIn ? (
          <ChatForm debateId={debateId} onPosted={(c) => feed?.merge([c])} />
        ) : (
          <p className="text-sm">
            <Link href={`/sign-in?next=/debates/${debateId}`} className="font-medium text-indigo-600 hover:underline">
              Sign in
            </Link>{" "}
            to chat.
          </p>
        ))}

      {reporting && (
        <ReportDialog
          key={reporting.id}
          dialog={dialog}
          debateId={debateId}
          fixed={{
            value: `comment:${reporting.id}`,
            label: `${reporting.author}'s comment: “${reporting.body}”`,
          }}
        />
      )}
    </Card>
  );
}

function ChatForm({ debateId, onPosted }: { debateId: string; onPosted: (c: CommentView) => void }) {
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startPost] = useTransition();
  const left = COMMENT_MAX_LENGTH - text.length;

  return (
    <form
      className="space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim() || pending) return;
        startPost(async () => {
          const result = await postCommentAction(debateId, text);
          if (result.comment) {
            onPosted(result.comment);
            setText("");
            setMessage(null);
          } else {
            setMessage(result.message ?? "Couldn't post that.");
          }
        });
      }}
    >
      <div className="flex gap-2">
        <input
          name="comment"
          aria-label="Your comment"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={COMMENT_MAX_LENGTH}
          placeholder="Say something…"
          autoComplete="off"
          className={cx(inputClass, "min-w-0 flex-1")}
        />
        <Button type="submit" disabled={pending || !text.trim()} className="shrink-0">
          Send
        </Button>
      </div>
      {message && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {message}
        </p>
      )}
      {left <= 40 && <p className="text-right text-[11px] text-zinc-500 dark:text-zinc-400">{left} characters left</p>}
    </form>
  );
}
