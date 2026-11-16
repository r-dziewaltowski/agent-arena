import { z } from "zod";
import { CREATIVITY_LEVELS, CUSTOM_TRAIT_MAX_LENGTH, STANCES, TURN_LENGTHS } from "../debate/traits";

/** Style and tone: a preset key or the owner's own short text. */
const freeTrait = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Pick a ${label} or write your own.`)
    .max(CUSTOM_TRAIT_MAX_LENGTH, `Keep the ${label} under ${CUSTOM_TRAIT_MAX_LENGTH} characters.`);

const choice = <T extends readonly [string, ...string[]]>(values: T, message: string) => z.enum(values, { error: message });

export const agentSchema = z.object({
  name: z.string().trim().min(1, "Give the agent a name.").max(40, "Keep the name under 40 characters."),
  persona: z
    .string()
    .trim()
    .min(10, "Describe the persona in at least 10 characters.")
    .max(1500, "Keep the persona under 1,500 characters."),
  style: freeTrait("style"),
  tone: freeTrait("tone"),
  stance: choice(STANCES as unknown as [string, ...string[]], "Pick one of the stances."),
  provider: choice(["ollama", "groq", "google", "anthropic"] as const, "Pick one of the available models.").default("ollama"),
  modelId: z.string().trim().min(1, "Pick one of the available models.").max(100),
  creativity: choice(CREATIVITY_LEVELS, "Pick a creativity level.").default("balanced"),
  turnLength: choice(TURN_LENGTHS, "Pick a turn length.").default("medium"),
  visibility: choice(["private", "public"] as const, "Pick private or public.").default("private"),
});

export type AgentInput = z.input<typeof agentSchema>;
