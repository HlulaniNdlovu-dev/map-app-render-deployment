# Mapper — Improvement Plan (Phase 0 output)

Status: **discovery complete, no code changed.** This document is the required
checkpoint before Phase 1 begins. Everything below is verified against the
actual repo and the live database as of this writing, not against the brief's
summary (the brief itself says to prefer ground truth where they disagree —
they disagree in a few places, flagged below).

---

## 0. Repo topology — read this first

**The system spans two separate git repositories, not one.** This changes
where several brief deliverables live and needs a decision from you.

| Repo | Path | Contains |
|---|---|---|
| Frontend | `GroupC/frontend_v2` | React 19 + TS SPA. Also contains a **`GroupC/backend_v2`** sibling folder — this is a legacy/abandoned backend (SQLite-based) and is **not** the backend in use. Ignore it. |
| Backend | `map-app-render-deployment/backend` | The real, live backend. Express + MySQL, deployed separately (Render), DB hosted on Railway. |

**Proposed deviation:** I'll place `docs/`, the canonical SQL script set, and
`docker-compose.yml` (Phase 4 OSRM) in `map-app-render-deployment` (the
backend repo), since Phases 1, 2, 3, 4, 5, 6 are almost entirely backend/DB
work. The frontend repo gets its own small `docs/AI-FEATURE-FRONTEND.md` cross-
reference if needed, plus a README update pointing at the backend repo's docs
for full setup. **Please confirm this split is acceptable** — the brief
implicitly assumes one repo for the "single README explains how to run
everything" deliverable (Phase 8.4), and I want that to actually be true
across both repos rather than technically-true-but-confusing.

---

## 1. Confirmed database schema (live, via `SHOW CREATE TABLE`)

9 tables exist today. All match the brief's description with two additions
the brief didn't mention (`admin_driver`, currently empty/unused — looks like
a leftover many-to-many join that nothing writes to) and one behavioural
detail the brief's summary omits: **`source`/`status` on `hazard_reports` and
`ended_at` on `destination` already exist** (I added these in earlier work
this session).

```sql
user (
  user_id PK, email UNIQUE, password, username UNIQUE,
  date_created, last_login, firstname, lastname
)

driver            (driver_id PK, user_id FK -> user)
admin             (admin_id PK, user_id FK -> user)
traffic_authority (traffic_authority_id PK, user_id FK -> user)
security_agency   (security_agency_id PK, user_id FK -> user)
data_analyst      (data_analyst_id PK, user_id FK -> user)
-- role is purely "which of these 5 tables contains this user_id"

admin_driver (admin_id FK, driver_id FK, composite PK)  -- unused, 0 rows, no code references it

hazard_reports (
  id PK, user_id FK -> user (ON DELETE CASCADE),
  latitude DECIMAL(10,7), longitude DECIMAL(10,7),
  hazard_type VARCHAR(255),        -- free text, no enum/lookup table: 'pothole','protest',
                                    -- 'hijacking','road_closure','crime_hotspot','accident',
                                    -- 'march','construction','other', ... (values found in code,
                                    -- not DB-enforced)
  source VARCHAR(32) DEFAULT 'citizen',   -- 'citizen' | 'traffic_authority' | 'security_agency'
  status VARCHAR(16) DEFAULT 'active',    -- 'active' | 'resolved'
  created_at DATETIME DEFAULT (NOW() + INTERVAL 2 HOUR)   -- SAST offset baked into the default
)

destination (
  id PK, user_id FK -> user (ON DELETE CASCADE),
  start_location, end_location VARCHAR(255),
  hazard_bypassed INT DEFAULT 0,   -- present but never written by any current endpoint — dead column
  ended_at DATETIME NULL,          -- "End Trip" timestamp
  created_at DATETIME DEFAULT (NOW() + INTERVAL 2 HOUR)
)
```

