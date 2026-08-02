import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import adminWare from '../middleware/admin.js';
import requireRole from '../middleware/role.js';
import pool from '../db/db.js';

const router = express.Router();

// A citizen (driver) can only ever file a plain report. Traffic Authority
// and Security Agency reports are tagged with their role automatically,
// server-side, from the authenticated user's JWT — never trusted from the
// request body — so a regular driver can't spoof an "official" report.
function sourceForRole(role) {
  if (role === 'traffic_authority') return 'traffic_authority';
  if (role === 'security_agency') return 'security_agency';
  return 'citizen';
}

/**
 * Best-effort notification fan-out: notifies every driver with a trip
 * still in progress (destination.ended_at IS NULL) that a new hazard was
 * reported, excluding the reporter. The schema doesn't persist a trip's
 * route geometry (only free-text start/end location), so this can't
 * filter by actual proximity to the driver's route — "active trip" is the
 * closest available proxy for "currently driving." Never blocks or fails
 * the hazard report itself if this fails.
 */
async function notifyDriversOnActiveTrips(hazardId, reporterUserId, hazardType, latitude, longitude) {
  try {
    const message = `New ${String(hazardType).replace(/_/g, ' ')} hazard reported at ${Number(latitude).toFixed(3)}, ${Number(longitude).toFixed(3)}.`;
    await pool.query(
      `INSERT INTO driver_notifications (user_id, hazard_id, message)
       SELECT DISTINCT d.user_id, ?, ?
       FROM destination d
       WHERE d.ended_at IS NULL AND d.user_id != ?`,
      [hazardId, message, reporterUserId]
    );
  } catch (err) {
    console.warn('Failed to fan out driver notifications for new hazard:', err.message);
  }
}

/**
 * POST /api/hazards
 * Commit a new hazard/danger-zone report. Used by drivers reporting a
 * hazard from the map, and by Traffic Authority (protests, road closures)
 * and Security Agency (crime hotspots, hijacking areas) from their
 * dashboards — same table, tagged by source.
 */
router.post('/', authenticateToken, async (req, res) => {
  const { latitude, longitude, hazardType } = req.body || {};
  const userId = req.id;

  if (!userId || !latitude || !longitude || !hazardType) {
    return res.status(400).json({
      success: false,
      message: "Malformed hazard schema. Missing parameters."
    });
  }

  const source = sourceForRole(req.type);

  try {
    const [result] = await pool.query(`
      INSERT INTO hazard_reports (user_id, latitude, longitude, hazard_type, source, created_at)
      VALUES (?, ?, ?, ?, ?, CONVERT_TZ(NOW(), @@session.time_zone, '+02:00'))
    `, [userId, latitude, longitude, hazardType, source]);

    await notifyDriversOnActiveTrips(result.insertId, userId, hazardType, latitude, longitude);

    return res.status(201).json({
      success: true,
      message: "Telemetry point committed successfully.",
      reportId: result.insertId
    });

  } catch (dbError) {
    console.error("Database insertion fault:", dbError);
    return res.status(500).json({
      success: false,
      message: "Internal record storage transactional failure."
    });
  }
});

/**
 * GET /api/hazards
 * Compiles hazard collections for the SafePath Engine check loops, and
 * for admin/analyst views. Includes source/status so callers can tell
 * official reports apart from citizen ones and filter out resolved zones.
 */
router.get('/', async (req, res) => {
  try {
    const [logs] = await pool.query(`
      SELECT
        hr.id,
        hr.user_id,
        u.username,
        u.email,
        hr.latitude,
        hr.longitude,
        hr.hazard_type AS hazardType,
        hr.source,
        hr.status,
        hr.created_at AS createdAt
      FROM hazard_reports hr
      INNER JOIN user u ON hr.user_id = u.user_id
      ORDER BY hr.created_at DESC
    `);
    return res.status(200).json(logs);

  } catch (dbError) {
    console.error("Backend failed to fetch threat matrix data logs:", dbError);
    return res.status(500).json({
      success: false,
      message: "Internal server data retrieval failure."
    });
  }
});

