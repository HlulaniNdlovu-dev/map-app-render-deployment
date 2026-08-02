-- Changes a hazard_reports row's status (active <-> resolved) and logs the
-- change to hazard_resolution_log. Enforces the same ownership rule the
-- route used to check in JS: admins can change any report, everyone else
-- (traffic_authority, security_agency) can only change reports they filed
-- themselves. Called from PATCH /api/hazards/:id/status.

DROP PROCEDURE IF EXISTS sp_resolve_hazard;

@@SPLIT@@

CREATE PROCEDURE sp_resolve_hazard(
  IN p_hazard_id INT,
  IN p_new_status VARCHAR(16),
  IN p_actor_user_id INT,
  IN p_is_admin TINYINT(1),
  OUT p_status VARCHAR(20)
)
BEGIN
  DECLARE v_owner_id INT DEFAULT NULL;
  DECLARE v_prev_status VARCHAR(16) DEFAULT NULL;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    SET p_status = 'ERROR';
  END;

  START TRANSACTION;

  SELECT user_id, status INTO v_owner_id, v_prev_status
    FROM hazard_reports WHERE id = p_hazard_id FOR UPDATE;

  IF v_owner_id IS NULL THEN
    ROLLBACK;
    SET p_status = 'NOT_FOUND';
  ELSEIF p_is_admin = 0 AND v_owner_id <> p_actor_user_id THEN
    ROLLBACK;
    SET p_status = 'FORBIDDEN';
  ELSE
    UPDATE hazard_reports SET status = p_new_status WHERE id = p_hazard_id;

    INSERT INTO hazard_resolution_log
      (hazard_id, resolved_by, previous_status, new_status)
      VALUES (p_hazard_id, p_actor_user_id, v_prev_status, p_new_status);

    COMMIT;
    SET p_status = 'OK';
  END IF;
END