Row counts today: `user`=31, `driver`=22, `admin`=3, `traffic_authority`=2,
`security_agency`=2, `data_analyst`=2, `hazard_reports`=29, `destination`=4,
`admin_driver`=0. (Includes demo accounts seeded earlier this session —
Phase 4's seed script should either build on these or supersede them.)

**Naming inconsistency to fix under Phase 5's "consistent naming" requirement:**
the JWT payload and every API response call the driver role `"normal"`
(`userType: "normal"`), while the DB table is `driver` and every other role
uses its literal table name (`"admin"`, `"traffic_authority"`, ...). I will
**not** silently rename this mid-brief since the frontend's `dashboardPathForRole`
and role loaders match on these exact strings — I'll flag it for a coordinated
rename (`"normal"` → `"driver"`) as a small, explicit Phase 5 sub-task touching
both repos, or document it as an accepted inconsistency if you'd rather not
touch working auth. **Your call — flagged, not yet decided.**

---

## 2. Confirmed API surface

`server.js` mounts, in order:

```
/api/auth          → auth.routes.js       (register, register-staff, login)
/api/users          → user.routes.js
/api/hazards        → hazards.route.js
/api/normal-user/destinations   → destination.routes.js (normalUserRouter) — authenticateToken applied at MOUNT, not per-route
/api/admin-user/destinations    → destination.routes.js (adminRouter) — authenticateToken + authenticateAdmin at MOUNT
/api/analyse        → analyse.js
/api/reports        → reports.routes.js
```

| Endpoint | Method | Auth today | Notes |
|---|---|---|---|
| `/api/auth/register` | POST | none (public) | Hard-wired to always create a `driver` row regardless of body content — this was a deliberate fix for a prior privilege-escalation bug. Keep it that way. |
| `/api/auth/register-staff` | POST | `authenticateToken`+`adminWare` | Only path to create admin/traffic_authority/security_agency/data_analyst accounts. |
| `/api/auth/login` | POST | none (public, obviously) | Resolves role by checking each subtype table in turn. |
| `/api/users` GET/PUT/DELETE | — | `authenticateToken` | Self-service profile. |
| `/api/users/all`, `/drivers`, `/:id/password`, `DELETE /:id` | — | `authenticateToken`+`adminWare` | Admin-only. |
| `/api/hazards` POST | POST | `authenticateToken` | `source` is derived from `req.type` (JWT), **never** from the request body. |
| `/api/hazards` GET | GET | **none** | Returns every report including reporter `user_id`/`username`/`email`. Public read of who-reported-what. Flagged for Phase 4. |
| `/api/hazards/mine` | GET | `authenticateToken` | |
| `/api/hazards/:id` PUT/DELETE | — | `authenticateToken`+`adminWare` | |
| `/api/hazards/:id/status` PATCH | PATCH | `authenticateToken`+`requireRole(admin, traffic_authority, security_agency)` | Non-admins scoped to their own reports via an `AND user_id = ?` clause. **This is the endpoint Phase 2's `sp_resolve_hazard` replaces.** |
| `/api/normal-user/destinations` POST/GET, `/generate` POST, `/:id/end` PATCH | — | `authenticateToken` (router-level) | `POST /` runs the JS SafeMaster port server-side and persists a trip; **the frontend does not call this for its live routing** — see §3. `/:id/end` is the "End Trip" endpoint; **Phase 2's `sp_end_trip` candidate.** |
| `/api/admin-user/destinations` GET/DELETE | — | `authenticateToken`+`authenticateAdmin` (router-level) | |
| `/api/analyse` POST | POST | **none** | Classifies free-text news into a risk category via GPT-4o-mini. **This is the orphaned Phase 1 endpoint.** |
| `/api/analyse/shorten` POST | POST | **none** | Shortens location/description strings via GPT-4o-mini. Also unauthenticated, also unused by the UI. |
| `/api/analyse/safe_route` POST | POST | **none** | **Not mentioned in the brief's description — a third, separate AI mechanism.** Fetches OSRM alternatives and asks GPT to pick whichever stays furthest from a supplied danger-zone list. Distinct from SafeMaster's deterministic geometric scoring. Confirmed unused by the frontend (which uses the TS SafeMaster port instead). I'll leave this endpoint as-is (not part of any Phase task) but it needs the same auth lockdown as the other two `/api/analyse/*` routes in Phase 4, since it burns OpenAI + OSRM quota with zero access control. |
| `/api/analyse/health` GET | GET | none | Leaks `apiKeyLoaded: boolean`. Low severity, will lock down alongside the rest. |
| `/api/reports/safety` GET | GET | `authenticateToken`+`adminWare` | **No filter/sort params exist today** — fixed aggregate query. Phase 3 target #1. |
| `/api/reports/hotspots` GET | GET | `authenticateToken`+`requireRole(data_analyst, admin)` | **No filter/sort params either.** Phase 3 target #2. |

**Frontend-side role gating is client-side only.** `App.tsx`'s `AdminLoader`
and `roleLoader` check `localStorage.getItem('isAdmin')` /
`localStorage.getItem('userType')` — trivially spoofable via devtools. This
is exactly what Phase 4's server-side enforcement task targets; the backend
middleware (`adminWare`, `requireRole`) already exists and is already applied
to most sensitive routes (table above), so Phase 4's real work is (a) closing
the three unauthenticated `/api/analyse/*` routes and `/api/hazards` GET, and
(b) writing the test proving a driver token gets 403 from a staff route —
which today would actually **pass** for most endpoints already, except the
AI routes.

---

## 3. SafeMaster — both ports, and a divergence risk I found

**Locations:**
- Backend (JS): `backend/src/routes/destination.routes.js`, lines 1–140
  (constants + `loadRoutingContext`) and the `generateRoute` function further
  down. Exposed via `POST /api/normal-user/destinations` and
  `POST /api/normal-user/destinations/generate`.
- Frontend (TS): `frontend_v2/src/lib/utils.ts`, lines 27–32 (constants) and
  `generateSafeRoute` at line 370. This is what the driver's "AI SAFE PATH"
  button actually calls — **the backend port is not in the live routing path
  today**, only the logging side-effect of `POST /api/normal-user/destinations`.

Both use identical constants (`INCIDENT_RADIUS_KM=0.6`, `BYPASS_OFFSET_KM=2.2`,
`W_INCIDENTS=0.5`, `W_AREAS=0.3`, `W_ALERTS=0.2`) and both carry the
detour-acceptance fix described in the brief (gate on hazards the detour was
built to avoid, not total hazard count) — confirmed present in both ports at
`destination.routes.js` (`fetchAvoidanceRoutes`) and `utils.ts` lines 439–474.
**That fix is safe.**

**A latent divergence I found, not yet triggered but relevant to Phase 6:**
the backend port has real (if currently dormant) hooks for two extra risk
inputs beyond hazard proximity — `risk_area` and `alerts` tables — that
`loadRoutingContext()` tries to query and **silently falls back to empty
arrays** if they don't exist (they don't, today). When empty, `W_AREAS`
contributes a hardcoded neutral default (`avgArea = 25.0`) and `W_ALERTS`
contributes `0`. The **frontend port hardcodes those exact same neutral
values directly in its formula** (`25 * W_AREAS + 0 * W_ALERTS`), so today the
two ports agree — but only because both are pinned to the same placeholder,
not because they're actually synchronized. **If Phase 6 adds a real `alerts`
table (see §4 below for the naming collision this creates), the backend port
will start pulling real alert data into its risk score automatically, while
the frontend port will not — silently breaking parity**, which is exactly
what the brief's Rule 3 exists to prevent.

