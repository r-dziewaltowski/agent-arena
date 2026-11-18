CREATE TABLE `debate_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`debate_id` text NOT NULL,
	`user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	`deleted_by` text,
	FOREIGN KEY (`debate_id`) REFERENCES `debates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `debate_comments_debate_created_idx` ON `debate_comments` (`debate_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `debate_comments_debate_deleted_idx` ON `debate_comments` (`debate_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `debate_comments_user_debate_idx` ON `debate_comments` (`user_id`,`debate_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `reports` ADD `comment_id` text REFERENCES debate_comments(id) ON DELETE cascade;