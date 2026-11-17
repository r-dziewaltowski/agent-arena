"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Notice, cx } from "@/components/ui";
import { costUsd, formatUsd, type Price } from "@/lib/ai/pricing";
import type { TurnView } from "@/lib/debate-view";
import { Countdown } from "./countdown";

/** `price`: set for agents on paid models, billed to their owner's OpenRouter account. */
type Speaker = { participantId: string; name: string; position: number; price: Price | null };
type Silenced = { participantId: string; reason: string | null };

type LiveState = {
  status: string;
  waitingReason: string | null;
  nextAttemptAt: number | null;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  silenced: Silenced[];
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
 * being written arrives with more text each time, so every viewer sees it grow word by word. While
 * someone watches, the server releases the text at reading pace (lib/debate/pacing.ts); this view
 * only smooths each second's new words so they appear one by one.
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

  // The last turn may still be being revealed after the debate has finished.
  const active = state.status === "running" || turns.some((t) => t.status === "streaming");

  useEffect(() => {
    if (!active) return;
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
            silenced: data.silenced,
          });
          // Finished or failed, and every word shown: reload the page around the transcript (status, voting, etc.).
          if (data.status !== "running" && !data.turns.some((t) => t.status === "streaming")) router.refresh();
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
  }, [debateId, active, router]);

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
        <p className="text-sm text-zinc-500 dark:text-zinc-400">The first speaker is preparing their opening statement…</p>
      )}

      {[...byRound.entries()].map(([round, roundTurns]) => (
        <section key={round}>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{roundTitle(round, rounds)}</h3>
          <div className="space-y-3">
            {roundTurns.map((t) => {
              const speaker = t.participantId ? speakerById.get(t.participantId) : undefined;
              const idx = ((speaker?.position ?? 1) - 1) % SPEAKER_COLORS.length;
              return (
                <article key={t.seq} className={cx("rounded-md border-l-4 px-4 py-3", SPEAKER_COLORS[idx])}>
                  <p className={cx("mb-1 text-sm font-semibold", NAME_COLORS[idx])}>{speaker?.name ?? "Unknown"}</p>
                  <SmoothText text={t.content} streaming={t.status === "streaming"} />
                  {t.status === "complete" && t.completionTokens !== null && (
                    <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">{t.completionTokens} tokens</p>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ))}

      {state.silenced.map((x) => (
        <Notice key={x.participantId} tone="amber">
          {speakerById.get(x.participantId)?.name ?? "An agent"} can&apos;t speak any more: {x.reason ?? "its owner's key stopped working"}.
          Its remaining turns are skipped.
        </Notice>
      ))}

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {(state.totalPromptTokens + state.totalCompletionTokens).toLocaleString()} tokens used · {costLine(speakers, turns)}
      </p>
    </div>
  );
}

/** "Free", or what each paid agent cost its owner so far (list price, on their OpenRouter account). */
function costLine(speakers: Speaker[], turns: TurnView[]): string {
  const paid = speakers.filter((sp) => sp.price);
  if (paid.length === 0) return "Free";
  const costs = paid.map((sp) => {
    const own = turns.filter((t) => t.participantId === sp.participantId && t.status === "complete");
    const usd = own.reduce((sum, t) => sum + costUsd(sp.price!, t.promptTokens ?? 0, t.completionTokens ?? 0), 0);
    return `${sp.name} ${formatUsd(usd)}`;
  });
  const free = speakers.length > paid.length ? "; the rest free" : "";
  return `${costs.join(", ")} on its owner's OpenRouter account${free}`;
}

/** Fully revealing a second's worth of new text takes about this long (one poll interval). */
const SMOOTH_MS = 1000;
const SMOOTH_TICK_MS = 40;

/**
 * A turn's text, letting newly arrived words appear one by one over about a second instead of in
 * one jump per poll. Text already there when the turn first renders (a finished turn) shows at once.
 */
function SmoothText({ text, streaming }: { text: string; streaming: boolean }) {
  const [shown, setShown] = useState(() => (streaming ? 0 : text.length));
  const shownRef = useRef(shown);

  useEffect(() => {
    const target = text.length;
    if (shownRef.current >= target) return;
    const perTick = Math.max(1, ((target - shownRef.current) * SMOOTH_TICK_MS) / SMOOTH_MS);
    const timer = setInterval(() => {
      const next = Math.min(target, shownRef.current + perTick);
      shownRef.current = next;
      setShown(next);
      if (next >= target) clearInterval(timer);
    }, SMOOTH_TICK_MS);
    return () => clearInterval(timer);
  }, [text]);

  const visible = Math.min(Math.floor(shown), text.length);
  const typing = streaming || visible < text.length;
  return (
    <p className={cx("whitespace-pre-wrap text-sm leading-relaxed", typing && "typing-caret")}>{text.slice(0, visible)}</p>
  );
}