**Decision needed from you, options:**
1. Build the Phase 6 `alerts` table to feed the frontend port too (frontend
   would need a new `GET /api/alerts/active` call folded into `runCheck()`),
   keeping both ports genuinely synchronized — more work, but closes the gap
   properly and the alerts data becomes real routing signal instead of a
   notification-only feature.
2. Keep Phase 6's alerts purely a notification-center feature (not fed into
   scoring at all), and explicitly **do not** populate the backend's dormant
   `risk_area`/`alerts` query hooks — i.e. leave both ports' neutral defaults
   alone, sidestepping the divergence entirely.

**I recommend option 2** for this brief: it satisfies Phase 6's actual ask
(persistent, readable alerts) without expanding SafeMaster's scope, avoids a
naming collision (see §4), and keeps the parallel-port surface area smaller.
Either way, I'll add the shared JSON test-vector fixture (Rule 3) as part of
Phase 2 setup, before touching either port again, so this class of bug
becomes mechanically detectable regardless of which option we pick later.

---

## 4. Everything else discovery turned up that changes execution

- **Geoapify key**: hardcoded as the literal string `5e7b1eab70f24694a61d4362ce38f88e`
  independently in **4 frontend files, 8 call sites**: `lib/utils.ts` (lines
  660, 813), `pages/MapPage.tsx` (lines 50, 311, 355, 376, 436),
  `pages/CurrentEventMap.tsx` (line 100). All are either
  `/v1/geocode/reverse` or `/v1/geocode/autocomplete` calls. The Phase 4 proxy
  needs exactly two backend endpoints (`GET /api/geocode/reverse`,
  `GET /api/geocode/autocomplete`) and all 8 call sites need to switch to
  calling those instead of Geoapify directly.
