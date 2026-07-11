# ADR 0001: Supabase PostgreSQL persistence

## Status

Accepted for MVP Wave 3.

## Decision

- Use the same SQL migrations for local Supabase and hosted Supabase.
- Keep `MemoryDodoRepository` for deterministic unit tests and seed mode.
- Add an asynchronous PostgreSQL repository selected explicitly with `DODO_REPOSITORY=postgres`.
- Keep Fastify as the only application component allowed to use the database credential. The browser must not receive the database URL or service-role key.
- Store the current canonical API documents in JSONB with relational business keys and indexes. Do not prematurely model replay-only or OLAP facts.
- Put application tables in the non-exposed `dodo` schema and revoke access from `anon` and `authenticated` roles.
- Use relational join rows for player-to-match membership so recent-match reads and replacement remain deterministic.

## MVP tables

```text
dodo.heroes
dodo.items
dodo.maps
dodo.players
dodo.matches
dodo.player_matches
dodo.sync_jobs
dodo.player_sync_batches
dodo.player_sync_failures
dodo.provider_health
dodo.static_snapshots
```

Every JSONB payload must continue to validate against the existing TypeScript contract at the application boundary. SQL migrations are append-only once accepted.

## Connection policy

- Local development: Supabase CLI and its local PostgreSQL connection string.
- Persistent container/VM API: direct connection when reachable, otherwise Supavisor session mode.
- Serverless API, if introduced later: Supavisor transaction mode.
- `ssl` behavior is derived from the database URL/environment and must remain testable; credentials are never logged.

## Deferred

- Supabase Auth and Steam account binding.
- Raw replay object storage.
- ClickHouse or another OLAP store.
- Replay-derived item, ward, death, movement, and minute facts.
- Browser access through Supabase Data API.

## Acceptance criteria

1. Local migrations apply from an empty database and can be reset.
2. PostgreSQL repository behavior matches the memory repository for the persisted MVP operations.
3. Replacing the same player's recent matches is transactional and idempotent.
4. Restarting the API retains players, matches, sync batches, failures, jobs, snapshots, and provider health.
5. Seed mode and existing HTTP contracts remain unchanged.
