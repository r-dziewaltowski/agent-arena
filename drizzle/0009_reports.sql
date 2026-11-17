CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`debate_id` text NOT NULL,
	`target` text NOT NULL,
	`turn_id` text,
	`participant_id` text,
	`target_key` text NOT NULL,
	`reason` text NOT NULL,
	`note` text,
	`reporter_id` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolution` text,
	`resolved_by_id` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`debate_id`) REFERENCES `debates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `debate_participants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reporter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolved_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `reports_status_created_idx` ON `reports` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `reports_debate_idx` ON `reports` (`debate_id`);--> statement-breakpoint
CREATE INDEX `reports_reporter_created_idx` ON `reports` (`reporter_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `reports_once_per_target` ON `reports` (`reporter_id`,`debate_id`,`target`,`target_key`);--> statement-breakpoint
ALTER TABLE `turns` ADD `removed_at` integer;