- **OSRM base URL**: hardcoded identically in 3 files —
  `frontend_v2/src/lib/utils.ts`, `backend/src/routes/destination.routes.js`,
  `backend/src/routes/analyse.js`. Frontend calls OSRM directly from the
  browser for its live routing (SafeMaster TS port) — this **cannot** be
  proxied the same way Geoapify can without adding real latency to every
  route calculation, so `OSRM_BASE_URL` will be a **build-time Vite env var**
  on the frontend (still fine — it's not a secret, just an endpoint) and a
  runtime env var on the backend.
- **DB credentials and JWT secret already read from `process.env`, but both
  have real, working values hardcoded as the fallback default** in
  `db/db.js` (host/port/user/**password**/database) and in three separate
  files' `JWT_SECRET` fallback (`server.js`, `middleware/auth.js`,
  `auth.routes.js`, all must change together). These aren't placeholder
  examples — they're the actual live credentials, currently committed. Phase
  4 removes the fallback values entirely (fail fast if env vars are missing,
  rather than silently defaulting to a checked-in secret).
- **No CSV/PDF export library exists yet** in the backend
  (`bcryptjs, cors, dotenv, express, jsonwebtoken, mysql2, openai,
  nodemon` — that's the full dependency list). Phase 3 needs at least a CSV
  writer; I propose a small hand-rolled CSV serializer (no new dependency —
  it's a handful of lines and avoids adding a package for something this
  simple) and `pdfkit` for PDF (lightweight, no headless-browser dependency
  like `puppeteer` would need).
- **No Cheerio anywhere in either repo.** The frontend has an unused
  `serpapi` dependency (never imported anywhere) that isn't wired to
  anything and isn't in the backend's `package.json` either — a leftover,
  not "the existing approach." For Phase 1 ingestion I propose: a
  configurable `NEWS_SOURCE_URL` env var, preferring an RSS/JSON feed where
  available (no scraping library needed, just an XML parser) with Cheerio as
  a fallback dependency for HTML-only sources. This is simpler and more
  robust than scraping a specific news site's markup, which breaks the
  moment that site redesigns.
- **`hazard_reports.hazard_type` and `hazard_reports.source` are free-text
  VARCHAR, not DB-enforced enums** — currently constrained only by what the
  frontend UI happens to send. Relevant to Phase 1's `classified_category`
  mapping decision (§5) and to Phase 4's server-side validation task (I'll
  validate against an explicit allow-list in code, not a DB constraint,
  to avoid a migration that could reject existing rows).
