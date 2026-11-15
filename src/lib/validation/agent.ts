import { z } from "zod";
import { CREATIVITY_LEVELS, CUSTOM_TRAIT_MAX_LENGTH, STANCES, TURN_LENGTHS } from "../debate/traits";

/** Style and tone: a preset key or the owner's own short text. */
const freeTrait = z.string().trim().min(1).max(CUSTOM_TRAIT_MAX_LENGTH);

export const agentSchema = z.object({
  name: z.string().trim().min(1).max(40),
  persona: z.string().trim().min(10).max(1500),
  style: freeTrait,
  tone: freeTrait,
  stance: z.enum(STANCES as [string, ...string[]]),
  provider: z.enum(["ollama", "groq", "anthropic"]).default("ollama"),
  modelId: z.string().trim().min(1).max(100),
  creativity: z.enum(CREATIVITY_LEVELS).default("balanced"),
  turnLength: z.enum(TURN_LENGTHS).default("medium"),
  visibility: z.enum(["private", "public"]).default("private"),
});

export type AgentInput = z.input<typeof agentSchema>;
