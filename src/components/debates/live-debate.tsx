"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Avatar } from "@/components/avatar";
import { Notice, cx } from "@/components/ui";
import { costUsd, formatUsd, type Price } from "@/lib/ai/pricing";
import { revealedLength, SPEECH_PLAYBACK_RATE, wholeWords } from "@/lib/debate/pacing";
import type { TurnView, UpcomingTurn } from "@/lib/debate-view";
import { charsAt } from "@/lib/voice/marks";
import { Countdown } from "./countdown";

/** `price`: set for agents on paid models, billed to their owner's OpenRouter account. */
type Speaker = { participantId: string; name: string; position: number; price: Price | null; avatarUrl: string };
type Silenced = { participantId: string; reason: string | null };

type LiveState = {
  status: string;
  waitingReason: string | null;
  nextAttemptAt: number | null;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  silenced: Silenced[];
};

type TurnsResponse = LiveState & { turns: TurnView[]; upcoming: UpcomingTurn | null; serverNow: number };

const SPEAKER_COLORS = [
  "border-indigo-400 bg-indigo-50/60 dark:bg-indigo-950/40",
  "border-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/40",
  "border-amber-400 bg-amber-50/60 dark:bg-amber-950/40",
  "border-rose-400 bg-rose-50/60 dark:bg-rose-950/40",
];
const NAME_COLORS = ["text-indigo-700 dark:text-indigo-300", "text-emerald-700 dark:text-emerald-300", "text-amber-700 dark:text-amber-300", "text-rose-700 dark:text-rose-300"];

/** Remembers, in this browser only, that the viewer wants to hear debates. */
const LISTEN_KEY = "agent-arena:listen";
/** How often a turn being shown is redrawn. */
const TICK_MS = 50;

function roundTitle(round: number, rounds: number) {
  if (round === 1) return "Opening statements";
  if (round === rounds) return "Closing statements";
  return `Round ${round}`;
}

/**
 * The transcript. While the debate runs it polls the turns endpoint about once a second. A turn
 * being shown arrives whole, with its timing: this view reveals it word by word on the server's
 * clock, or, when listening, in step with the turn's speech (lib/debate/pacing.ts, lib/voice/marks.ts).
 */
