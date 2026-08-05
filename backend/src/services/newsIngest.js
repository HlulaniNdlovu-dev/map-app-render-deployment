import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import pool from '../db/db.js';
import { classifyArticleText } from './classifyNews.js';
import { geocodeForward } from './geocode.js';

const rssParser = new Parser();

// Kept small deliberately — classification burns real OpenAI credits per
// item, and this is a manually-triggered review feature, not a background
// cron job. An admin can just trigger ingestion again for more.
const MAX_ITEMS_PER_INGEST = 5;

// Most SA news sites 403 (or redirect-loop) a request with no User-Agent —
// this isn't optional. Fetching ourselves (rather than rss-parser's own
// parseURL) also lets the same header cover both the RSS path and the
// Cheerio HTML fallback below.
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

/**
 * Pulls recent items from NEWS_SOURCE_URL, prefers RSS/Atom parsing, and
 * falls back to a generic HTML scrape (Cheerio) for a single-article page
 * when the source isn't a feed at all. Returns [{ title, text, url }].
 */
async function fetchNewsItems(sourceUrl) {
  try {
    const res = await fetch(sourceUrl, { headers: FETCH_HEADERS, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const feed = await rssParser.parseString(xml);
    return (feed.items || [])
      .slice(0, MAX_ITEMS_PER_INGEST)
      .map((item) => ({
        title: item.title || '',
        text: [item.title, item.contentSnippet || item.content].filter(Boolean).join('. '),
        url: item.link || sourceUrl,
      }))
      .filter((item) => item.text.trim().length > 0);
  } catch (rssError) {
    console.warn(`Source did not parse as RSS/Atom (${rssError.message}); falling back to HTML scrape.`);
  }

  // Fallback: treat the URL as a single article page and pull visible text
  // out of the most common article containers.
  try {
    const res = await fetch(sourceUrl, { headers: FETCH_HEADERS, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const title = $('title').first().text().trim() || $('h1').first().text().trim();
    const container = $('article').length ? $('article') : $('body');
    const paragraphs = container
      .find('p')
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((t) => t.length > 40); // skip nav/footer boilerplate fragments

    const text = [title, ...paragraphs.slice(0, 10)].filter(Boolean).join('. ');
    if (!text.trim()) return [];

    return [{ title, text, url: sourceUrl }];
  } catch (htmlError) {
    console.error('HTML fallback scrape also failed:', htmlError.message);
    return [];
  }
}

/**
 * Full ingestion pass: fetch -> classify each item -> geocode the
 * classifier's suggested location -> insert as a PENDING candidate. Never
 * writes to hazard_reports directly.
 */
export async function ingestNews() {
  const sourceUrl = process.env.NEWS_SOURCE_URL || 'https://www.iol.co.za/rss';

  const items = await fetchNewsItems(sourceUrl);
  const created = [];
  const errors = [];

  for (const item of items) {
    try {
      const classification = await classifyArticleText(item.text);
      const geo = await geocodeForward(classification.location);

      const [result] = await pool.query(
        `INSERT INTO ai_risk_candidate
           (raw_source_text, source_url, classified_category, confidence,
            suggested_lat, suggested_lng, suggested_location_text, summary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.text.slice(0, 4000),
          item.url,
          classification.hazard_type,
          classification.confidence,
          geo?.lat ?? null,
          geo?.lng ?? null,
          classification.location,
          classification.summary,
        ]
      );

      created.push({
        candidateId: result.insertId,
        title: item.title,
        category: classification.hazard_type,
        confidence: classification.confidence,
        hasLocation: !!geo,
      });
    } catch (err) {
      console.error('Failed to classify/store news item:', item.url, err.message);
      errors.push({ url: item.url, message: err.message });
    }
  }

  return { sourceUrl, itemsFound: items.length, created, errors };
}
