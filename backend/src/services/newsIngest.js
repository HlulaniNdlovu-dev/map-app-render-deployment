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
 * classifier's suggested location -> insert directly into hazard_report
 * (source='ai_confirmed', status='active') when a location resolves.
 * There is no separate review-queue table (ai_risk_candidates) in this
 * deployment — items with no resolvable location are skipped rather than
 * held for manual review, since they can't be placed on the map at all.
 * `userId` is the admin who triggered ingestion, recorded as the reporter.
 */
export async function ingestNews(userId) {
  const sourceUrl = process.env.NEWS_SOURCE_URL || 'https://www.iol.co.za/rss';

  const items = await fetchNewsItems(sourceUrl);
  const created = [];
  const skipped = [];
  const errors = [];

  for (const item of items) {
    try {
      const classification = await classifyArticleText(item.text);
      const geo = await geocodeForward(classification.location);

      if (!geo) {
        skipped.push({ url: item.url, title: item.title, reason: 'No resolvable location.' });
        continue;
      }

      const [result] = await pool.query(
        `INSERT INTO hazard_report (user_id, latitude, longitude, hazard_type, source, status, created_at)
         VALUES (?, ?, ?, ?, 'ai_confirmed', 'active', CONVERT_TZ(NOW(), @@session.time_zone, '+02:00'))`,
        [userId, geo.lat, geo.lng, classification.hazard_type]
      );

      created.push({
        hazardId: result.insertId,
        title: item.title,
        category: classification.hazard_type,
        confidence: classification.confidence,
        location: geo.formatted || classification.location,
      });
    } catch (err) {
      console.error('Failed to classify/store news item:', item.url, err.message);
      errors.push({ url: item.url, message: err.message });
    }
  }

  return { sourceUrl, itemsFound: items.length, created, skipped, errors };
}
