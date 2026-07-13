# ADR 0006: Publish only reproducible static map snapshots

## Status

Accepted for phase 5 foundation. No live snapshot is accepted yet.

## Context

Official 7.41 and 7.41d patch notes describe map changes but do not publish machine-readable coordinates. `dotaconstants` does not contain current map geometry, and the reviewed GameTracking mirror does not include a license or the current main-map instance. A database row alone is therefore not evidence that a map is current or reusable.

The live API must continue returning `MAP_UNAVAILABLE` until a snapshot can be reproduced from a specified Steam App 570 build and reviewed for the intended use. Heatmaps, movement paths, ward recommendations, terrain rasters and replay parsing remain outside the MVP.

## Decision

- A map snapshot is derived only from a legally accessed App 570 build. Record the build ID, depot manifest ID, map resource path, resource SHA-256, extractor name/version and canonical snapshot SHA-256.
- `patch` means the official Dota patch against which this exact snapshot was verified. A known map-changing patch invalidates the current pointer until a new snapshot is reviewed.
- `sourceSnapshot` is an immutable manifest URI. `sourceUrls` contains the official patch/build evidence used by reviewers.
- `quality` is stored with the immutable map payload. `complete` means every type declared by the reviewed inventory is included; `partial` requires explicit exclusions and still contains real verified features.
- Geometry is strict two-dimensional GeoJSON-shaped `Point`, `LineString` or `Polygon` in `source2-world-units`. Coordinates must be finite and inside the declared render bounds.
- Every feature has at least one resource/entity source reference. Feature IDs and coverage types are unique. Included types must contain real features; omitted types are explicitly explained in `coverage.exclusions`.
- Lanes require extracted waypoint topology before publication. Roshan points describe pits/spawners, not his live position. No terrain, river, high-ground, tree, radius or route geometry is inferred.
- Canonical hashing omits the self-referential `sourceRevision.snapshotSha256`, sorts object keys and features by ID, and preserves coordinate order. Re-importing the same current ID/hash is a no-op. A changed payload requires a new revision ID.
- The repository stores the map and its static snapshot atomically. API quality and timestamps come from that snapshot; routes do not infer `complete` merely because a current row exists.
- No official minimap texture or other game asset is copied into the repository. Commercial reuse of extracted game content requires a separate Valve/ legal decision; this ADR authorizes only the technical foundation and factual derived data subject to that review.

## Primary evidence

- Official patch list: `https://www.dota2.com/datafeed/patchnoteslist?language=schinese`
- Official 7.41 data: `https://www.dota2.com/datafeed/patchnotes?version=7.41&language=schinese`
- Steam build/depot documentation: `https://partner.steamgames.com/doc/store/application/builds`
- Steam Subscriber Agreement: `https://store.steampowered.com/subscriber_agreement/`

## Consequences

Phase 5 can implement validation, deterministic fixtures, idempotent persistence, honest API states and Web coverage UI without publishing invented coordinates. Production remains unavailable until a reviewed manifest and lawful source extraction are supplied.
