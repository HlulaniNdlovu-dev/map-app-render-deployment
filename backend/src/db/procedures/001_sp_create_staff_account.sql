-- Creates a staff account (admin / traffic_authority / security_agency /
-- data_analyst) atomically: one row in `user`, one row in the matching
-- role subtype table. Password hashing stays in Node (bcrypt isn't
-- available in MySQL) — this procedure receives an already-hashed
-- password. Called from POST /api/auth/register-staff, which is already
-- gated to admins only via middleware.

DROP PROCEDURE IF EXISTS sp_create_staff_account;

@@SPLIT@@

CREATE PROCEDURE sp_create_staff_account(
  IN p_email VARCHAR(255),
  IN p_password_hash VARCHAR(255),
  IN p_username VARCHAR(255),
  IN p_first_name VARCHAR(255),
  IN p_last_name VARCHAR(255),
  IN p_role VARCHAR(50),
  OUT p_user_id INT,
  OUT p_status VARCHAR(20)
)
BEGIN
  DECLARE v_existing INT DEFAULT 0;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    SET p_status = 'ERROR';
    SET p_user_id = NULL;
  END;

  SELECT COUNT(*) INTO v_existing
    FROM user WHERE email = p_email OR username = p_username;

  IF v_existing > 0 THEN
    SET p_status = 'DUPLICATE';
    SET p_user_id = NULL;
  ELSE
    START TRANSACTION;

    INSERT INTO user (email, password, username, firstname, lastname)
      VALUES (p_email, p_password_hash, p_username, p_first_name, p_last_name);
    SET p_user_id = LAST_INSERT_ID();

    IF p_role = 'admin' THEN
      INSERT INTO admin (user_id) VALUES (p_user_id);
    ELSEIF p_role = 'traffic_authority' THEN
      INSERT INTO traffic_authority (user_id) VALUES (p_user_id);
    ELSEIF p_role = 'security_agency' THEN
      INSERT INTO security_agency (user_id) VALUES (p_user_id);
    ELSEIF p_role = 'data_analyst' THEN
      INSERT INTO data_analyst (user_id) VALUES (p_user_id);
    ELSE
      SET p_role = NULL;
    END IF;

    IF p_role IS NULL THEN
      ROLLBACK;
      SET p_status = 'INVALID_ROLE';
      SET p_user_id = NULL;
    ELSE
      COMMIT;
      SET p_status = 'OK';
    END IF;
  END IF;
END
