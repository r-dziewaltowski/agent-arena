/**
 * Trait presets shared by validation, the prompt builder and (from M2) the agent form.
 * Style and tone accept a preset key or the owner's own text; stance is preset-only in v1.
 */

export const CUSTOM_TRAIT_MAX_LENGTH = 80;

/** The agent form's "Write your own…" choice for style and tone (never a preset key). */
export const CUSTOM_TRAIT = "__custom";

/**
 * The style or tone the agent form submitted: the chosen preset, or the owner's own text when
 * "Write your own…" was picked. Falls back to a plain `<name>` field (older forms).
 */
export function submittedTrait(formData: FormData, name: "style" | "tone"): string {
  const choice = formData.get(`${name}Choice`);
  if (typeof choice !== "string") return String(formData.get(name) ?? "");
  return choice === CUSTOM_TRAIT ? String(formData.get(`${name}Custom`) ?? "") : choice;
}

export const STYLE_PRESETS = {
  socratic: "You argue by asking pointed questions that expose weaknesses in other people's reasoning.",
  analytical: "You argue methodically, breaking claims into parts and weighing evidence.",
  storyteller: "You argue through vivid examples, anecdotes and stories.",
  pragmatic: "You focus on practical consequences: what works, what it costs and who it affects.",
  passionate: "You argue with conviction and appeal to values and emotions.",
} as const satisfies Record<string, string>;

export const TONE_PRESETS = {
  formal: "Your tone is formal and measured.",
  casual: "Your tone is casual and conversational.",
  dry: "Your tone is dry and understated, with a deadpan wit.",
  sarcastic: "Your tone is sarcastic and sharp, but never abusive.",
  warm: "Your tone is warm and generous towards the others.",
} as const satisfies Record<string, string>;

/** One-line descriptions shown in the agent form under the Style and Tone pickers. */
export const STYLE_DESCRIPTIONS: Record<keyof typeof STYLE_PRESETS, string> = {
  socratic: "Asks pointed questions that expose weak reasoning.",
  analytical: "Breaks claims into parts and weighs the evidence.",
  storyteller: "Argues through examples, anecdotes and stories.",
  pragmatic: "Focuses on what works, what it costs and who it affects.",
  passionate: "Argues with conviction, appealing to values and emotions.",
};

export const TONE_DESCRIPTIONS: Record<keyof typeof TONE_PRESETS, string> = {
  formal: "Formal and measured.",
  casual: "Casual and conversational.",
  dry: "Dry and understated, with deadpan wit.",
  sarcastic: "Sarcastic and sharp, but never abusive.",
  warm: "Warm and generous towards the others.",
};

export const STANCE_DESCRIPTIONS: Record<"contrarian" | "agreeable" | "neutral" | "mediator" | "provocateur", string> = {
  contrarian: "Disagrees, and tests the others' claims.",
  agreeable: "Looks for agreement and builds on good ideas.",
  neutral: "Weighs every side before taking a position.",
  mediator: "Tries to bring opposing sides together.",
  provocateur: "Takes bold, controversial positions and pushes back hard.",
};

export const STANCE_PRESETS = {
  contrarian: {
    description: "You like to disagree and to test other people's claims.",
    instruction: "Challenge the strongest point the previous speaker made and explain why it fails.",
  },
  agreeable: {
    description: "You look for agreement and build on good ideas.",
    instruction:
      "Acknowledge what you agree with in the previous points, then add to or refine them.",
  },
  neutral: {
    description: "You weigh every side before taking a position.",
    instruction: "Weigh the points made so far, then give your own view.",
  },
  mediator: {
    description: "You try to bring opposing sides together.",
    instruction: "Find common ground between the other participants and propose a compromise.",
  },
  provocateur: {
    description: "You enjoy bold, controversial positions.",
    instruction: "Make the boldest, most provocative case for your position and push back hard.",
  },
} as const satisfies Record<string, { description: string; instruction: string }>;

export type StylePreset = keyof typeof STYLE_PRESETS;
export type TonePreset = keyof typeof TONE_PRESETS;
export type Stance = keyof typeof STANCE_PRESETS;

export const STANCES = Object.keys(STANCE_PRESETS) as Stance[];

export const CREATIVITY_LEVELS = ["focused", "balanced", "creative", "wild"] as const;
export type Creativity = (typeof CREATIVITY_LEVELS)[number];

export const TURN_LENGTHS = ["short", "medium", "long"] as const;
export type TurnLength = (typeof TURN_LENGTHS)[number];

export const CREATIVITY_LABELS: Record<Creativity, { label: string; hint: string }> = {
  focused: { label: "Focused", hint: "Tight and consistent" },
  balanced: { label: "Balanced", hint: "Natural, with some variety" },
  creative: { label: "Creative", hint: "Bolder phrasing and ideas" },
  wild: { label: "Wild", hint: "Unpredictable; may drift" },
};

export const TURN_LENGTH_LABELS: Record<TurnLength, { label: string; hint: string }> = {
  short: { label: "Short", hint: "About 70 words" },
  medium: { label: "Medium", hint: "About 130 words" },
  long: { label: "Long", hint: "About 240 words" },
};

/** "socratic" → "Socratic"; custom text is shown as written. */
export function traitLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function isStylePreset(value: string): value is StylePreset {
  return Object.hasOwn(STYLE_PRESETS, value);
}

export function isTonePreset(value: string): value is TonePreset {
  return Object.hasOwn(TONE_PRESETS, value);
}

export function isStance(value: string): value is Stance {
  return Object.hasOwn(STANCE_PRESETS, value);
}

/** The prompt sentence for a style: the preset's tuned sentence, or custom text in a fixed frame. */
export function styleSentence(style: string): string {
  return isStylePreset(style) ? STYLE_PRESETS[style] : `Your rhetorical style: ${style.trim()}.`;
}

/** The prompt sentence for a tone: the preset's tuned sentence, or custom text in a fixed frame. */
export function toneSentence(tone: string): string {
  return isTonePreset(tone) ? TONE_PRESETS[tone] : `Your tone: ${tone.trim()}.`;
}

/** Stance is preset-only; anything unknown falls back to neutral. */
export function stanceOf(stance: string): (typeof STANCE_PRESETS)[Stance] {
  return isStance(stance) ? STANCE_PRESETS[stance] : STANCE_PRESETS.neutral;
}
