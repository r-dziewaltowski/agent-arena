CREATE TABLE `turn_audio` (
	`turn_id` text PRIMARY KEY NOT NULL,
	`debate_id` text NOT NULL,
	`mime_type` text NOT NULL,
	`data` blob NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`debate_id`) REFERENCES `debates`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `turn_audio_debate_idx` ON `turn_audio` (`debate_id`);--> statement-breakpoint
ALTER TABLE `agents` ADD `voice` text;--> statement-breakpoint
ALTER TABLE `agents` ADD `voice_style` text;--> statement-breakpoint
ALTER TABLE `debate_participants` ADD `voice` text;--> statement-breakpoint
ALTER TABLE `debate_participants` ADD `voice_style` text;--> statement-breakpoint
ALTER TABLE `debates` ADD `voice_model` text;--> statement-breakpoint
ALTER TABLE `turns` ADD `reveal_ends_at` integer;--> statement-breakpoint
ALTER TABLE `turns` ADD `audio_marks` text;