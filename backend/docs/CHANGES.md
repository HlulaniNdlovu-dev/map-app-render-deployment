# Changes — mapped to rubric marks

This documents everything delivered against the improvement brief in [`IMPROVEMENT-PLAN.md`](./IMPROVEMENT-PLAN.md),
organized by the same phases and explicitly labeled with which rubric category each phase
closes. See that file for the discovery/design reasoning behind each decision.

---

## Phase 1 — AI integration ("Live Risk Intelligence")

**Rubric: AI integration.**

- News ingestion (`src/services/newsIngest.js`) → LLM classification (`classifyNews.js`,
  GPT-4o-mini) → geocoding (`services/geocode.js`) → stored as a `pending` row in the new
  `ai_risk_candidates` table. The LLM never writes directly to live hazard data.
- A human (Admin or Data Analyst) reviews each candidate via `/ai-candidates` — **confirm**
  inserts a real `hazard_reports` row (`source='ai_confirmed'`); **reject** does nothing
  further. This human-in-the-loop step is the hallucination-mitigation mechanism — see
  [`AI-FEATURE.md`](./AI-FEATURE.md) for the full design writeup, category-mapping table, and
  privacy notes.
- All 4 `/api/ai/*` and `/api/analyse/*` endpoints locked down to Admin/Data Analyst only
  (previously unauthenticated).

## Phase 2 — Stored procedures

**Rubric: stored procedures.**

Three procedures, each atomically doing what used to be multiple separate queries from JS:

| Procedure | Replaces | New table it owns |
|---|---|---|
| `sp_create_staff_account` | Manual duplicate-check + 2 inserts in `auth.routes.js` | — |
| `sp_resolve_hazard` | Manual ownership-check + update in `hazards.route.js` | `hazard_resolution_log` (audit trail) |
| `sp_end_trip` | Manual update in `destination.routes.js` | `trip_summary` (duration computed server-side) |

Also: a shared JSON test-vector fixture (`backend/src/routes/__fixtures__/safemaster-vectors.json`,
byte-identical copy in `frontend_v2/src/lib/__fixtures__/`) with a `vitest` suite on **both**
ports asserting identical `riskScore`/`riskLevel`/`incidentsOnRoute` for the same input — the
parallel-port parity rule made mechanically enforceable. **This caught a real bug**: the
frontend's route-sampling function was index/count-based (capped at ~40 samples) while the
backend's was distance-based (~every 250m); for a dense real-world OSRM route the two could
silently disagree on which hazards count as "on the route." Fixed by making both distance-based.

## Phase 3 — Reports (filter, sort, export)

**Rubric: 4+ reports, each filtered, sorted, and exportable.**

| Report | New? | Filters | Sort |
|---|---|---|---|
| Safety Report | existing, retrofitted | date range, source (radio buttons) | count / name |
| Hotspot Report | existing, retrofitted | min. cluster size, include-resolved (checkbox) | count / lat / lng |
| Trip Completion Report | **new** | date range, driver, min/max duration | start time / duration |
| Hazard Response Report | **new** | date range, hazard type, new status | resolved date / hazard type |

All 4 export as CSV or PDF (`?format=csv\|pdf`). PDF exports are fully styled (branded
header band, section-colored tables, alternating row shading, page footer) and each carries
a plain-language description of what the report shows and how to read it, plus a summary of
whatever filters were applied — see `backend/src/services/export.js`.

## Phase 4 — Security, validation, resilience, secrets

**Rubric: security/validation/resilience, no secrets in the frontend bundle.**

- **Secrets**: removed hardcoded fallback values for DB credentials and `JWT_SECRET`
  (fail-fast at startup instead); Geoapify API key moved server-side behind a new
  `/api/geocode/*` proxy (was hardcoded in 4 frontend files, 8 call sites) — verified via
  `grep` over the production `dist/` bundle that the key no longer ships to the browser.
- **Resilience**: OSRM base URL now an env var (`OSRM_BASE_URL` / `VITE_OSRM_BASE_URL`) with
  a documented self-host path ([`OSRM-SELFHOST.md`](./OSRM-SELFHOST.md)); both routing ports
  retry OSRM requests with backoff on 5xx/network errors before falling back gracefully.
