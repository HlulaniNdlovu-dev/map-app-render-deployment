-- Records a successful login. Fixes a real inconsistency: every other
-- timestamp in this system (created_at, resolved_at, etc.) is stored via
-- `NOW() + INTERVAL 2 HOUR` to correct for the deployment host's clock
-- running on UTC while the application is South Africa-only (SAST,
-- UTC+2) — but the login route was setting `last_login = NOW()` with no
-- offset at all, so it was consistently 2 hours behind every other
-- timestamp the same user could see elsewhere in the system.

DROP PROCEDURE IF EXISTS sp_record_login;

@@SPLIT@@

CREATE PROCEDURE sp_record_login(
  IN p_user_id INT
)
BEGIN
  UPDATE user SET last_login = (NOW() + INTERVAL 2 HOUR) WHERE user_id = p_user_id;
END
