"use client";

import { useEffect, useState } from "react";

function format(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${sec.toString().padStart(2, "0")}s`;
}

/** "Starts in 4m 12s", shown in the viewer's own clock; the worker does the actual starting. */
export function Countdown({ to, label = "Starts in" }: { to: number; label?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  if (now === null) return null;
  const left = to - now;
  return (
    <span>
      {left > 0 ? `${label} ${format(left)}` : "Starting…"}
      <span className="text-zinc-500"> ({new Date(to).toLocaleString()})</span>
    </span>
  );
}
