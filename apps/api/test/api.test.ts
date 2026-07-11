import {
  accountResolutionResponseSchema,
  apiErrorSchema,
  dataStatusResponseSchema,
  heroDetailResponseSchema,
  heroesResponseSchema,
  itemDetailResponseSchema,
  itemsResponseSchema,
  mapFeaturesResponseSchema,
  mapVersionResponseSchema,
  matchDetailResponseSchema,
  playerHeroResponseSchema,
  playerHeroesResponseSchema,
  playerMatchesResponseSchema,
  playerOverviewResponseSchema,
  syncJobResponseSchema,
} from "@dodo/contracts";
import {
  createSeedRepository,
  SEED_ACCOUNT_ID,
  SEED_HISTORY_PRIVATE_ACCOUNT_ID,
  SEED_PARTIAL_ACCOUNT_ID,
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
    itemsResponseSchema.parse(json(await app.inject({ method: "GET", url: "/v1/items" })));
    itemDetailResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/items/1" })),
    );
    mapVersionResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/maps/current" })),
    );
    mapFeaturesResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/maps/seed-map/features" })),
    );
    dataStatusResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/data-status" })),
    );
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

  it("never paginates beyond the frozen last-100 match window", async () => {
    const ids: string[] = [];
    let cursor: string | null = null;

    do {
      const query = cursor ? `?limit=37&cursor=${encodeURIComponent(cursor)}` : "?limit=37";
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
