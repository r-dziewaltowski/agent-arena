CREATE TABLE `agent_images` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`mime_type` text NOT NULL,
	`data` blob NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `agents` ADD `image_updated_at` integer;--> statement-breakpoint
ALTER TABLE `agents` ADD `avatar_seed` text;