- **Three risk-category taxonomies exist in the codebase today, none shared
  with the others**: (1) `hazard_reports.hazard_type` free strings like
  `'pothole'`, `'protest'`, `'hijacking'`; (2) `/api/analyse`'s
  `risk_category` output — `Crime | Protest | Natural Disaster | Accident |
  Infrastructure | Civil Unrest | Other`; (3) `services/assessRisk.js`'s
  `RISK_CATEGORIES` — `VIOLENT_CRIME | CIVIL_UNREST |
  ENVIRONMENTAL_HAZARDS | INFRASTRUCTURE_ISSUES`, used only for scoring
  colour-coding. Phase 1 needs one explicit mapping from (2) → (1) so a
  confirmed AI candidate becomes a valid `hazard_type`; I'll document that
  mapping table in `docs/AI-FEATURE.md` rather than leaving it implicit in
  code.
- **`destination.hazard_bypassed` is a dead column** — defined, defaulted to
  0, never written by any current endpoint. Not in scope for this brief, but
  worth a one-line mention in `CHANGES.md` since the Trip Completion Report
  (Phase 3) might otherwise be expected to use it and won't.
- **`.gitignore` in both repos already covers `.env*` patterns** — safe to
  add real `.env` files locally without a review step to catch an accidental
  commit, though I'll still grep the built bundle per the brief's
  instruction as a backstop.

---

## 5. Phase 1 design decisions (stated now so Phase 1 doesn't stall on them)

- **`ai_risk_candidates` → confirmed `hazard_reports` source value**: I'll add
  `'ai_confirmed'` as a new allowed value in `hazard_reports.source` (it's an
  unconstrained VARCHAR, so this is a zero-migration change). This keeps
  `bySource` in the Safety Report and the Hazard Response Report (Phase 3)
  correct with no query changes — they already `GROUP BY source` generically.
  Rejected alternative: tagging confirmed AI hazards with the reviewing
  staff member's own role as `source` plus a separate `origin='ai'` column —
  more columns, and it would hide "this was AI-suggested" behind a second
  field every report query would need to know about.
- **`classified_category` → `hazard_type` mapping** (documented fully in
  `docs/AI-FEATURE.md` in Phase 1, stated here for visibility): `Crime` →
  `hijacking`, `Protest`/`Civil Unrest` → `protest`, `Natural Disaster` →
  `flooding`, `Accident` → `accident`, `Infrastructure` → `road_closure`,
  `Other` → `other`.
- **News ingestion source**: `NEWS_SOURCE_URL` env var, RSS/JSON-first
  parsing, Cheerio fallback for HTML-only sources (§4). Ingestion is
  manually triggered from the Admin/Analyst UI in this brief (a button, not
  a cron job) — the brief doesn't ask for scheduled ingestion, and adding one
  would need its own resilience/backoff design I'd rather not scope-creep
  in without asking first.

---

## 6. Task → file map

### Phase 1 — AI feature
| Task | Files |
|---|---|
| `ai_risk_candidates` table | `backend/src/db/migrations/002_ai_candidates.sql` |
| Ingestion endpoint | new `backend/src/routes/ai.routes.js`, new `backend/src/services/newsIngest.js` |
| Candidate list/confirm/reject endpoints | `backend/src/routes/ai.routes.js` |
| Wire into `hazard_reports` on confirm | `backend/src/routes/ai.routes.js` (reuses `sp_resolve_hazard`-adjacent insert, see Phase 2 note) |
| Role lockdown on `/api/analyse/*` and new `/api/ai/*` | `backend/src/server.js`, `backend/src/routes/analyse.js`, `backend/src/routes/ai.routes.js` |
| Frontend "Live Risk Intelligence" panel | new `frontend_v2/src/pages/admin._pages/AiCandidatesPage.tsx` (Admin), reused/linked from `frontend_v2/src/pages/DataAnalystDashboard.tsx` |
| Route wiring + role loader | `frontend_v2/src/App.tsx` |
| Docs | `backend/docs/AI-FEATURE.md` |

