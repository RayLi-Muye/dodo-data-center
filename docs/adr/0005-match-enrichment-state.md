# ADR 0005: Persist match enrichment state separately from source attribution

## Status

Accepted for phase 4 implementation.

## Context

`enrichmentSources=["stratz"]` means that validated STRATZ data changed a stored match. It does not say whether the upstream response was complete. Using that array as completion state creates two opposite bugs: a no-change complete response is retried forever, while a changed partial response is never retried.

STRATZ currently supplies purchase events but not a complete sale ledger. Therefore `itemTimelineStatus=partial` is a capability statement and cannot by itself make the whole match retryable.

## Decision

- Add a persistent `stratzEnrichment` state to each stored match payload.
- Keep `enrichmentSources` as attribution only.
- Treat an accepted STRATZ response with `quality=complete` as terminal `complete`, even though purchase-only item timelines remain partial.
- Retry an accepted partial, not-found or invalid single-match response after 15 minutes, then 2 hours, then 24 hours. After four total attempts (the initial attempt plus three retries), retain existing data and settle as `terminal_partial` when STRATZ contributed data, otherwise `terminal_failed`.
- Core or player identity conflicts are terminal failures for the current provider revision.
- Authentication, rate-limit and provider-unavailable failures stop the current batch. They do not consume the match attempt budget and become `provider_blocked` with a bounded retry time.
- `providerRevision=stratz-graphql-v1` makes the normalization contract explicit. A future revision may reopen terminal states deliberately.
- Candidate selection uses this state and `nextAttemptAt`; it must not use `enrichmentSources` or `itemTimelineStatus` as completion proxies.
- Event merging remains monotonic: partial or empty upstream data cannot erase existing timelines, and sale events, levels or times are never inferred.

## Batch progress

`GET /v1/players/{accountId}/enrichment?scope=recent|all_imported` computes progress from persisted match states. `POST` processes a bounded batch of at most 20 retry-eligible matches. `recent` means the newest 20 imported matches; `all_imported` means every imported public match. Repeated calls are idempotent and continue from remaining eligible states without a separate cursor table.

`POST /v1/matches/{matchId}/enrichment` refreshes one stored match. It first obtains OpenDota detail when the stored record is only a summary, then applies optional STRATZ enrichment. The endpoint never bypasses Steam/Dota privacy and never clears readable OpenDota data on failure.

## Deployment boundary

Production remains single-instance during MVP. In-process request coalescing plus persistent per-match state is sufficient for this phase. Before multiple API replicas, add a database lease around external per-match and provider-batch calls.
