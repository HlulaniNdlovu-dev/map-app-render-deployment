-- AI-classified hazard candidates awaiting human review. Confirming one
-- inserts a real row into hazard_reports (source='ai_confirmed'); rejecting
-- one has no effect on routing at all. This table exists specifically so an
-- LLM never writes directly into the live risk data — see docs/AI-FEATURE.md
-- for the reasoning (hallucination mitigation).

CREATE TABLE IF NOT EXISTS `ai_risk_candidates` (
  `candidate_id` INT NOT NULL AUTO_INCREMENT,
  `raw_source_text` TEXT NOT NULL,
  `source_url` VARCHAR(512) DEFAULT NULL,
  `classified_category` VARCHAR(64) NOT NULL,
  `confidence` DECIMAL(4,3) NOT NULL,
  `suggested_lat` DECIMAL(10,7) DEFAULT NULL,
  `suggested_lng` DECIMAL(10,7) DEFAULT NULL,
  `suggested_location_text` VARCHAR(255) DEFAULT NULL,
  `summary` VARCHAR(512) DEFAULT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `created_at` DATETIME DEFAULT (NOW() + INTERVAL 2 HOUR),
  `reviewed_by` INT DEFAULT NULL,
  `reviewed_at` DATETIME DEFAULT NULL,
  `resulting_hazard_id` INT DEFAULT NULL,
  PRIMARY KEY (`candidate_id`),
  KEY `reviewed_by` (`reviewed_by`),
  KEY `resulting_hazard_id` (`resulting_hazard_id`),
  CONSTRAINT `ai_risk_candidates_ibfk_1` FOREIGN KEY (`reviewed_by`) REFERENCES `user` (`user_id`),
  CONSTRAINT `ai_risk_candidates_ibfk_2` FOREIGN KEY (`resulting_hazard_id`) REFERENCES `hazard_reports` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
