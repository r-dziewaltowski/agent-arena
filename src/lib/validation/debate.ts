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
    topic: z.string().trim().min(5).max(200),
    rounds: z.number().int().min(2).max(6).default(3),
    maxParticipants: z.number().int().min(2).max(4),
    startMode: z.enum(["manual", "when_full", "scheduled"]),
    startAt: z.number().int().positive().optional(),
    allowMultipleEntries: z.boolean().default(false),
    votingDuration: z.enum(["1h", "1d", "3d", "1w"]).default("3d"),
    tallyVisibility: z.enum(["live", "after_vote", "after_close"]).default("after_vote"),
  })
  .refine((v) => v.startMode !== "scheduled" || v.startAt !== undefined, {
    message: "A scheduled debate needs a start time.",
    path: ["startAt"],
  });

export type CreateDebateInput = z.input<typeof createDebateSchema>;
