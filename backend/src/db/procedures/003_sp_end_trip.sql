-- Marks a driver's trip as ended and writes a durable trip_summary row
-- (duration computed server-side from the original created_at, not trusted
-- from the client). Scoped to the authenticated user's own trip — mirrors
-- the ownership check the JS route used to do with `AND user_id = ?`.
-- Called from PATCH /api/normal-user/destinations/:id/end.

DROP PROCEDURE IF EXISTS sp_end_trip;

@@SPLIT@@

CREATE PROCEDURE sp_end_trip(
  IN p_destination_id INT,
  IN p_user_id INT,
  OUT p_status VARCHAR(20),
  OUT p_duration_seconds INT
)
BEGIN
  DECLARE v_owner_id INT DEFAULT NULL;
  DECLARE v_start_location VARCHAR(255);
  DECLARE v_end_location VARCHAR(255);
  DECLARE v_created_at DATETIME;
  DECLARE v_ended_at DATETIME;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    SET p_status = 'ERROR';
  END;

  START TRANSACTION;

  SELECT user_id, start_location, end_location, created_at, ended_at
    INTO v_owner_id, v_start_location, v_end_location, v_created_at, v_ended_at
    FROM destination WHERE id = p_destination_id FOR UPDATE;

  IF v_owner_id IS NULL THEN
    ROLLBACK;
    SET p_status = 'NOT_FOUND';
  ELSEIF v_owner_id <> p_user_id THEN
    ROLLBACK;
    SET p_status = 'FORBIDDEN';
  ELSEIF v_ended_at IS NOT NULL THEN
    ROLLBACK;
    SET p_status = 'ALREADY_ENDED';
  ELSE
    UPDATE destination
      SET ended_at = CONVERT_TZ(NOW(), @@session.time_zone, '+02:00')
      WHERE id = p_destination_id;

    SELECT ended_at INTO v_ended_at FROM destination WHERE id = p_destination_id;
    SET p_duration_seconds = TIMESTAMPDIFF(SECOND, v_created_at, v_ended_at);

    INSERT INTO trip_summary
      (destination_id, user_id, start_location, end_location, duration_seconds, started_at, ended_at)
      VALUES (p_destination_id, p_user_id, v_start_location, v_end_location, p_duration_seconds, v_created_at, v_ended_at);

    COMMIT;
    SET p_status = 'OK';
  END IF;
END
