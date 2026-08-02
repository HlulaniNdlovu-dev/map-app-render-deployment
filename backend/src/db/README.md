# Database setup

## Run order

1. **Schema** — `schema.sql` creates every table (consolidated from `migrations/*.sql`,
   which remain as the historical record of how the schema was built up in phases).
2. **Stored procedures** — `procedures/*.sql` creates `sp_create_staff_account`,
   `sp_resolve_hazard`, and `sp_end_trip`.
3. **Seed data** (optional) — `seed.sql` adds demo data: 10+ rows in every table with a
   real code path (50 users across all 5 roles, 18 hazard reports, 12 trips, 15 resolution-log
   entries, 10 AI candidates, 12 driver notifications). Safe to skip in production.

## Applying it

The easiest path is the npm scripts, which apply `migrations/*.sql` then `procedures/*.sql`
(tracked in a `schema_migrations` table so re-running only picks up new files — safe to run
repeatedly):

```bash
npm run migrate   # schema.sql equivalent: migrations/*.sql, then procedures/*.sql
npm run seed       # optional demo data — NOT tracked, re-running re-inserts it
```

To restore the exact live schema in one shot instead (e.g. onto a fresh empty database),
run `schema.sql` directly followed by every file in `procedures/`:

```bash
mysql -h $MYSQLHOST -P $MYSQLPORT -u $MYSQLUSER -p $MYSQLDATABASE < schema.sql
mysql -h $MYSQLHOST -P $MYSQLPORT -u $MYSQLUSER -p $MYSQLDATABASE < procedures/001_sp_create_staff_account.sql
mysql -h $MYSQLHOST -P $MYSQLPORT -u $MYSQLUSER -p $MYSQLDATABASE < procedures/002_sp_resolve_hazard.sql
mysql -h $MYSQLHOST -P $MYSQLPORT -u $MYSQLUSER -p $MYSQLDATABASE < procedures/003_sp_end_trip.sql
mysql -h $MYSQLHOST -P $MYSQLPORT -u $MYSQLUSER -p $MYSQLDATABASE < seed.sql   # optional
```

(`seed.sql` is written to work either way — it doesn't depend on `migrate.mjs` having run
first, only on the schema existing.)

## Files

| File | Purpose |
|---|---|
| `schema.sql` | Canonical DDL, all 13 application tables + `schema_migrations`. Matches [`docs/ERD.md`](../../docs/ERD.md) / [`docs/schema.dbml`](../../docs/schema.dbml). |
| `migrations/*.sql` | The same schema, built up incrementally in the order these features were added. What `migrate.mjs` actually runs. |
| `procedures/*.sql` | The 3 stored procedures. Each file is `DROP PROCEDURE IF EXISTS` + `CREATE PROCEDURE`, split on a `@@SPLIT@@` marker (not `;`, since procedure bodies contain their own semicolons). |
| `seed.sql` | Demo data. Every `seed_*` username is namespaced so it can never collide with a real user or the earlier hand-seeded demo accounts (`driver_demo`, `admin_demo`, etc). |
| `migrate.mjs` | Applies `migrations/` then `procedures/`, tracked in `schema_migrations` — safe to re-run. |
| `seed.mjs` | Applies `seed.sql`. Not tracked — a deliberate, repeatable action, not an idempotent migration. |
| `db.js` | The `mysql2` connection pool every route imports. Fails fast at startup if any `MYSQL*` env var is missing (see `../../.env.example`). |
