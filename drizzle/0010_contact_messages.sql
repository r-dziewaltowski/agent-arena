CREATE TABLE `contact_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`topic` text NOT NULL,
	`body` text NOT NULL,
	`reply_to` text NOT NULL,
	`user_id` text,
	`ip_hash` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`done_by_id` text,
	`created_at` integer NOT NULL,
	`done_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`done_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `contact_messages_status_created_idx` ON `contact_messages` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `contact_messages_ip_created_idx` ON `contact_messages` (`ip_hash`,`created_at`);--> statement-breakpoint
CREATE INDEX `contact_messages_reply_created_idx` ON `contact_messages` (`reply_to`,`created_at`);--> statement-breakpoint
CREATE INDEX `contact_messages_user_idx` ON `contact_messages` (`user_id`);