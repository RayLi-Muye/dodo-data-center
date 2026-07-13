# ADR 0003: STRATZ is a secondary match enrichment provider

## Status

Accepted — 2026-07-13

## Context

OpenDota supplies the MVP player sync and match baseline, but parsed matches do not always include timed ability upgrades and item purchase events. STRATZ exposes those replay-derived events and player or hero aggregates. Its game-version catalog can lag the current Valve release, replay processing can be delayed, and authenticated use is rate limited.

## Decision

- Keep Dota 2 official current-data as the authority for current heroes, abilities, items and update notes.
- Keep OpenDota as the primary public-player and match ingestion provider.
- Use STRATZ only on the server as a secondary match-detail enrichment provider.
- In the first integration, accept timed ability upgrades and purchase events. Do not infer sales from final inventory or incomplete inventory snapshots.
- Preserve existing OpenDota fields when STRATZ is unavailable, rate limited, delayed or partial.
- Record `stratz` in `enrichmentSources` and include it in response `meta.sources` only when STRATZ data was actually persisted.
- Do not use STRATZ game-version IDs to assign the public `officialVersion`.
- Do not use STRATZ as the MVP map provider.

## Consequences

The API gains more complete match timelines without making STRATZ a single point of failure. Provider errors, caching and write idempotency must be tested independently. `STRATZ_TOKEN` remains a server-only secret and must never appear in client bundles, logs or repository files.
