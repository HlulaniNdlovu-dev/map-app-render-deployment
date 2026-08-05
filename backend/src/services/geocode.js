// Server-side Geoapify wrapper. Calling Geoapify from the backend (rather
// than the browser) means the API key never has to reach a client at all.

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
      `${GEOAPIFY_BASE}/search?text=${encodeURIComponent(query)}&filter=countrycode:za&format=json&apiKey=${key}`
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
