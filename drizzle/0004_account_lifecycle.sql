ALTER TABLE `user` ADD `deleted_at` integer;--> statement-breakpoint
-- Email confirmation becomes required for new sign-ups. Accounts that existed before are marked
-- confirmed (grandfathered), so nobody is locked out of an account they already use.
UPDATE `user` SET `email_verified` = 1 WHERE `email_verified` = 0;
