-- One row per completed trip, written by sp_end_trip. Persists a
-- point-in-time duration snapshot even if the source destination row is
-- later deleted, and gives the Trip Completion Report (Phase 3) a table to
-- aggregate over without recomputing TIMESTAMPDIFF on every request.

CREATE TABLE IF NOT EXISTS `trip_summary` (
  `summary_id` INT NOT NULL AUTO_INCREMENT,
  `destination_id` INT NOT NULL,
  `user_id` INT NOT NULL,
  `start_location` VARCHAR(255) DEFAULT NULL,
  `end_location` VARCHAR(255) DEFAULT NULL,
  `duration_seconds` INT NOT NULL,
  `started_at` DATETIME NOT NULL,
  `ended_at` DATETIME NOT NULL,
  PRIMARY KEY (`summary_id`),
  UNIQUE KEY `destination_id` (`destination_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `trip_summary_ibfk_1` FOREIGN KEY (`destination_id`) REFERENCES `destination` (`id`) ON DELETE CASCADE,
  CONSTRAINT `trip_summary_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
