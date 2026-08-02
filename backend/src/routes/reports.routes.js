import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import adminWare from '../middleware/admin.js';
import requireRole from '../middleware/role.js';
import pool from '../db/db.js';
import { buildCsv, streamPdf, parseSortDir, sortRows } from '../services/export.js';

const router = express.Router();

function sendExport(req, res, { title, sections, description, filters }) {
  const format = (req.query.format || 'json').toLowerCase();
  const generatedAt = new Date().toISOString();
  const filtersText = filters && filters.length ? filters.join('; ') : 'none — showing all records';

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${title.replace(/\s+/g, '_').toLowerCase()}.csv"`);
    return res.status(200).send(buildCsv(title, generatedAt, sections, { description, filters: filtersText }));
  }
  if (format === 'pdf') {
    res.setHeader('Content-Disposition', `attachment; filename="${title.replace(/\s+/g, '_').toLowerCase()}.pdf"`);
    streamPdf(res, title, generatedAt, sections, { description, filters: filtersText });
    return true;
  }
  return null; // caller falls back to its own JSON shape
}

const SOURCE_LABELS = {
  citizen: 'Citizen',
  traffic_authority: 'Traffic Authority',
  security_agency: 'Security Agency',
  ai_confirmed: 'AI Confirmed',
};

function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

