CREATE TABLE `provider_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`encrypted_key` text NOT NULL,
	`key_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`failed_at` integer,
	`fail_reason` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_connections_user_provider_uq` ON `provider_connections` (`user_id`,`provider`);--> statement-breakpoint
ALTER TABLE `debate_participants` ADD `silenced_at` integer;--> statement-breakpoint
ALTER TABLE `debate_participants` ADD `silenced_reason` text;