export function LiveDebate({
  debateId,
  rounds,
  speakers,
  initialTurns,
  initialUpcoming,
  initial,
  serverNow,
  wordsPerSecond,
  voiceOn,
}: {
  debateId: string;
  rounds: number;
  speakers: Speaker[];
  initialTurns: TurnView[];
  initialUpcoming: UpcomingTurn | null;
  initial: LiveState;
  /** The server's clock when the page was made, to correct this browser's. */
  serverNow: number;
  wordsPerSecond: number | null;
  /** Whether turns get speech, so the Listen button is offered. */
  voiceOn: boolean;
}) {
  const router = useRouter();
  const [turns, setTurns] = useState<TurnView[]>(initialTurns);
  const [upcoming, setUpcoming] = useState<UpcomingTurn | null>(initialUpcoming);
  const [state, setState] = useState<LiveState>(initial);
  // Server time minus this browser's time: first from when the page was made, then from each poll.
  const offsetRef = useRef<number | null>(null);
  const serverTime = useCallback(() => {
    offsetRef.current ??= serverNow - Date.now();
    return Date.now() + offsetRef.current;
  }, [serverNow]);
  const turnsRef = useRef(turns);
  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  // A debate stays live for viewers until its last turn has been shown, even once it's finished.
  const showing = turns.some((t) => t.status === "streaming") || upcoming !== null;
  const active = state.status === "running" || showing;

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      const after = Math.max(0, ...turnsRef.current.filter((t) => t.status === "complete").map((t) => t.seq));
      try {
        const sentAt = Date.now();
        const res = await fetch(`/api/debates/${debateId}/turns?after=${after}`, { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as TurnsResponse;
          if (stopped) return;
          // The server's time was read about halfway through the request.
          offsetRef.current = data.serverNow - (sentAt + Date.now()) / 2;
          setTurns((prev) => {
            // Drop our copies of turns still being shown; the response carries them.
            const bySeq = new Map(prev.filter((t) => t.status === "complete").map((t) => [t.seq, t]));
            for (const t of data.turns) bySeq.set(t.seq, t);
            return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
          });
          setUpcoming(data.upcoming);
          setState({
            status: data.status,
            waitingReason: data.waitingReason,
            nextAttemptAt: data.nextAttemptAt,
            totalPromptTokens: data.totalPromptTokens,
            totalCompletionTokens: data.totalCompletionTokens,
            silenced: data.silenced,
          });
          // Finished or failed, and every word shown: reload the page around the transcript (status, voting, etc.).
          if (data.status !== "running" && !data.upcoming && !data.turns.some((t) => t.status === "streaming")) router.refresh();
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

  // Redraw turns being shown a few times a second.
  const [now, setNow] = useState(() => serverNow);
  const revealing = turns.some((t) => t.reveal);
  useEffect(() => {
    if (!revealing) return;
    const timer = setInterval(() => setNow(serverTime()), TICK_MS);
    return () => clearInterval(timer);
  }, [revealing, serverTime]);

  // The turn being spoken right now, if it has speech.
  const speaking = turns.find((t) => t.reveal?.audioUrl && t.reveal.startsAt <= now && t.status === "streaming");
  const speech = useSpeech({
    current: speaking?.reveal?.audioUrl ? { seq: speaking.seq, url: speaking.reveal.audioUrl, startsAt: speaking.reveal.startsAt } : null,
    upcomingUrl: upcoming?.audioUrl ?? null,
    serverTime,
  });

  const speakerById = new Map(speakers.map((s) => [s.participantId, s]));
  const byRound = new Map<number, TurnView[]>();
  for (const t of turns) byRound.set(t.round, [...(byRound.get(t.round) ?? []), t]);

  /** How much of a turn being shown is out: by its audio when it's playing, else by the clock. */
  const shownLength = (t: TurnView & { reveal: NonNullable<TurnView["reveal"]> }) => {
    const playing = speech.position;
    if (playing && playing.seq === t.seq && t.reveal.marks) return wholeWords(t.reveal.full, charsAt(t.reveal.marks, playing.ms));
    return revealedLength(t.reveal.full, { revealStartedAt: t.reveal.startsAt, marks: t.reveal.marks }, now, wordsPerSecond);
  };

  return (
    <div className="space-y-6">
      {voiceOn && active && <ListenBar speech={speech} />}

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

      {turns.length === 0 && active && (
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
                  <div className="mb-2 flex items-center gap-2.5">
                    {speaker && <Avatar src={speaker.avatarUrl} size={32} />}
                    <p className={cx("text-sm font-semibold", NAME_COLORS[idx])}>{speaker?.name ?? "Unknown"}</p>
                  </div>
                  {t.reveal ? (
                    <RevealText text={t.reveal.full} shown={shownLength({ ...t, reveal: t.reveal })} />
                  ) : (
                    <SmoothText text={t.content} streaming={t.status === "streaming"} />
                  )}
                  {t.status === "complete" && t.completionTokens !== null && (
                    <p className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">{t.completionTokens} tokens</p>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ))}

      {turns.length > 0 && active && !turns.some((t) => t.status === "streaming") && state.status === "running" && (
        <Delayed ms={3000}>
          <p className="typing-caret text-sm text-zinc-500 dark:text-zinc-400">The next speaker is preparing</p>
        </Delayed>
      )}

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

type SpeechControls = ReturnType<typeof useSpeech>;

/** The Listen switch. It affects only this browser: the debate runs the same for everyone. */
function ListenBar({ speech }: { speech: SpeechControls }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
      <button
        type="button"
        aria-pressed={speech.listening}
        onClick={speech.listening && !speech.blocked ? speech.stop : speech.listen}
        className={cx(
          "inline-flex items-center gap-2 rounded-md px-3 py-1.5 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500",
          speech.listening
            ? "bg-indigo-600 text-white hover:bg-indigo-500"
            : "border border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900",
        )}
      >
        <SpeakerIcon muted={!speech.listening} />
        {speech.listening ? (speech.blocked ? "Start sound" : "Listening") : "Listen"}
      </button>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">
        {speech.blocked
          ? "Your browser paused the sound. Press Start sound to hear the agents."
          : speech.listening
            ? "Press again to stop. The text follows the voices."
            : "Hear the agents' voices, with the text in step. Only in this browser."}
      </span>
    </div>
  );
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="size-4" aria-hidden>
      <path d="M3 8h3l4-3v10l-4-3H3z" fill="currentColor" stroke="none" />
      {muted ? <path d="M13 8l4 4m0-4l-4 4" strokeLinecap="round" /> : <path d="M13 7.5a3.5 3.5 0 0 1 0 5M15 5.5a6.5 6.5 0 0 1 0 9" strokeLinecap="round" />}
    </svg>
  );
}

/**
 * Plays the speech of the turn being shown, from the point the debate has reached (someone who
 * joins mid-turn hears the rest of it). `mediaMs` tells the text how far the voice has got, so the
 * two stay together even if the audio stalls to load. The choice is remembered in this browser.
 */
function useSpeech({
  current,
  upcomingUrl,
  serverTime,
}: {
  current: { seq: number; url: string; startsAt: number } | null;
  upcomingUrl: string | null;
  serverTime: () => number;
}) {
  const listening = useSyncExternalStore(subscribeListen, readListen, () => false);
  const [blocked, setBlocked] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [position, setPosition] = useState<{ seq: number; ms: number } | null>(null);
  const currentRef = useRef(current);
  const serverTimeRef = useRef(serverTime);
  useEffect(() => {
    currentRef.current = current;
    serverTimeRef.current = serverTime;
  });

  /** Starts (or resumes) the current turn's speech at the right point; safe to call repeatedly. */
  const sync = useCallback(() => {
    const turn = currentRef.current;
    let el = audioRef.current;
    // Between turns: let the last one's speech finish. It can run a moment behind the schedule (it
    // started after loading), and pausing it here would cut off its last words.
    if (!turn) return;
    if (!el) {
      el = new Audio();
      el.preload = "auto";
      audioRef.current = el;
    }
    const start = () => {
      const audio = audioRef.current;
      if (!audio || audio.dataset.seq !== String(turn.seq)) return;
      audio.playbackRate = SPEECH_PLAYBACK_RATE;
      audio.currentTime = Math.max(0, ((serverTimeRef.current() - turn.startsAt) * SPEECH_PLAYBACK_RATE) / 1000);
      audio.play().then(
        () => setBlocked(false),
        (err: unknown) => {
          // Autoplay refused until the viewer presses something on the page.
          if (err instanceof DOMException && err.name === "NotAllowedError") setBlocked(true);
        },
      );
    };
    if (el.dataset.seq !== String(turn.seq)) {
      el.pause();
      el.dataset.seq = String(turn.seq);
      el.src = turn.url;
      el.defaultPlaybackRate = SPEECH_PLAYBACK_RATE;
      el.addEventListener("loadedmetadata", start, { once: true });
      el.load();
    } else if (el.paused && !el.ended) {
      start();
    }
  }, []);

  useEffect(() => {
    if (listening) sync();
    else audioRef.current?.pause();
  }, [listening, current?.seq, sync]);

  // Fetch the next turn's speech while this one plays, so it starts on time.
  useEffect(() => {
    if (!listening || !upcomingUrl) return;
    fetch(upcomingUrl).catch(() => {});
  }, [listening, upcomingUrl]);

  useEffect(() => () => audioRef.current?.pause(), []);

  // How far the voice has got, read a few times a second while it plays: the text follows it.
  useEffect(() => {
    if (!listening) return;
    const timer = setInterval(() => {
      const el = audioRef.current;
      const playing = el && !el.paused && !el.ended && el.dataset.seq;
      setPosition(playing ? { seq: Number(el.dataset.seq), ms: el.currentTime * 1000 } : null);
    }, TICK_MS);
    return () => {
      clearInterval(timer);
      setPosition(null);
    };
  }, [listening]);

  return {
    listening,
    blocked,
    /** Turns sound on, from a click (browsers allow playing sound after one). */
    listen: () => {
      writeListen(true);
      sync();
    },
    stop: () => {
      writeListen(false);
      setBlocked(false);
      audioRef.current?.pause();
    },
    /** Which turn's speech is playing and how far into it, or null when none is. */
    position,
  };
}

// The Listen choice, kept in this browser and shared by every debate page open in it.
let listenFallback = false;
const listenSubscribers = new Set<() => void>();

function subscribeListen(onChange: () => void) {
  listenSubscribers.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listenSubscribers.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readListen(): boolean {
  try {
    return localStorage.getItem(LISTEN_KEY) === "1";
  } catch {
    return listenFallback; // storage blocked: remembered until the page closes
  }
}

function writeListen(on: boolean) {
  listenFallback = on;
  try {
    localStorage.setItem(LISTEN_KEY, on ? "1" : "0");
  } catch {
    // Storage blocked: the fallback above keeps it.
  }
  for (const notify of listenSubscribers) notify();
}

/** Shows its children only after `ms`, so brief gaps between speakers don't flash a message. */
function Delayed({ ms, children }: { ms: number; children: ReactNode }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(timer);
  }, [ms]);
  return shown ? <>{children}</> : null;
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

/** A turn being shown: its first `shown` characters, with a caret until it's all out. */
function RevealText({ text, shown }: { text: string; shown: number }) {
  const typing = shown < text.length;
  return <p className={cx("whitespace-pre-wrap text-sm leading-relaxed", typing && "typing-caret")}>{text.slice(0, shown)}</p>;
}

/** Fully revealing a second's worth of new text takes about this long (one poll interval). */
const SMOOTH_MS = 1000;
const SMOOTH_TICK_MS = 40;

/**
 * A turn's text, letting newly arrived words appear one by one over about a second instead of in
 * one jump per poll (debates run without pacing: the terminal CLI's database, older turns). Text
 * already there when the turn first renders (a finished turn) shows at once.
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
