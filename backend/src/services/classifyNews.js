import OpenAI from 'openai';
import { calculateAreaRisk, RISK_CATEGORIES } from './assessRisk.js';

// AI_PROVIDER=openai uses OpenAI's hosted API (needs a valid OPENAI_API_KEY).
// AI_PROVIDER=ollama (default) talks to a local Ollama server instead — no
// API key or network egress required, useful when OPENAI_API_KEY isn't
// working. Ollama exposes an OpenAI-compatible endpoint, so the same
// client/JSON-mode call shape works for both; only baseURL/model differ.
const PROVIDER = (process.env.AI_PROVIDER || 'ollama').toLowerCase();
const MODEL = PROVIDER === 'openai'
  ? (process.env.OPENAI_MODEL || 'gpt-4o-mini')
  : (process.env.OLLAMA_MODEL || 'gemma3:4b');

let client = null;
function getClient() {
  if (client) return client;
  client = PROVIDER === 'openai'
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : new OpenAI({
        apiKey: 'ollama', // unused by Ollama, but the SDK requires a non-empty value
        baseURL: `${process.env.OLLAMA_BASE_URL || 'http://localhost:11434'}/v1`,
      });
  return client;
}

const CATEGORY_TO_BASE_RISK = {
  Crime: RISK_CATEGORIES.VIOLENT_CRIME,
  Protest: RISK_CATEGORIES.CIVIL_UNREST,
  'Civil Unrest': RISK_CATEGORIES.CIVIL_UNREST,
  'Natural Disaster': RISK_CATEGORIES.ENVIRONMENTAL_HAZARDS,
  Accident: RISK_CATEGORIES.ENVIRONMENTAL_HAZARDS,
  Infrastructure: RISK_CATEGORIES.INFRASTRUCTURE_ISSUES,
  Other: RISK_CATEGORIES.INFRASTRUCTURE_ISSUES,
};

// A third taxonomy: hazard_reports.hazard_type is free-text, constrained
// only by what the map UI's hazard-type picker sends today. This is the
// mapping a confirmed AI candidate uses to become a valid hazard_type.
export const CATEGORY_TO_HAZARD_TYPE = {
  Crime: 'hijacking',
  Protest: 'protest',
  'Civil Unrest': 'protest',
  'Natural Disaster': 'flooding',
  Accident: 'accident',
  Infrastructure: 'road_closure',
  Other: 'other',
};

/**
 * Sends free text to the classifier and returns a structured risk
 * assessment. Used by the news ingestion pipeline.
 */
export async function classifyArticleText(text) {
  const completion = await getClient().chat.completions.create({
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
  "summary": "1 sentence plain English summary of what happened",
  "confidence": "a number from 0 to 1 for how confident you are this article describes a real, specific, current road-safety-relevant risk at a specific location (not a vague/old/unrelated story)"
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
    throw new Error(`OpenAI response parse failed: ${parseError.message}`);
  }

  const category = parsed.risk_category || 'Other';
  const baseCategory = CATEGORY_TO_BASE_RISK[category] || RISK_CATEGORIES.INFRASTRUCTURE_ISSUES;
  const riskAssessment = calculateAreaRisk(baseCategory, 0);

  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5));

  return {
    location: parsed.location || null,
    risk_category: category,
    summary: parsed.summary || '',
    confidence,
    hazard_type: CATEGORY_TO_HAZARD_TYPE[category] || 'other',
    risk_score: riskAssessment.overallRiskScore,
    risk_level: riskAssessment.assessment,
    display_color: riskAssessment.displayColor,
  };
}
