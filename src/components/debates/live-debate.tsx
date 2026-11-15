"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Notice, cx } from "@/components/ui";
import type { TurnView } from "@/lib/debate-view";
import { Countdown } from "./countdown";

type Speaker = { participantId: string; name: string; position: number };

type LiveState = {
  status: string;
  waitingReason: string | null;
  nextAttemptAt: number | null;
  totalPromptTokens: number;
  totalCompletionTokens: number;
};

const SPEAKER_COLORS = [
  "border-indigo-400 bg-indigo-50/60 dark:bg-indigo-950/40",
  "border-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/40",
  "border-amber-400 bg-amber-50/60 dark:bg-amber-950/40",
  "border-rose-400 bg-rose-50/60 dark:bg-rose-950/40",
];
const NAME_COLORS = ["text-indigo-700 dark:text-indigo-300", "text-emerald-700 dark:text-emerald-300", "text-amber-700 dark:text-amber-300", "text-rose-700 dark:text-rose-300"];

function roundTitle(round: number, rounds: number) {
  if (round === 1) return "Opening statements";
  if (round === rounds) return "Closing statements";
  return `Round ${round}`;
}

/**
 * The transcript. While the debate runs it polls the turns endpoint about once a second; the turn
 * being written arrives with more text each time, so every viewer sees it grow word by word.
 */
export function LiveDebate({
  debateId,
  rounds,
  speakers,
  initialTurns,
  initial,
}: {
  debateId: string;
  rounds: number;
  speakers: Speaker[];
  initialTurns: TurnView[];
  initial: LiveState;
}) {
  const router = useRouter();
  const [turns, setTurns] = useState<TurnView[]>(initialTurns);
  const [state, setState] = useState<LiveState>(initial);
  const turnsRef = useRef(turns);
  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  useEffect(() => {
    if (state.status !== "running") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      const after = Math.max(0, ...turnsRef.current.filter((t) => t.status === "complete").map((t) => t.seq));
      try {
        const res = await fetch(`/api/debates/${debateId}/turns?after=${after}`, { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as LiveState & { turns: TurnView[] };
          if (stopped) return;
          setTurns((prev) => {
            // Drop our streaming copies; the response carries the current one (or none, if discarded).
            const bySeq = new Map(prev.filter((t) => t.status === "complete").map((t) => [t.seq, t]));
            for (const t of data.turns) bySeq.set(t.seq, t);
            return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
          });
          setState({
            status: data.status,
            waitingReason: data.waitingReason,
            nextAttemptAt: data.nextAttemptAt,
            totalPromptTokens: data.totalPromptTokens,
            totalCompletionTokens: data.totalCompletionTokens,
          });
          // Finished or failed: reload the page around the transcript (status, voting, etc.).
          if (data.status !== "running") router.refresh();
        }
      } catch {
        // Network hiccup: try again on the next tick.
      }
      if (!stopped) timer = setTimeout(poll, 1000);
    };

    timer = setTimeout(poll, 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [debateId, state.status, router]);

  const speakerById = new Map(speakers.map((s) => [s.participantId, s]));
  const byRound = new Map<number, TurnView[]>();
  for (const t of turns) byRound.set(t.round, [...(byRound.get(t.round) ?? []), t]);

  return (
    <div className="space-y-6">
      {state.status === "running" && state.waitingReason && (
        <Notice tone="amber">
          {state.waitingReason}
          {state.nextAttemptAt && (
            <span className="block text-xs">
              <Countdown to={state.nextAttemptAt} label="Next try in" />
            </span>
          )}
        </Notice>
      )}

      {turns.length === 0 && state.status === "running" && (
        <p className="text-sm text-zinc-500">The first speaker is preparing their opening statement…</p>
      )}

      {[...byRound.entries()].map(([round, roundTurns]) => (
        <section key={round}>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">{roundTitle(round, rounds)}</h3>
          <div className="space-y-3">
            {roundTurns.map((t) => {
              const speaker = t.participantId ? speakerById.get(t.participantId) : undefined;
              const idx = ((speaker?.position ?? 1) - 1) % SPEAKER_COLORS.length;
              return (
                <article key={t.seq} className={cx("rounded-md border-l-4 px-4 py-3", SPEAKER_COLORS[idx])}>
                  <p className={cx("mb-1 text-sm font-semibold", NAME_COLORS[idx])}>{speaker?.name ?? "Unknown"}</p>
                  <p className={cx("whitespace-pre-wrap text-sm leading-relaxed", t.status === "streaming" && "typing-caret")}>
                    {t.content}
                  </p>
                  {t.status === "complete" && t.completionTokens !== null && (
                    <p className="mt-2 text-[11px] text-zinc-500">{t.completionTokens} tokens</p>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ))}

      <p className="text-xs text-zinc-500">
        {(state.totalPromptTokens + state.totalCompletionTokens).toLocaleString()} tokens used · Free
      </p>
    </div>
  );
}
