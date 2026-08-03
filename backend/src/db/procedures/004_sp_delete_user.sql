-- Deletes a user account. Fixes a real bug where the admin "delete user"
-- feature always failed: every user has exactly one role-subtype row
-- (driver/admin/traffic_authority/security_agency/data_analyst), and none
-- of those foreign keys cascade on delete, so a plain `DELETE FROM user`
-- always threw ER_ROW_IS_REFERENCED_2 (confirmed live against the deployed
-- database before writing this fix).
--
-- Blocks deletion if the user resolved someone else's hazard report or
-- reviewed an AI candidate (hazard_resolution_log.resolved_by /
-- ai_risk_candidates.reviewed_by) — deleting them would corrupt that
-- audit trail's "who did this" record. Their own hazard_reports,
-- destination, driver_notifications (all ON DELETE CASCADE) and
-- trip_summary rows are their own history and are removed with them.

DROP PROCEDURE IF EXISTS sp_delete_user;

@@SPLIT@@

CREATE PROCEDURE sp_delete_user(
  IN p_user_id INT,
  OUT p_status VARCHAR(20)
)
BEGIN
  DECLARE v_exists INT DEFAULT 0;
  DECLARE v_blocked INT DEFAULT 0;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    SET p_status = 'ERROR';
  END;

  SELECT COUNT(*) INTO v_exists FROM user WHERE user_id = p_user_id;

  IF v_exists = 0 THEN
    SET p_status = 'NOT_FOUND';
  ELSE
    SELECT COUNT(*) INTO v_blocked FROM hazard_resolution_log WHERE resolved_by = p_user_id;
    IF v_blocked = 0 THEN
      SELECT COUNT(*) INTO v_blocked FROM ai_risk_candidates WHERE reviewed_by = p_user_id;
    END IF;

    IF v_blocked > 0 THEN
      SET p_status = 'HAS_AUDIT_HISTORY';
    ELSE
      START TRANSACTION;

      DELETE FROM driver WHERE user_id = p_user_id;
      DELETE FROM admin WHERE user_id = p_user_id;
      DELETE FROM traffic_authority WHERE user_id = p_user_id;
      DELETE FROM security_agency WHERE user_id = p_user_id;
      DELETE FROM data_analyst WHERE user_id = p_user_id;
      DELETE FROM trip_summary WHERE user_id = p_user_id;
      DELETE FROM user WHERE user_id = p_user_id;

      COMMIT;
      SET p_status = 'OK';
    END IF;
  END IF;
END
