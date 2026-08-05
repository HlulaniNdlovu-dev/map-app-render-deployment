import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import adminWare from '../middleware/admin.js';
import pool from '../db/db.js';
import { sendExport } from '../services/export.js';

const router = express.Router();

function sortRows(rows, key, dir) {
  const factor = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor;
    return String(av).localeCompare(String(bv)) * factor;
  });
}

/**
 * GET /api/reports/safety
 * Admin-only. Aggregate system-wide safety statistics.
 * Filters: from, to (date range on hazard_report.created_at), source.
 * Sort: sortBy=count|name, sortDir=asc|desc.
 */
router.get('/safety', authenticateToken, adminWare, async (req, res) => {
  try {
    const { from, to, source } = req.query;
    const sortBy = req.query.sortBy === 'name' ? 'name' : 'count';
    const sortDir = req.query.sortDir === 'asc' ? 'asc' : 'desc';

    const clauses = [];
    const params = [];
    if (from && to) { clauses.push('created_at BETWEEN ? AND ?'); params.push(from, to); }
    if (source) { clauses.push('source = ?'); params.push(source); }
    const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const [[{ totalHazards }]] = await pool.query('SELECT COUNT(*) AS totalHazards FROM hazard_report');
    const [[{ activeHazards }]] = await pool.query("SELECT COUNT(*) AS activeHazards FROM hazard_report WHERE status = 'active'");
    const [[{ totalDrivers }]] = await pool.query('SELECT COUNT(*) AS totalDrivers FROM driver');
    const [[{ totalTrips }]] = await pool.query('SELECT COUNT(*) AS totalTrips FROM destination');

    const [byTypeRaw] = await pool.query(
      `SELECT hazard_type AS hazardType, COUNT(*) AS count FROM hazard_report ${whereClause} GROUP BY hazard_type`,
      params
    );
    const [bySourceRaw] = await pool.query(
      `SELECT source, COUNT(*) AS count FROM hazard_report ${whereClause} GROUP BY source`,
      params
    );

    const trendClauses = [...clauses];
    const trendParams = [...params];
    if (!(from && to)) trendClauses.push('created_at >= (NOW() - INTERVAL 14 DAY)');
    const [dailyTrend] = await pool.query(
      `SELECT DATE(created_at) AS day, COUNT(*) AS count FROM hazard_report WHERE ${trendClauses.join(' AND ')} GROUP BY DATE(created_at) ORDER BY day ASC`,
      trendParams
    );

    const byType = sortRows(byTypeRaw, sortBy === 'name' ? 'hazardType' : 'count', sortDir);
    const bySource = sortRows(bySourceRaw, sortBy === 'name' ? 'source' : 'count', sortDir);

    const filterSummary = [];
    if (from && to) filterSummary.push(`Date range: ${from} to ${to}`);
    if (source) filterSummary.push(`Source: ${source}`);
    filterSummary.push(`Sorted by ${sortBy} (${sortDir})`);

    const exported = sendExport(req, res, {
      title: 'Safety Report',
      description: 'System-wide hazard activity and driver statistics for the Route Safety Monitor: totals give an at-a-glance snapshot, "By Hazard Type" and "By Source" break reports down by category and origin, and "Daily Trend" shows report volume per day over the selected window (or the last 14 days by default).',
      filters: filterSummary,
      sections: [
        {
          label: 'Totals',
          columns: [
            { key: 'metric', label: 'Metric', width: 2 },
            { key: 'value', label: 'Value', width: 1 },
          ],
          rows: [
            { metric: 'Total Hazards', value: totalHazards },
            { metric: 'Active Hazards', value: activeHazards },
            { metric: 'Registered Drivers', value: totalDrivers },
            { metric: 'Destinations Logged', value: totalTrips },
          ],
        },
        {
          label: 'By Hazard Type',
          columns: [
            { key: 'hazardType', label: 'Hazard Type', width: 2 },
            { key: 'count', label: 'Count', width: 1 },
          ],
          rows: byType,
        },
        {
          label: 'By Source',
          columns: [
            { key: 'source', label: 'Source', width: 2 },
            { key: 'count', label: 'Count', width: 1 },
          ],
          rows: bySource,
        },
        {
          label: 'Daily Trend',
          columns: [
            { key: 'day', label: 'Day', width: 1 },
            { key: 'count', label: 'Count', width: 1 },
          ],
          rows: dailyTrend.map((d) => ({ ...d, day: new Date(d.day).toISOString().slice(0, 10) })),
        },
      ],
    });
    if (exported) return;

    return res.status(200).json({
      success: true,
      generatedAt: new Date().toISOString(),
      totals: { totalHazards, activeHazards, totalDrivers, totalTrips },
      byType,
      bySource,
      dailyTrend,
    });
  } catch (err) {
    console.error('Failed to generate safety report:', err);
    return res.status(500).json({ success: false, message: 'Internal server failure generating safety report.' });
  }
});

export default router;
