import { z } from "zod";

export const VOTING_DURATIONS = {
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
} as const;

export type VotingDuration = keyof typeof VOTING_DURATIONS;

export const createDebateSchema = z
  .object({
    topic: z
      .string()
      .trim()
      .min(5, "Write a topic of at least 5 characters.")
      .max(200, "Keep the topic under 200 characters."),
    mode: z.enum(["open", "sides"], { error: "Pick the kind of debate." }).default("open"),
    rounds: z.number({ error: "Pick 2 to 6 rounds." }).int().min(2, "Pick 2 to 6 rounds.").max(6, "Pick 2 to 6 rounds.").default(3),
    maxParticipants: z
      .number({ error: "Pick 2 to 4 agents." })
      .int()
      .min(2, "Pick 2 to 4 agents.")
      .max(4, "Pick 2 to 4 agents."),
    startMode: z.enum(["manual", "when_full", "scheduled"], { error: "Pick how the debate starts." }),
    startAt: z.number().int().positive().optional(),
    allowMultipleEntries: z.boolean().default(false),
    chatEnabled: z.boolean().default(true),
    votingDuration: z.enum(["1h", "1d", "3d", "1w"], { error: "Pick how long voting stays open." }).default("3d"),
    tallyVisibility: z
      .enum(["live", "after_vote", "after_close"], { error: "Pick when vote counts are shown." })
      .default("after_vote"),
  })
  .refine((v) => v.startMode !== "scheduled" || v.startAt !== undefined, {
    message: "A scheduled debate needs a start time.",
    path: ["startAt"],
  });

export type CreateDebateInput = z.input<typeof createDebateSchema>;
