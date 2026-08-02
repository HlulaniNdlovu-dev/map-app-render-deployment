-- Adds the three remaining user roles from the system spec (Traffic
-- Authority, Security Agency, Data Analyst), plus the columns needed for
-- report attribution/resolution and trip-end tracking.
--
-- Purely additive: new tables use IF NOT EXISTS, new columns are nullable
-- or defaulted so existing rows and queries are unaffected. Safe to re-run.

CREATE TABLE IF NOT EXISTS `traffic_authority` (
  `traffic_authority_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  PRIMARY KEY (`traffic_authority_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `traffic_authority_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `security_agency` (
  `security_agency_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  PRIMARY KEY (`security_agency_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `security_agency_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `data_analyst` (
  `data_analyst_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  PRIMARY KEY (`data_analyst_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `data_analyst_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- `source` distinguishes citizen-submitted reports from official Traffic
-- Authority / Security Agency reports. `status` lets those roles (or an
-- admin) mark a danger zone resolved once it no longer applies.
--
-- NOTE: this server's MySQL doesn't accept `ADD COLUMN IF NOT EXISTS`, so
-- these two ALTERs are NOT safe to blindly re-run — check with DESCRIBE
-- first if re-applying this file.
ALTER TABLE `hazard_reports`
  ADD COLUMN `source` VARCHAR(32) NOT NULL DEFAULT 'citizen' AFTER `hazard_type`,
  ADD COLUMN `status` VARCHAR(16) NOT NULL DEFAULT 'active' AFTER `source`;

-- `ended_at` records when a driver completed a trip (the "End Trip" use
-- case). NULL means the trip is still in progress / was never explicitly
-- ended.
ALTER TABLE `destination`
  ADD COLUMN `ended_at` DATETIME NULL DEFAULT NULL AFTER `hazard_bypassed`;
