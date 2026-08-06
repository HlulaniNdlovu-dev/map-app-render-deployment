import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import adminWare from '../middleware/admin.js';
import pool from '../db/db.js';
import { ingestNews } from '../services/newsIngest.js';

const router = express.Router();

/**
 * POST /api/ai/ingest
 * Pulls recent news, classifies each item, geocodes the suggested
 * location, and — when a location resolves — inserts it directly into
 * hazard_report (source='ai_confirmed'). There is no separate
 * ai_risk_candidates review-queue table in this deployment; classification
 * result is final as soon as ingestion runs.
 */
router.post('/ingest', authenticateToken, adminWare, async (req, res) => {
  try {
    const result = await ingestNews(req.id);
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('News ingestion failed:', err);
    return res.status(502).json({ success: false, message: 'News ingestion failed. The source or the classifier may be unavailable — try again shortly.' });
  }
});

/**
 * GET /api/ai/recent
 * Lists the most recently AI-added hazards (hazard_report rows with
 * source='ai_confirmed'), newest first — lets the admin panel show what
 * ingestion has added without a separate candidates table.
 */
router.get('/recent', authenticateToken, adminWare, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, latitude, longitude, hazard_type AS hazardType, status, created_at AS createdAt
       FROM hazard_report
       WHERE source = 'ai_confirmed'
       ORDER BY created_at DESC
       LIMIT 50`
    );
    return res.status(200).json({ success: true, hazards: rows });
  } catch (err) {
    console.error('Failed to load recent AI hazards:', err);
    return res.status(500).json({ success: false, message: 'Internal server failure loading recent AI hazards.' });
  }
});

export default router;
