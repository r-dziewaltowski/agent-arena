"use client";

import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

/**
 * A date in the viewer's own locale and time zone ("15 Nov", or "15 Nov 2025" for another year).
 * The server doesn't know either, so it renders the plain ISO date until the browser takes over.
 */
export function LocalDate({ at }: { at: number }) {
  const text = useSyncExternalStore(
    noSubscribe,
    () => {
      const d = new Date(at);
      const sameYear = d.getFullYear() === new Date().getFullYear();
      return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
    },
    () => new Date(at).toISOString().slice(0, 10),
  );
  return <time dateTime={new Date(at).toISOString()}>{text}</time>;
}