### Phase 2 — Stored procedures
| Task | Files |
|---|---|
| `sp_create_staff_account` | `backend/src/db/procedures/001_sp_create_staff_account.sql`, called from `backend/src/routes/auth.routes.js` (`/register-staff`) |
| `sp_resolve_hazard` + `hazard_resolution_log` table | `backend/src/db/migrations/003_hazard_resolution_log.sql`, `backend/src/db/procedures/002_sp_resolve_hazard.sql`, called from `backend/src/routes/hazards.route.js` (`PATCH /:id/status`) |
| `sp_end_trip` + `trip_summary` table | `backend/src/db/migrations/004_trip_summary.sql`, `backend/src/db/procedures/003_sp_end_trip.sql`, called from `backend/src/routes/destination.routes.js` (`PATCH /:id/end`) |
| Shared SafeMaster test-vector fixture (Rule 3) | new `backend/src/routes/__fixtures__/safemaster-vectors.json`, small runner script referenced from both ports' test setup |

### Phase 3 — Reports
| Task | Files |
|---|---|
| Trip Completion Report (new) | `backend/src/routes/reports.routes.js`, `frontend_v2/src/pages/admin._pages/AdminSafetyReportPage.tsx` (or a new page) |
| Hazard Response Report (new) | `backend/src/routes/reports.routes.js`, new frontend page linked from Admin + relevant staff dashboards |
| Filter/sort on existing 2 reports | `backend/src/routes/reports.routes.js`, `frontend_v2/src/pages/admin._pages/AdminSafetyReportPage.tsx`, `frontend_v2/src/pages/DataAnalystDashboard.tsx` |
| CSV/PDF export (all 4) | `backend/src/services/export.js` (new), wired into `reports.routes.js`, export buttons on all 4 frontend report views |

### Phase 4 — Security/validation/resilience/secrets
| Task | Files |
|---|---|
| Auth test (driver 403 on staff routes) | new `backend/src/__tests__/role-enforcement.test.js` (or a plain script if no test runner is added — see note below) |
| Lock down `/api/analyse/*`, `/api/hazards` GET | `backend/src/routes/analyse.js`, `backend/src/routes/hazards.route.js`, `backend/src/server.js` |
| Server-side validation + descriptive errors | every file in `backend/src/routes/` |
| Global error handler | `backend/src/server.js` |
| Env vars + `.env.example` | `backend/.env.example`, `backend/src/db/db.js`, `backend/src/middleware/auth.js`, `backend/src/routes/auth.routes.js`, `backend/src/server.js` |
| Geoapify proxy | new `backend/src/routes/geocode.routes.js`; frontend call-site swap in the 4 files listed in §4 |
| `OSRM_BASE_URL` configurable | `backend/src/routes/destination.routes.js`, `backend/src/routes/analyse.js`, `frontend_v2/src/lib/utils.ts` (Vite env), `frontend_v2/vite.config.ts` if needed |
| OSRM self-host | new `backend/docker-compose.yml`, `backend/docs/OSRM-SELFHOST.md` |
| Seed data | `backend/src/db/seed.sql` |

**Note on the test:** the backend has no test runner installed today (no
Jest/Vitest/etc. in `package.json`). Adding one is reasonable for a single
role-enforcement test, but it's a real dependency addition — I'll propose
`vitest` (lighter than Jest, works fine on a plain Node/Express backend)
unless you'd prefer I keep it dependency-free with a small standalone script
under `backend/scripts/verify-role-enforcement.mjs` that hits a running
server and asserts the 403. **Flagging this choice for your Phase 0 review
rather than deciding unilaterally**, since it's a new dev dependency.

