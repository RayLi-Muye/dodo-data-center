# ADR 0002: Incremental sync and snapshot caching

## Status

Accepted for the MVP synchronization performance pass.

## Context

A repeated public-account refresh currently rewrites the same hero, item, patch, update and match documents. The PostgreSQL repository issues those writes one row at a time. With the API in Singapore and Supabase in Tokyo, the resulting network round trips dominate a successful sync even when the latest 20 matches are already enriched.

## Decision

- Keep PostgreSQL as the source of truth; do not add Redis for this pass.
- Extend static snapshots with `checkedAt`, `changedAt` and a deterministic `contentHash` while retaining `fetchedAt` for source freshness.
- Treat legacy snapshots as `checkedAt = changedAt = fetchedAt` with an unknown hash.
- Use a six-hour TTL for heroes, abilities, items and the OpenDota major-patch catalog.
- Use a thirty-minute TTL for the Dota 2 official update catalog.
- Inside the TTL, reuse persisted catalogs and skip their upstream requests and database writes.
- After the TTL, normalize and hash the complete catalog. If the hash is unchanged, update only the snapshot. If it changed, atomically replace the catalog using set-based SQL.
- Compare the latest player matches with persisted documents and write only new or materially changed matches. Existing enriched details remain authoritative over a repeated summary response.
- Batch match document and player-membership writes in set-based PostgreSQL statements. Keep deterministic advisory locking and document merge behavior.
- Keep recent-match detail enrichment asynchronous within the existing job for this pass; separating it into another durable job is a later slice.

## Why not Redis yet

The preview currently runs one always-on API instance. PostgreSQL snapshots and advisory locks already provide durable cross-request coordination. Redis would add another service without removing the upstream check or the row-at-a-time SQL pattern. Redis remains appropriate when Dodo adds multiple API replicas, a durable worker queue, rate limiting or hot aggregate caching.

## Acceptance criteria

1. A second account refresh inside the TTL does not call static catalog providers.
2. A stale but unchanged catalog updates snapshot freshness without rewriting catalog rows.
3. A repeated account refresh does not submit unchanged match documents.
4. First-time imports and changed catalogs use bounded, set-based SQL rather than one statement per row.
5. Private, partial, rate-limited, unavailable and failed states retain their existing meaning.
6. Account `224328273` remains readable throughout refresh, finishes successfully and has materially lower repeated-sync latency.
