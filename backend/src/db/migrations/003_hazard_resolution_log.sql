-- Audit trail for hazard status changes. sp_resolve_hazard writes one row
-- here every time a hazard_reports row's status is changed via the
-- procedure, so who changed what and when survives even if the hazard
-- itself is later deleted or its status flips back.

CREATE TABLE IF NOT EXISTS `hazard_resolution_log` (
  `log_id` INT NOT NULL AUTO_INCREMENT,
  `hazard_id` INT NOT NULL,
  `resolved_by` INT NOT NULL,
  `previous_status` VARCHAR(16) NOT NULL,
  `new_status` VARCHAR(16) NOT NULL,
  `resolved_at` DATETIME DEFAULT (NOW() + INTERVAL 2 HOUR),
  PRIMARY KEY (`log_id`),
  KEY `hazard_id` (`hazard_id`),
  KEY `resolved_by` (`resolved_by`),
  CONSTRAINT `hazard_resolution_log_ibfk_1` FOREIGN KEY (`hazard_id`) REFERENCES `hazard_reports` (`id`) ON DELETE CASCADE,
  CONSTRAINT `hazard_resolution_log_ibfk_2` FOREIGN KEY (`resolved_by`) REFERENCES `user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
