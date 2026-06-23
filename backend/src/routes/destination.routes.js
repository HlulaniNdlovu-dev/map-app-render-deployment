import express from 'express';
import pool from '../db/db.js';

// ─────────────────────────────────────────────
// Constants (mirrored from SafeMaster route_optimizer.py)
// ─────────────────────────────────────────────
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';
const INCIDENT_RADIUS_KM = 0.6;
const BYPASS_OFFSET_KM = 2.2;
const W_INCIDENTS = 0.5;
const W_AREAS = 0.3;
const W_ALERTS = 0.2;


// ─────────────────────────────────────────────
// Geo Helpers
// ─────────────────────────────────────────────

/** Haversine distance in km between two lat/lng points. */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

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

/**
 * Sample ~every 250 m along a LineString coordinate array.
 * Returns an array of [lon, lat] pairs.
 */
function sampleLine(coordinates) {
  if (!coordinates || coordinates.length === 0) return [];
  const STEP_KM = 0.25;
  const samples = [coordinates[0]];
  let accumulated = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const [lon1, lat1] = coordinates[i - 1];
    const [lon2, lat2] = coordinates[i];
    const seg = haversineKm(lat1, lon1, lat2, lon2);
    accumulated += seg;
    if (accumulated >= STEP_KM) {
      samples.push(coordinates[i]);
      accumulated = 0;
    }
  }
  if (samples[samples.length - 1] !== coordinates[coordinates.length - 1]) {
    samples.push(coordinates[coordinates.length - 1]);
  }
  return samples;
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
      'SELECT id, latitude, longitude, hazard_type AS hazardType, 1 AS severity FROM hazard_report WHERE latitude IS NOT NULL AND longitude IS NOT NULL'
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
// Risk Scoring
// (equivalent to _score_route_path in Python)
// ─────────────────────────────────────────────

function riskLevel(score) {
  if (score >= 70) return 'DANGEROUS';
  if (score >= 40) return 'WARNING';
  return 'SAFE';
}

/**
 * Scores a route path based on nearby incidents, risk areas, and alerts.
 * Returns { riskScore, riskLevelLabel, explanation, incidentsOnRoute, zonesPassed }
 */
function scoreRoutePath(coordinates, startLocation, endLocation, { events, areas, alerts }) {
  const samples = sampleLine(coordinates);
  const incidentIds = new Set();
  const areaScores = [];
  const alertIds = new Set();
  const riskZonesPassed = [];

  for (const [lon, lat] of samples) {
    for (const ev of events) {
      if (haversineKm(lat, lon, ev.latitude, ev.longitude) <= INCIDENT_RADIUS_KM) {
        incidentIds.add(ev.id);
      }
    }
    for (const area of areas) {
      if (area.latitude == null || area.longitude == null) continue;
      const radius = area.radius_km || 2.5;
      if (haversineKm(lat, lon, area.latitude, area.longitude) <= radius) {
        areaScores.push(area.risk_score);
        if (!riskZonesPassed.includes(area.area_name)) {
          riskZonesPassed.push(area.area_name);
        }
      }
    }
  }

  for (const alert of alerts) {
    const msg = (alert.message || '').toLowerCase();
    if (riskZonesPassed.some((z) => msg.includes(z.toLowerCase()))) {
      alertIds.add(alert.id);
    }
  }

  const incidentHits = incidentIds.size;
  const alertHits = alertIds.size;
  const avgArea =
    areaScores.length > 0
      ? areaScores.reduce((a, b) => a + b, 0) / areaScores.length
      : 25.0; // default neutral score when no area data

  const incidentComponent = Math.min(100.0, incidentHits * 12.0);
  const alertComponent = Math.min(100.0, alertHits * 25.0);
  const riskScore = Math.round(
    Math.min(100.0, incidentComponent * W_INCIDENTS + avgArea * W_AREAS + alertComponent * W_ALERTS) * 100
  ) / 100;

  const level = riskLevel(riskScore);
  const reasons = [];
  if (incidentHits) reasons.push(`${incidentHits} hazard(s) near the route`);
  if (riskZonesPassed.length) {
    const high = riskZonesPassed.filter(
      (z) => (areas.find((a) => a.area_name === z)?.risk_score ?? 0) >= 40
    );
    if (high.length) reasons.push(`passes through ${high.slice(0, 3).join(', ')}`);
  }
  if (alertHits) reasons.push(`${alertHits} active alert(s) affect this corridor`);

  let explanation;
  if (level === 'SAFE') {
    explanation = `Low-risk corridor from ${startLocation} to ${endLocation}. ${reasons[0] || 'No major hazards or high-risk zones detected.'}`;
  } else if (level === 'WARNING') {
    explanation = `Moderate risk route: ${reasons.join('; ') || 'some alerts nearby'}.`;
  } else {
    explanation = `High-risk route — avoid if possible: ${reasons.join('; ') || 'elevated area scores'}.`;
  }

  return { riskScore, riskLevelLabel: level, explanation, incidentsOnRoute: incidentHits, zonesPassed: riskZonesPassed };
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

async function fetchOsrmPath(...waypoints) {
  if (waypoints.length < 2) return [];
  const path = waypoints.map(([lon, lat]) => `${lon},${lat}`).join(';');
  const alt = waypoints.length === 2 ? 'true' : 'false';
  const url = `${OSRM_BASE}/${path}?overview=full&geometries=geojson&alternatives=${alt}&steps=false`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!resp.ok) return [];
    return parseOsrmRoutes(await resp.json());
  } catch (err) {
    console.warn('OSRM routing failed:', err.message);
    return [];
  }
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

  for (const via of viaPoints.slice(0, 8)) {
    for (const osrmItem of await fetchOsrmPath(startCoord, via, endCoord)) {
      const coords = osrmItem.geojson.geometry.coordinates;
      const scoring = scoreRoutePath(coords, startLocation, endLocation, ctx);
      if (scoring.incidentsOnRoute >= incidents.length) continue;
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
      if (scoring.incidentsOnRoute === 0) {
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
  const { startLocation, endLocation, startLng, startLat, endLng, endLat } = req.body;
  const userId = req.id || 5;

  if (!startLocation || !endLocation) {
    return res.status(400).json({
      success: false,
      message: 'Missing startLocation or endLocation parameters.',
    });
  }

  // Coordinates are required for full route generation.
  if (startLng == null || startLat == null || endLng == null || endLat == null) {
    return res.status(400).json({
      success: false,
      message: 'Missing coordinate parameters (startLng, startLat, endLng, endLat).',
    });
  }

  try {
    // 1. Generate the safest route using the rerouting engine
    const routeResult = await generateRoute(
      startLocation,
      endLocation,
      [parseFloat(startLng), parseFloat(startLat)],
      [parseFloat(endLng), parseFloat(endLat)]
    );

    // 2. Persist the destination log
    const [result] = await pool.query(
      `INSERT INTO destination (user_id, start_location, end_location) VALUES (?, ?, ?)`,
      [userId, startLocation, endLocation]
    );

    return res.status(201).json({
      success: true,
      message: 'Route generated and destination tracked successfully.',
      logId: result.insertId,
      route: routeResult,
    });
  } catch (err) {
    console.error('Route generation or tracking failure:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal server failure during route generation.',
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
 * POST /api/normal-user/destinations/generate
 * Generates a risk-scored route WITHOUT persisting a log entry.
 * Useful for previewing routes before confirming a journey.
 */
normalUserRouter.post('/generate', async (req, res) => {
  const { startLocation, endLocation, startLng, startLat, endLng, endLat } = req.body;

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
