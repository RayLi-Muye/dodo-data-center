# ADR 0004: STRATZ cloud access requires an approved server token

## Status

Accepted for the MVP fallback path; external STRATZ authorization remains pending.

## Context

The same configured STRATZ token can read a known public match from a local developer machine, while the Railway Singapore API receives GraphQL `AUTHENTICATION: forbidden` with HTTP 403. OpenDota continues to provide the complete MVP baseline, so this failure affects optional timed ability and purchase enrichment rather than player-page availability.

STRATZ distinguishes token types by intended use. Its public knowledge base describes the default Steam-login token as suitable for small or personal projects and the Individual token as the option for websites and community applications. The same documentation requires attribution or referral traffic depending on token type. These pages are historical guidance; the current STRATZ token page and a response from STRATZ remain authoritative for an actual production grant.

## Decision

- Do not proxy, rotate exits, spoof users, or otherwise bypass the Railway 403.
- Keep STRATZ optional and server-only. OpenDota remains the readable match-detail fallback.
- Treat 403 `forbidden` as an access or authorization failure, not an empty match and not a privacy result.
- Apply for or request confirmation of an Individual server token for the Dodo website, explicitly naming the Railway Singapore runtime and the observed 403.
- Display STRATZ attribution whenever persisted STRATZ enrichment is shown, and keep `stratz` in response source metadata only when its data was actually persisted.
- Do not move the STRATZ token into Web, Vercel client code, logs, repository files, or user-visible diagnostics.
- Until production authorization succeeds, phase 2 is internally complete when fallback, classification, attribution and tests pass. Deployment acceptance remains externally pending and does not block official encyclopedia work.
- Phase 2 provides opportunistic enrichment only. A persisted partial STRATZ result is not evidence that every replay-derived event is complete; retry and backfill state is owned by the match-detail phase.

## Access request template

```text
Subject: Individual API token / server access for Dodo Data Center

We are building Dodo Data Center, a public Dota 2 account-analysis and encyclopedia website.
STRATZ is used only as an attributed secondary source for replay-derived ability and item
timelines; OpenDota remains our baseline. Our current Steam-login token succeeds locally,
but the same server-side GraphQL request from a Railway Singapore single-instance service
returns HTTP 403 with AUTHENTICATION: forbidden. Could you confirm the appropriate
Individual token and whether this Railway server runtime is permitted? We will follow the
documented rate limits, link attribution to https://stratz.com/, and never expose the token
to browsers.
```

## Acceptance evidence

- Local known-match query succeeds with the configured token.
- Railway known-match query returns HTTP 403 / `AUTHENTICATION: forbidden`.
- A known production match already enriched before the cloud restriction retains `enrichmentSources=["stratz"]` and its timed events.
- New enrichment failures leave the OpenDota detail readable and expose degraded optional-provider health.
- No STRATZ secret appears in client bundles, API payloads or logs.

## References

- [STRATZ token types](https://github.com/STRATZ-Esports/knowledge-base/issues/37)
- [STRATZ rate limits](https://github.com/STRATZ-Esports/knowledge-base/issues/15)
- [STRATZ attribution guidance](https://github.com/STRATZ-Esports/knowledge-base/issues/31)
- [STRATZ API and replay overview](https://stratz.com/welcome)
