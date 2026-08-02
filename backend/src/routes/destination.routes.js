import express from 'express';
import pool from '../db/db.js';
import { haversineKm, sampleLine, riskLevel, scoreRoutePath, INCIDENT_RADIUS_KM } from '../lib/safemaster.js';

// ─────────────────────────────────────────────
// Constants (mirrored from SafeMaster route_optimizer.py)
// ─────────────────────────────────────────────
const OSRM_BASE = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org/route/v1/driving';
const BYPASS_OFFSET_KM = 2.2;


// ─────────────────────────────────────────────
// Geo Helpers
// ─────────────────────────────────────────────

/** Initial bearing (degrees) from point 1 to point 2. */
function bearingDeg(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Destination point from an origin, travelling a given bearing for distKm.
 * Returns [lon, lat].
 */
function destinationPoint(lat, lon, bearingDegrees, distKm) {
  const R = 6371;
  const d = distKm / R;
  const brng = (bearingDegrees * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );
  return [(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}

// ─────────────────────────────────────────────
// Database Context Loader
// (equivalent to _load_routing_context in Python)
// ─────────────────────────────────────────────

/**
 * Loads hazards (events), risk areas, and recent alerts from the database.
 * Maps group_c table names to SafeMaster concepts:
 *   hazards   → events  (latitude, longitude, hazardType maps to severity)
 *   risk_area → areas   (optional table; gracefully skips if absent)
 *   alerts    → alerts  (optional table; gracefully skips if absent)
 */
async function loadRoutingContext() {
  let events = [];
  let areas = [];
  let alerts = [];

  try {
    const [hazardRows] = await pool.query(
      "SELECT id, latitude, longitude, hazard_type AS hazardType, 1 AS severity FROM hazard_reports WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND status = 'active'"
    );
    events = hazardRows;
  } catch (err) {
    console.warn('Could not load hazards for routing context:', err.message);
  }

  // Optional risk_area table — skip gracefully if it doesn't exist
  try {
    const [areaRows] = await pool.query(
      'SELECT id, area_name, latitude, longitude, radius_km, risk_score FROM risk_area'
    );
    areas = areaRows;
  } catch (_) {
    // Table may not exist in this deployment
  }

  // Optional alerts table — skip gracefully if it doesn't exist
  try {
    const [alertRows] = await pool.query(
      'SELECT id, message, created_at FROM alerts ORDER BY created_at DESC LIMIT 20'
    );
    alerts = alertRows;
  } catch (_) {
    // Table may not exist in this deployment
  }

  return { events, areas, alerts };
}


// ─────────────────────────────────────────────
// OSRM Integration
// (equivalent to _fetch_osrm_path / _parse_osrm_routes in Python)
// ─────────────────────────────────────────────

function parseOsrmRoutes(data) {
  if (data?.code !== 'Ok') return [];
  return (data.routes || [])
    .filter((r) => r.geometry)
    .map((r, i) => ({
      index: i,
      distanceM: r.distance,
      durationS: r.duration,
      geojson: { type: 'Feature', geometry: r.geometry, properties: {} },
    }));
}

const OSRM_MAX_RETRIES = 2;
const OSRM_RETRY_BACKOFF_MS = [500, 1500];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches one OSRM path with retry-with-backoff for transient failures
 * (timeouts, 5xx, network blips). Still returns [] on final failure rather
 * than throwing — every caller already has a graceful fallback for that
 * (generateRoute's straight-line corridor, or the caller simply skipping a
 * detour candidate), so this never crashes a request; it just degrades.
 */
async function fetchOsrmPath(...waypoints) {
  if (waypoints.length < 2) return [];
  const path = waypoints.map(([lon, lat]) => `${lon},${lat}`).join(';');
  const alt = waypoints.length === 2 ? 'true' : 'false';
  const url = `${OSRM_BASE}/${path}?overview=full&geometries=geojson&alternatives=${alt}&steps=false`;

  for (let attempt = 0; attempt <= OSRM_MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!resp.ok) {
        // 4xx (bad request/coordinates) won't fix itself on retry — only
        // retry server-side/transient failures.
        if (resp.status < 500) return [];
        throw new Error(`OSRM responded ${resp.status}`);
      }
      return parseOsrmRoutes(await resp.json());
    } catch (err) {
      const isLastAttempt = attempt === OSRM_MAX_RETRIES;
      console.warn(`OSRM routing failed (attempt ${attempt + 1}/${OSRM_MAX_RETRIES + 1}):`, err.message);
      if (isLastAttempt) return [];
      await sleep(OSRM_RETRY_BACKOFF_MS[attempt] ?? 1500);
    }
  }
  return [];
}


// ─────────────────────────────────────────────
// Bypass / Detour Logic
// (equivalent to _bypass_via_points / _fetch_avoidance_routes in Python)
// ─────────────────────────────────────────────

function bypassViaPoints(incidents, startCoord, endCoord) {
  const [lon1, lat1] = startCoord;
  const [lon2, lat2] = endCoord;
  const corridorBearing = bearingDeg(lat1, lon1, lat2, lon2);
  const points = [];
  const seen = new Set();

  for (const ev of incidents.slice(0, 3)) {
    for (const distance of [BYPASS_OFFSET_KM, BYPASS_OFFSET_KM + 0.8]) {
      for (const offset of [90, -90, 120, -120]) {
        const [lon, lat] = destinationPoint(ev.latitude, ev.longitude, corridorBearing + offset, distance);
        const key = `${Math.round(lon * 1000)},${Math.round(lat * 1000)}`;
        if (!seen.has(key)) {
          seen.add(key);
          points.push([lon, lat]);
        }
      }
    }
  }

  const midLon = (lon1 + lon2) / 2;
  const midLat = (lat1 + lat2) / 2;
  for (const ev of incidents.slice(0, 2)) {
    const away = bearingDeg(ev.latitude, ev.longitude, midLat, midLon) + 180;
    const [lon, lat] = destinationPoint(ev.latitude, ev.longitude, away, BYPASS_OFFSET_KM);
    const key = `${Math.round(lon * 1000)},${Math.round(lat * 1000)}`;
    if (!seen.has(key)) {
      seen.add(key);
      points.push([lon, lat]);
    }
  }

  return points;
}

function buildCandidate(item, scoring, label, startLocation, endLocation) {
  return {
    label,
    geojson: {
      type: 'Feature',
      properties: {
        start: startLocation,
        end: endLocation,
        riskScore: scoring.riskScore,
        riskLevel: scoring.riskLevelLabel,
        label,
        distanceM: item.distanceM,
        durationS: item.durationS,
        incidentsOnRoute: scoring.incidentsOnRoute,
      },
      geometry: item.geojson.geometry,
    },
    riskScore: scoring.riskScore,
    riskLevelLabel: scoring.riskLevelLabel,
    explanation: scoring.explanation,
    incidentsOnRoute: scoring.incidentsOnRoute,
    distanceM: item.distanceM,
    durationS: item.durationS,
  };
}

async function fetchAvoidanceRoutes(startCoord, endCoord, incidents, startLocation, endLocation, ctx) {
  const candidates = [];
  const viaPoints = bypassViaPoints(incidents, startCoord, endCoord);
  // Scoped context used only to count hits against the specific hazards
  // this detour is meant to avoid — see note below.
  const blockingCtx = { events: incidents, areas: [], alerts: [] };

  for (const via of viaPoints.slice(0, 8)) {
    for (const osrmItem of await fetchOsrmPath(startCoord, via, endCoord)) {
      const coords = osrmItem.geojson.geometry.coordinates;
      const scoring = scoreRoutePath(coords, startLocation, endLocation, ctx);
      // Gate on hits against the incidents this detour was built to avoid,
      // not the total incident count city-wide — a detour that clears the
      // incidents blocking the direct route is a real improvement even if
      // it happens to pass near some unrelated incident elsewhere. Gating
      // on the total count instead rejected every detour whenever any
      // other incident existed nearby, which is exactly the case for
      // incidents close to the user's own starting point (a dense local
      // cluster), while long trips rarely pass near unrelated incidents.
      const blockingHits = scoreRoutePath(coords, startLocation, endLocation, blockingCtx).incidentsOnRoute;
      if (blockingHits >= incidents.length) continue;
      const label =
        scoring.incidentsOnRoute === 0
          ? 'Safer detour (clear of hazards)'
          : 'Detour avoiding hazards';
      candidates.push(buildCandidate(osrmItem, scoring, label, startLocation, endLocation));
    }
  }

  if (incidents.length >= 2) {
    const [via0, via1] = viaPoints;
    for (const osrmItem of await fetchOsrmPath(startCoord, via0, via1, endCoord)) {
      const coords = osrmItem.geojson.geometry.coordinates;
      const scoring = scoreRoutePath(coords, startLocation, endLocation, ctx);
      const blockingHits = scoreRoutePath(coords, startLocation, endLocation, blockingCtx).incidentsOnRoute;
      if (blockingHits === 0) {
        candidates.push(
          buildCandidate(osrmItem, scoring, 'Multi-point detour (clear of hazards)', startLocation, endLocation)
        );
      }
    }
  }

  return candidates;
}


// ─────────────────────────────────────────────
// Route Generation  (core of SafeMaster generate_route)
// ─────────────────────────────────────────────

function geometryKey(geojson) {
  const coords = geojson?.geometry?.coordinates || [];
  if (coords.length < 2) return '';
  const first = coords[0];
  const mid = coords[Math.floor(coords.length / 2)];
  const last = coords[coords.length - 1];
  return `${Math.round(first[0] * 1e4)}:${Math.round(first[1] * 1e4)}:${Math.round(mid[0] * 1e4)}:${Math.round(mid[1] * 1e4)}:${Math.round(last[0] * 1e4)}:${Math.round(last[1] * 1e4)}:${coords.length}`;
}

function labelCandidates(candidates) {
  if (!candidates.length) return;
  candidates.forEach((c, i) => {
    const inc = c.incidentsOnRoute || 0;
    if (i === 0) {
      c.label = inc === 0 ? 'Safest route (clear of hazards)' : `Best available route (${inc} hazard(s) nearby)`;
    } else if (inc === 0 && !(c.label || '').toLowerCase().includes('detour')) {
      c.label = 'Alternate route avoiding hazards';
    } else if (inc > 0 && !c.label) {
      c.label = `Alternative route (${inc} hazard(s) nearby)`;
    }
    c.geojson.properties.label = c.label;
    if (i === 0 && inc > 0 && candidates.slice(1).some((a) => (a.incidentsOnRoute || 99) === 0)) {
      c.explanation += ' A clearer alternate route is available — compare options below.';
    }
  });
}

/**
 * Core route generation function.
 * Equivalent to SafeMaster's generate_route().
 * startCoord and endCoord are [lon, lat] tuples.
 */
async function generateRoute(startLocation, endLocation, startCoord, endCoord) {
  const ctx = await loadRoutingContext();
  const { events } = ctx;
  const candidates = [];
  const seenKeys = new Set();

  function addCandidate(candidate) {
    const key = geometryKey(candidate.geojson);
    if (key && seenKeys.has(key)) return;
    if (key) seenKeys.add(key);
    candidates.push(candidate);
  }

  // 1. Fetch OSRM routes (direct + alternatives)
  const osrmRoutes = await fetchOsrmPath(startCoord, endCoord);
  if (osrmRoutes.length) {
    for (let i = 0; i < osrmRoutes.length; i++) {
      const item = osrmRoutes[i];
      const coords = item.geojson.geometry.coordinates;
      const scoring = scoreRoutePath(coords, startLocation, endLocation, ctx);
      const label = i === 0 ? 'Direct route' : `OSRM alternative ${i}`;
      addCandidate(buildCandidate(item, scoring, label, startLocation, endLocation));
    }
  } else {
    // Straight-line fallback when OSRM is unreachable
    const mid = [
      Math.round(((startCoord[0] + endCoord[0]) / 2) * 1e6) / 1e6,
      Math.round(((startCoord[1] + endCoord[1]) / 2) * 1e6) / 1e6,
    ];
    const coords = [startCoord, mid, endCoord];
    const scoring = scoreRoutePath(coords, startLocation, endLocation, ctx);
    addCandidate({
      label: 'Direct corridor (offline routing)',
      geojson: {
        type: 'Feature',
        properties: { label: 'Direct corridor (offline routing)' },
        geometry: { type: 'LineString', coordinates: coords },
      },
      riskScore: scoring.riskScore,
      riskLevelLabel: scoring.riskLevelLabel,
      explanation: scoring.explanation,
      incidentsOnRoute: scoring.incidentsOnRoute,
    });
  }

  // 2. Identify blocking hazards near the primary route
  let blocking = [];
  if (candidates.length) {
    const refCoords = candidates[0].geojson.geometry.coordinates;
    const samples = sampleLine(refCoords);
    const hits = {};
    for (const [lon, lat] of samples) {
      for (const ev of events) {
        if (haversineKm(lat, lon, ev.latitude, ev.longitude) <= INCIDENT_RADIUS_KM) {
          hits[ev.id] = ev;
        }
      }
    }
    blocking = Object.values(hits).sort((a, b) => b.severity - a.severity);
  }
  if (!blocking.length) {
    const lineSamples = sampleLine([startCoord, endCoord]);
    const hits = {};
    for (const [lon, lat] of lineSamples) {
      for (const ev of events) {
        if (haversineKm(lat, lon, ev.latitude, ev.longitude) <= INCIDENT_RADIUS_KM) {
          hits[ev.id] = ev;
        }
      }
    }
    blocking = Object.values(hits).sort((a, b) => b.severity - a.severity);
  }

  // 3. Generate detour candidates around blocking hazards
  if (blocking.length) {
    const detours = await fetchAvoidanceRoutes(
      startCoord, endCoord, blocking, startLocation, endLocation, ctx
    );
    for (const d of detours) addCandidate(d);
  }

  // 4. Sort and label
  candidates.sort(
    (a, b) =>
      (a.incidentsOnRoute || 999) - (b.incidentsOnRoute || 999) ||
      a.riskScore - b.riskScore ||
      (a.distanceM || 0) - (b.distanceM || 0)
  );
  labelCandidates(candidates);

  const best = candidates[0];
  const alternatives = candidates.slice(1, 6);

  return {
    startLocation,
    endLocation,
    startLat: startCoord[1],
    startLng: startCoord[0],
    endLat: endCoord[1],
    endLng: endCoord[0],
    riskScore: best.riskScore,
    riskLevel: best.riskLevelLabel,
    explanation: best.explanation,
    incidentsOnRoute: best.incidentsOnRoute || 0,
    geojson: best.geojson,
    alternatives: alternatives.map((alt) => ({
      label: alt.label,
      riskScore: alt.riskScore,
      riskLevel: alt.riskLevelLabel,
      explanation: alt.explanation || '',
      incidentsOnRoute: alt.incidentsOnRoute || 0,
      geojson: alt.geojson,
      distanceM: alt.distanceM,
      durationS: alt.durationS,
    })),
  };
}


// ─────────────────────────────────────────────
// Express Routers
// (original group_c structure, now with rerouting)
// ─────────────────────────────────────────────

const normalUserRouter = express.Router();

/**
 * POST /api/normal-user/destinations
 * Logs a new route AND returns a smart, risk-scored route generated by the
 * SafeMaster rerouting engine. Requires { startLocation, endLocation,
 * startLng, startLat, endLng, endLat } in the request body.
 * startLng/startLat/endLng/endLat are optional — if omitted, OSRM will still
 * attempt routing using a gazetteer lookup (not yet implemented here; pass
 * coordinates for reliable results).
 */
normalUserRouter.post('/', async (req, res) => {
  const { startLocation, endLocation, startLng, startLat, endLng, endLat } = req.body || {};
  const userId = req.id;

  if (typeof startLocation !== 'string' || typeof endLocation !== 'string' || !startLocation.trim() || !endLocation.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Missing startLocation or endLocation parameters.',
    });
  }

  try {
    // Persist independently of route generation. The map page already generates
    // its route client-side and sends only the two location labels, so requiring
    // coordinates here previously rejected every valid destination submission.
    const [result] = await pool.query(
      `INSERT INTO destination (user_id, start_location, end_location) VALUES (?, ?, ?)`,
      [userId, startLocation.trim(), endLocation.trim()]
    );

    const hasCoordinates = [startLng, startLat, endLng, endLat].every(
      (value) => value != null && Number.isFinite(Number(value))
    );

    // Preserve route-generation support for callers that provide coordinates,
    // but never roll back a successfully saved destination when routing fails.
    if (hasCoordinates) {
      try {
        const route = await generateRoute(
          startLocation.trim(),
          endLocation.trim(),
          [Number(startLng), Number(startLat)],
          [Number(endLng), Number(endLat)]
        );
        return res.status(201).json({
          success: true,
          message: 'Destination saved and route generated successfully.',
          logId: result.insertId,
          route,
        });
      } catch (routeError) {
        console.warn('Destination saved, but route generation failed:', routeError.message);
      }
    }

    return res.status(201).json({
      success: true,
      message: 'Destination saved successfully.',
      logId: result.insertId,
    });
  } catch (err) {
    console.error('Destination tracking failure:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal server failure while saving the destination.',
    });
  }
});

