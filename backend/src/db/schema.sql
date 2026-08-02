-- Mapper — consolidated canonical schema.
--
-- Reproduces the live database exactly (captured via `SHOW CREATE TABLE`
-- against the deployed instance, Phase 5). This file is the single
-- source of truth for the schema; `db/migrations/*.sql` remain as the
-- historical record of how it was built up incrementally and are what
-- `npm run migrate` actually applies. Tables are ordered so every
-- foreign key references a table already created above it.
--
-- See docs/ERD.md and docs/schema.dbml for the entity-relationship
-- diagram this schema corresponds to.

CREATE TABLE IF NOT EXISTS `user` (
  `user_id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `username` varchar(255) NOT NULL,
  `date_created` datetime DEFAULT NULL,
  `last_login` datetime DEFAULT NULL,
  `firstname` varchar(255) DEFAULT NULL,
  `lastname` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `email` (`email`),
  UNIQUE KEY `username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- One user row per role subtype table below — a user's role is purely
-- "which of these 5 tables contains this user_id" (never a role column).

CREATE TABLE IF NOT EXISTS `driver` (
  `driver_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  PRIMARY KEY (`driver_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `driver_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `admin` (
  `admin_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  PRIMARY KEY (`admin_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `admin_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

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

-- Leftover many-to-many join between admin and driver. 0 rows, no code
-- references it anywhere in the app — kept only because it already
-- exists live and dropping it isn't in scope for this brief.
CREATE TABLE IF NOT EXISTS `admin_driver` (
  `admin_id` int NOT NULL,
  `driver_id` int NOT NULL,
  PRIMARY KEY (`admin_id`,`driver_id`),
  KEY `driver_id` (`driver_id`),
  CONSTRAINT `admin_driver_ibfk_1` FOREIGN KEY (`admin_id`) REFERENCES `admin` (`admin_id`) ON DELETE CASCADE,
  CONSTRAINT `admin_driver_ibfk_2` FOREIGN KEY (`driver_id`) REFERENCES `driver` (`driver_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `hazard_reports` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `latitude` decimal(10,7) NOT NULL,
  `longitude` decimal(10,7) NOT NULL,
  `hazard_type` varchar(255) NOT NULL,
  `source` varchar(32) NOT NULL DEFAULT 'citizen',
  `status` varchar(16) NOT NULL DEFAULT 'active',
  `created_at` datetime DEFAULT ((now() + interval 2 hour)),
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `hazard_reports_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `destination` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `start_location` varchar(255) DEFAULT NULL,
  `end_location` varchar(255) DEFAULT NULL,
  `hazard_bypassed` int DEFAULT '0',
  `ended_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT ((now() + interval 2 hour)),
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `destination_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- AI-classified hazard candidates awaiting human review (Phase 1). See
-- docs/AI-FEATURE.md — confirming one inserts a real hazard_reports row
-- (source='ai_confirmed'); rejecting one has no further effect.
CREATE TABLE IF NOT EXISTS `ai_risk_candidates` (
  `candidate_id` int NOT NULL AUTO_INCREMENT,
  `raw_source_text` text NOT NULL,
  `source_url` varchar(512) DEFAULT NULL,
  `classified_category` varchar(64) NOT NULL,
  `confidence` decimal(4,3) NOT NULL,
  `suggested_lat` decimal(10,7) DEFAULT NULL,
  `suggested_lng` decimal(10,7) DEFAULT NULL,
  `suggested_location_text` varchar(255) DEFAULT NULL,
  `summary` varchar(512) DEFAULT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'pending',
  `created_at` datetime DEFAULT ((now() + interval 2 hour)),
  `reviewed_by` int DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `resulting_hazard_id` int DEFAULT NULL,
  PRIMARY KEY (`candidate_id`),
  KEY `reviewed_by` (`reviewed_by`),
  KEY `resulting_hazard_id` (`resulting_hazard_id`),
  CONSTRAINT `ai_risk_candidates_ibfk_1` FOREIGN KEY (`reviewed_by`) REFERENCES `user` (`user_id`),
  CONSTRAINT `ai_risk_candidates_ibfk_2` FOREIGN KEY (`resulting_hazard_id`) REFERENCES `hazard_reports` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Audit trail written by sp_resolve_hazard (Phase 2) every time a
-- hazard_reports row's status changes.
CREATE TABLE IF NOT EXISTS `hazard_resolution_log` (
  `log_id` int NOT NULL AUTO_INCREMENT,
  `hazard_id` int NOT NULL,
  `resolved_by` int NOT NULL,
  `previous_status` varchar(16) NOT NULL,
  `new_status` varchar(16) NOT NULL,
  `resolved_at` datetime DEFAULT ((now() + interval 2 hour)),
  PRIMARY KEY (`log_id`),
  KEY `hazard_id` (`hazard_id`),
  KEY `resolved_by` (`resolved_by`),
  CONSTRAINT `hazard_resolution_log_ibfk_1` FOREIGN KEY (`hazard_id`) REFERENCES `hazard_reports` (`id`) ON DELETE CASCADE,
  CONSTRAINT `hazard_resolution_log_ibfk_2` FOREIGN KEY (`resolved_by`) REFERENCES `user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- One row per completed trip, written by sp_end_trip (Phase 2) with a
-- server-computed duration.
CREATE TABLE IF NOT EXISTS `trip_summary` (
  `summary_id` int NOT NULL AUTO_INCREMENT,
  `destination_id` int NOT NULL,
  `user_id` int NOT NULL,
  `start_location` varchar(255) DEFAULT NULL,
  `end_location` varchar(255) DEFAULT NULL,
  `duration_seconds` int NOT NULL,
  `started_at` datetime NOT NULL,
  `ended_at` datetime NOT NULL,
  PRIMARY KEY (`summary_id`),
  UNIQUE KEY `destination_id` (`destination_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `trip_summary_ibfk_1` FOREIGN KEY (`destination_id`) REFERENCES `destination` (`id`) ON DELETE CASCADE,
  CONSTRAINT `trip_summary_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Notification-only alerts for drivers (Phase 6). Deliberately NOT named
-- `alerts` — see the migration file's comment for why (SafeMaster
-- parallel-port parity, Rule 3).
CREATE TABLE IF NOT EXISTS `driver_notifications` (
  `notification_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `hazard_id` int DEFAULT NULL,
  `message` varchar(512) NOT NULL,
  `is_read` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime DEFAULT ((now() + interval 2 hour)),
  PRIMARY KEY (`notification_id`),
  KEY `user_id` (`user_id`),
  KEY `hazard_id` (`hazard_id`),
  CONSTRAINT `driver_notifications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `driver_notifications_ibfk_2` FOREIGN KEY (`hazard_id`) REFERENCES `hazard_reports` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Migration-tooling infrastructure (tracks which db/migrations/*.sql and
-- db/procedures/*.sql files have been applied — see db/migrate.mjs). Not
-- part of the application's conceptual data model; omitted from the ERD.
CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `filename` varchar(255) NOT NULL,
  `applied_at` datetime DEFAULT ((now() + interval 2 hour)),
  PRIMARY KEY (`filename`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
