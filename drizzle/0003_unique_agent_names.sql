-- Agent names become unique per owner (ignoring case). Existing duplicates keep the oldest
-- agent's name; later ones get " (2)", " (3)" … in the order they were created. The new names are
-- worked out first (window function), then applied, so renames can't affect each other.
UPDATE `agents` SET `name` = `renames`.`new_name`
FROM (
  SELECT `id`, `name` || ' (' || `rn` || ')' AS `new_name`
  FROM (
    SELECT `id`, `name`,
           ROW_NUMBER() OVER (PARTITION BY `owner_id`, lower(`name`) ORDER BY `created_at`, `id`) AS `rn`
    FROM `agents`
  )
  WHERE `rn` > 1
) AS `renames`
WHERE `agents`.`id` = `renames`.`id`;--> statement-breakpoint
CREATE UNIQUE INDEX `agents_owner_name_unique` ON `agents` (`owner_id`,lower("name"));