function formatDurationSeconds(seconds) {
  const s = Number(seconds) || 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/**
 * GET /api/reports/safety
 * Admin-only. Aggregate system-wide safety statistics: the
 * "Administrator requests report -> Generate safety report" use case.
 * Filters: from, to (date range on hazard_reports.created_at).
 * Sort: sortBy=count|name (applies to byType and bySource), sortDir=asc|desc.
 * source: citizen|traffic_authority|security_agency|ai_confirmed — narrows
 * byType and the daily trend to reports from that source only.
 * Export: ?format=csv|pdf.
 */
router.get('/safety', authenticateToken, adminWare, async (req, res) => {
  try {
    const { from, to, source } = req.query;
    const sortBy = req.query.sortBy === 'name' ? 'name' : 'count';
    const sortDir = parseSortDir(req.query.sortDir);

    const clauses = [];
    const params = [];
    if (from && to) { clauses.push('created_at BETWEEN ? AND ?'); params.push(from, to); }
    if (source) { clauses.push('source = ?'); params.push(source); }
    const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const [[{ totalHazards }]] = await pool.query('SELECT COUNT(*) AS totalHazards FROM hazard_reports');
    const [[{ activeHazards }]] = await pool.query("SELECT COUNT(*) AS activeHazards FROM hazard_reports WHERE status = 'active'");
    const [[{ totalDrivers }]] = await pool.query('SELECT COUNT(*) AS totalDrivers FROM driver');
    const [[{ totalTrips }]] = await pool.query('SELECT COUNT(*) AS totalTrips FROM destination');
    const [[{ tripsCompleted }]] = await pool.query('SELECT COUNT(*) AS tripsCompleted FROM destination WHERE ended_at IS NOT NULL');

    const [byTypeRaw] = await pool.query(
      `SELECT hazard_type AS hazardType, COUNT(*) AS count FROM hazard_reports ${whereClause} GROUP BY hazard_type`,
      params
    );
    const [bySourceRaw] = await pool.query(
      `SELECT source, COUNT(*) AS count FROM hazard_reports ${whereClause} GROUP BY source`,
      params
    );
    const trendClauses = [...clauses];
    const trendParams = [...params];
    if (!(from && to)) trendClauses.push('created_at >= (NOW() - INTERVAL 14 DAY)');
    const [dailyTrend] = await pool.query(
      `SELECT DATE(created_at) AS day, COUNT(*) AS count FROM hazard_reports WHERE ${trendClauses.join(' AND ')} GROUP BY DATE(created_at) ORDER BY day ASC`,
      trendParams
    );

    const byType = sortRows(byTypeRaw, sortBy === 'name' ? 'hazardType' : 'count', sortDir);
    const bySource = sortRows(bySourceRaw, sortBy === 'name' ? 'source' : 'count', sortDir);

    const filterSummary = [];
    if (from && to) filterSummary.push(`Date range: ${from} to ${to}`);
    if (source) filterSummary.push(`Source: ${SOURCE_LABELS[source] || source}`);
    filterSummary.push(`Sorted by ${sortBy === 'name' ? 'name' : 'count'} (${sortDir})`);

    const exported = sendExport(req, res, {
      title: 'Safety Report',
      description:
        'This report summarizes system-wide hazard activity and driver trip completion for the Route Safety Monitor. ' +
        '"Totals" gives an at-a-glance snapshot of the whole system. "By Hazard Type" and "By Source" break hazard ' +
        'reports down by category and by who filed them — citizen drivers, Traffic Authority, Security Agency, or an ' +
        'AI-confirmed news alert (see the Live Risk Intelligence feature). "Daily Trend" shows report volume per day ' +
        'over the selected window (or the last 14 days by default) to help identify spikes in hazard activity.',
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
            { metric: 'Trips Logged', value: totalTrips },
            { metric: 'Trips Completed', value: tripsCompleted },
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
            { key: 'dayFormatted', label: 'Day', width: 1 },
            { key: 'count', label: 'Count', width: 1 },
          ],
          rows: dailyTrend.map((d) => ({ ...d, dayFormatted: new Date(d.day).toISOString().slice(0, 10) })),
        },
      ],
    });
    if (exported) return;

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
 * Filters: minCount, includeResolved (default false — active hazards only).
 * Sort: sortBy=count|lat|lng, sortDir=asc|desc.
 * Export: ?format=csv|pdf.
 */
router.get('/hotspots', authenticateToken, requireRole('data_analyst', 'admin'), async (req, res) => {
  try {
    const minCount = req.query.minCount ? Number(req.query.minCount) : 0;
    const includeResolved = req.query.includeResolved === 'true';
    const sortKey = ['count', 'lat', 'lng'].includes(req.query.sortBy) ? req.query.sortBy : 'count';
    const sortDir = parseSortDir(req.query.sortDir);

    const [rows] = await pool.query(`
      SELECT
        ROUND(latitude, 2) AS gridLat,
        ROUND(longitude, 2) AS gridLng,
        COUNT(*) AS count,
        GROUP_CONCAT(DISTINCT hazard_type) AS hazardTypes
      FROM hazard_reports
      ${includeResolved ? '' : "WHERE status = 'active'"}
      GROUP BY gridLat, gridLng
      ORDER BY count DESC
      LIMIT 200
    `);

    let hotspots = rows.map((r) => ({
      lat: Number(r.gridLat),
      lng: Number(r.gridLng),
      count: r.count,
      hazardTypes: r.hazardTypes ? r.hazardTypes.split(',') : [],
      riskLevel: r.count >= 5 ? 'HIGH' : r.count >= 2 ? 'MEDIUM' : 'LOW',
    }));

    hotspots = hotspots.filter((h) => h.count >= minCount);
    hotspots = sortRows(hotspots, sortKey, sortDir).slice(0, 50);

    const filterSummary = [];
    if (minCount > 0) filterSummary.push(`Minimum ${minCount} report(s) per cluster`);
    filterSummary.push(includeResolved ? 'Includes resolved hazards' : 'Active hazards only');
    filterSummary.push(`Sorted by ${sortKey} (${sortDir})`);

    const exported = sendExport(req, res, {
      title: 'Hotspot Report',
      description:
        'This report clusters hazard reports into a coarse geographic grid (each cell is roughly 1km, from rounding ' +
        'coordinates to 2 decimal places) to surface areas with repeated incidents rather than one-off reports. ' +
        'Risk Level is derived purely from how many reports fall in a cell: LOW = 1, MEDIUM = 2-4, HIGH = 5 or more. ' +
        'Use this to identify recurring danger zones that may warrant targeted attention — additional patrols, road ' +
        'repairs, or public safety notices — rather than treating every individual hazard report in isolation.',
      filters: filterSummary,
      sections: [
        {
          columns: [
            { key: 'lat', label: 'Latitude', width: 1 },
            { key: 'lng', label: 'Longitude', width: 1 },
            { key: 'count', label: 'Reports', width: 1 },
            { key: 'riskLevel', label: 'Risk Level', width: 1 },
            { key: 'hazardTypesText', label: 'Hazard Types Present', width: 3 },
          ],
          rows: hotspots.map((h) => ({ ...h, hazardTypesText: h.hazardTypes.join(', ') })),
        },
      ],
    });
    if (exported) return;

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

/**
 * GET /api/reports/trips
 * Admin / Data Analyst. Trip Completion Report — one row per trip ended
 * via sp_end_trip (Phase 2), i.e. every row in trip_summary.
 * Filters: from, to (date range on started_at), userId, minDuration, maxDuration (seconds).
 * Sort: sortBy=startedAt|durationSeconds, sortDir=asc|desc.
 * Export: ?format=csv|pdf.
 */
router.get('/trips', authenticateToken, requireRole('admin', 'data_analyst'), async (req, res) => {
  try {
    const { from, to, userId, minDuration, maxDuration } = req.query;
    const sortKey = req.query.sortBy === 'durationSeconds' ? 'duration_seconds' : 'started_at';
    const sortDir = parseSortDir(req.query.sortDir, 'desc') === 'asc' ? 'ASC' : 'DESC';

    const clauses = [];
    const params = [];
    if (from && to) { clauses.push('ts.started_at BETWEEN ? AND ?'); params.push(from, to); }
    if (userId) { clauses.push('ts.user_id = ?'); params.push(userId); }
    if (minDuration) { clauses.push('ts.duration_seconds >= ?'); params.push(Number(minDuration)); }
    if (maxDuration) { clauses.push('ts.duration_seconds <= ?'); params.push(Number(maxDuration)); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const [rows] = await pool.query(
      `SELECT
         ts.summary_id AS summaryId,
         u.username AS driverUsername,
         ts.start_location AS startLocation,
         ts.end_location AS endLocation,
         ts.duration_seconds AS durationSeconds,
         ts.started_at AS startedAt,
         ts.ended_at AS endedAt
       FROM trip_summary ts
       INNER JOIN user u ON ts.user_id = u.user_id
       ${where}
       ORDER BY ${sortKey === 'duration_seconds' ? 'ts.duration_seconds' : 'ts.started_at'} ${sortDir}
       LIMIT 500`,
      params
    );

    const filterSummary = [];
    if (from && to) filterSummary.push(`Date range: ${from} to ${to}`);
    if (userId) filterSummary.push(`Driver user ID: ${userId}`);
    if (minDuration) filterSummary.push(`Minimum duration: ${minDuration}s`);
    if (maxDuration) filterSummary.push(`Maximum duration: ${maxDuration}s`);
    filterSummary.push(`Sorted by ${sortKey === 'duration_seconds' ? 'duration' : 'start time'} (${sortDir === 'ASC' ? 'asc' : 'desc'})`);

    const rowsFormatted = rows.map((r) => ({
      ...r,
      durationFormatted: formatDurationSeconds(r.durationSeconds),
      startedAt: formatDateTime(r.startedAt),
      endedAt: formatDateTime(r.endedAt),
    }));

    const exported = sendExport(req, res, {
      title: 'Trip Completion Report',
      description:
        'This report lists every driver trip that has been marked complete via the app\'s "End Trip" action. Each ' +
        'row corresponds to one trip_summary record, written server-side by the sp_end_trip stored procedure the ' +
        'moment a trip ends. Duration is computed from the trip\'s actual start and end timestamps — not ' +
        'self-reported by the driver — so it reflects real elapsed journey time. Use this to understand typical trip ' +
        'lengths and driver activity patterns across the system.',
      filters: filterSummary,
      sections: [
        {
          columns: [
            { key: 'summaryId', label: 'ID', width: 0.6 },
            { key: 'driverUsername', label: 'Driver', width: 1.3 },
            { key: 'startLocation', label: 'Start', width: 1.6 },
            { key: 'endLocation', label: 'End', width: 1.6 },
            { key: 'durationFormatted', label: 'Duration', width: 1 },
            { key: 'startedAt', label: 'Started At', width: 1.6 },
            { key: 'endedAt', label: 'Ended At', width: 1.6 },
          ],
          rows: rowsFormatted,
        },
      ],
    });
    if (exported) return;

    return res.status(200).json({ success: true, generatedAt: new Date().toISOString(), trips: rows });
  } catch (err) {
    console.error('Failed to generate trip completion report:', err);
    return res.status(500).json({ success: false, message: 'Internal server failure generating trip completion report.' });
  }
});

/**
 * GET /api/reports/hazard-responses
 * Admin / Traffic Authority / Security Agency / Data Analyst — the roles
 * that can resolve a hazard (sp_resolve_hazard, Phase 2) can review the
 * audit trail of resolutions, and Data Analyst gets read-only access for
 * response-pattern analysis (same reasoning as their hotspots access).
 * One row per hazard_resolution_log entry.
 * Filters: from, to (date range on resolved_at), hazardType, newStatus.
 * Sort: sortBy=resolvedAt|hazardType, sortDir=asc|desc.
 * Export: ?format=csv|pdf.
 */
router.get('/hazard-responses', authenticateToken, requireRole('admin', 'traffic_authority', 'security_agency', 'data_analyst'), async (req, res) => {
  try {
    const { from, to, hazardType, newStatus } = req.query;
    const sortKey = req.query.sortBy === 'hazardType' ? 'hr.hazard_type' : 'hrl.resolved_at';
    const sortDir = parseSortDir(req.query.sortDir, 'desc') === 'asc' ? 'ASC' : 'DESC';

    const clauses = [];
    const params = [];
    if (from && to) { clauses.push('hrl.resolved_at BETWEEN ? AND ?'); params.push(from, to); }
    if (hazardType) { clauses.push('hr.hazard_type = ?'); params.push(hazardType); }
    if (newStatus) { clauses.push('hrl.new_status = ?'); params.push(newStatus); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const [rows] = await pool.query(
      `SELECT
         hrl.log_id AS logId,
         hrl.hazard_id AS hazardId,
         hr.hazard_type AS hazardType,
         u.username AS resolvedByUsername,
         hrl.previous_status AS previousStatus,
         hrl.new_status AS newStatus,
         hrl.resolved_at AS resolvedAt
       FROM hazard_resolution_log hrl
       INNER JOIN hazard_reports hr ON hrl.hazard_id = hr.id
       INNER JOIN user u ON hrl.resolved_by = u.user_id
       ${where}
       ORDER BY ${sortKey} ${sortDir}
       LIMIT 500`,
      params
    );

    const filterSummary = [];
    if (from && to) filterSummary.push(`Date range: ${from} to ${to}`);
    if (hazardType) filterSummary.push(`Hazard type: ${hazardType.replace(/_/g, ' ')}`);
    if (newStatus) filterSummary.push(`Changed to: ${newStatus}`);
    filterSummary.push(`Sorted by ${sortKey === 'hr.hazard_type' ? 'hazard type' : 'resolved date'} (${sortDir === 'ASC' ? 'asc' : 'desc'})`);

    const rowsFormatted = rows.map((r) => ({
      ...r,
      statusChange: `${r.previousStatus} -> ${r.newStatus}`,
      resolvedAt: formatDateTime(r.resolvedAt),
    }));

    const exported = sendExport(req, res, {
      title: 'Hazard Response Report',
      description:
        'This report is an audit trail of every hazard status change (active <-> resolved) made by Traffic ' +
        'Authority, Security Agency, or Administrator staff, written server-side by the sp_resolve_hazard stored ' +
        'procedure every time it runs. Each row records who made the change, what the status was before and after, ' +
        'and exactly when. "Resolved" means staff have confirmed the hazard no longer applies; a hazard can be ' +
        'reopened back to "active" if it turns out the danger is still present. Use this report to measure ' +
        'accountability and response time for reported hazards.',
      filters: filterSummary,
      sections: [
        {
          columns: [
            { key: 'logId', label: 'ID', width: 0.5 },
            { key: 'hazardId', label: 'Hazard', width: 0.7 },
            { key: 'hazardType', label: 'Hazard Type', width: 1.3 },
            { key: 'resolvedByUsername', label: 'Changed By', width: 1.2 },
            { key: 'statusChange', label: 'Status Change', width: 1.3 },
            { key: 'resolvedAt', label: 'Changed At', width: 1.6 },
          ],
          rows: rowsFormatted,
        },
      ],
    });
    if (exported) return;

    return res.status(200).json({ success: true, generatedAt: new Date().toISOString(), responses: rows });
  } catch (err) {
    console.error('Failed to generate hazard response report:', err);
    return res.status(500).json({ success: false, message: 'Internal server failure generating hazard response report.' });
  }
});

export default router;
