import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import adminWare from '../middleware/admin.js';
import pool from '../db/db.js';
import { ingestNews } from '../services/newsIngest.js';

const router = express.Router();

/**
 * POST /api/ai/ingest
 * Pulls recent news, classifies each item, geocodes the suggested
 * location, and stores results as PENDING candidates. Never touches
 * hazard_report directly.
 */
router.post('/ingest', authenticateToken, adminWare, async (req, res) => {
  try {
    const result = await ingestNews();
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('News ingestion failed:', err);
    return res.status(502).json({ success: false, message: 'News ingestion failed. The source or the classifier may be unavailable — try again shortly.' });
  }
});

/**
 * GET /api/ai/candidates?status=pending
 * Defaults to pending candidates, ranked by confidence desc — the review
 * queue. ?status=confirmed|rejected lets a reviewer look back at history.
 */
router.get('/candidates', authenticateToken, adminWare, async (req, res) => {
  const status = ['pending', 'confirmed', 'rejected'].includes(req.query.status)
    ? req.query.status
    : 'pending';

  try {
    const [rows] = await pool.query(
      `SELECT candidate_id, raw_source_text, source_url, classified_category,
              confidence, suggested_lat, suggested_lng, suggested_location_text,
              summary, status, created_at, reviewed_by, reviewed_at, resulting_hazard_id
       FROM ai_risk_candidate
       WHERE status = ?
       ORDER BY confidence DESC, created_at DESC`,
      [status]
    );
    return res.status(200).json({ success: true, candidates: rows });
  } catch (err) {
    console.error('Failed to load AI candidates:', err);
    return res.status(500).json({ success: false, message: 'Internal server failure loading candidates.' });
  }
});

/**
 * POST /api/ai/candidates/:id/confirm
 * Human-in-the-loop promotion: only this action ever creates a real
 * hazard_report row from AI output, and only after a person reviewed it.
 * Requires the candidate to have a resolved location.
 */
router.post('/candidates/:id/confirm', authenticateToken, adminWare, async (req, res) => {
  const { id } = req.params;

  const connection = await pool.getConnection();
  try {
    const [[candidate]] = await connection.query(
      'SELECT * FROM ai_risk_candidate WHERE candidate_id = ?',
      [id]
    );

    if (!candidate) {
      return res.status(404).json({ success: false, message: 'Candidate not found.' });
    }
    if (candidate.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Candidate already ${candidate.status}.` });
    }
    if (candidate.suggested_lat === null || candidate.suggested_lng === null) {
      return res.status(400).json({
        success: false,
        message: 'This candidate has no resolved location, so it cannot become a map hazard. Reject it instead.',
      });
    }

    await connection.beginTransaction();

    const [hazardResult] = await connection.query(
      `INSERT INTO hazard_report (user_id, latitude, longitude, hazard_type, source, status, created_at)
       VALUES (?, ?, ?, ?, 'ai_confirmed', 'active', CONVERT_TZ(NOW(), @@session.time_zone, '+02:00'))`,
      [req.id, candidate.suggested_lat, candidate.suggested_lng, candidate.classified_category]
    );

    await connection.query(
      `UPDATE ai_risk_candidate
       SET status = 'confirmed', reviewed_by = ?, reviewed_at = CONVERT_TZ(NOW(), @@session.time_zone, '+02:00'), resulting_hazard_id = ?
       WHERE candidate_id = ?`,
      [req.id, hazardResult.insertId, id]
    );

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: 'Candidate confirmed and added to the live risk database.',
      hazardId: hazardResult.insertId,
    });
  } catch (err) {
    await connection.rollback().catch(() => {});
    console.error('Failed to confirm AI candidate:', err);
    return res.status(500).json({ success: false, message: 'Internal server failure confirming candidate.' });
  } finally {
    connection.release();
  }
});

/**
 * POST /api/ai/candidates/:id/reject
 * No hazard_report write happens here at all — rejecting an AI candidate
 * has zero effect on routing or any other part of the system.
 */
router.post('/candidates/:id/reject', authenticateToken, adminWare, async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await pool.query(
      `UPDATE ai_risk_candidate
       SET status = 'rejected', reviewed_by = ?, reviewed_at = CONVERT_TZ(NOW(), @@session.time_zone, '+02:00')
       WHERE candidate_id = ? AND status = 'pending'`,
      [req.id, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Candidate not found or already reviewed.' });
    }
    return res.status(200).json({ success: true, message: 'Candidate rejected.' });
  } catch (err) {
    console.error('Failed to reject AI candidate:', err);
    return res.status(500).json({ success: false, message: 'Internal server failure rejecting candidate.' });
  }
});

export default router;
