# Mapper — Entity-Relationship Diagram

Reflects the final schema after Phases 1, 2 and 6 (AI candidates, stored-procedure-backed
audit tables, and notification-only alerts). Canonical DDL: [`src/db/schema.sql`](../src/db/schema.sql).
DBML source (paste into [dbdiagram.io](https://dbdiagram.io) for an interactive diagram):
[`schema.dbml`](./schema.dbml).

`schema_migrations` (migration-tooling bookkeeping, not part of the application's
data model) is omitted from both diagrams below.

## Diagram

```mermaid
erDiagram
    USER {
        int user_id PK
        varchar email UK
        varchar password
        varchar username UK
        datetime date_created
        datetime last_login
        varchar firstname
        varchar lastname
    }

    DRIVER {
        int driver_id PK
        int user_id FK
    }
    ADMIN {
        int admin_id PK
        int user_id FK
    }
    TRAFFIC_AUTHORITY {
        int traffic_authority_id PK
        int user_id FK
    }
    SECURITY_AGENCY {
        int security_agency_id PK
        int user_id FK
    }
    DATA_ANALYST {
        int data_analyst_id PK
        int user_id FK
    }
    ADMIN_DRIVER {
        int admin_id PK,FK
        int driver_id PK,FK
    }

    HAZARD_REPORTS {
        int id PK
        int user_id FK
        decimal latitude
        decimal longitude
        varchar hazard_type
        varchar source
        varchar status
        datetime created_at
    }

    DESTINATION {
        int id PK
        int user_id FK
        varchar start_location
        varchar end_location
        int hazard_bypassed
        datetime ended_at
        datetime created_at
    }

    AI_RISK_CANDIDATES {
        int candidate_id PK
        text raw_source_text
        varchar source_url
        varchar classified_category
        decimal confidence
        decimal suggested_lat
        decimal suggested_lng
        varchar suggested_location_text
        varchar summary
        varchar status
        datetime created_at
        int reviewed_by FK
        datetime reviewed_at
        int resulting_hazard_id FK
    }

    HAZARD_RESOLUTION_LOG {
        int log_id PK
        int hazard_id FK
        int resolved_by FK
        varchar previous_status
        varchar new_status
        datetime resolved_at
    }

    TRIP_SUMMARY {
        int summary_id PK
        int destination_id FK,UK
        int user_id FK
        varchar start_location
        varchar end_location
        int duration_seconds
        datetime started_at
        datetime ended_at
    }

    DRIVER_NOTIFICATIONS {
        int notification_id PK
        int user_id FK
        int hazard_id FK
        varchar message
        boolean is_read
        datetime created_at
    }

    USER ||--o{ DRIVER : "is a"
    USER ||--o{ ADMIN : "is a"
    USER ||--o{ TRAFFIC_AUTHORITY : "is a"
    USER ||--o{ SECURITY_AGENCY : "is a"
    USER ||--o{ DATA_ANALYST : "is a"
    ADMIN ||--o{ ADMIN_DRIVER : "links (unused)"
    DRIVER ||--o{ ADMIN_DRIVER : "links (unused)"

    USER ||--o{ HAZARD_REPORTS : "files"
    USER ||--o{ DESTINATION : "logs trip"
    USER ||--o{ AI_RISK_CANDIDATES : "reviews"
    HAZARD_REPORTS ||--o{ AI_RISK_CANDIDATES : "confirmed as"
    HAZARD_REPORTS ||--o{ HAZARD_RESOLUTION_LOG : "status history"
    USER ||--o{ HAZARD_RESOLUTION_LOG : "resolved by"
    DESTINATION ||--o| TRIP_SUMMARY : "ended as"
    USER ||--o{ TRIP_SUMMARY : "completed by"
    USER ||--o{ DRIVER_NOTIFICATIONS : "notified"
    HAZARD_REPORTS ||--o{ DRIVER_NOTIFICATIONS : "triggers"
```

## Table groups

**Identity & roles** — `user`, `driver`, `admin`, `traffic_authority`, `security_agency`,
`data_analyst`, `admin_driver` (legacy, unused). A user's role is purely which subtype
table contains their `user_id` — there is no `role` column anywhere.

**Core operations** — `hazard_reports` (every danger-zone report, tagged by `source` so
citizen reports are distinguishable from official Traffic Authority / Security Agency
ones) and `destination` (a driver's logged trip; `ended_at IS NULL` means still in
progress).

**Phase 1 — AI feature** — `ai_risk_candidates`. News → LLM classification → geocode →
pending candidate. A human reviewer confirms (inserts a real `hazard_reports` row,
`source='ai_confirmed'`) or rejects (no further effect). See
[`AI-FEATURE.md`](./AI-FEATURE.md).

**Phase 2 — stored procedures** — `hazard_resolution_log` (written by `sp_resolve_hazard`
on every status change) and `trip_summary` (written by `sp_end_trip`, with a
server-computed `duration_seconds`). Both are audit/derived tables a stored procedure
owns exclusively — the routes never write to them directly.

**Phase 6 — notifications** — `driver_notifications`. Deliberately not named `alerts`:
the backend's SafeMaster port has a dormant query against a table literally named
`alerts` that silently no-ops today. Naming this table `alerts` would make that query
start succeeding and pull real data into routing scores automatically, while the
frontend TS port (which has no such hook) would not — silently breaking the two ports'
parity (parallel-port Rule 3). `driver_notifications` stays intentionally disconnected
from SafeMaster scoring; it is purely a notification-center feed.
