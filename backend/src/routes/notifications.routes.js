import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import pool from '../db/db.js';

// Notification-only alerts (Phase 6). Every route here is scoped to the
// authenticated user's own notifications — a driver can never read or
// modify another driver's notifications.
const router = express.Router();

/**
 * GET /api/notifications
 * The authenticated user's own notifications, most recent first.
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT notification_id AS notificationId, hazard_id AS hazardId, message,
              is_read AS isRead, created_at AS createdAt
       FROM driver_notifications
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 50`,
      [req.id]
    );
    return res.status(200).json({ success: true, notifications: rows });
  } catch (err) {
    console.error('Failed to fetch notifications:', err);
    return res.status(500).json({ success: false, message: 'Internal server failure fetching notifications.' });
  }
});

/**
 * PATCH /api/notifications/:id/read
 * Marks one of the authenticated user's own notifications as read.
 */
router.patch('/:id/read', authenticateToken, async (req, res) => {
  try {
    const [result] = await pool.query(
      `UPDATE driver_notifications SET is_read = 1 WHERE notification_id = ? AND user_id = ?`,
      [req.params.id, req.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Notification not found.' });
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Failed to mark notification read:', err);
    return res.status(500).json({ success: false, message: 'Internal server failure updating notification.' });
  }
});

/**
 * PATCH /api/notifications/read-all
 * Marks every one of the authenticated user's own notifications as read.
 */
router.patch('/read-all', authenticateToken, async (req, res) => {
  try {
    await pool.query(`UPDATE driver_notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0`, [req.id]);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Failed to mark all notifications read:', err);
    return res.status(500).json({ success: false, message: 'Internal server failure updating notifications.' });
  }
});

export default router;
