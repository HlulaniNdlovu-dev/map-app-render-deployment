// Server-side Geoapify wrapper. Calling Geoapify from the backend (rather
// than the browser) means the API key never has to reach a client at all —
// this is the same shape Phase 4's frontend-facing geocode proxy will use,
// just consumed in-process here for AI candidate geocoding instead of over
// HTTP from the SPA.

const GEOAPIFY_BASE = 'https://api.geoapify.com/v1/geocode';

function getKey() {
  const key = process.env.GEOAPIFY_API_KEY;
  if (!key) throw new Error('GEOAPIFY_API_KEY is not configured.');
  return key;
}

/**
 * Forward-geocodes a free-text place description (e.g. "Sandton,
 * Johannesburg") to coordinates. Returns null rather than throwing when no
 * match is found or the API call fails — callers should treat a missing
 * location as "review this candidate without a map pin," not a hard error.
 */
export async function geocodeForward(query) {
  if (!query) return null;
  try {
    const key = getKey();
    const res = await fetch(
      `${GEOAPIFY_BASE}/search?text=${encodeURIComponent(query)}&format=json&apiKey=${key}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const point = data.results?.[0];
    if (!point) return null;
    return { lat: point.lat, lng: point.lon, formatted: point.formatted };
  } catch (err) {
    console.warn('Forward geocode failed:', err.message);
    return null;
  }
}

/** Reverse-geocodes coordinates to a formatted address. Same null-on-failure contract. */
export async function geocodeReverse(lat, lon) {
  try {
    const key = getKey();
    const res = await fetch(
      `${GEOAPIFY_BASE}/reverse?lat=${lat}&lon=${lon}&format=json&apiKey=${key}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.results?.[0] || null;
  } catch (err) {
    console.warn('Reverse geocode failed:', err.message);
    return null;
  }
}
