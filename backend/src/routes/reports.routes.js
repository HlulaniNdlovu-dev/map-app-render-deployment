import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import adminWare from '../middleware/admin.js';
import requireRole from '../middleware/role.js';
import pool from '../db/db.js';

const router = express.Router();

/**
 * GET /api/reports/safety
 * Admin-only. Aggregate system-wide safety statistics: the
 * "Administrator requests report -> Generate safety report" use case.
 */
router.get('/safety', authenticateToken, adminWare, async (req, res) => {
  try {
    const [[{ totalHazards }]] = await pool.query('SELECT COUNT(*) AS totalHazards FROM hazard_reports');
    const [[{ activeHazards }]] = await pool.query("SELECT COUNT(*) AS activeHazards FROM hazard_reports WHERE status = 'active'");
    const [[{ totalDrivers }]] = await pool.query('SELECT COUNT(*) AS totalDrivers FROM driver');
    const [[{ totalTrips }]] = await pool.query('SELECT COUNT(*) AS totalTrips FROM destination');
    const [[{ tripsCompleted }]] = await pool.query('SELECT COUNT(*) AS tripsCompleted FROM destination WHERE ended_at IS NOT NULL');

    const [byType] = await pool.query(
      'SELECT hazard_type AS hazardType, COUNT(*) AS count FROM hazard_reports GROUP BY hazard_type ORDER BY count DESC'
    );
    const [bySource] = await pool.query(
      'SELECT source, COUNT(*) AS count FROM hazard_reports GROUP BY source ORDER BY count DESC'
    );
    const [dailyTrend] = await pool.query(
      `SELECT DATE(created_at) AS day, COUNT(*) AS count
       FROM hazard_reports
       WHERE created_at >= (NOW() - INTERVAL 14 DAY)
       GROUP BY DATE(created_at)
       ORDER BY day ASC`
    );

    return res.status(200).json({
      success: true,
      generatedAt: new Date().toISOString(),
      totals: { totalHazards, activeHazards, totalDrivers, totalTrips, tripsCompleted },
      byType,
      bySource,
      dailyTrend,
    });
  } catch (err) {
    console.error('Failed to generate safety report:', err);
    return res.status(500).json({ success: false, message: 'Internal server failure generating safety report.' });
  }
});

/**
 * GET /api/reports/hotspots
 * Data Analyst (or admin). Buckets active hazard reports into a coarse
 * lat/lng grid to surface areas with repeated reports — the "Analyst
 * requests statistics -> Generate hotspot report" use case.
 */
router.get('/hotspots', authenticateToken, requireRole('data_analyst', 'admin'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        ROUND(latitude, 2) AS gridLat,
        ROUND(longitude, 2) AS gridLng,
        COUNT(*) AS count,
        GROUP_CONCAT(DISTINCT hazard_type) AS hazardTypes
      FROM hazard_reports
      WHERE status = 'active'
      GROUP BY gridLat, gridLng
      ORDER BY count DESC
      LIMIT 50
    `);

    const hotspots = rows.map((r) => ({
      lat: Number(r.gridLat),
      lng: Number(r.gridLng),
      count: r.count,
      hazardTypes: r.hazardTypes ? r.hazardTypes.split(',') : [],
      riskLevel: r.count >= 5 ? 'HIGH' : r.count >= 2 ? 'MEDIUM' : 'LOW',
    }));

    return res.status(200).json({
      success: true,
      generatedAt: new Date().toISOString(),
      hotspots,
    });
  } catch (err) {
    console.error('Failed to generate hotspot report:', err);
    return res.status(500).json({ success: false, message: 'Internal server failure generating hotspot report.' });
  }
});

export default router;
