# ADR 0002: Incremental sync and snapshot caching

## Status

Accepted. The cache mechanics and the domain-derived refresh policy were confirmed by the
Dota review in `docs/prd/dota2-domain-context.md`.

## Context

A repeated public-account refresh currently rewrites the same hero, item, patch, update and match documents. The PostgreSQL repository issues those writes one row at a time. With the API in Singapore and Supabase in Tokyo, the resulting network round trips dominate a successful sync even when the latest 20 matches are already enriched.

## Decision

- Keep PostgreSQL as the source of truth; do not add Redis for this pass.
- Extend static snapshots with `checkedAt`, `changedAt` and a deterministic `contentHash` while retaining `fetchedAt` for source freshness.
- Treat legacy snapshots as `checkedAt = changedAt = fetchedAt` with an unknown hash.
- Refresh public-player match discovery at most once every thirty minutes unless the user
  explicitly requests a refresh. A player refresh never refreshes a static catalog.
- Run an independent Dota 2 official Patch/update sentinel every two hours.
- Refresh the official hero, ability and item catalogs when the official version changes, and
  otherwise reconcile their content hashes every seven days.
- Recheck partial static catalogs after two hours instead of retaining a degraded catalog for
  the full reconciliation interval.
- Inside the TTL, reuse persisted catalogs and skip their upstream requests and database writes.
- After the TTL, normalize and hash the complete catalog. If the hash is unchanged, update only the snapshot. If it changed, atomically replace the catalog using set-based SQL.
- Compare the latest player matches with persisted documents and write only new or materially changed matches. Existing enriched details remain authoritative over a repeated summary response.
- Batch match document and player-membership writes in set-based PostgreSQL statements. Keep deterministic advisory locking and document merge behavior.
- Keep recent-match detail enrichment asynchronous within the existing job for this pass; separating it into another durable job is a later slice.

The two-hour sentinel interval is a freshness SLA, not an estimate of Valve's release cadence.
A future patch-watch mode may temporarily shorten it after a newly detected Patch; that mode is
not part of this decision and must not be claimed until it is implemented and monitored.

## Why not Redis yet

The preview currently runs one always-on API instance. PostgreSQL snapshots and advisory locks already provide durable cross-request coordination. Redis would add another service without removing the upstream check or the row-at-a-time SQL pattern. Redis remains appropriate when Dodo adds multiple API replicas, a durable worker queue, rate limiting or hot aggregate caching.

## Acceptance criteria

1. No account refresh calls a static catalog provider, regardless of its age.
2. A stale but unchanged catalog updates snapshot freshness without rewriting catalog rows.
3. A repeated account refresh does not submit unchanged match documents.
4. First-time imports and changed catalogs use bounded, set-based SQL rather than one statement per row.
5. Private, partial, rate-limited, unavailable and failed states retain their existing meaning.
6. Account `224328273` remains readable throughout refresh, finishes successfully and has materially lower repeated-sync latency.
