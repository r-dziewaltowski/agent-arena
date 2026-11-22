"use client";

import { useEffect, useRef, useState } from "react";
import { parseEvent, type DebateEvent } from "@/lib/realtime/events";

/** What a page hears: the server's events, plus `open` whenever the stream (re)connects. */
export type StreamEvent = DebateEvent | { type: "open" };

/** Waits before connecting again after the stream drops: doubling from 2 s up to a minute. */
const RETRY_FIRST_MS = 2_000;
const RETRY_MAX_MS = 60_000;

/**
 * Listens to one debate's events while `enabled`. The server says where (`/events/connect`):
 * Ably's address in production, the app's own stream in development and tests, or nowhere, in
 * which case this stays disconnected and the page keeps polling.
 *
 * Returns whether the stream is up. While it isn't (connecting, dropped, refused), pages poll as
 * before. On every (re)connect it sends `open`, so the page fetches what it missed meanwhile.
 * The browser's own reconnecting would reuse the old address, whose Ably token may have expired,
 * so on any drop this asks the server for a fresh address.
 */
export function useDebateEvents(debateId: string, enabled: boolean, onEvent: (event: StreamEvent) => void): boolean {
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryMs = RETRY_FIRST_MS;

    const retryLater = () => {
      source?.close();
      source = null;
      setConnected(false);
      if (stopped) return;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
    };

    async function connect() {
      let url: string | null;
      try {
        const res = await fetch(`/api/debates/${debateId}/events/connect`, { cache: "no-store" });
        if (res.status === 404) return; // the debate is gone; the page will find out
        if (!res.ok) throw new Error(String(res.status));
        url = ((await res.json()) as { url: string | null }).url;
      } catch {
        if (!stopped) retryLater();
        return;
      }
      if (stopped || !url) return; // no push here: the page polls

      const es = new EventSource(url);
      source = es;
      es.onopen = () => {
        retryMs = RETRY_FIRST_MS;
        setConnected(true);
        onEventRef.current({ type: "open" });
      };
      es.onmessage = (message) => {
        const event = parseEvent(message.data);
        if (event) onEventRef.current(event);
      };
      // Network drops, refusals (e.g. Ably's connection limit) and Ably's own `error` events (an
      // expired token) all land here: start over with a fresh address.
      es.addEventListener("error", () => {
        if (source === es) retryLater();
      });
    }

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      source?.close();
      setConnected(false);
    };
  }, [debateId, enabled]);

  return connected;
}
