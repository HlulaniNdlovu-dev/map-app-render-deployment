import express from 'express';
import OpenAI from 'openai';
import { authenticateToken } from '../middleware/auth.js';
import requireRole from '../middleware/role.js';
import { classifyArticleText } from '../services/classifyNews.js';

// env vars are loaded once, centrally, by src/env.js (server.js's first
// import) — no per-file dotenv.config() needed here anymore.

const router = express.Router();

// These endpoints call OpenAI on every request — unrestricted, anyone could
// burn API quota with no rate limit or role check. Restricted to the roles
// that actually use AI classification (Admin reviews the safety picture,
// Data Analyst reviews hotspots); drivers/traffic authority/security agency
// have no reason to call these directly.
const aiOnly = requireRole('admin', 'data_analyst');

router.get('/health', (req, res) => {
    res.json({ status: 'ok', route: '/api/analyse', apiKeyLoaded: !!process.env.OPENAI_API_KEY });
});

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY});
const MODEL  = 'gpt-4o-mini';

/* =============================================================
   POST /api/analyse
   Analyses a news article. Admin/Data Analyst only.
   Returns: { location, risk_category, summary, confidence, hazard_type,
              risk_score, risk_level, display_color }
============================================================= */
router.post('/', authenticateToken, aiOnly, async (req, res) => {
    const { text } = req.body || {};

    if (!text) {
        return res.status(400).json({ error: 'No text provided.' });
    }

    try {
        const result = await classifyArticleText(text);
        res.json(result);
    } catch (error) {
        console.error('AI analysis error:', error);
        res.status(502).json({ error: 'Failed to analyse article.', details: error.message });
    }
});

/* =============================================================
   POST /api/analyse/shorten
   Shortens a location string and incident description. Admin/Data Analyst only.
   Returns: { short_location, short_description }
============================================================= */
router.post('/shorten', authenticateToken, aiOnly, async (req, res) => {
    const { location, description } = req.body || {};

    if (!location || !description) {
        return res.status(400).json({ error: 'location and description are required.' });
    }

    try {
        const completion = await client.chat.completions.create({
            model: MODEL,
            messages: [
                {
                    role: 'system',
                    content: 'You are a data formatter for a route safety application in South Africa. Respond ONLY with valid JSON — no markdown, no explanation.'
                },
                {
                    role: 'user',
                    content: `Shorten the following and return a JSON object with exactly these fields:
{
  "short_location": "most meaningful part only, max 40 characters (e.g. street and suburb)",
  "short_description": "one sentence summary, max 80 characters"
}

Location: ${location}
Description: ${description}`
                }
            ],
            response_format: { type: 'json_object' }
        });

        const parsed = JSON.parse(completion.choices[0].message.content);
        res.json(parsed);

    } catch (error) {
        console.error('AI shorten error:', error);
        res.status(502).json({ error: 'Failed to shorten.' });
    }
});

/* =============================================================
   POST /api/analyse/safe_route
   Fetches real road routes via OSRM, then uses AI to pick the
   one that stays furthest from the provided danger zones.
   Admin/Data Analyst only (see docs/IMPROVEMENT-PLAN.md §2 — this is a
   separate, currently-unused-by-the-frontend AI routing mechanism,
   distinct from the SafeMaster deterministic scorer).

   Body:
     start       [lng, lat]   — user's current position
     destination [lat, lng]   — destination (note order from MapPage)
     avoidPlaces [lng, lat][] — dangerous coordinates to avoid
   Returns: { coordinates: [lng, lat][] }
============================================================= */
router.post('/safe_route', authenticateToken, aiOnly, async (req, res) => {
    const { start, destination, avoidPlaces } = req.body || {};

    if (!start || !destination) {
        return res.status(400).json({ error: 'start and destination are required.' });
    }

    const dangers = avoidPlaces || [];

    try {
        // Step 1: Fetch real road-following routes from OSRM (same engine as fetchRoutes in utils.ts)
        // OSRM expects: lng,lat;lng,lat
        // destination arrives as [lat, lng] from MapPage, so we flip it here
        const osrmBase = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org/route/v1/driving';
        const osrmUrl = `${osrmBase}/` +
                        `${start[0]},${start[1]};${destination[1]},${destination[0]}` +
                        `?overview=full&geometries=geojson&alternatives=true`;
        const osrmRes = await fetch(osrmUrl);
        if (!osrmRes.ok) throw new Error(`OSRM request failed: ${osrmRes.status}`);

        const osrmData = await osrmRes.json();
        const routes   = osrmData.routes;

        if (!routes?.length) {
            return res.status(404).json({ error: 'No routes found between these points.' });
        }

        // No danger zones, or only one route available — return immediately
        if (dangers.length === 0 || routes.length === 1) {
            return res.json({ coordinates: routes[0].geometry.coordinates });
        }

        // Step 2: Ask GPT to pick whichever route avoids the danger zones
        // Sample every 10th coordinate so the prompt stays small
        const routeSummaries = routes.map((r, i) => ({
            routeIndex: i,
            sampleCoordinates: r.geometry.coordinates.filter((_, idx) => idx % 10 === 0)
        }));

        const completion = await client.chat.completions.create({
            model: MODEL,
            messages: [
                {
                    role: 'system',
                    content: 'You are a route safety analyst for a navigation app in South Africa. Respond ONLY with valid JSON — no markdown, no explanation.'
                },
                {
                    role: 'user',
                    content: `You have ${routes.length} possible driving routes and a list of dangerous locations.
Choose the route index whose path stays furthest from ALL dangerous locations.

Dangerous locations [longitude, latitude]:
${JSON.stringify(dangers)}

Available routes (sampled [longitude, latitude] waypoints):
${JSON.stringify(routeSummaries)}

Return a JSON object with exactly these fields:
{
  "safeRouteIndex": <number>,
  "reason": "<one short sentence>"
}`
                }
            ],
            response_format: { type: 'json_object' }
        });

        const parsed     = JSON.parse(completion.choices[0].message.content);
        const chosen     = Number(parsed.safeRouteIndex);
        const safeIndex  = chosen < routes.length ? chosen : 0;

        res.json({ coordinates: routes[safeIndex].geometry.coordinates });

    } catch (error) {
        console.error('Safe route error:', error);
        res.status(502).json({ error: 'Failed to generate safe route.' });
    }
});

export default router;
