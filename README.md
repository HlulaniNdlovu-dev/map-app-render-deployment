# Mapper — Safe Route Navigation System

A route-safety app for South African drivers: routes are scored and, where needed, detoured
around real risk — hijacking hotspots, protests, crime, taxi strikes, road closures — not
just optimized for distance or time. Five roles cover the full pipeline from citizen report
to authority response: **Driver**, **System Administrator**, **Traffic Authority**,
**Security Agency**, and **Data Analyst**.

## Two repositories

This project is split across two directories in this workspace, each its own git repo:

| Repo | What it is |
|---|---|
| **`map-app-render-deployment/backend`** (this repo) | The live, deployed backend — Express + MySQL. **This is the only backend** — `GroupC/backend_v2` is dead/legacy and not used anywhere. |
| **`GroupC/frontend_v2`** | The frontend — React 19 + TypeScript + React Router v7 + MapLibre GL, deployed separately, talks to the backend above over HTTPS. |

## Architecture

- **SafeMaster routing engine** exists as two independent ports that must stay
  mathematically identical: a TypeScript port in the frontend (`lib/safemaster.ts`, what the
  driver's live "AI SAFE PATH" button actually calls) and a JavaScript port in the backend
  (`src/lib/safemaster.js`, used for the destination-logging side effect). A shared
  fixture (`__fixtures__/safemaster-vectors.json`, identical in both repos) and a `vitest`
  suite on each port catch any future divergence — see [`backend/docs/CHANGES.md`](backend/docs/CHANGES.md#phase-2--stored-procedures)
  for a real bug this caught.
- **Roles** are not a column — a user's role is purely which of 5 subtype tables
  (`driver`, `admin`, `traffic_authority`, `security_agency`, `data_analyst`) contains their
  `user_id`. See [`backend/docs/ERD.md`](backend/docs/ERD.md) for the full schema.
- **AI feature** ("Live Risk Intelligence"): news → LLM classification → geocode → a human
  reviews before anything reaches the live risk database. See [`backend/docs/AI-FEATURE.md`](backend/docs/AI-FEATURE.md).

## Setup

### Backend

```bash
cd backend
npm install
cp .env.example src/.env   # fill in real DB/JWT/OpenAI/Geoapify values
npm run migrate            # applies schema + stored procedures
npm run seed                # optional — demo data, 10+ rows per table
npm start                   # http://localhost:3000
npm test                    # vitest: SafeMaster parity + role-enforcement
```

### Frontend

```bash
cd ../GroupC/frontend_v2
npm install
cp .env.example .env.local  # optional — only needed to self-host OSRM
npm run dev                 # http://localhost:5173
npm test                    # vitest: SafeMaster parity (mirrors the backend suite)
npm run build                # production build
```

## Demo accounts

All seeded with password `@Test123` (see [`backend/src/db/seed.sql`](backend/src/db/seed.sql)
for the full 50-account seed set, or use these 5 originally-seeded ones — one per role):

| Role | Username |
|---|---|
| Driver | `driver_demo` |
| System Administrator | `admin_demo` |
| Traffic Authority | `traffic_demo` |
| Security Agency | `security_demo` |
| Data Analyst | `analyst_demo` |

## Features by role

- **Driver** — safe-route planning with live risk scoring, hazard reporting, trip
  history, background re-route checks while driving, persistent notifications for new
  hazards reported near an in-progress trip.
- **System Administrator** — full user/staff management, hazard-report moderation, 4
  filterable/sortable/exportable reports (Safety, Hotspot, Trip Completion, Hazard
  Response), the AI candidate review queue.
- **Traffic Authority / Security Agency** — file official hazard reports (road closures,
  protests, crime hotspots), resolve/reopen their own reports, review the Hazard Response
  audit trail.
- **Data Analyst** — hotspot clustering, Trip Completion + Hazard Response reports, AI
  candidate review.

## Documentation index

| Doc | Covers |
|---|---|
| [`backend/docs/IMPROVEMENT-PLAN.md`](backend/docs/IMPROVEMENT-PLAN.md) | The original discovery/design doc this whole improvement pass was built from. |
| [`backend/docs/CHANGES.md`](backend/docs/CHANGES.md) | What was delivered, phase by phase, mapped to rubric marks. |
| [`backend/docs/AI-FEATURE.md`](backend/docs/AI-FEATURE.md) | AI integration design, data flow, hallucination mitigation. |
| [`backend/docs/ERD.md`](backend/docs/ERD.md) / [`schema.dbml`](backend/docs/schema.dbml) | Entity-relationship diagram. |
| [`backend/docs/OSRM-SELFHOST.md`](backend/docs/OSRM-SELFHOST.md) | Self-hosting the routing engine instead of the public demo server. |
| [`backend/src/db/README.md`](backend/src/db/README.md) | Database setup / run order. |