### Phase 5 — ERD
| Task | Files |
|---|---|
| DBML + Mermaid ERD reflecting final schema (incl. every Phase 1/2/6 table) | `backend/docs/schema.dbml`, `backend/docs/ERD.md` |
| Canonical DDL matching the ERD | `backend/src/db/schema.sql` (consolidated from the migration files) |

### Phase 6 — Proposal gaps
| Task | Files |
|---|---|
| Background re-route poller + prompt | `frontend_v2/src/pages/MapPage.tsx` (reuses existing `runCheck`/SafeMaster TS port — no scoring logic changes, so no parallel-port impact per §3 option 2) |
| `alerts` table (notification-only, per §3 decision) | `backend/src/db/migrations/005_alerts.sql` |
| Alert generation on new nearby hazard | `backend/src/routes/hazards.route.js` (on `POST /`, insert alert rows for drivers with a recent/active route near the new hazard) |
| Notification centre UI | new `frontend_v2/src/components/NotificationCenter.tsx`, wired into `frontend_v2/src/components/Layout.tsx` and `frontend_v2/src/pages/MapPage.tsx` |

### Phase 7 — UI marks
| Task | Files |
|---|---|
| Page titles audit | every route component — likely a small `useEffect(() => { document.title = ... })` helper or `<title>` via a shared hook, applied consistently |
| FK dropdowns showing business meaning | wherever a raw ID currently appears in a `<select>` or filter (audit during implementation — none confirmed missing yet, will list precisely in Phase 7's own sub-plan) |
| 8 varied controls | date-range pickers (report filters), risk-threshold slider (re-route sensitivity), checkboxes (include resolved), radio filters (by source), confidence-threshold control (AI panel) — 5 new + the 3 existing (map pin-drop, hazard-type picker, drag marker) already present |

### Phase 8 — Packaging
| Task | Files |
|---|---|
| Consolidated SQL run order | `backend/src/db/README.md` documenting `schema.sql` → `procedures/*.sql` → `seed.sql` |
| `CHANGES.md` mapped to rubric marks | `backend/docs/CHANGES.md` |
| Root README covering both repos | `map-app-render-deployment/README.md` (primary), `GroupC/README.md` (pointer) |

---

## 7. Risks

- **OSRM public demo rate-limiting mid-Phase** could make routing checks
  flaky while I'm building/testing Phases 1–3, independent of the Phase 4
  fix for it. I'll prioritize the `OSRM_BASE_URL` env var + fallback
  handling early (matches the brief's own suggested execution order) so
  later phases aren't debugged against an unreliable dependency.
- **OpenAI cost**: ingestion + classification burns real API credits per
  call. I'll keep ingestion manually triggered (§5) and default to a small
  batch size, not a background poller, to keep this bounded during grading/demo.
- **Two-repo coordination**: any change that touches both the TS and JS
  SafeMaster ports, or both frontend and backend for the Geoapify proxy,
  needs commits in both repos kept in sync. I'll call out paired commits
  explicitly in `CHANGES.md`.
- **`userType: "normal"` rename** (§1) touches live auth on both repos if we
  do it — low risk technically (it's a pure string rename with no schema
  change) but touches a working login path. Awaiting your decision.
- **New dependencies**: `pdfkit` (PDF export, Phase 3), possibly `vitest`
  (Phase 4 test) — flagged above rather than assumed.

---

## Awaiting your review

I have not modified any file outside `docs/` and this plan. Please confirm or
correct:

1. The two-repo `docs/` placement (§0).
2. The `userType`/`driver` naming rename — do it now or leave it (§1).
3. SafeMaster/alerts option 2 (notification-only, no scoring feed) vs option 1 (§3).
4. `ai_risk_candidates` → `source: 'ai_confirmed'` design (§5).
5. Test approach for Phase 4's role-enforcement proof: add `vitest`, or a
   dependency-free script (§6, Phase 4 note).

Once confirmed, I'll proceed in the brief's suggested order starting with
Phase 1, committing per phase as instructed.
