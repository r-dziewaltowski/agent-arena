/**
 * The voices an agent can speak with: Gemini's prebuilt text-to-speech voices. The voice itself
 * comes from this list; how it speaks (character, mood, pace, accent) is the owner's free text.
 */

export const VOICES = {
  Achernar: "soft",
  Achird: "friendly",
  Algenib: "gravelly",
  Algieba: "smooth",
  Alnilam: "firm",
  Aoede: "breezy",
  Autonoe: "bright",
  Callirrhoe: "easy-going",
  Charon: "informative",
  Despina: "smooth",
  Enceladus: "breathy",
  Erinome: "clear",
  Fenrir: "excitable",
  Gacrux: "mature",
  Iapetus: "clear",
  Kore: "firm",
  Laomedeia: "upbeat",
  Leda: "youthful",
  Orus: "firm",
  Puck: "upbeat",
  Pulcherrima: "forward",
  Rasalgethi: "informative",
  Sadachbia: "lively",
  Sadaltager: "knowledgeable",
  Schedar: "even",
  Sulafat: "warm",
  Umbriel: "easy-going",
  Vindemiatrix: "gentle",
  Zephyr: "bright",
  Zubenelgenubi: "casual",
} as const satisfies Record<string, string>;

export type Voice = keyof typeof VOICES;
export const VOICE_NAMES = Object.keys(VOICES) as Voice[];

/** Longest "how it speaks" direction an owner can write. */
export const VOICE_STYLE_MAX_LENGTH = 200;

export function isVoice(value: unknown): value is Voice {
  return typeof value === "string" && Object.hasOwn(VOICES, value);
}

/** The agent's voice, or a stable pick from its id for agents saved before voices existed. */
export function voiceFor(agentId: string, voice: string | null | undefined): Voice {
  if (isVoice(voice)) return voice;
  let hash = 0;
  for (const ch of agentId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return VOICE_NAMES[hash % VOICE_NAMES.length];
}

/** A random voice for a new agent's form. */
export function randomVoice(): Voice {
  return VOICE_NAMES[Math.floor(Math.random() * VOICE_NAMES.length)];
}

/** Where the agent form's preview of a voice lives (made once by `npm run voices:previews`). */
export function voicePreviewUrl(voice: Voice): string {
  return `/voices/${voice}.mp3`;
}

/**
 * The direction a debate's speech is made with: the owner's own words, or the agent's tone (a
 * preset's description or the owner's custom tone) when they left it empty.
 */
export function speechDirection(voiceStyle: string | null | undefined, tone: string, toneDescriptions: Record<string, string>): string {
  const own = voiceStyle?.trim();
  if (own) return own;
  const described = Object.hasOwn(toneDescriptions, tone) ? toneDescriptions[tone] : tone;
  return `${described.replace(/\.$/, "")}, like a confident debater`;
}
