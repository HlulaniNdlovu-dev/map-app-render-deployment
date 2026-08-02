# Self-hosting OSRM (optional)

The app talks to OSRM for actual road-following route geometry. By
default it uses the public demo server
(`https://router.project-osrm.org`) — free, zero setup, but shared and
rate-limited, which is a real risk if it gets hit hard during grading or
a demo. This is how to run your own instance locally instead.

## One-time data preparation

OSRM needs a preprocessed map extract before it can serve routes — this
step is slow (several minutes) and only needs to happen once per map
version, not on every start.

```bash
mkdir -p osrm-data
cd osrm-data

# South Africa extract (~450MB) from Geofabrik
curl -O https://download.geofabrik.de/africa/south-africa-latest.osm.pbf

# Extract, partition, customize — each step preprocesses the previous
# one's output. Uses the official image so nothing else needs installing.
docker run --rm -t -v "${PWD}:/data" osrm/osrm-backend osrm-extract -p /opt/car.lua /data/south-africa-latest.osm.pbf
docker run --rm -t -v "${PWD}:/data" osrm/osrm-backend osrm-partition /data/south-africa-latest.osrm
docker run --rm -t -v "${PWD}:/data" osrm/osrm-backend osrm-customize /data/south-africa-latest.osrm

cd ..
```

## Running it

```bash
docker compose up -d osrm
```

This serves the routing API on `http://localhost:5000`. Verify it's alive:

```bash
curl "http://localhost:5000/route/v1/driving/28.1914,-25.7566;28.0473,-26.2041?overview=false"
```

A JSON response with `"code":"Ok"` means it's working (this is a Pretoria
→ Johannesburg test route).

## Pointing the app at it

```bash
# backend/src/.env
OSRM_BASE_URL=http://localhost:5000/route/v1/driving

# frontend_v2/.env
VITE_OSRM_BASE_URL=http://localhost:5000/route/v1/driving
```

Restart both the backend and the frontend dev server after changing
these — Vite only reads `VITE_*` env vars at startup.

## Falling back to the public server

Just remove or leave these two env vars unset — both `OSRM_BASE_URL` and
`VITE_OSRM_BASE_URL` default to the public demo server if not provided.
The app's retry-with-backoff (see `docs/IMPROVEMENT-PLAN.md` §Phase 4)
and straight-line degraded-route fallback apply either way, self-hosted
or not.
