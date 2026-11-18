import type { ModelMessage } from "ai";
import { CREATIVITY_SENTENCES, stanceOf, styleSentence, toneSentence, type Creativity } from "./traits";

export type TurnKind = "opening" | "argument" | "closing";

export type Speaker = {
  id: string;
  name: string;
  persona: string;
  style: string;
  tone: string;
  stance: string;
  /** Set only for models that take no temperature: Creativity is then asked for in words. */
  creativityInPrompt?: Creativity;
};

export type PriorTurn = { participantId: string | null; content: string };

export type PromptInput = {
  topic: string;
  rounds: number;
  round: number;
  kind: TurnKind;
  speaker: Speaker;
  participants: Speaker[];
  /** Turns to show word for word, oldest first. */
  turns: PriorTurn[];
  /** Rolling summary of turns before `turns`, if any (M4). */
  summary?: string | null;
  /** Whether someone has already spoken in the current round. */
  othersSpokeThisRound: boolean;
  /**
   * Tokens for the visible answer (the turn length's, without a thinking model's extra room), used
   * to ask for a length the model can finish within.
   */
  answerTokens?: number;
};

/** Roughly 0.6 words per token leaves room to finish a sentence before the cap. */
export function targetWords(maxOutputTokens: number): number {
  return Math.round((maxOutputTokens * 0.6) / 10) * 10;
}

export type BuiltPrompt = {
  system: string;
  messages: ModelMessage[];
  stopSequences: string[];
};

/** The kind of turn for a given round. Debates have at least 2 rounds. */
export function turnKindFor(round: number, rounds: number): TurnKind {
  if (round <= 1) return "opening";
  if (round >= rounds) return "closing";
  return "argument";
}

export function buildPrompt(input: PromptInput): BuiltPrompt {
  const { speaker, participants } = input;
  const others = participants.filter((p) => p.id !== speaker.id);
  const nameById = new Map(participants.map((p) => [p.id, p.name]));

  const system = [
    `You are ${speaker.name}, taking part in a live debate.`,
    `Who you are: ${speaker.persona.trim()}`,
    [
      styleSentence(speaker.style),
      toneSentence(speaker.tone),
      stanceOf(speaker.stance).description,
      speaker.creativityInPrompt ? CREATIVITY_SENTENCES[speaker.creativityInPrompt] : null,
    ]
      .filter(Boolean)
      .join(" "),
    `The topic: ${input.topic.trim()}`,
    `The other participants: ${others.map((o) => o.name).join(", ")}.`,
    [
      `Rules: speak only as ${speaker.name}, in the first person.`,
      input.answerTokens
        ? `Keep it under ${targetWords(input.answerTokens)} words, in 1 to 3 short paragraphs.`
        : "Write 1 to 3 short paragraphs.",
      "Do not start with your name or a label.",
      "Never write lines for the other participants.",
      "Do not describe actions or stage directions.",
    ].join(" "),
  ].join("\n\n");

  const raw: ModelMessage[] = [];
  raw.push({
    role: "user",
    content: input.summary
      ? `The debate on "${input.topic.trim()}" so far, summarised:\n${input.summary.trim()}`
      : `The debate on "${input.topic.trim()}" begins.`,
  });

  for (const turn of input.turns) {
    if (turn.participantId === speaker.id) {
      raw.push({ role: "assistant", content: turn.content });
    } else {
      const name = (turn.participantId && nameById.get(turn.participantId)) ?? "Someone";
      raw.push({ role: "user", content: `${name}: ${turn.content}` });
    }
  }

  raw.push({ role: "user", content: roundInstruction(input) });

  return {
    system,
    messages: mergeConsecutive(raw),
    stopSequences: others.map((o) => `\n${o.name}:`),
  };
}

function roundInstruction(input: PromptInput): string {
  const { round, rounds, kind, speaker } = input;
  const label = `Round ${round} of ${rounds}.`;
  switch (kind) {
    case "opening":
      return [
        label,
        "Give your opening statement: state your position on the topic and your main reasons.",
        input.othersSpokeThisRound ? "You may briefly react to what was said before you." : "",
      ]
        .filter(Boolean)
        .join(" ");
    case "argument":
      return `${label} ${stanceOf(speaker.stance).instruction}`;
    case "closing":
      return `${label} This is the final round. Give your closing statement: sum up your position and answer the strongest point made against it. Do not introduce new arguments.`;
  }
}

/** Joins consecutive messages from the same role, which small models handle poorly. */
function mergeConsecutive(messages: ModelMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && last.role === m.role && typeof last.content === "string" && typeof m.content === "string") {
      out[out.length - 1] = { ...last, content: `${last.content}\n\n${m.content}` } as ModelMessage;
    } else {
      out.push(m);
    }
  }
  return out;
}

/** Strips reasoning blocks and a leading name label that small models sometimes add. */
export function cleanTurnText(text: string, speakerName: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  out = out.replace(/^\s*<think>[\s\S]*$/i, ""); // an unclosed reasoning block
  const escaped = speakerName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  out = out.replace(new RegExp(`^\\s*(\\*\\*)?${escaped}(\\*\\*)?\\s*:(\\*\\*)?\\s*`, "i"), "");
  return out.trim();
}

/**
 * For a turn cut off by the length cap: drop the unfinished last sentence, as long as that keeps
 * most of the text. Otherwise end it with an ellipsis.
 */
export function trimToLastSentence(text: string): string {
  const trimmed = text.trimEnd();
  if (/[.!?]["'”’)\]]?$/.test(trimmed)) return trimmed;
  const matches = [...trimmed.matchAll(/[.!?]["'”’)\]]?(?=\s)/g)];
  const last = matches.at(-1);
  if (last && last.index !== undefined) {
    const end = last.index + last[0].length;
    if (end >= trimmed.length * 0.5) return trimmed.slice(0, end);
  }
  return `${trimmed}…`;
}

/** Gives later agents that share a name a suffix, e.g. "Socrates (2)". */
export function disambiguateNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    let candidate = name;
    for (let n = 2; used.has(candidate.trim().toLowerCase()); n++) {
      candidate = `${name} (${n})`;
    }
    used.add(candidate.trim().toLowerCase());
    return candidate;
  });
}
