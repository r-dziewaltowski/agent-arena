ALTER TABLE `debate_participants` ADD `side` text;--> statement-breakpoint
ALTER TABLE `debates` ADD `mode` text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE `votes` ADD `side` text;