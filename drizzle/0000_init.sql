CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`display_name` text NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`persona` text NOT NULL,
	`style` text NOT NULL,
	`tone` text NOT NULL,
	`stance` text NOT NULL,
	`provider` text NOT NULL,
	`model_id` text NOT NULL,
	`creativity` text DEFAULT 'balanced' NOT NULL,
	`turn_length` text DEFAULT 'medium' NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agents_owner_idx` ON `agents` (`owner_id`);--> statement-breakpoint
CREATE TABLE `debate_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`debate_id` text NOT NULL,
	`agent_id` text,
	`user_id` text NOT NULL,
	`position` integer NOT NULL,
	`joined_at` integer NOT NULL,
	`name` text,
	`persona` text,
	`style` text,
	`tone` text,
	`stance` text,
	`provider` text,
	`model_id` text,
	`creativity` text,
	`turn_length` text,
	`temperature` real,
	`max_output_tokens` integer,
	FOREIGN KEY (`debate_id`) REFERENCES `debates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `participants_debate_idx` ON `debate_participants` (`debate_id`);--> statement-breakpoint
CREATE INDEX `participants_debate_user_idx` ON `debate_participants` (`debate_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `participants_debate_position_uq` ON `debate_participants` (`debate_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `participants_debate_agent_uq` ON `debate_participants` (`debate_id`,`agent_id`);--> statement-breakpoint
CREATE TABLE `debates` (
	`id` text PRIMARY KEY NOT NULL,
	`creator_id` text NOT NULL,
	`topic` text NOT NULL,
	`rounds` integer DEFAULT 3 NOT NULL,
	`max_participants` integer NOT NULL,
	`start_mode` text NOT NULL,
	`start_at` integer,
	`allow_multiple_entries` integer DEFAULT false NOT NULL,
	`voting_duration` text DEFAULT '3d' NOT NULL,
	`tally_visibility` text DEFAULT 'after_vote' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`cancel_reason` text,
	`current_round` integer DEFAULT 1 NOT NULL,
	`current_turn_index` integer DEFAULT 0 NOT NULL,
	`max_total_tokens` integer,
	`total_prompt_tokens` integer DEFAULT 0 NOT NULL,
	`total_completion_tokens` integer DEFAULT 0 NOT NULL,
	`summary` text,
	`summary_through_seq` integer DEFAULT 0 NOT NULL,
	`lock_token` text,
	`locked_at` integer,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`wait_attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`waiting_reason` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`voting_closes_at` integer,
	FOREIGN KEY (`creator_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `debates_creator_idx` ON `debates` (`creator_id`);--> statement-breakpoint
CREATE INDEX `debates_status_created_idx` ON `debates` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `debates_status_start_idx` ON `debates` (`status`,`start_at`);--> statement-breakpoint
CREATE TABLE `turns` (
	`id` text PRIMARY KEY NOT NULL,
	`debate_id` text NOT NULL,
	`participant_id` text,
	`round` integer NOT NULL,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`model_id` text,
	`latency_ms` integer,
	`finish_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`debate_id`) REFERENCES `debates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `debate_participants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `turns_debate_seq_uq` ON `turns` (`debate_id`,`seq`);--> statement-breakpoint
CREATE TABLE `votes` (
	`id` text PRIMARY KEY NOT NULL,
	`debate_id` text NOT NULL,
	`user_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`debate_id`) REFERENCES `debates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `debate_participants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `votes_debate_user_uq` ON `votes` (`debate_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `votes_debate_participant_idx` ON `votes` (`debate_id`,`participant_id`);