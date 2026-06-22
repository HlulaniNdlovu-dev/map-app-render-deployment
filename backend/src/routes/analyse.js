import express from 'express';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { calculateAreaRisk, RISK_CATEGORIES } from '../services/assessRisk.js';

dotenv.config({ path: new URL('../.env', import.meta.url).pathname });

const router = express.Router();

router.get('/health', (req, res) => {
    res.json({ status: 'ok', route: '/api/analyse', apiKeyLoaded: !!process.env.OPENAI_API_KEY });
});

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY});
const MODEL  = 'gpt-4o-mini';

/* =============================================================
   POST /api/analyse
   Analyses a news article.
   Returns: { location, risk_category, summary }
============================================================= */
router.post('/', async (req, res) => {
    const { text } = req.body;

    if (!text) {
        return res.status(400).json({ error: 'No text provided.' });
    }

    try {
        const completion = await client.chat.completions.create({
            model: MODEL,
            messages: [
                {
                    role: 'system',
                    content: 'You are a risk assessment analyst for a route safety application in South Africa. Respond ONLY with valid JSON — no markdown, no explanation.'
                },
                {
                    role: 'user',
                    content: `Analyse this news article and return a JSON object with exactly these fields:
{
  "location": "the specific place mentioned (in a format usable in a map app)",
  "risk_category": "one of: Crime, Protest, Natural Disaster, Accident, Infrastructure, Civil Unrest, Other",
  "summary": "1 sentence plain English summary of what happened"
}

Article:
${text}`
                }
            ],
            response_format: { type: 'json_object' }
        });

        const rawContent = completion.choices?.[0]?.message?.content;
        if (!rawContent) {
            throw new Error('OpenAI returned no completion content.');
        }

        let parsed;
        try {
            parsed = JSON.parse(rawContent);
        } catch (parseError) {
            console.error('Failed to parse OpenAI response as JSON:', rawContent);
            throw new Error(`OpenAI response parse failed: ${parseError.message}`);
        }

        const category = parsed.risk_category || 'Other';
        const baseCategory = {
            Crime: RISK_CATEGORIES.VIOLENT_CRIME,
            Protest: RISK_CATEGORIES.CIVIL_UNREST,
            'Civil Unrest': RISK_CATEGORIES.CIVIL_UNREST,
            'Natural Disaster': RISK_CATEGORIES.ENVIRONMENTAL_HAZARDS,
            Accident: RISK_CATEGORIES.ENVIRONMENTAL_HAZARDS,
            Infrastructure: RISK_CATEGORIES.INFRASTRUCTURE_ISSUES,
            Other: RISK_CATEGORIES.INFRASTRUCTURE_ISSUES
        }[category] || RISK_CATEGORIES.INFRASTRUCTURE_ISSUES;

        const riskAssessment = calculateAreaRisk(baseCategory, 0);

        res.json({
            ...parsed,
            risk_score: riskAssessment.overallRiskScore,
            risk_level: riskAssessment.assessment,
            display_color: riskAssessment.displayColor
        });

    } catch (error) {
        console.error('AI analysis error:', error);
        res.status(500).json({ error: 'Failed to analyse article.', details: error.message });
    }
});

/* =============================================================
   POST /api/analyse/shorten
   Shortens a location string and incident description.
   Returns: { short_location, short_description }
============================================================= */
router.post('/shorten', async (req, res) => {
    const { location, description } = req.body;

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
        res.status(500).json({ error: 'Failed to shorten.' });
    }
});

/* =============================================================
   POST /api/analyse/safe_route
   Fetches real road routes via OSRM, then uses AI to pick the
   one that stays furthest from the provided danger zones.

   Body:
     start       [lng, lat]   — user's current position
     destination [lat, lng]   — destination (note order from MapPage)
     avoidPlaces [lng, lat][] — dangerous coordinates to avoid
   Returns: { coordinates: [lng, lat][] }
============================================================= */
router.post('/safe_route', async (req, res) => {
    const { start, destination, avoidPlaces } = req.body;

    if (!start || !destination) {
        return res.status(400).json({ error: 'start and destination are required.' });
    }

    const dangers = avoidPlaces || [];

    try {
        // Step 1: Fetch real road-following routes from OSRM (same engine as fetchRoutes in utils.ts)
        // OSRM expects: lng,lat;lng,lat
        // destination arrives as [lat, lng] from MapPage, so we flip it here
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/` +
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
        res.status(500).json({ error: 'Failed to generate safe route.' });
    }
});

export default router;