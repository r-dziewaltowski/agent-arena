import { blob, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { agents } from "./agents";
import { user } from "./auth";

export const debates = sqliteTable(
  "debates",
  {
    id: text("id").primaryKey(),
    creatorId: text("creator_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),

    // Configuration, fixed at creation.
    topic: text("topic").notNull(),
    /** "open": everyone argues their own view; "sides": each agent argues for or against the topic. */
    mode: text("mode", { enum: ["open", "sides"] }).notNull().default("open"),
    rounds: integer("rounds").notNull().default(3),
    maxParticipants: integer("max_participants").notNull(),
    startMode: text("start_mode", { enum: ["manual", "when_full", "scheduled"] }).notNull(),
    startAt: integer("start_at"),
    allowMultipleEntries: integer("allow_multiple_entries", { mode: "boolean" })
      .notNull()
      .default(false),
    votingDuration: text("voting_duration", { enum: ["1h", "1d", "3d", "1w"] })
      .notNull()
      .default("3d"),
    tallyVisibility: text("tally_visibility", { enum: ["live", "after_vote", "after_close"] })
      .notNull()
      .default("after_vote"),

    // State.
    status: text("status", {
      enum: ["open", "running", "completed", "failed", "cancelled"],
    })
      .notNull()
      .default("open"),
    cancelReason: text("cancel_reason"),
    currentRound: integer("current_round").notNull().default(1),
    currentTurnIndex: integer("current_turn_index").notNull().default(0),
    /** Safety cap on prompt + completion tokens, computed at start. Not shown to users. */
    maxTotalTokens: integer("max_total_tokens"),
    totalPromptTokens: integer("total_prompt_tokens").notNull().default(0),
    totalCompletionTokens: integer("total_completion_tokens").notNull().default(0),
    summary: text("summary"),
    summaryThroughSeq: integer("summary_through_seq").notNull().default(0),

    // Worker coordination and error handling.
    lockToken: text("lock_token"),
    lockedAt: integer("locked_at"),
    /** Consecutive bad turns; the debate fails after 2 retries. */
    retryCount: integer("retry_count").notNull().default(0),
    /** Consecutive "model unreachable" attempts, used for the growing backoff. */
    waitAttempts: integer("wait_attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at"),
    waitingReason: text("waiting_reason"),
    /**
     * The Gemini voice model this debate speaks with (see `voice/speech.ts`): chosen at its first
     * spoken turn and kept, so voices sound the same throughout; changed only when its free daily
     * limit runs out. Null until then.
     */
    voiceModel: text("voice_model"),
    errorMessage: text("error_message"),

    createdAt: integer("created_at").notNull(),
    startedAt: integer("started_at"),
    completedAt: integer("completed_at"),
    votingClosesAt: integer("voting_closes_at"),
  },
  (t) => [
    index("debates_creator_idx").on(t.creatorId),
    index("debates_status_created_idx").on(t.status, t.createdAt),
    index("debates_status_start_idx").on(t.status, t.startAt),
  ],
);

/** An entry while the debate is open; a participant once it has started. */
export const debateParticipants = sqliteTable(
  "debate_participants",
  {
    id: text("id").primaryKey(),
    debateId: text("debate_id")
      .notNull()
      .references(() => debates.id, { onDelete: "cascade" }),
    /** Null once the agent is deleted after the debate started; the snapshot remains. */
    agentId: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
    /** The agent's owner. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Slot = speaking order, 1-based. Renumbered 1..n at start. */
    position: integer("position").notNull(),
    /** In a for-or-against debate, the side this entry argues (chosen when entering); null otherwise. */
    side: text("side", { enum: ["for", "against"] }),
    joinedAt: integer("joined_at").notNull(),

    // Snapshot of the agent, filled at start.
    name: text("name"),
    persona: text("persona"),
    style: text("style"),
    tone: text("tone"),
    stance: text("stance"),
    provider: text("provider"),
    modelId: text("model_id"),
    creativity: text("creativity"),
    turnLength: text("turn_length"),
    temperature: real("temperature"),
    maxOutputTokens: integer("max_output_tokens"),
    /** The agent's chosen model when it was retired and the provider default ran instead. */
    modelFallbackFrom: text("model_fallback_from"),
    voice: text("voice"),
    /** The direction its speech is made with (the owner's own, or one derived from the tone). */
    voiceStyle: text("voice_style"),
    /**
     * Set when this agent can no longer speak because its owner's paid-model key stopped working
     * (or was disconnected); its remaining turns are skipped and the debate carries on.
     */
    silencedAt: integer("silenced_at"),
    silencedReason: text("silenced_reason"),
  },
  (t) => [
    index("participants_debate_idx").on(t.debateId),
    index("participants_debate_user_idx").on(t.debateId, t.userId),
    uniqueIndex("participants_debate_position_uq").on(t.debateId, t.position),
    uniqueIndex("participants_debate_agent_uq").on(t.debateId, t.agentId),
  ],
);

export const turns = sqliteTable(
  "turns",
  {
    id: text("id").primaryKey(),
    debateId: text("debate_id")
      .notNull()
      .references(() => debates.id, { onDelete: "cascade" }),
    /** Null for summary turns. */
    participantId: text("participant_id").references(() => debateParticipants.id, {
      onDelete: "cascade",
    }),
    round: integer("round").notNull(),
    seq: integer("seq").notNull(),
    kind: text("kind", { enum: ["opening", "argument", "closing", "summary"] }).notNull(),
    status: text("status", { enum: ["streaming", "complete"] }).notNull(),
    /** Grows while the turn is streaming. */
    content: text("content").notNull().default(""),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    modelId: text("model_id"),
    latencyMs: integer("latency_ms"),
    finishReason: text("finish_reason"),
    /**
     * When viewers start getting the turn (see `pacing.ts`): once it's written and its speech is
     * ready, and not before the previous turn has been shown, so it can lie in the future for a turn
     * prepared ahead. Null: shown as fast as it's written (pacing off).
     */
    revealStartedAt: integer("reveal_started_at"),
    /** When the turn will have been fully shown (and spoken). Null for turns from before voices. */
    revealEndsAt: integer("reveal_ends_at"),
    /** JSON `[ms, chars][]` keeping the text in step with the turn's audio; null without audio. */
    audioMarks: text("audio_marks"),
    /** Set when an admin removed the turn's text after a report: it shows as removed. */
    removedAt: integer("removed_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("turns_debate_seq_uq").on(t.debateId, t.seq)],
);

/**
 * A turn's speech, kept only while the debate is live: voice enhances watching a debate, and
 * finished debates are read as text. Deleted once the debate's last turn has been shown.
 */
export const turnAudio = sqliteTable(
  "turn_audio",
  {
    turnId: text("turn_id")
      .primaryKey()
      .references(() => turns.id, { onDelete: "cascade" }),
    debateId: text("debate_id")
      .notNull()
      .references(() => debates.id, { onDelete: "cascade" }),
    mimeType: text("mime_type").notNull(),
    data: blob("data", { mode: "buffer" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("turn_audio_debate_idx").on(t.debateId)],
);