/**
 * GET /api/normal-user/destinations
 * Returns historical route logs for the authenticated user.
 */
normalUserRouter.get('/', async (req, res) => {
  const userId = req.id
  try {
    const [rows] = await pool.query(
      `SELECT id,
              start_location AS startLocation,
              end_location   AS endLocation,
              ended_at       AS endedAt,
              created_at     AS createdAt
       FROM destination
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );
    return res.status(200).json(rows);
  } catch (err) {
    console.error('Failed to query destination logs:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal server data retrieval failure.',
    });
  }
});

/**
 * PATCH /api/normal-user/destinations/:id/end
 * Marks a logged trip as completed (the "End Trip" use case) — records
 * when the driver actually reached their destination. Scoped to the
 * authenticated user's own trip.
 */
normalUserRouter.patch('/:id/end', async (req, res) => {
  const { id } = req.params;
  const connection = await pool.getConnection();
  try {
    // sp_end_trip does the ownership check + ended_at update + trip_summary
    // insert (with a server-computed duration) atomically in one transaction.
    await connection.query(
      'CALL sp_end_trip(?, ?, @p_status, @p_duration)',
      [id, req.id]
    );
    const [[out]] = await connection.query('SELECT @p_status AS status, @p_duration AS durationSeconds');

    if (out.status === 'NOT_FOUND' || out.status === 'FORBIDDEN') {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }
    if (out.status === 'ALREADY_ENDED') {
      return res.status(400).json({ success: false, message: 'Trip has already been ended.' });
    }
    if (out.status !== 'OK') {
      return res.status(500).json({ success: false, message: 'Internal server failure ending trip.' });
    }

    return res.status(200).json({ success: true, message: 'Trip ended.', durationSeconds: out.durationSeconds });
  } catch (err) {
    console.error('Failed to end trip:', err);
    return res.status(500).json({ success: false, message: 'Internal server failure ending trip.' });
  } finally {
    connection.release();
  }
});

/**
 * POST /api/normal-user/destinations/generate
 * Generates a risk-scored route WITHOUT persisting a log entry.
 * Useful for previewing routes before confirming a journey.
 */
normalUserRouter.post('/generate', async (req, res) => {
  const { startLocation, endLocation, startLng, startLat, endLng, endLat } = req.body || {};

  if (!startLocation || !endLocation || startLng == null || startLat == null || endLng == null || endLat == null) {
    return res.status(400).json({
      success: false,
      message: 'startLocation, endLocation, startLng, startLat, endLng, endLat are all required.',
    });
  }

  try {
    const routeResult = await generateRoute(
      startLocation,
      endLocation,
      [parseFloat(startLng), parseFloat(startLat)],
      [parseFloat(endLng), parseFloat(endLat)]
    );
    return res.status(200).json({ success: true, route: routeResult });
  } catch (err) {
    console.error('Route generation failure:', err);
    return res.status(502).json({
      success: false,
      message: 'Could not generate route. Try different locations.',
    });
  }
});


// ─────────────────────────────────────────────

const adminRouter = express.Router();

/**
 * GET /api/admin-user/destinations/a
 * Global audit log of all destination records across all users.
 */
adminRouter.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT d.id,
              d.user_id         AS userId,
              u.username,
              u.email,
              u.firstname,
              u.lastname,
              d.start_location  AS startLocation,
              d.end_location    AS endLocation,
              d.hazard_bypassed AS hazardBypassed,
              d.ended_at        AS endedAt,
              d.created_at      AS createdAt
       FROM destination d
       INNER JOIN user u ON d.user_id = u.user_id
       ORDER BY d.created_at DESC`
    );
    return res.status(200).json(rows);
  } catch (err) {
    console.error('Admin destination pull failure:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal server analytical compilation failure.',
    });
  }
});

adminRouter.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await pool.query('DELETE FROM destination WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Target log entry not found.' });
    }
    return res.status(200).json({
      success: true,
      message: `Log entry ${id} successfully removed.`,
    });
  } catch (err) {
    console.error('Admin deletion failure:', err);
    return res.status(500).json({ success: false, message: 'Internal log deletion failure.' });
  }
});
export { adminRouter, normalUserRouter };
