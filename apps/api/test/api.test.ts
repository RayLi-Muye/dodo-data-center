import {
  accountResolutionResponseSchema,
  apiErrorSchema,
  dataStatusResponseSchema,
  entityUpdatesResponseSchema,
  heroDetailResponseSchema,
  heroesResponseSchema,
  itemDetailResponseSchema,
  itemDetailsResponseSchema,
  itemsResponseSchema,
  mapFeaturesResponseSchema,
  mapVersionResponseSchema,
  matchDetailResponseSchema,
  patchesResponseSchema,
  playerHeroResponseSchema,
  playerHeroesResponseSchema,
  playerMatchesResponseSchema,
  playerOverviewResponseSchema,
  syncJobResponseSchema,
  updateDetailResponseSchema,
  updatesResponseSchema,
} from "@dodo/contracts";
import {
  createSeedRepository,
  SEED_ACCOUNT_ID,
  SEED_HISTORY_PRIVATE_ACCOUNT_ID,
  SEED_PARTIAL_ACCOUNT_ID,
  SEED_UPDATED_AT,
} from "@dodo/db";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";

const json = (response: { body: string }): unknown => JSON.parse(response.body);

describe("Dodo API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({ environment: "test", repository: await createSeedRepository() });
  });

  afterEach(async () => {
    await app.close();
  });

  it("serves every P0 route with its frozen response schema", async () => {
    const accountResolution = await app.inject({
      method: "POST",
      url: "/v1/account-resolutions",
      payload: { kind: "account_id", value: SEED_ACCOUNT_ID },
    });
    expect(accountResolution.statusCode).toBe(200);
    accountResolutionResponseSchema.parse(json(accountResolution));

    const sync = await app.inject({ method: "POST", url: `/v1/players/${SEED_ACCOUNT_ID}/sync` });
    expect(sync.statusCode).toBe(202);
    const syncData = syncJobResponseSchema.parse(json(sync));

    const job = await app.inject({ method: "GET", url: `/v1/sync-jobs/${syncData.data.jobId}` });
    syncJobResponseSchema.parse(json(job));

    const overview = await app.inject({ method: "GET", url: `/v1/players/${SEED_ACCOUNT_ID}` });
    playerOverviewResponseSchema.parse(json(overview));

    const matches = await app.inject({
      method: "GET",
      url: `/v1/players/${SEED_ACCOUNT_ID}/matches?limit=2`,
    });
    const matchesData = playerMatchesResponseSchema.parse(json(matches));
    expect(matchesData.data.nextCursor).not.toBeNull();

    const playerHeroes = await app.inject({
      method: "GET",
      url: `/v1/players/${SEED_ACCOUNT_ID}/heroes?window=last_20&limit=2`,
    });
    playerHeroesResponseSchema.parse(json(playerHeroes));

    const playerHero = await app.inject({
      method: "GET",
      url: `/v1/players/${SEED_ACCOUNT_ID}/heroes/1?window=last_100`,
    });
    playerHeroResponseSchema.parse(json(playerHero));

    const match = await app.inject({
      method: "GET",
      url: `/v1/matches/${matchesData.data.items[0]?.id}`,
    });
    matchDetailResponseSchema.parse(json(match));

    heroesResponseSchema.parse(json(await app.inject({ method: "GET", url: "/v1/heroes" })));
    heroDetailResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/heroes/1" })),
    );
    entityUpdatesResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/heroes/1/updates" })),
    );
    itemsResponseSchema.parse(json(await app.inject({ method: "GET", url: "/v1/items" })));
    itemDetailsResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/items/details" })),
    );
    itemDetailResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/items/1" })),
    );
    entityUpdatesResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/items/1/updates" })),
    );
    mapVersionResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/maps/current" })),
    );
    mapFeaturesResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/maps/seed-map/features" })),
    );
    patchesResponseSchema.parse(json(await app.inject({ method: "GET", url: "/v1/patches" })));
    updatesResponseSchema.parse(json(await app.inject({ method: "GET", url: "/v1/updates" })));
    updateDetailResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/updates/7.41" })),
    );
    dataStatusResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/data-status" })),
    );
  });

  it("lists official update summaries without groups and serves detail by version", async () => {
    const list = updatesResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/updates?limit=1" })),
    );
    expect(list.data.items).toHaveLength(1);
    expect(list.data.items[0]).toMatchObject({ version: "7.41", changeGroupCount: 4 });
    expect(list.data.items[0]).not.toHaveProperty("groups");

    const detail = updateDetailResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/updates/7.41" })),
    );
    expect(detail.data.groups).toHaveLength(4);
    expect(detail.data.groups[0]?.notes[0]?.text).toBe("Deterministic test-only update note.");

    const missing = await app.inject({ method: "GET", url: "/v1/updates/does-not-exist" });
    expect(missing.statusCode).toBe(404);
    expect(apiErrorSchema.parse(json(missing)).error.code).toBe("NOT_FOUND");
  });

  it("serves filtered hero and item update histories with empty and missing entity semantics", async () => {
    const hero = entityUpdatesResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/heroes/1/updates" })),
    );
    expect(hero.data.items).toEqual([
      expect.objectContaining({
        version: "7.41",
        matchedGroupCount: 1,
        groups: [expect.objectContaining({ kind: "hero", entityId: "1" })],
      }),
    ]);

    const item = entityUpdatesResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/items/1/updates" })),
    );
    expect(item.data.items[0]).toMatchObject({ matchedGroupCount: 2 });
    expect(item.data.items[0]?.groups.map((group) => group.kind)).toEqual([
      "item",
      "neutral_item",
    ]);

    const empty = entityUpdatesResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/heroes/2/updates" })),
    );
    expect(empty.data).toEqual({ items: [], nextCursor: null });

    const missing = await app.inject({ method: "GET", url: "/v1/heroes/999/updates" });
    expect(missing.statusCode).toBe(404);
    expect(apiErrorSchema.parse(json(missing)).error.code).toBe("NOT_FOUND");
  });

  it("defaults entity update histories to five releases and continues with a stable cursor", async () => {
    await app.close();
    const repository = await createSeedRepository();
    const seedUpdate = await repository.getUpdateRelease("7.41");
    const snapshot = await repository.getUpdateSnapshot();
    if (!seedUpdate || !snapshot) throw new Error("Seed update fixture missing");
    const heroGroup = seedUpdate.groups.find((group) => group.kind === "hero");
    if (!heroGroup) throw new Error("Seed hero update group missing");
    await repository.replaceUpdateReleases(
      Array.from({ length: 6 }, (_, index) => ({
        ...seedUpdate,
        version: `7.41-test-${index}`,
        releasedAt: new Date(Date.parse(SEED_UPDATED_AT) + index * 1_000).toISOString(),
        changeGroupCount: 1,
        groups: [heroGroup],
      })),
      snapshot,
    );
    app = await buildApp({ environment: "test", repository });

    const first = entityUpdatesResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/heroes/1/updates" })),
    );
    expect(first.data.items.map((release) => release.version)).toEqual([
      "7.41-test-5",
      "7.41-test-4",
      "7.41-test-3",
      "7.41-test-2",
      "7.41-test-1",
    ]);
    expect(first.data.nextCursor).not.toBeNull();

    const second = entityUpdatesResponseSchema.parse(
      json(
        await app.inject({
          method: "GET",
          url: `/v1/heroes/1/updates?cursor=${first.data.nextCursor}`,
        }),
      ),
    );
    expect(second.data.items.map((release) => release.version)).toEqual(["7.41-test-0"]);
    expect(second.data.nextCursor).toBeNull();

    const invalid = await app.inject({ method: "GET", url: "/v1/heroes/1/updates?limit=11" });
    expect(invalid.statusCode).toBe(400);
    expect(apiErrorSchema.parse(json(invalid)).error.code).toBe("VALIDATION_ERROR");
  });

  it("resolves account ID, Steam ID64, and supported profile URLs", async () => {
    const cases: InjectOptions[] = [
      {
        method: "POST",
        url: "/v1/account-resolutions",
        payload: { kind: "account_id", value: SEED_ACCOUNT_ID },
      },
      {
        method: "POST",
        url: "/v1/account-resolutions",
        payload: { kind: "account_id", value: "0123456789" },
      },
      {
        method: "POST",
        url: "/v1/account-resolutions",
        payload: { kind: "steam_id64", value: "76561198083722517" },
      },
      {
        method: "POST",
        url: "/v1/account-resolutions",
        payload: {
          kind: "steam_profile_url",
          value: "https://steamcommunity.com/profiles/76561198083722517/",
        },
      },
    ];

    for (const request of cases) {
      const response = await app.inject(request);
      const body = accountResolutionResponseSchema.parse(json(response));
      expect(body.data.accountId).toBe(SEED_ACCOUNT_ID);
      expect(body.meta).not.toHaveProperty("sampleSize");
    }
  });

  it("rejects vanity URLs and malformed input with frozen error codes", async () => {
    const vanity = await app.inject({
      method: "POST",
      url: "/v1/account-resolutions",
      payload: { kind: "steam_profile_url", value: "https://steamcommunity.com/id/example" },
    });
    expect(vanity.statusCode).toBe(400);
    expect(apiErrorSchema.parse(json(vanity)).error.code).toBe("UNSUPPORTED_ACCOUNT_REFERENCE");

    const insecureProfileUrl = await app.inject({
      method: "POST",
      url: "/v1/account-resolutions",
      payload: {
        kind: "steam_profile_url",
        value: "http://steamcommunity.com/profiles/76561198083722517",
      },
    });
    expect(insecureProfileUrl.statusCode).toBe(400);
    expect(apiErrorSchema.parse(json(insecureProfileUrl)).error.code).toBe(
      "INVALID_ACCOUNT_ID",
    );

    const invalidReference = await app.inject({
      method: "POST",
      url: "/v1/account-resolutions",
      payload: { kind: "account_id", value: "not-numeric" },
    });
    expect(apiErrorSchema.parse(json(invalidReference)).error.code).toBe("VALIDATION_ERROR");

    const outOfRangeAccount = await app.inject({
      method: "POST",
      url: "/v1/account-resolutions",
      payload: { kind: "account_id", value: "9999999999" },
    });
    expect(apiErrorSchema.parse(json(outOfRangeAccount)).error.code).toBe(
      "INVALID_ACCOUNT_ID",
    );

    const zeroAccount = await app.inject({
      method: "GET",
      url: "/v1/players/0",
    });
    expect(apiErrorSchema.parse(json(zeroAccount)).error.code).toBe("INVALID_ACCOUNT_ID");

    const outOfRangePlayer = await app.inject({
      method: "GET",
      url: "/v1/players/9999999999",
    });
    expect(apiErrorSchema.parse(json(outOfRangePlayer)).error.code).toBe(
      "INVALID_ACCOUNT_ID",
    );

    const invalidAccount = await app.inject({ method: "GET", url: "/v1/players/not-numeric" });
    expect(invalidAccount.statusCode).toBe(400);
    expect(apiErrorSchema.parse(json(invalidAccount)).error.code).toBe("INVALID_ACCOUNT_ID");

    const invalidPage = await app.inject({
      method: "GET",
      url: `/v1/players/${SEED_ACCOUNT_ID}/matches?limit=101`,
    });
    expect(apiErrorSchema.parse(json(invalidPage)).error.code).toBe("VALIDATION_ERROR");
  });

  it("returns explicit not-found and privacy outcomes instead of empty statistics", async () => {
    const missing = await app.inject({ method: "GET", url: "/v1/players/999999999" });
    expect(missing.statusCode).toBe(404);
    expect(apiErrorSchema.parse(json(missing)).error.code).toBe("NOT_FOUND");

    const privateResponse = await app.inject({
      method: "GET",
      url: `/v1/players/${SEED_HISTORY_PRIVATE_ACCOUNT_ID}/heroes`,
    });
    expect(privateResponse.statusCode).toBe(403);
    const privateBody = apiErrorSchema.parse(json(privateResponse));
    expect(privateBody.error.code).toBe("HISTORY_PRIVATE");
    expect(privateBody.meta?.status).toBe("history_private");

    const missingHero = await app.inject({ method: "GET", url: "/v1/heroes/999" });
    expect(missingHero.statusCode).toBe(404);
    expect(apiErrorSchema.parse(json(missingHero)).error.code).toBe("NOT_FOUND");
  });

  it.each([
    ["source_rate_limited", 429, "SOURCE_RATE_LIMITED"],
    ["source_unavailable", 503, "SOURCE_UNAVAILABLE"],
    ["syncing", 409, "SYNC_IN_PROGRESS"],
    ["failed", 500, "INTERNAL_ERROR"],
  ] as const)("maps %s to its frozen HTTP outcome", async (status, statusCode, errorCode) => {
    const repository = await createSeedRepository();
    await repository.upsertPlayer({
      accountId: "555555555",
      steamId64: null,
      personaName: "Seed Status Player",
      avatarUrl: null,
      status,
      importedMatchCount: 0,
      earliestImportedAt: null,
      latestImportedAt: null,
    });
    await app.close();
    app = await buildApp({ environment: "test", repository });

    const response = await app.inject({ method: "GET", url: "/v1/players/555555555" });
    const body = apiErrorSchema.parse(json(response));

    expect(response.statusCode).toBe(statusCode);
    expect(body.error.code).toBe(errorCode);
    expect(body.meta?.status).toBe(status);
  });

  it("returns actual partial player data with partial quality", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/v1/players/${SEED_PARTIAL_ACCOUNT_ID}`,
    });
    const body = playerOverviewResponseSchema.parse(json(response));

    expect(response.statusCode).toBe(200);
    expect(body.data.games).toBe(3);
    expect(body.data.profile.status).toBe("public_partial");
    expect(body.meta.quality).toBe("partial");
  });

  it("returns parse-pending as a 409 state rather than empty statistics", async () => {
    const repository = await createSeedRepository();
    await repository.upsertPlayer({
      accountId: "555555555",
      steamId64: null,
      personaName: "Seed Parse Pending Player",
      avatarUrl: null,
      status: "parse_pending",
      importedMatchCount: 0,
      earliestImportedAt: null,
      latestImportedAt: null,
    });
    await app.close();
    app = await buildApp({ environment: "test", repository });

    const overview = await app.inject({ method: "GET", url: "/v1/players/555555555" });
    const overviewBody = apiErrorSchema.parse(json(overview));
    expect(overview.statusCode).toBe(409);
    expect(overviewBody.error.code).toBe("PARSE_PENDING");
    expect(overviewBody.meta?.status).toBe("parse_pending");

    const job = syncJobResponseSchema.parse(
      json(await app.inject({ method: "POST", url: "/v1/players/555555555/sync" })),
    );
    expect(job.data.status).toBe("parse_pending");
    expect(job.data.errorCode).toBe("PARSE_PENDING");
  });

  it("keeps sync requests idempotent and exposes terminal jobs", async () => {
    const first = syncJobResponseSchema.parse(
      json(await app.inject({ method: "POST", url: `/v1/players/${SEED_ACCOUNT_ID}/sync` })),
    );
    const second = syncJobResponseSchema.parse(
      json(await app.inject({ method: "POST", url: `/v1/players/${SEED_ACCOUNT_ID}/sync` })),
    );

    expect(second.data).toEqual(first.data);
    expect(first.data.status).toBe("public_complete");
    expect(first.data.completedAt).not.toBeNull();

    const privateJob = syncJobResponseSchema.parse(
      json(
        await app.inject({
          method: "POST",
          url: `/v1/players/${SEED_HISTORY_PRIVATE_ACCOUNT_ID}/sync`,
        }),
      ),
    );
    expect(privateJob.data.status).toBe("history_private");
    expect(privateJob.data.errorCode).toBe("HISTORY_PRIVATE");

    const leadingZero = syncJobResponseSchema.parse(
      json(await app.inject({ method: "POST", url: "/v1/players/0123456789/sync" })),
    );
    expect(leadingZero.data).toEqual(first.data);

    const leadingZeroJob = syncJobResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/sync-jobs/job-0123456789" })),
    );
    expect(leadingZeroJob.data).toEqual(first.data);
  });

  it("canonicalizes leading-zero player paths before repository lookup", async () => {
    const canonical = playerOverviewResponseSchema.parse(
      json(await app.inject({ method: "GET", url: `/v1/players/${SEED_ACCOUNT_ID}` })),
    );
    const leadingZero = playerOverviewResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/players/0123456789" })),
    );

    expect(leadingZero.data).toEqual(canonical.data);
    expect(leadingZero.data.profile.accountId).toBe(SEED_ACCOUNT_ID);
  });

  it("uses opaque cursor pagination without changing stable match order", async () => {
    const firstResponse = await app.inject({
      method: "GET",
      url: `/v1/players/${SEED_ACCOUNT_ID}/matches?limit=2`,
    });
    const first = playerMatchesResponseSchema.parse(json(firstResponse));
    expect(first.data.items.map((match) => match.id)).toEqual(["9000000001", "9000000000"]);

    const secondResponse = await app.inject({
      method: "GET",
      url: `/v1/players/${SEED_ACCOUNT_ID}/matches?limit=2&cursor=${first.data.nextCursor}`,
    });
    const second = playerMatchesResponseSchema.parse(json(secondResponse));
    expect(second.data.items.map((match) => match.id)).toEqual(["9000000002", "9000000003"]);

    const badCursor = await app.inject({
      method: "GET",
      url: `/v1/players/${SEED_ACCOUNT_ID}/matches?cursor=not-a-cursor`,
    });
    expect(apiErrorSchema.parse(json(badCursor)).error.code).toBe("VALIDATION_ERROR");
  });

  it("never paginates beyond an explicitly selected last-100 match window", async () => {
    const ids: string[] = [];
    let cursor: string | null = null;

    do {
      const query = cursor
        ? `?window=last_100&limit=37&cursor=${encodeURIComponent(cursor)}`
        : "?window=last_100&limit=37";
      const response = playerMatchesResponseSchema.parse(
        json(
          await app.inject({
            method: "GET",
            url: `/v1/players/${SEED_ACCOUNT_ID}/matches${query}`,
          }),
        ),
      );
      ids.push(...response.data.items.map((match) => match.id));
      cursor = response.data.nextCursor;
    } while (cursor);

    expect(ids).toHaveLength(100);
    expect(new Set(ids).size).toBe(100);
    expect(ids.slice(0, 4)).toEqual([
      "9000000001",
      "9000000000",
      "9000000002",
      "9000000003",
    ]);
    for (let excludedIndex = 100; excludedIndex < 105; excludedIndex += 1) {
      expect(ids).not.toContain(String(9_000_000_000 + excludedIndex));
    }
  });

  it("filters by patch before applying player windows and exposes all imported matches", async () => {
    const repository = await createSeedRepository();
    const importedMatches = await repository.listPlayerMatches(SEED_ACCOUNT_ID);
    for (const [index, match] of importedMatches.entries()) {
      await repository.upsertMatch({
        ...match,
        detail: {
          ...match.detail,
          officialVersion: index < 10 ? "new-patch" : "old-patch",
          officialVersionSource: "start_time_inferred",
        },
      });
    }
    await app.close();
    app = await buildApp({ environment: "test", repository });

    const overview = playerOverviewResponseSchema.parse(
      json(
        await app.inject({
          method: "GET",
          url: `/v1/players/${SEED_ACCOUNT_ID}?window=last_20&patch=old-patch`,
        }),
      ),
    );
    expect(overview.data.games).toBe(20);
    expect(overview.meta.filtersApplied).toEqual({ window: "last_20", patch: "old-patch" });

    const matches = playerMatchesResponseSchema.parse(
      json(
        await app.inject({
          method: "GET",
          url: `/v1/players/${SEED_ACCOUNT_ID}/matches?window=last_20&patch=old-patch&limit=100`,
        }),
      ),
    );
    expect(matches.data.items).toHaveLength(20);
    expect(matches.data.items.map((match) => match.id)).toEqual(
      importedMatches.slice(10, 30).map((match) => match.detail.id),
    );
    expect(matches.meta.filtersApplied).toEqual({
      window: "last_20",
      patch: "old-patch",
      heroId: null,
      outcome: null,
      gameMode: null,
      lobbyType: null,
      dateFrom: null,
      dateTo: null,
    });

    const heroes = playerHeroesResponseSchema.parse(
      json(
        await app.inject({
          method: "GET",
          url: `/v1/players/${SEED_ACCOUNT_ID}/heroes?window=last_20&patch=old-patch`,
        }),
      ),
    );
    expect(heroes.data.items.reduce((sum, hero) => sum + hero.games, 0)).toBe(20);
    expect(heroes.meta.filtersApplied).toEqual({ window: "last_20", patch: "old-patch" });

    const selectedHeroId = matches.data.items[0]!.player.heroId;
    const hero = playerHeroResponseSchema.parse(
      json(
        await app.inject({
          method: "GET",
          url: `/v1/players/${SEED_ACCOUNT_ID}/heroes/${selectedHeroId}?window=last_20&patch=old-patch`,
        }),
      ),
    );
    expect(hero.data.games).toBe(
      matches.data.items.filter((match) => match.player.heroId === selectedHeroId).length,
    );
    expect(hero.meta.filtersApplied).toEqual({
      window: "last_20",
      patch: "old-patch",
      heroId: selectedHeroId,
    });

    const allImported = playerMatchesResponseSchema.parse(
      json(
        await app.inject({
          method: "GET",
          url: `/v1/players/${SEED_ACCOUNT_ID}/matches?window=all_imported&patch=old-patch&limit=100`,
        }),
      ),
    );
    expect(allImported.data.items).toHaveLength(95);
    expect(allImported.data.nextCursor).toBeNull();
  });

  it("infers an official version when reading a legacy major-patch match", async () => {
    const repository = await createSeedRepository();
    const stored = (await repository.listPlayerMatches(SEED_ACCOUNT_ID))[0]!;
    await repository.upsertMatch({
      ...stored,
      detail: {
        ...stored.detail,
        officialVersion: null,
        openDotaPatchId: "60",
        officialVersionSource: "unavailable",
      },
    });
    await repository.replacePatches(
      [{ id: "7.41d", name: "7.41d", releasedAt: "2024-12-01T00:00:00.000Z" }],
      {
        source: "dota2_official",
        quality: "complete",
        fetchedAt: SEED_UPDATED_AT,
        checkedAt: SEED_UPDATED_AT,
        changedAt: SEED_UPDATED_AT,
        contentHash: "official-patches",
        officialVersion: "7.41d",
      },
    );
    await app.close();
    app = await buildApp({ environment: "test", repository });

    const response = matchDetailResponseSchema.parse(
      json(await app.inject({ method: "GET", url: `/v1/matches/${stored.detail.id}` })),
    );
    expect(response.data).toMatchObject({
      officialVersion: "7.41d",
      openDotaPatchId: "60",
      officialVersionSource: "start_time_inferred",
    });
  });

  it("attributes persisted STRATZ enrichment in match response metadata", async () => {
    const repository = await createSeedRepository();
    const stored = (await repository.listPlayerMatches(SEED_ACCOUNT_ID))[0]!;
    await repository.upsertMatch({
      ...stored,
      detail: {
        ...stored.detail,
        enrichmentSources: ["stratz"],
      },
    });
    await app.close();
    app = await buildApp({ environment: "test", repository });

    const response = matchDetailResponseSchema.parse(
      json(await app.inject({ method: "GET", url: `/v1/matches/${stored.detail.id}` })),
    );
    expect(response.data.enrichmentSources).toEqual(["stratz"]);
    expect(response.meta.sources).toEqual(["seed", "stratz"]);
  });

  it("defaults match browsing to 30 all-imported results", async () => {
    const response = playerMatchesResponseSchema.parse(
      json(
        await app.inject({
          method: "GET",
          url: `/v1/players/${SEED_ACCOUNT_ID}/matches`,
        }),
      ),
    );

    expect(response.data.items).toHaveLength(30);
    expect(response.data.nextCursor).not.toBeNull();
    expect(response.meta.filtersApplied).toEqual({
      window: "all_imported",
      patch: null,
      heroId: null,
      outcome: null,
      gameMode: null,
      lobbyType: null,
      dateFrom: null,
      dateTo: null,
    });
  });

  it("applies combined match filters before the window and keeps them across pages", async () => {
    const repository = await createSeedRepository();
    await app.close();
    app = await buildApp({ environment: "test", repository });
    const query = [
      "heroId=1",
      "patch=seed-patch",
      "outcome=win",
      "gameMode=seed-ranked-all-pick",
      "lobbyType=seed-lobby",
      "dateFrom=2024-12-29",
      "dateTo=2025-01-01",
      "window=last_20",
      "limit=3",
    ].join("&");

    const first = playerMatchesResponseSchema.parse(
      json(
        await app.inject({
          method: "GET",
          url: `/v1/players/${SEED_ACCOUNT_ID}/matches?${query}`,
        }),
      ),
    );
    expect(first.data.items).toHaveLength(3);
    expect(first.data.items.every((match) => match.player.heroId === "1")).toBe(true);
    expect(first.data.items.every((match) => match.player.isWin)).toBe(true);
    expect(first.data.items.every((match) => match.officialVersion === "seed-patch")).toBe(true);
    expect(first.data.items.every((match) => match.gameMode === "seed-ranked-all-pick")).toBe(
      true,
    );
    expect(first.data.items.every((match) => match.lobbyType === "seed-lobby")).toBe(true);
    expect(first.meta.filtersApplied).toEqual({
      window: "last_20",
      patch: "seed-patch",
      heroId: "1",
      outcome: "win",
      gameMode: "seed-ranked-all-pick",
      lobbyType: "seed-lobby",
      dateFrom: "2024-12-29",
      dateTo: "2025-01-01",
    });

    const second = playerMatchesResponseSchema.parse(
      json(
        await app.inject({
          method: "GET",
          url: `/v1/players/${SEED_ACCOUNT_ID}/matches?${query}&cursor=${encodeURIComponent(first.data.nextCursor!)}`,
        }),
      ),
    );
    expect(second.data.items).toHaveLength(3);
    expect(second.data.items.every((match) => match.player.heroId === "1")).toBe(true);
    expect(new Set([...first.data.items, ...second.data.items].map((match) => match.id)).size).toBe(
      6,
    );
  });

  it("selects a hero's recent window after filtering by that hero", async () => {
    const response = playerMatchesResponseSchema.parse(
      json(
        await app.inject({
          method: "GET",
          url: `/v1/players/${SEED_ACCOUNT_ID}/matches?heroId=1&window=last_20&limit=30`,
        }),
      ),
    );

    expect(response.data.items).toHaveLength(20);
    expect(response.data.nextCursor).toBeNull();
    expect(response.data.items.every((match) => match.player.heroId === "1")).toBe(true);
  });

  it("includes both UTC date endpoints and rejects impossible calendar dates", async () => {
    const repository = await createSeedRepository();
    const matches = await repository.listPlayerMatches(SEED_ACCOUNT_ID);
    await repository.upsertMatch({
      ...matches[0]!,
      detail: { ...matches[0]!.detail, startTime: "2025-01-01T00:00:00.000Z" },
    });
    await repository.upsertMatch({
      ...matches[1]!,
      detail: { ...matches[1]!.detail, startTime: "2025-01-01T23:59:59.999Z" },
    });
    await app.close();
    app = await buildApp({ environment: "test", repository });

    const bounded = playerMatchesResponseSchema.parse(
      json(
        await app.inject({
          method: "GET",
          url: `/v1/players/${SEED_ACCOUNT_ID}/matches?dateFrom=2025-01-01&dateTo=2025-01-01&limit=100`,
        }),
      ),
    );
    expect(bounded.data.items.map((match) => match.id)).toContain(matches[0]!.detail.id);
    expect(bounded.data.items.map((match) => match.id)).toContain(matches[1]!.detail.id);
    expect(
      bounded.data.items.find((match) => match.id === matches[0]!.detail.id)?.startTime,
    ).toBe("2025-01-01T00:00:00.000Z");
    expect(
      bounded.data.items.find((match) => match.id === matches[1]!.detail.id)?.startTime,
    ).toBe("2025-01-01T23:59:59.999Z");

    const impossible = await app.inject({
      method: "GET",
      url: `/v1/players/${SEED_ACCOUNT_ID}/matches?dateFrom=2025-02-30`,
    });
    expect(impossible.statusCode).toBe(400);
    expect(apiErrorSchema.parse(json(impossible)).error.code).toBe("VALIDATION_ERROR");

    const reversed = await app.inject({
      method: "GET",
      url: `/v1/players/${SEED_ACCOUNT_ID}/matches?dateFrom=2025-02-01&dateTo=2025-01-31`,
    });
    expect(reversed.statusCode).toBe(400);
    expect(apiErrorSchema.parse(json(reversed)).error.code).toBe("VALIDATION_ERROR");
  });

  it("reconciles all-imported and last-100 metrics against match facts", async () => {
    const repository = await createSeedRepository();
    await app.close();
    app = await buildApp({ environment: "test", repository });

    const overview = playerOverviewResponseSchema.parse(
      json(await app.inject({ method: "GET", url: `/v1/players/${SEED_ACCOUNT_ID}` })),
    );
    expect(overview.data.games).toBe(100);
    expect(overview.data.heroes.reduce((sum, hero) => sum + hero.games, 0)).toBe(100);
    expect(overview.data.heroes.reduce((sum, hero) => sum + hero.wins, 0)).toBe(
      overview.data.wins,
    );
    expect(overview.meta.sampleSize).toBe(100);
    expect(overview.meta.coverageRate).toBe(1);
    expect(overview.meta.inputWatermark).toBe("2025-01-01T23:00:00.000Z");

    const allImported = playerHeroesResponseSchema.parse(
      json(
        await app.inject({
          method: "GET",
          url: `/v1/players/${SEED_ACCOUNT_ID}/heroes?window=all_imported`,
        }),
      ),
    );
    expect(allImported.meta.sampleSize).toBe(105);
    expect(allImported.meta.inputWatermark).toBe("2025-01-01T23:00:00.000Z");
    expect(allImported.data.items.reduce((sum, hero) => sum + hero.games, 0)).toBe(105);
    expect(allImported.data.items.reduce((sum, hero) => sum + hero.wins, 0)).toBe(53);

    const selected = (await repository.listPlayerMatches(SEED_ACCOUNT_ID)).slice(0, 100);
    const players = selected.map((match) =>
      match.detail.players.find((player) => player.accountId === SEED_ACCOUNT_ID),
    );
    const kills = players.reduce((sum, player) => sum + (player?.kills ?? 0), 0);
    const deaths = players.reduce((sum, player) => sum + (player?.deaths ?? 0), 0);
    const assists = players.reduce((sum, player) => sum + (player?.assists ?? 0), 0);
    expect(overview.data.kdaRatio).toBe((kills + assists) / Math.max(deaths, 1));
    expect(overview.data.fieldCoverage.gpm.observedCount).toBe(
      players.filter((player) => player?.gpm !== null).length,
    );

    const hero = playerHeroResponseSchema.parse(
      json(
        await app.inject({
          method: "GET",
          url: `/v1/players/${SEED_ACCOUNT_ID}/heroes/1?window=last_100`,
        }),
      ),
    );
    expect(hero.meta.inputWatermark).toBe("2025-01-01T23:00:00.000Z");
  });

  it("filters encyclopedia and map lists before pagination", async () => {
    const heroes = heroesResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/heroes?q=axe&patch=seed-patch" })),
    );
    expect(heroes.data.items.map((hero) => hero.id)).toEqual(["2"]);

    const items = itemsResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/items?limit=2" })),
    );
    expect(items.data.items.map((item) => item.localizedName)).toEqual([
      "Seed Black King Bar",
      "Seed Blink Dagger",
    ]);

    const details = itemDetailsResponseSchema.parse(
      json(
        await app.inject({
          method: "GET",
          url: "/v1/items/details?q=blink&patch=seed-patch&limit=1",
        }),
      ),
    );
    expect(details.data.items).toHaveLength(1);
    expect(details.data.items[0]).toMatchObject({
      id: "1",
      localizedName: "Seed Blink Dagger",
      officialVersion: "seed-patch",
    });
    expect(details.data.items[0]).toHaveProperty("description");
    expect(details.data.items[0]).toHaveProperty("attributes");

    const features = mapFeaturesResponseSchema.parse(
      json(
        await app.inject({
          method: "GET",
          url: "/v1/maps/seed-map/features?type=roshan&limit=1",
        }),
      ),
    );
    expect(features.data.items).toHaveLength(1);
    expect(features.data.items[0]?.type).toBe("roshan");
  });

  it("paginates complete hero and item catalogs beyond the 100-entry client page", async () => {
    await app.close();
    const repository = await createSeedRepository();
    const [heroTemplate, itemTemplate, heroSnapshot, itemSnapshot] = await Promise.all([
      repository.getHero("1"),
      repository.getItem("1"),
      repository.getHeroSnapshot(),
      repository.getItemSnapshot(),
    ]);
    if (!heroTemplate || !itemTemplate || !heroSnapshot || !itemSnapshot) {
      throw new Error("Seed encyclopedia fixture missing");
    }
    const ids = Array.from({ length: 127 }, (_, index) => String(index + 1));
    await repository.replaceHeroes(
      ids.map((id) => ({
        ...heroTemplate,
        id,
        name: `hero_${id.padStart(3, "0")}`,
        localizedName: `Hero ${id.padStart(3, "0")}`,
      })),
      heroSnapshot,
      ids,
    );
    await repository.replaceItems(
      ids.map((id) => ({
        ...itemTemplate,
        id,
        name: `item_${id.padStart(3, "0")}`,
        localizedName: `Item ${id.padStart(3, "0")}`,
      })),
      itemSnapshot,
      ids,
    );
    app = await buildApp({ environment: "test", repository });

    for (const resource of ["heroes", "items"] as const) {
      const schema = resource === "heroes" ? heroesResponseSchema : itemsResponseSchema;
      const first = schema.parse(
        json(await app.inject({ method: "GET", url: `/v1/${resource}?limit=100` })),
      );
      expect(first.data.items).toHaveLength(100);
      expect(first.data.nextCursor).not.toBeNull();
      const second = schema.parse(
        json(
          await app.inject({
            method: "GET",
            url: `/v1/${resource}?limit=100&cursor=${first.data.nextCursor}`,
          }),
        ),
      );
      expect(second.data.items).toHaveLength(27);
      expect(second.data.nextCursor).toBeNull();

      const overLimit = await app.inject({ method: "GET", url: `/v1/${resource}?limit=101` });
      expect(overLimit.statusCode).toBe(400);
    }
  });

  it("paginates the complete item-detail catalog with the catalog's stable order", async () => {
    await app.close();
    const repository = await createSeedRepository();
    const [itemTemplate, itemSnapshot] = await Promise.all([
      repository.getItem("1"),
      repository.getItemSnapshot(),
    ]);
    if (!itemTemplate || !itemSnapshot) throw new Error("Seed item fixture missing");
    const ids = Array.from({ length: 127 }, (_, index) => String(index + 1));
    await repository.replaceItems(
      ids.map((id) => ({
        ...itemTemplate,
        id,
        name: `item_${id.padStart(3, "0")}`,
        localizedName: `Item ${id.padStart(3, "0")}`,
      })),
      itemSnapshot,
      ids,
    );
    app = await buildApp({ environment: "test", repository });

    const first = itemDetailsResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/items/details?limit=100" })),
    );
    expect(first.data.items).toHaveLength(100);
    expect(first.data.items[0]?.localizedName).toBe("Item 001");
    expect(first.data.nextCursor).not.toBeNull();

    const second = itemDetailsResponseSchema.parse(
      json(
        await app.inject({
          method: "GET",
          url: `/v1/items/details?limit=100&cursor=${first.data.nextCursor}`,
        }),
      ),
    );
    expect(second.data.items).toHaveLength(27);
    expect(second.data.items[0]?.localizedName).toBe("Item 101");
    expect(second.data.nextCursor).toBeNull();

    const invalid = await app.inject({ method: "GET", url: "/v1/items/details?limit=101" });
    expect(invalid.statusCode).toBe(400);
  });

  it("only enables local CORS in development", async () => {
    await app.close();
    const developmentApp = await buildApp({ environment: "development" });
    const productionApp = await buildApp({ environment: "production" });

    const development = await developmentApp.inject({
      method: "GET",
      url: "/v1/data-status",
      headers: { origin: "http://localhost:3000" },
    });
    const production = await productionApp.inject({
      method: "GET",
      url: "/v1/data-status",
      headers: { origin: "http://localhost:3000" },
    });

    expect(development.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(production.headers["access-control-allow-origin"]).toBeUndefined();

    await developmentApp.close();
    await productionApp.close();
    app = await buildApp({ environment: "test" });
  });
});