/**
 * GET /api/hazards/mine
 * Reports filed by the authenticated user — used by the Traffic Authority
 * and Security Agency dashboards to show "my reports" without needing to
 * filter the full citywide feed client-side.
 */
router.get('/mine', authenticateToken, async (req, res) => {
  try {
    const [logs] = await pool.query(`
      SELECT id, latitude, longitude, hazard_type AS hazardType, source, status, created_at AS createdAt
      FROM hazard_reports
      WHERE user_id = ?
      ORDER BY created_at DESC
    `, [req.id]);
    return res.status(200).json(logs);
  } catch (dbError) {
    console.error("Failed to fetch own hazard reports:", dbError);
    return res.status(500).json({ success: false, message: "Internal server data retrieval failure." });
  }
});

/**
 * PUT /api/hazards/:id
 * Admin-only. Updates ONLY hazard_type on a hazard_reports row.
 */
router.put('/:id', authenticateToken, adminWare, async (req, res) => {
  const hazardId = req.params.id;
  const { hazardType } = req.body || {};

  if (!hazardType) {
    return res.status(400).json({ success: false, message: "hazardType is required." });
  }

  try {
    const [result] = await pool.query(
      `UPDATE hazard_reports SET hazard_type = ? WHERE id = ?`,
      [hazardType, hazardId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Hazard report not found." });
    }

    return res.status(200).json({ success: true, message: "Hazard type updated." });
  } catch (dbError) {
    console.error("Failed to update hazard type:", dbError);
    return res.status(500).json({ success: false, message: "Internal update failure." });
  }
});

/**
 * PATCH /api/hazards/:id/status
 * Marks a danger zone active/resolved. Admins can resolve anything;
 * Traffic Authority / Security Agency can only resolve reports they
 * themselves filed (their own protest/closure/hotspot record).
 */
router.patch('/:id/status', authenticateToken, requireRole('admin', 'traffic_authority', 'security_agency'), async (req, res) => {
  const hazardId = req.params.id;
  const { status } = req.body || {};

  if (!['active', 'resolved'].includes(status)) {
    return res.status(400).json({ success: false, message: "status must be 'active' or 'resolved'." });
  }

  const connection = await pool.getConnection();
  try {
    // sp_resolve_hazard does the ownership check + status update + audit
    // log insert (hazard_resolution_log) atomically in one transaction.
    await connection.query(
      'CALL sp_resolve_hazard(?, ?, ?, ?, @p_status)',
      [hazardId, status, req.id, req.type === 'admin' ? 1 : 0]
    );
    const [[out]] = await connection.query('SELECT @p_status AS status');

    if (out.status === 'NOT_FOUND' || out.status === 'FORBIDDEN') {
      return res.status(404).json({ success: false, message: "Hazard report not found or not yours to update." });
    }
    if (out.status !== 'OK') {
      return res.status(500).json({ success: false, message: "Internal update failure." });
    }

    return res.status(200).json({ success: true, message: `Marked ${status}.` });
  } catch (dbError) {
    console.error("Failed to update hazard status:", dbError);
    return res.status(500).json({ success: false, message: "Internal update failure." });
  } finally {
    connection.release();
  }
});

/**
 * DELETE /api/hazards/:id
 * Admin-only. Removes a hazard_reports row.
 */
router.delete('/:id', authenticateToken, adminWare, async (req, res) => {
  const hazardId = req.params.id;

  try {
    const [result] = await pool.query(`DELETE FROM hazard_reports WHERE id = ?`, [hazardId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Hazard report not found." });
    }

    return res.status(200).json({ success: true, message: "Hazard report deleted." });
  } catch (dbError) {
    console.error("Failed to delete hazard report:", dbError);
    return res.status(500).json({ success: false, message: "Internal delete failure." });
  }
});

export default router;
