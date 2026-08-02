-- Notification-only alerts for drivers (Phase 6 proposal gap: persistent
-- alerts). Deliberately NOT named `alerts` — the backend SafeMaster port's
-- loadRoutingContext() has a dormant `SELECT ... FROM alerts` query that
-- silently no-ops today because that table doesn't exist. Naming this
-- table `alerts` would make that dormant query start succeeding and pull
-- real data into routing scores automatically, while the frontend TS port
-- would not — silently breaking SafeMaster parity (Rule 3). Confirmed
-- decision: alerts stay notification-only, not routing signal. See
-- docs/IMPROVEMENT-PLAN.md section 3.

CREATE TABLE IF NOT EXISTS `driver_notifications` (
  `notification_id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `hazard_id` INT DEFAULT NULL,
  `message` VARCHAR(512) NOT NULL,
  `is_read` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME DEFAULT (NOW() + INTERVAL 2 HOUR),
  PRIMARY KEY (`notification_id`),
  KEY `user_id` (`user_id`),
  KEY `hazard_id` (`hazard_id`),
  CONSTRAINT `driver_notifications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `user` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `driver_notifications_ibfk_2` FOREIGN KEY (`hazard_id`) REFERENCES `hazard_reports` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
