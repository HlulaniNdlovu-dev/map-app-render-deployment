// Pure SafeMaster risk-scoring functions, deliberately isolated from
// db.js/pool and everything else with I/O or env-var dependencies. This is
// the half of the routing engine that MUST behave identically to the
// frontend TS port (see frontend_v2/src/lib/safemaster.ts) — keeping it
// dependency-free means the parity test (__tests__/safemaster-parity.test.js)
// can import and run it with no DB, no env vars, no network.

export const INCIDENT_RADIUS_KM = 0.6;
export const W_INCIDENTS = 0.5;
export const W_AREAS = 0.3;
export const W_ALERTS = 0.2;

/** Haversine distance in km between two lat/lng points. */
export function haversineKm(lat1, lon1, lat2, lon2) {
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

/**
 * Sample ~every 250 m along a LineString coordinate array.
 * Returns an array of [lon, lat] pairs.
 */
export function sampleLine(coordinates) {
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

export function riskLevel(score) {
  if (score >= 70) return 'DANGEROUS';
  if (score >= 40) return 'WARNING';
  return 'SAFE';
}

/**
 * Scores a route path based on nearby incidents, risk areas, and alerts.
 * Returns { riskScore, riskLevelLabel, explanation, incidentsOnRoute, zonesPassed }
 */
export function scoreRoutePath(coordinates, startLocation, endLocation, { events, areas, alerts }) {
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
