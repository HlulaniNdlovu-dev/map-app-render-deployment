# AI Feature — Live Risk Intelligence

## What it does

Public South African news is periodically checked for stories describing a
real, current, location-specific road-safety risk (a protest, a hijacking
hotspot, flooding, a serious accident, etc.). An LLM classifies each story;
a human (Admin or Data Analyst) reviews the classification and either
confirms it — which adds a real hazard to the live risk database that
SafeMaster routes around — or rejects it, which does nothing at all.

This closes a real gap: today, every hazard in the system comes from a
citizen, Traffic Authority, or Security Agency manually dropping a pin on a
map. Most road-safety-relevant news never reaches any of those people in
time. This feature turns publicly available news into the same kind of
actionable signal, without ever letting an LLM's output become "truth" on
its own.

## Why an LLM, and what it's worth to the business

Classifying free-text news into "is this a road-safety risk, where, and how
serious" is a task with no fixed vocabulary or format — the same protest
might be described as "service delivery unrest," "a march," or "residents
blocked the N3," and the location might be a suburb name, an intersection,
or a landmark. A rules/keyword-based classifier would need constant manual
tuning and would still miss most real phrasing. An LLM (`gpt-4o-mini`) reads
the story the way a person would and returns a structured answer: category,
location, one-line summary, and its own confidence — cheaply enough to run
on every ingested item.

**Business value:** every additional early, correctly-placed hazard makes
every driver's route safer without anyone having to manually watch the
news. The alternative — doing nothing until a citizen physically encounters
the danger and reports it — is strictly slower and strictly more dangerous.

## Data flow (3 tiers)

```
 [News source: RSS/Atom feed, or a single HTML article page as fallback]
                          │
                          ▼
        Backend (Express): services/newsIngest.js
        - fetches with a browser User-Agent (most SA news sites 403
          bare requests)
        - rss-parser for feeds; Cheerio for HTML-only sources
        - takes at most 5 items per ingestion run (cost control —
          this is manually triggered, not a cron job; see "why not
          scheduled" below)
                          │
                          ▼
        services/classifyNews.js → OpenAI (gpt-4o-mini)
        - one prompt per item: category, location, summary, confidence
        - shared with the pre-existing POST /api/analyse endpoint, so
          there's exactly one place the classification prompt lives
                          │
                          ▼
        services/geocode.js → Geoapify forward geocoding
        - "Sandton, Johannesburg" → {lat, lng}
        - failure here doesn't fail the whole item — a candidate with
          no resolved location is still stored, just can't be confirmed
          until it's rejected or re-ingested with a clearer source
                          │
                          ▼
        MySQL: ai_risk_candidates (status = 'pending')
                          │
                          ▼
     Frontend: Admin or Data Analyst reviews the queue in the "Live
     Risk Intelligence" panel — sees category, confidence, a map pin
     preview, the source link, and either:
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
     POST /confirm                POST /reject
              │                       │
     Backend transaction:        UPDATE ai_risk_candidates
     INSERT hazard_reports       SET status='rejected'
     (source='ai_confirmed')     — no other write happens at all
     UPDATE ai_risk_candidates
     SET status='confirmed'
              │
              ▼
     Live hazard — SafeMaster now scores routes against it
     exactly like any citizen/Traffic Authority/Security Agency report
```

## Hallucination mitigation

The core design decision: **an LLM output is never DML against
`hazard_reports` directly.** It lands in `ai_risk_candidates` first, which
is not read by SafeMaster or any report at all — a hallucinated location, a
misread category, or a fabricated "risk" simply sits in a review queue
until a person looks at it. Concretely:

- `confidence` is surfaced to the reviewer (0–100%), not hidden or acted on
  automatically — there is no confidence threshold above which a candidate
  auto-confirms.
- A candidate with no geocodable location literally cannot be confirmed —
  the confirm endpoint validates this server-side and returns a 400
  telling the reviewer to reject it instead, rather than guessing a
  location.
- Confirming is logged: `reviewed_by` and `reviewed_at` are recorded on the
  candidate, and the resulting hazard keeps a back-reference
  (`resulting_hazard_id`) — there's always an audit trail from a live
  hazard back to the specific person who approved it and the exact source
  text the LLM saw.
- Rejecting is a dead end by design — it updates one row and touches
  nothing else in the system. Verified live: rejecting a seeded test
  candidate did not create a hazard, and a second confirm attempt on an
  already-confirmed candidate is rejected with a 400, not silently
  re-applied.

## Data privacy

Only the public news item's text (headline + snippet/summary, or scraped
paragraph text for a single-article fallback) is sent to OpenAI. No driver
location, account information, trip history, or any other personal data is
part of any AI request in this feature — the classifier has no access to
anything from `user`, `driver`, `destination`, or any other table. This is
stated explicitly in the review panel itself, not just here.

## Access control

`POST /api/ai/ingest`, `GET /api/ai/candidates`,
`POST /api/ai/candidates/:id/confirm`, `POST /api/ai/candidates/:id/reject`
all require `authenticateToken` + `requireRole('admin', 'data_analyst')`.
The same lockdown was applied to the three previously-unauthenticated
`/api/analyse/*` endpoints while this feature was built, since they share
the same OpenAI billing and the same "who should be allowed to trigger
this" answer. Verified live: a driver token gets 403 from every one of
these routes; a request with no token at all gets 401.

## `classified_category` → `hazard_type` mapping

`hazard_reports.hazard_type` is free-text (see
`docs/IMPROVEMENT-PLAN.md` §4), constrained only by what the map's hazard
picker sends today. A confirmed AI candidate needs a value from that same
space:

| LLM `risk_category` | Stored `hazard_type` |
|---|---|
| Crime | `hijacking` |
| Protest | `protest` |
| Civil Unrest | `protest` |
| Natural Disaster | `flooding` |
| Accident | `accident` |
| Infrastructure | `road_closure` |
| Other | `other` |

## `source` value

Confirmed AI hazards are stored with `source = 'ai_confirmed'` — a fourth
value alongside the existing `citizen` / `traffic_authority` /
`security_agency`. No schema change was needed (`hazard_reports.source` is
an unconstrained `VARCHAR`), and every existing report that groups hazards
`BY source` (the Safety Report, and the new Hazard Response Report) picks
this up automatically.

## Why ingestion is manually triggered, not scheduled

Each ingestion run costs real OpenAI credits and hits a real news source.
The brief doesn't ask for scheduled ingestion, and a background poller
would need its own retry/backoff/rate-limit design that's out of scope
here — see `docs/IMPROVEMENT-PLAN.md` §5 for the explicit decision to keep
this a manually-triggered, small-batch (5 items/run) action for now.

## Known limitation, stated plainly

News source availability is itself a live external dependency, same as
OSRM and Geoapify — during development the configured default source
(`https://www.iol.co.za/rss`) needed a browser-style `User-Agent` header to
avoid a 403, and a different default previously tried
(`feeds.news24.com`) turned out to be discontinued/redirected. If the
configured `NEWS_SOURCE_URL` becomes unreachable at demo time, ingestion
fails per-item with a caught, descriptive error rather than crashing — see
the resilience pattern in `services/newsIngest.js`.