- **Validation**: every route that destructured `req.body` without a default (13 call sites
  across 5 files) has been fixed to `req.body || {}` — previously, a request with no body at
  all (e.g. `Content-Type` omitted) threw synchronously *before* the existing validation
  checks ever ran, producing a raw HTML stack-trace page instead of a clean error.
- **Global error handler + 404 JSON catch-all** added to `server.js` — any unhandled
  exception now returns clean JSON, never a leaked stack trace.
- **Auth test**: `src/__tests__/role-enforcement.test.js` proves a driver's JWT is rejected
  (403) by every staff-only route, and that a route meant for drivers still lets them through.
- **Seed data**: `src/db/seed.sql`, 10+ rows in every real table (50 users, 18 hazards, 12
  trips, 15 audit-log entries, 10 AI candidates, 12 notifications).
- **Bug found and fixed along the way**: the self-service "Change Password" field on the
  account page sent a new password to `PUT /api/users`, but the backend silently discarded
  it and always kept the old hash — password change had never actually worked. Fixed and
  verified end-to-end (old password stops working, new one starts working).

## Phase 5 — ERD

**Rubric: ERD reflecting the final schema.**

[`docs/schema.dbml`](./schema.dbml) (paste into dbdiagram.io) and [`docs/ERD.md`](./ERD.md)
(Mermaid diagram, renders directly on GitHub) both cover all 13 application tables and every
foreign key, generated *after* Phases 1/2/6 so nothing is missing. [`src/db/schema.sql`](../src/db/schema.sql)
is the canonical DDL the diagrams describe — validated by actually running it against the
live database.

## Phase 6 — Two proposal gaps

**Rubric: dynamic re-routing, persistent alerts.**

- **Dynamic re-routing**: `MapPage.tsx` now polls the existing SafeMaster check (`runCheck`)
  every 90 seconds while a trip is active, reusing the same toast-prompt UI the manual "AI
  SAFE PATH" button already used — no new scoring logic, so no parallel-port impact. A new
  "Alert Sensitivity" slider lets the driver set a minimum risk score before the poller
  bothers them.
- **Persistent alerts**: new `driver_notifications` table (deliberately **not** named
  `alerts` — the backend SafeMaster port has a dormant query against a table literally named
  `alerts` that silently no-ops today; naming this table that would have made it start
  pulling data into routing scores automatically while the frontend port wouldn't, breaking
  parity). Notification-only per the confirmed design decision. A hazard report now fans out
  a notification to every driver with a trip in progress; a new bell-icon `NotificationCenter`
  (light and dark variants) shows unread count, lets you mark read individually or all at once.

## Phase 7 — UI polish

**Rubric: page titles, FK dropdowns, 8+ varied form controls.**

- Every one of the 24 route-level pages now sets a distinct `document.title` via a shared
  `usePageTitle` hook (none did before).
- Two raw numeric "User ID" filter inputs (Hazard Reports, Driver Destinations admin pages)
  replaced with dropdowns showing `username (email)` instead of a number the admin would
  have to already know.
- 8 varied controls total: date-range pickers (×3 reports), a risk-threshold slider (map
  re-route sensitivity), a checkbox (hotspot report's "include resolved"), radio buttons
  (safety report's source filter), a confidence-threshold slider (AI candidates panel), plus
  the pre-existing map pin-drop, hazard-type picker, and drag marker.

## Phase 8 — Packaging

**Rubric: documentation/packaging.**

- [`backend/src/db/README.md`](../src/db/README.md) — SQL run order (schema → procedures → seed).
- This file.
- Root [`README.md`](../../README.md) covering both repos, setup, architecture, and features by role.

---

## Everything that was NOT touched (explicitly out of scope)

- `GroupC/backend_v2` — dead/legacy, superseded by this backend. Never modified.
- SafeMaster's actual routing/scoring math — only the *sampling* function's algorithm
  changed (fixed to match between ports); the risk-score formula itself is untouched.
- `risk_area` table — still dormant/unpopulated, matching the confirmed decision not to
  expand SafeMaster's scoring scope in this pass.
