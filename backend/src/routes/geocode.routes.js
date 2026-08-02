import express from 'express';
import { geocodeForward, geocodeReverse } from '../services/geocode.js';

// Proxies Geoapify so the API key never has to ship in the frontend
// bundle. Public (no auth) — geocoding a place name isn't sensitive, and
// the frontend needs this on the login-gated map screen as well as
// destination search, which already requires being logged in anyway via
// the page itself, not this endpoint specifically.
const router = express.Router();

/**
 * GET /api/geocode/reverse?lat=&lon=
 */
router.get('/reverse', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) {
    return res.status(400).json({ success: false, message: 'lat and lon query parameters are required.' });
  }
  const latNum = Number(lat);
  const lonNum = Number(lon);
  if (Number.isNaN(latNum) || latNum < -90 || latNum > 90 || Number.isNaN(lonNum) || lonNum < -180 || lonNum > 180) {
    return res.status(400).json({ success: false, message: 'lat must be between -90 and 90, lon between -180 and 180.' });
  }

  const result = await geocodeReverse(latNum, lonNum);
  if (!result) {
    return res.status(502).json({ success: false, message: 'Could not resolve an address for these coordinates right now.' });
  }
  return res.status(200).json({ success: true, result });
});

/**
 * GET /api/geocode/autocomplete?text=
 * Same Geoapify autocomplete endpoint the frontend called directly
 * before — proxied through here now for the same key-hiding reason.
 */
router.get('/autocomplete', async (req, res) => {
  const { text } = req.query;
  if (!text || String(text).trim().length === 0) {
    return res.status(400).json({ success: false, message: 'text query parameter is required.' });
  }

  try {
    const key = process.env.GEOAPIFY_API_KEY;
    if (!key) {
      return res.status(500).json({ success: false, message: 'Geocoding is not configured on the server.' });
    }
    const resp = await fetch(
      `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(String(text))}&apiKey=${key}`
    );
    if (!resp.ok) {
      return res.status(502).json({ success: false, message: 'Address lookup is temporarily unavailable.' });
    }
    const data = await resp.json();
    return res.status(200).json({ success: true, features: data.features || [] });
  } catch (err) {
    console.error('Autocomplete proxy failed:', err.message);
    return res.status(502).json({ success: false, message: 'Address lookup is temporarily unavailable.' });
  }
});

/**
 * GET /api/geocode/search?text=
 * Forward geocoding (free text -> coordinates) — same shape as the
 * ai_risk_candidates ingestion pipeline uses internally, exposed here for
 * the frontend's own forward-geocode needs if any call site needs it.
 */
router.get('/search', async (req, res) => {
  const { text } = req.query;
  if (!text || String(text).trim().length === 0) {
    return res.status(400).json({ success: false, message: 'text query parameter is required.' });
  }
  const result = await geocodeForward(String(text));
  if (!result) {
    return res.status(502).json({ success: false, message: 'Could not resolve coordinates for that location right now.' });
  }
  return res.status(200).json({ success: true, result });
});

export default router;
