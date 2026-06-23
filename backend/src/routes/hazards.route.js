import express from 'express';
// Import your authenticateToken middleware here (adjust the path as necessary)
import { authenticateToken } from '../middleware/auth.js';
import adminWare from '../middleware/admin.js';
import  pool  from '../db/db.js';

const router = express.Router();

/**
 * POST /api/hazards
 * Commit a new telemetry hazard point
 * 
 * 
 */

router.post('/', authenticateToken, async (req, res) => {
  const { latitude, longitude, hazardType } = req.body;
  const userId = req.user?.userId;  // Assigned by authenticateToken middleware

  // 1. Validation check
  if (!userId || !latitude || !longitude || !hazardType) {
    return res.status(400).json({ 
      success: false, 
      message: "Malformed hazard schema. Missing parameters." 
    });
  }

  try {
    // 2. Insert using your global or imported async db instance
    // Assumes 'db' is globally accessible, or imported/passed into the file
    const [result] = await pool.query(`
      INSERT INTO hazard_reports (user_id, latitude, longitude, hazard_type)
      VALUES (?, ?, ?, ?)
    `, [userId, latitude, longitude, hazardType]);

    // 3. Return clean JSON payload
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
 * Compiles hazard collections for the SafePath Engine check loops.
 *
 * MODIFIED: added hr.user_id and u.email to the SELECT so the admin
 * hazard management page can filter/display by user. This is additive
 * only — every field the SafePath engine (or anything else) already
 * reads is still present under the same name, so existing consumers
 * of this endpoint are unaffected.
 */
router.get('/', async (req, res) => {
  try {
    if (!pool) {
      return res.status(500).json({ success: false, message: "Database connection uninitialized." });
    }

    const [logs] = await pool.query(`
      SELECT 
        hr.id, 
        hr.user_id,
        u.username, 
        u.email,
        hr.latitude, 
        hr.longitude, 
        hr.hazard_type AS hazardType, 
        hr.created_at AS createdAt 
      FROM hazard_reports hr
      INNER JOIN user u ON hr.user_id = u.user_id
      ORDER BY hr.created_at DESC
    `);
    //console.log(logs);
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
 * NEW: PUT /api/hazards/:id
 * Admin-only. Updates ONLY hazard_type on a hazard_reports row.
 * Body: { hazardType: string }  (camelCase, matching this file's
 * existing convention on the POST route above)
 */
router.put('/:id', authenticateToken, adminWare, async (req, res) => {
  const hazardId = req.params.id;
  const { hazardType } = req.body;

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
 * NEW: DELETE /api/hazards/:id
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
