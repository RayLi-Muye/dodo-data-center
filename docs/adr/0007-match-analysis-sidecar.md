# ADR 0007: Store parsed match analysis as a sidecar

## Status

Accepted for Wave 18.

## Context

`dodo.matches.payload` is the compact source for player match lists and player-level aggregation. Parsed timelines and event breakdowns can add thousands of values to one match. Embedding them in the same JSONB payload would force list and metric queries to load analysis data they do not use.

Parsed fields also have different freshness and completeness from the core match. A valid ten-player match may temporarily have unavailable timelines while OpenDota replay parsing is pending. Missing analysis must not make the core match disappear, and a weaker refresh must not erase richer stored facts.

## Decision

- Keep `dodo.matches` limited to `MatchCoreDetail`.
- Store OpenDota parsed facts in one `dodo.match_analysis` row keyed by `match_id` with a cascading foreign key.
- Combine core and sidecar only for `GET /v1/matches/{matchId}` and the matching enrichment response.
- Do not read the sidecar for player match lists or aggregate metrics.
- Version the normalized payload with `providerRevision`.
- Keep independent `unavailable|partial|complete` status and exclusions for every analysis section.
- Preserve richer sections when a weaker payload arrives; a new complete section is an authoritative snapshot for that provider revision.
- Provider errors do not write an empty sidecar. A legacy match without a sidecar receives an unavailable analysis only at the HTTP composition boundary.

## Consequences

- Single-match reads perform one additional primary-key lookup.
- Player lists and aggregate calculations keep their existing compact read path.
- Core and analysis can be refreshed independently without misrepresenting parse-pending data as an empty event set.
- Repository implementations need matching Memory and PostgreSQL merge behavior and explicit idempotency tests.
- Future replay parsers can use a new provider revision or a separate source-specific sidecar without changing historical core match rows.
