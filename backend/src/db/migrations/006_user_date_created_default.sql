-- `user.date_created` was created with DEFAULT NULL — unlike every other
-- created_at-style column in this schema (hazard_reports, destination,
-- ai_risk_candidates, driver_notifications, etc.), which all default to
-- NOW() + INTERVAL 2 HOUR. Neither the driver self-register INSERT nor
-- sp_create_staff_account ever set it explicitly either, so every new
-- user's date_created has always come out NULL. Brings it in line with
-- the rest of the schema. Existing NULL rows are left as-is — this only
-- affects future inserts.
ALTER TABLE `user`
  MODIFY COLUMN `date_created` DATETIME DEFAULT (NOW() + INTERVAL 2 HOUR);
