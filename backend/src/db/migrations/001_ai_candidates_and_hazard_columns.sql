-- Adds the columns/table needed for the Live Risk Intelligence (AI news
-- analysis) admin feature and the Safety Report's by-source breakdown.
-- Already applied to the local `safe_route` database by hand; kept here so
-- the schema is reproducible on another machine/DB.
--
-- Table names follow this schema's existing singular convention
-- (user, admin, driver, destination, hazard_report).

ALTER TABLE hazard_report
  ADD COLUMN source VARCHAR(32) NOT NULL DEFAULT 'citizen',
  ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'active';

CREATE TABLE IF NOT EXISTS ai_risk_candidate (
  candidate_id INT NOT NULL AUTO_INCREMENT,
  raw_source_text TEXT NOT NULL,
  source_url VARCHAR(512) DEFAULT NULL,
  classified_category VARCHAR(64) NOT NULL,
  confidence DECIMAL(4,3) NOT NULL,
  suggested_lat DECIMAL(10,7) DEFAULT NULL,
  suggested_lng DECIMAL(10,7) DEFAULT NULL,
  suggested_location_text VARCHAR(255) DEFAULT NULL,
  summary VARCHAR(512) DEFAULT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  reviewed_by INT DEFAULT NULL,
  reviewed_at DATETIME DEFAULT NULL,
  resulting_hazard_id INT DEFAULT NULL,
  PRIMARY KEY (candidate_id),
  KEY reviewed_by (reviewed_by),
  KEY resulting_hazard_id (resulting_hazard_id),
  CONSTRAINT ai_risk_candidate_ibfk_1 FOREIGN KEY (reviewed_by) REFERENCES user (user_id),
  CONSTRAINT ai_risk_candidate_ibfk_2 FOREIGN KEY (resulting_hazard_id) REFERENCES hazard_report (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
