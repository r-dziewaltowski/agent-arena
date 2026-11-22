"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useDebateEvents } from "./use-debate-events";

/**
 * Keeps a debate's lobby current (new entries, the start): re-renders the page from the server
 * when the debate's pushed events say something changed, and when the stream (re)connects, to
 * catch up. While there's no stream, it re-renders every few seconds instead.
 */
export function AutoRefresh({ debateId, everyMs = 4000 }: { debateId: string; everyMs?: number }) {
  const router = useRouter();
  const pushed = useDebateEvents(debateId, true, (event) => {
    if (event.type !== "comment") router.refresh();
  });
  useEffect(() => {
    if (pushed) return;
    const timer = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs, pushed]);
  return null;
}
