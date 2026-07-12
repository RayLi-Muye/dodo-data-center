import {
  apiErrorSchema,
  dataStatusResponseSchema,
  heroDetailResponseSchema,
  itemDetailResponseSchema,
  matchDetailResponseSchema,
  patchesResponseSchema,
  playerHeroesResponseSchema,
  playerHistorySyncResponseSchema,
  playerMatchesResponseSchema,
  playerOverviewResponseSchema,
  syncJobResponseSchema,
  updateDetailResponseSchema,
  updatesResponseSchema,
  type UpdateReleaseDetail,
} from "@dodo/contracts";
import {
  OpenDotaProviderError,
  type CanonicalConstantsSnapshot,
  type CanonicalHeroAbilityConstants,
  type CanonicalHeroConstant,
  type CanonicalItemConstant,
  type CanonicalMatchDetail,
  type CanonicalPlayerMatchesPage,
  type CanonicalPatchSummary,
  type CanonicalOfficialConstantsSnapshot,
  type CanonicalOfficialHeroAbilityConstants,
  type CanonicalPlayerProfile,
  type CanonicalRecentMatches,
} from "@dodo/dota-data";
import { createLiveRepository } from "@dodo/db";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import type { PlayerDataProvider } from "../src/player-data-provider.js";
import { PlayerHistorySyncService } from "../src/player-history-sync-service.js";
import { PlayerSyncService } from "../src/player-sync-service.js";
import { StaticCatalogService } from "../src/static-catalog-service.js";

const ACCOUNT_ID = "86745912";
const FETCHED_AT = "2026-07-10T01:00:00.000Z";
const ABILITIES_FETCHED_AT = "2026-07-10T01:00:00.500Z";
const CLOCK_AT = "2026-07-10T01:00:01.000Z";
const SOURCE = { source: "opendota" as const, fetchedAt: FETCHED_AT };
const OFFICIAL_SOURCE = { source: "dota2_official" as const, fetchedAt: FETCHED_AT };

const profile: CanonicalPlayerProfile = {
  accountId: ACCOUNT_ID,
  steamId64: "76561198047011640",
  personaName: "Public Test Player",
  avatarUrl: "https://fixtures.invalid/public-player.png",
  status: "public_complete",
  source: SOURCE,
};

const recent: CanonicalRecentMatches = {
  accountId: ACCOUNT_ID,
  requestedLimit: 100,
  eligibleCount: 3,
  excludedCount: 1,
  exclusionReasons: ["radiant_win_unavailable"],
  quality: "partial",
  source: SOURCE,
  candidateLedger: [
    { providerIndex: 0, status: "included", matchId: "8000000002" },
    {
      providerIndex: 1,
      status: "excluded",
      exclusionReasons: ["radiant_win_unavailable"],
    },
    { providerIndex: 2, status: "included", matchId: "8000000001" },
  ],
  matches: [
    {
      id: "8000000002",
      startTime: "2026-07-09T02:00:00.000Z",
      durationSeconds: 2400,
      patchId: null,
      gameMode: "22",
      lobbyType: "7",
      region: "3",
      radiantWin: true,
      player: {
        accountId: ACCOUNT_ID,
        eligibleForPersonalAggregation: true,
        playerSlot: 0,
        heroId: "1",
        side: "radiant",
        isWin: true,
        kills: 10,
        deaths: 2,
        assists: 12,
        gpm: 610,
        xpm: 700,
        lastHits: 260,
        denies: 8,
        heroDamage: 30_000,
        heroHealing: 0,
        towerDamage: 4_000,
        level: 25,
        netWorth: 24_000,
        finalItemIds: ["1", "2"],
        backpackItemIds: [],
        neutralItemId: null,
        neutralItemEnhancementId: "1592",
        abilityBuild: [],
        abilityBuildStatus: "unavailable",
        itemTimeline: [
          { itemKey: "blink", action: "purchase", gameTimeSeconds: 900, charges: null },
          { itemKey: "unknown_item", action: "purchase", gameTimeSeconds: 950, charges: null },
        ],
        itemTimelineStatus: "partial",
      },
    },
    {
      id: "8000000001",
      startTime: "2026-07-09T01:00:00.000Z",
      durationSeconds: 2100,
      patchId: "59",
      gameMode: "22",
      lobbyType: "7",
      region: "3",
      radiantWin: true,
      player: {
        accountId: ACCOUNT_ID,
        eligibleForPersonalAggregation: true,
        playerSlot: 128,
        heroId: "2",
        side: "dire",
        isWin: false,
        kills: 3,
        deaths: 8,
        assists: 9,
        gpm: null,
        xpm: 480,
        lastHits: 120,
        denies: null,
        heroDamage: 14_000,
        heroHealing: null,
        towerDamage: null,
        level: null,
        netWorth: null,
        finalItemIds: ["1"],
        backpackItemIds: [],
        neutralItemId: null,
        neutralItemEnhancementId: null,
        abilityBuild: [],
        abilityBuildStatus: "unavailable",
        itemTimeline: [],
        itemTimelineStatus: "unavailable",
      },
    },
  ],
};

const heroes: CanonicalOfficialConstantsSnapshot<CanonicalHeroConstant> = {
  source: OFFICIAL_SOURCE,
  officialVersion: "7.41b",
  quality: "complete",
  exclusions: [],
  items: [
    {
      id: "1",
      name: "antimage",
      localizedName: "Anti-Mage",
      primaryAttribute: "agility",
      attackType: "melee",
      roles: ["Carry", "Escape"],
      officialVersion: null,
    },
    {
      id: "2",
      name: "axe",
      localizedName: "Axe",
      primaryAttribute: "strength",
      attackType: "melee",
      roles: ["Initiator", "Durable"],
      officialVersion: null,
    },
    {
      id: "107",
      name: "earth_spirit",
      localizedName: "Earth Spirit",
      primaryAttribute: "strength",
      attackType: "melee",
      roles: ["Nuker", "Escape", "Disabler", "Initiator", "Durable"],
      officialVersion: null,
    },
  ],
};

const heroAbilities: CanonicalOfficialHeroAbilityConstants = {
  source: { source: "dota2_official", fetchedAt: ABILITIES_FETCHED_AT },
  officialVersion: "7.41b",
  quality: "complete",
  exclusions: [],
  heroes: {
    npc_dota_hero_earth_spirit: {
      heroName: "npc_dota_hero_earth_spirit",
      facetsStatus: "active",
      abilities: [
        {
          id: "5608",
          name: "earth_spirit_boulder_smash",
          localizedName: "Boulder Smash",
          description: "Smashes a target in the direction Earth Spirit is facing.",
          slot: 0,
          type: "basic",
        },
        {
          id: "5612",
          name: "earth_spirit_magnetize",
          localizedName: "Magnetize",
          description: "Magnetizes nearby enemy units.",
          slot: 1,
          type: "ultimate",
        },
        {
          id: "324",
          name: "special_bonus_unique_earth_spirit_4",
          localizedName: "+150 Rolling Boulder Distance",
          description: "",
          slot: 2,
          type: "talent",
        },
      ],
      facets: [
        { name: "Resonance", description: "Stone Remnants resonate with Magnetize." },
        {
          name: "earth_spirit_stepping_stone",
          description: "Rolling Boulder moves farther.",
        },
      ],
      excludedAbilityNames: [],
    },
  },
};

const items: CanonicalOfficialConstantsSnapshot<CanonicalItemConstant> = {
  source: OFFICIAL_SOURCE,
  officialVersion: "7.41b",
  quality: "complete",
  exclusions: [],
  items: [
    {
      id: "1",
      name: "blink",
      localizedName: "Blink Dagger",
      cost: 2250,
      category: "component",
      kind: "item",
      availabilityStatus: "verified_current",
      description: "Blink to a target point.",
      attributes: [],
      componentNames: [],
      officialVersion: null,
    },
    {
      id: "2",
      name: "power_treads",
      localizedName: "Power Treads",
      cost: 1400,
      category: "common",
      kind: "item",
      availabilityStatus: "verified_current",
      description: "Attribute-switching boots.",
      attributes: [{ label: "Move speed", value: "+45" }],
      componentNames: ["blink"],
      officialVersion: null,
    },
  ],
};

const patches: CanonicalOfficialConstantsSnapshot<CanonicalPatchSummary> = {
  source: OFFICIAL_SOURCE,
  officialVersion: "7.41b",
  quality: "complete",
  exclusions: [],
  items: [
    {
      id: "7.41a",
      name: "7.41a",
      releasedAt: "2026-07-08T00:00:00.000Z",
    },
    {
      id: "7.41b",
      name: "7.41b",
      releasedAt: "2026-07-09T00:00:00.000Z",
    },
  ],
};

const officialUpdate: UpdateReleaseDetail = {
  version: "7.41b",
  releasedAt: "2026-07-09T00:00:00.000Z",
  sourceUrl: "https://www.dota2.com/patches/7.41b",
  changeGroupCount: 1,
  contentStatus: "complete",
  excludedNoteCount: 0,
  groups: [
    {
      kind: "hero",
      subsection: "overview",
      entityId: "107",
      entityName: "Earth Spirit",
      relatedAbilityId: null,
      title: null,
      notes: [{ text: "Strength increased by 1.", info: null, indentLevel: 1 }],
    },
  ],
};

const detailFor = (matchId: string): CanonicalMatchDetail => {
  const match = recent.matches.find((candidate) => candidate.id === matchId);
  if (!match) throw new Error(`Missing test match ${matchId}`);
  return {
    ...match,
    lobbyType: "7",
    cluster: "156",
    radiantScore: 35,
    direScore: 28,
    eligiblePlayerCount: 1,
    excludedPlayerCount: 0,
    exclusionReasons: [],
    quality: "complete",
    players: [match.player],
    parseStatus: "parsed",
    source: SOURCE,
  };
};

const createProvider = (): PlayerDataProvider => ({
  getPlayerProfile: vi.fn(async () => profile),
  getRecentMatches: vi.fn(async () => recent),
  getPlayerMatchesPage: vi.fn(
    async (_accountId, limit, offset): Promise<CanonicalPlayerMatchesPage> => ({
      ...recent,
      requestedLimit: limit,
      offset,
      rawCount: recent.eligibleCount,
      reachedEnd: true,
    }),
  ),
  getMatchDetail: vi.fn(async (matchId) => detailFor(matchId)),
  getHeroConstants: vi.fn(async () => heroes),
  getHeroAbilityConstants: vi.fn(async () => heroAbilities),
  getItemConstants: vi.fn(async () => items),
  getPatchConstants: vi.fn(async () => patches),
  getRecentUpdateReleases: vi.fn(async () => ({
    items: [officialUpdate],
    excludedVersions: [],
    source: { source: "dota2_official" as const, fetchedAt: FETCHED_AT },
  })),
});

const createPreparedRepository = async () => {
  const repository = await createLiveRepository();
  const catalogs = new StaticCatalogService({
    repository,
    provider: createProvider(),
    clock: () => new Date(CLOCK_AT),
  });
  await catalogs.refresh();
  return repository;
};

const json = (response: { body: string }): unknown => JSON.parse(response.body);

describe("live player synchronization", () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("returns official-source unavailable errors before static snapshots exist", async () => {
    const repository = await createLiveRepository();
    app = await buildApp({
      environment: "test",
      dataMode: "live",
      repository,
      playerDataProvider: createProvider(),
      clock: () => new Date(CLOCK_AT),
    });

    const initialStatus = dataStatusResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/data-status" })),
    );
    expect(initialStatus.data.status).toBe("unavailable");
    expect(initialStatus.data.providers).toEqual([
      expect.objectContaining({ source: "opendota", status: "degraded" }),
      expect.objectContaining({
        source: "dota2_official",
        status: "unavailable",
        message: "The first official catalog check has not completed yet.",
      }),
    ]);

    for (const url of [
      "/v1/heroes",
      "/v1/heroes/999",
      "/v1/items",
      "/v1/items/999",
      "/v1/patches",
      "/v1/updates",
      "/v1/updates/7.41b",
    ]) {
      const response = await app.inject({ method: "GET", url });
      const error = apiErrorSchema.parse(json(response));
      expect(response.statusCode).toBe(503);
      expect(error.error.code).toBe("SOURCE_UNAVAILABLE");
      expect(error.meta?.sources).toEqual(["dota2_official"]);
    }

    const catalogs = new StaticCatalogService({
      repository,
      provider: createProvider(),
      clock: () => new Date(CLOCK_AT),
    });
    await catalogs.refresh();

    for (const url of ["/v1/heroes/999", "/v1/items/999", "/v1/updates/7.40z"]) {
      const response = await app.inject({ method: "GET", url });
      const error = apiErrorSchema.parse(json(response));
      expect(response.statusCode).toBe(404);
      expect(error.error.code).toBe("NOT_FOUND");
      expect(error.meta?.sources).toEqual(["dota2_official"]);
    }

    const [heroSnapshot, itemSnapshot, updateSnapshot] = await Promise.all([
      repository.getHeroSnapshot(),
      repository.getItemSnapshot(),
      repository.getUpdateSnapshot(),
    ]);
    if (!heroSnapshot || !itemSnapshot || !updateSnapshot) {
      throw new Error("Static snapshot missing");
    }
    await repository.replaceHeroes(await repository.listHeroes(), {
      ...heroSnapshot,
      quality: "partial",
    });
    await repository.replaceItems(await repository.listItems(), {
      ...itemSnapshot,
      quality: "partial",
    });
    await repository.replaceUpdateReleases([officialUpdate], {
      ...updateSnapshot,
      quality: "partial",
    });
    expect((await app.inject({ method: "GET", url: "/v1/heroes" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/items" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/updates" })).statusCode).toBe(200);

    for (const url of ["/v1/heroes/999", "/v1/items/999", "/v1/updates/7.40z"]) {
      const response = await app.inject({ method: "GET", url });
      const error = apiErrorSchema.parse(json(response));
      expect(response.statusCode).toBe(503);
      expect(error.error.code).toBe("SOURCE_UNAVAILABLE");
      expect(error.meta).toMatchObject({
        sources: ["dota2_official"],
        updatedAt: CLOCK_AT,
      });
    }
  });

  it("does not report an empty partial update snapshot as an empty result", async () => {
    const repository = await createLiveRepository();
    await repository.replaceUpdateReleases([], {
      source: "dota2_official",
      quality: "partial",
      fetchedAt: FETCHED_AT,
      checkedAt: CLOCK_AT,
      changedAt: FETCHED_AT,
      contentHash: "legacy-empty-update",
      officialVersion: "7.41b",
    });
    app = await buildApp({
      environment: "test",
      dataMode: "live",
      repository,
      playerDataProvider: createProvider(),
      clock: () => new Date(CLOCK_AT),
    });

    const response = await app.inject({ method: "GET", url: "/v1/updates" });
    const error = apiErrorSchema.parse(json(response));
    expect(response.statusCode).toBe(503);
    expect(error.error.code).toBe("SOURCE_UNAVAILABLE");
    expect(error.meta).toMatchObject({
      status: "source_unavailable",
      sources: ["dota2_official"],
      updatedAt: CLOCK_AT,
    });
  });

  it("imports provider data in the background with exact quality metadata", async () => {
    const repository = await createPreparedRepository();
    const provider = createProvider();
    const service = new PlayerSyncService({
      repository,
      provider,
      clock: () => new Date(CLOCK_AT),
    });
    app = await buildApp({
      environment: "test",
      dataMode: "live",
      repository,
      syncService: service,
      clock: () => new Date(CLOCK_AT),
    });

    const seedPlayer = await app.inject({ method: "GET", url: "/v1/players/123456789" });
    expect(seedPlayer.statusCode).toBe(404);

    const accepted = syncJobResponseSchema.parse(
      json(await app.inject({ method: "POST", url: `/v1/players/${ACCOUNT_ID}/sync` })),
    );
    expect(accepted.data.status).toBe("syncing");
    expect(accepted.data.completedAt).toBeNull();

    const terminal = await service.waitForJob(accepted.data.jobId);
    expect(terminal).toMatchObject({
      status: "public_partial",
      errorCode: null,
      completedAt: CLOCK_AT,
    });

    const overview = playerOverviewResponseSchema.parse(
      json(await app.inject({ method: "GET", url: `/v1/players/${ACCOUNT_ID}` })),
    );
    expect(overview.data).toMatchObject({ games: 2, wins: 1, favoriteHeroId: "1" });
    expect(overview.meta).toMatchObject({
      sampleSize: 2,
      eligibleCount: 3,
      excludedCount: 1,
      exclusionReasons: ["radiant_win_unavailable"],
      coverageRate: 2 / 3,
      updatedAt: FETCHED_AT,
      inputWatermark: "2026-07-09T02:00:00.000Z",
      metricVersion: "player-v1",
      sources: ["opendota"],
      quality: "partial",
    });

    const heroStats = playerHeroesResponseSchema.parse(
      json(await app.inject({ method: "GET", url: `/v1/players/${ACCOUNT_ID}/heroes` })),
    );
    expect(heroStats.meta).toMatchObject({ sampleSize: 2, eligibleCount: 3, excludedCount: 1 });

    const matches = playerMatchesResponseSchema.parse(
      json(await app.inject({ method: "GET", url: `/v1/players/${ACCOUNT_ID}/matches` })),
    );
    expect(matches.data.items.map((match) => match.id)).toEqual(["8000000002", "8000000001"]);
    expect(matches.data.items.map((match) => match.officialVersion)).toEqual([
      "7.41b",
      "7.41b",
    ]);
    expect(matches.data.items.map((match) => match.openDotaPatchId)).toEqual([null, "59"]);
    expect(matches.meta).not.toHaveProperty("sampleSize");
    expect(matches.meta.filtersApplied).toEqual({
      window: "all_imported",
      patch: null,
      heroId: null,
      outcome: null,
      gameMode: null,
      lobbyType: null,
      dateFrom: null,
      dateTo: null,
    });

    const unknownPatch = playerOverviewResponseSchema.parse(
      json(
        await app.inject({
          method: "GET",
          url: `/v1/players/${ACCOUNT_ID}?window=last_20&patch=unknown`,
        }),
      ),
    );
    expect(unknownPatch.data.games).toBe(0);
    expect(unknownPatch.meta.filtersApplied).toEqual({ window: "last_20", patch: "unknown" });

    const unknownMatches = playerMatchesResponseSchema.parse(
      json(
        await app.inject({
          method: "GET",
          url: `/v1/players/${ACCOUNT_ID}/matches?window=all_imported&patch=unknown`,
        }),
      ),
    );
    expect(unknownMatches.data.items).toEqual([]);

    const patchCatalog = patchesResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/patches?limit=1" })),
    );
    expect(patchCatalog.data.items).toEqual([patches.items[1]]);
    expect(patchCatalog.data.nextCursor).not.toBeNull();
    expect(patchCatalog.meta).toMatchObject({
      updatedAt: CLOCK_AT,
      sources: ["dota2_official"],
    });

    const detail = matchDetailResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/matches/8000000002" })),
    );
    expect(detail.data).toMatchObject({
      officialVersion: "7.41b",
      openDotaPatchId: null,
      officialVersionSource: "start_time_inferred",
      detailStatus: "enriched",
      parseStatus: "parsed",
      lobbyType: "7",
      cluster: "156",
      radiantScore: 35,
      direScore: 28,
    });
    expect(detail.data.players).toHaveLength(1);
    expect(detail.data.players[0]?.itemTimeline).toEqual([
      { itemId: "1", action: "purchase", gameTimeSeconds: 900, charges: null },
    ]);
    expect(detail.data.players[0]?.itemTimelineStatus).toBe("partial");
    expect(detail.data.players[0]?.neutralItemEnhancementId).toBe("1592");

    const map = await app.inject({ method: "GET", url: "/v1/maps/current" });
    expect(map.statusCode).toBe(503);
    const mapError = apiErrorSchema.parse(json(map));
    expect(mapError.error.code).toBe("MAP_UNAVAILABLE");
    expect(mapError.meta?.sources).toEqual(["curated_map"]);

    const hero = heroDetailResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/heroes/1" })),
    );
    expect(hero.data).toMatchObject({
      name: "antimage",
      officialVersion: "7.41b",
      facetsStatus: "unavailable",
    });
    expect(hero.meta.sources).toEqual(["dota2_official"]);

    const item = itemDetailResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/items/2" })),
    );
    expect(item.data).toMatchObject({
      name: "power_treads",
      components: ["1"],
      officialVersion: "7.41b",
    });

    const status = dataStatusResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/data-status" })),
    );
    expect(status.data).toMatchObject({
      status: "degraded",
      latestMatchAt: "2026-07-09T02:00:00.000Z",
    });
    expect(status.data.providers[0]).toMatchObject({ source: "opendota", status: "degraded" });
    expect(status.data.providers[1]).toMatchObject({
      source: "dota2_official",
      status: "ready",
    });

    expect(provider.getPlayerProfile).toHaveBeenCalledTimes(1);
    expect(provider.getRecentMatches).toHaveBeenCalledWith(ACCOUNT_ID, 100);
    expect(provider.getMatchDetail).toHaveBeenCalledTimes(2);
    expect(provider.getHeroConstants).not.toHaveBeenCalled();
    expect(provider.getHeroAbilityConstants).not.toHaveBeenCalled();
    expect(provider.getItemConstants).not.toHaveBeenCalled();
    expect(provider.getPatchConstants).not.toHaveBeenCalled();
    expect(provider.getRecentUpdateReleases).not.toHaveBeenCalled();

    const updateList = updatesResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/updates" })),
    );
    expect(updateList.data.items).toEqual([
      {
        version: officialUpdate.version,
        releasedAt: officialUpdate.releasedAt,
        sourceUrl: officialUpdate.sourceUrl,
        changeGroupCount: officialUpdate.changeGroupCount,
        contentStatus: officialUpdate.contentStatus,
        excludedNoteCount: officialUpdate.excludedNoteCount,
      },
    ]);
    expect(updateList.data.items[0]).not.toHaveProperty("groups");
    expect(updateList.meta).toMatchObject({ sources: ["dota2_official"] });

    const updateDetail = updateDetailResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/updates/7.41b" })),
    );
    expect(updateDetail.data).toEqual(officialUpdate);
  });

  it("joins exact hero ability IDs, talents, and facets into the live hero catalog", async () => {
    const repository = await createPreparedRepository();
    const provider = createProvider();
    const earthSpiritRecent: CanonicalRecentMatches = {
      ...recent,
      matches: recent.matches.map((match, index) =>
        index === 0
          ? {
              ...match,
              player: {
                ...match.player,
                heroId: "107",
                abilityBuild: [
                  { abilityId: "5608", sequence: 1, heroLevel: null, gameTimeSeconds: null },
                  { abilityId: "5612", sequence: 2, heroLevel: null, gameTimeSeconds: null },
                ],
                abilityBuildStatus: "ordered",
              },
            }
          : match,
      ),
    };
    provider.getRecentMatches = vi.fn(async () => earthSpiritRecent);
    provider.getMatchDetail = vi.fn(async (matchId) => {
      const match = earthSpiritRecent.matches.find((candidate) => candidate.id === matchId);
      if (!match) throw new Error(`Missing test match ${matchId}`);
      return {
        ...detailFor(matchId),
        players: [match.player],
      };
    });
    const service = new PlayerSyncService({ repository, provider, clock: () => new Date(CLOCK_AT) });
    app = await buildApp({
      environment: "test",
      dataMode: "live",
      repository,
      syncService: service,
      clock: () => new Date(CLOCK_AT),
    });

    const accepted = syncJobResponseSchema.parse(
      json(await app.inject({ method: "POST", url: `/v1/players/${ACCOUNT_ID}/sync` })),
    );
    await service.waitForJob(accepted.data.jobId);

    const hero = heroDetailResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/heroes/107" })),
    );
    expect(hero.data.abilities.map((ability) => ability.id)).toEqual(["5608", "5612", "324"]);
    expect(hero.data.abilities.find((ability) => ability.id === "324")?.type).toBe("talent");
    expect(hero.data.facets).toEqual(heroAbilities.heroes.npc_dota_hero_earth_spirit?.facets);
    expect(hero.data.sourceSnapshot).toContain("herodata/abilities");
    expect(hero.meta.updatedAt).toBe(CLOCK_AT);

    const match = matchDetailResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/matches/8000000002" })),
    );
    expect(match.data.players[0]?.heroId).toBe("107");
    expect(match.data.players[0]?.abilityBuild.map((event) => event.abilityId)).toEqual([
      "5608",
      "5612",
    ]);
    expect(
      match.data.players[0]?.abilityBuild.every((event) =>
        hero.data.abilities.some((ability) => ability.id === event.abilityId),
      ),
    ).toBe(true);
  });

  it("replaces repeated sync batches idempotently", async () => {
    const repository = await createPreparedRepository();
    const provider = createProvider();
    const upsertMatches = vi.spyOn(repository, "upsertPlayerMatches");
    const service = new PlayerSyncService({ repository, provider, clock: () => new Date(CLOCK_AT) });
    app = await buildApp({
      environment: "test",
      dataMode: "live",
      repository,
      syncService: service,
      clock: () => new Date(CLOCK_AT),
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const accepted = syncJobResponseSchema.parse(
        json(await app.inject({ method: "POST", url: `/v1/players/${ACCOUNT_ID}/sync` })),
      );
      await service.waitForJob(accepted.data.jobId);
    }

    expect(await repository.listPlayerMatches(ACCOUNT_ID)).toHaveLength(2);
    expect((await repository.getPlayer(ACCOUNT_ID))?.importedMatchCount).toBe(2);
    expect(await repository.getPlayerSyncBatch(ACCOUNT_ID)).toMatchObject({
      sampleSize: 2,
      eligibleCount: 3,
    });
    expect(provider.getRecentMatches).toHaveBeenCalledTimes(2);
    expect(provider.getHeroConstants).not.toHaveBeenCalled();
    expect(provider.getHeroAbilityConstants).not.toHaveBeenCalled();
    expect(provider.getItemConstants).not.toHaveBeenCalled();
    expect(provider.getPatchConstants).not.toHaveBeenCalled();
    expect(provider.getRecentUpdateReleases).not.toHaveBeenCalled();
    expect(upsertMatches).toHaveBeenLastCalledWith(ACCOUNT_ID, []);
    expect(provider.getMatchDetail).toHaveBeenCalledTimes(2);
    expect((await repository.getMatch("8000000002"))?.detail.detailStatus).toBe("enriched");
  });

  it("reuses the previous hero catalog within its refresh TTL", async () => {
    const repository = await createPreparedRepository();
    const provider = createProvider();
    const service = new PlayerSyncService({ repository, provider, clock: () => new Date(CLOCK_AT) });

    const first = await service.requestSync(ACCOUNT_ID);
    await service.waitForJob(first.jobId);
    expect((await repository.getHero("107"))?.abilities.map((ability) => ability.id)).toEqual([
      "5608",
      "5612",
      "324",
    ]);

    provider.getHeroAbilityConstants = vi.fn(async () => {
      throw new OpenDotaProviderError(
        "SOURCE_UNAVAILABLE",
        "upstream_5xx",
        "ability catalog unavailable",
        true,
        503,
      );
    });
    const refresh = await service.requestSync(ACCOUNT_ID);
    const terminal = await service.waitForJob(refresh.jobId);

    expect(terminal).toMatchObject({ status: "public_partial", errorCode: null });
    expect(provider.getHeroAbilityConstants).not.toHaveBeenCalled();
    expect((await repository.getHero("107"))?.abilities.map((ability) => ability.id)).toEqual([
      "5608",
      "5612",
      "324",
    ]);
  });

  it("refreshes a fresh legacy major-patch snapshot from the official index", async () => {
    const repository = await createPreparedRepository();
    await repository.replacePatches(
      [{ id: "60", name: "7.41", releasedAt: "2026-03-24T00:00:00.000Z" }],
      {
        source: "opendota",
        quality: "complete",
        fetchedAt: FETCHED_AT,
        checkedAt: CLOCK_AT,
        changedAt: FETCHED_AT,
        contentHash: "legacy-major-patches",
        officialVersion: null,
      },
    );
    const provider = createProvider();
    const service = new StaticCatalogService({
      repository,
      provider,
      clock: () => new Date(CLOCK_AT),
    });
    await service.refresh();

    expect(provider.getPatchConstants).toHaveBeenCalledTimes(1);
    expect(await repository.getPatchSnapshot()).toMatchObject({
      source: "dota2_official",
      officialVersion: "7.41b",
    });
    expect((await repository.listPatches()).map((patch) => patch.id)).toEqual([
      "7.41b",
      "7.41a",
    ]);
  });

  it("touches unchanged stale catalogs and advances changedAt only for changed content", async () => {
    const repository = await createPreparedRepository();
    const provider = createProvider();
    let now = new Date(CLOCK_AT);
    const clock = () => now;
    const replaceHeroes = vi.spyOn(repository, "replaceHeroes");
    const service = new StaticCatalogService({ repository, provider, clock });
    const initial = await repository.getHeroSnapshot();
    expect(replaceHeroes).not.toHaveBeenCalled();

    now = new Date(Date.parse(CLOCK_AT) + 8 * 24 * 60 * 60 * 1_000);
    await service.refresh();
    const touched = await repository.getHeroSnapshot();
    expect(replaceHeroes).not.toHaveBeenCalled();
    expect(touched?.checkedAt).toBe(now.toISOString());
    expect(touched?.changedAt).toBe(initial?.changedAt);

    provider.getHeroConstants = vi.fn(async () => ({
      ...heroes,
      items: heroes.items.map((hero) =>
        hero.id === "107" ? { ...hero, roles: [...hero.roles, "Support"] } : hero,
      ),
    }));
    now = new Date(Date.parse(CLOCK_AT) + 16 * 24 * 60 * 60 * 1_000);
    await service.refresh();
    const changed = await repository.getHeroSnapshot();
    expect(replaceHeroes).toHaveBeenCalledTimes(1);
    expect(changed?.changedAt).toBe(now.toISOString());
    expect(changed?.contentHash).not.toBe(initial?.contentHash);
  });

  it("settles fresh partial catalogs as degraded and retries them after the short TTL", async () => {
    const repository = await createPreparedRepository();
    const provider = createProvider();
    let now = new Date(CLOCK_AT);
    const service = new StaticCatalogService({ repository, provider, clock: () => now });
    const [heroSnapshot, itemSnapshot] = await Promise.all([
      repository.getHeroSnapshot(),
      repository.getItemSnapshot(),
    ]);
    if (!heroSnapshot || !itemSnapshot) throw new Error("Static snapshot missing");
    await repository.replaceHeroes(await repository.listHeroes(), {
      ...heroSnapshot,
      quality: "partial",
    });
    await repository.replaceItems(await repository.listItems(), {
      ...itemSnapshot,
      quality: "partial",
    });
    vi.mocked(provider.getHeroConstants).mockClear();
    vi.mocked(provider.getHeroAbilityConstants).mockClear();
    const upsertProviderHealth = vi.spyOn(repository, "upsertProviderHealth");

    service.start();
    await service.close();
    expect(provider.getHeroConstants).not.toHaveBeenCalled();
    expect(provider.getItemConstants).not.toHaveBeenCalled();
    expect(provider.getPatchConstants).not.toHaveBeenCalled();
    expect(provider.getRecentUpdateReleases).not.toHaveBeenCalled();
    expect(upsertProviderHealth).toHaveBeenLastCalledWith({
      source: "dota2_official",
      status: "degraded",
      checkedAt: CLOCK_AT,
      message: "Official catalog refresh completed with partial data.",
    });
    expect(await repository.getProviderHealth("dota2_official")).toMatchObject({
      status: "degraded",
    });

    now = new Date(Date.parse(CLOCK_AT) + 3 * 60 * 60 * 1_000);
    await service.refresh();

    expect(provider.getHeroConstants).toHaveBeenCalledTimes(1);
    expect(provider.getHeroAbilityConstants).toHaveBeenCalledTimes(1);
    expect(provider.getItemConstants).toHaveBeenCalledTimes(1);
    expect((await repository.getHeroSnapshot())?.quality).toBe("complete");
    expect((await repository.getItemSnapshot())?.quality).toBe("complete");
  });

  it("keeps old updates readable when their non-critical refresh fails", async () => {
    const repository = await createPreparedRepository();
    const oldUpdate = { ...officialUpdate, version: "7.41a" };
    await repository.replaceUpdateReleases([oldUpdate], {
      source: "dota2_official",
      quality: "complete",
      fetchedAt: "2026-07-09T00:00:00.000Z",
      checkedAt: "2026-07-09T00:00:00.000Z",
      changedAt: "2026-07-09T00:00:00.000Z",
      contentHash: "old-update",
      officialVersion: null,
    });
    const provider = createProvider();
    provider.getRecentUpdateReleases = vi.fn(async () => {
      throw new Error("test-only official update failure");
    });
    const service = new StaticCatalogService({
      repository,
      provider,
      clock: () => new Date(CLOCK_AT),
    });
    service.start();
    await service.close();

    expect(provider.getRecentUpdateReleases).toHaveBeenCalledTimes(1);
    expect((await repository.listUpdateReleases()).map((release) => release.version)).toEqual([
      "7.41a",
    ]);
    expect(await repository.getProviderHealth("dota2_official")).toMatchObject({
      status: "unavailable",
    });
    await repository.upsertProviderHealth({
      source: "opendota",
      status: "ready",
      checkedAt: CLOCK_AT,
      message: null,
    });
    app = await buildApp({
      environment: "test",
      dataMode: "live",
      repository,
      playerDataProvider: provider,
      clock: () => new Date(CLOCK_AT),
    });
    const status = dataStatusResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/data-status" })),
    );
    expect(status.data.status).toBe("unavailable");
    expect(status.data.providers.map((health) => health.source)).toEqual([
      "opendota",
      "dota2_official",
    ]);
  });

  it("keeps previously imported public data readable while a refresh is running", async () => {
    const repository = await createPreparedRepository();
    const provider = createProvider();
    const service = new PlayerSyncService({ repository, provider, clock: () => new Date(CLOCK_AT) });
    app = await buildApp({
      environment: "test",
      dataMode: "live",
      repository,
      syncService: service,
      clock: () => new Date(CLOCK_AT),
    });

    const initial = await service.requestSync(ACCOUNT_ID);
    await service.waitForJob(initial.jobId);
    let releaseProfile!: (profile: CanonicalPlayerProfile) => void;
    provider.getPlayerProfile = vi.fn(
      () => new Promise<CanonicalPlayerProfile>((resolve) => { releaseProfile = resolve; }),
    );

    const refresh = await service.requestSync(ACCOUNT_ID);
    expect(refresh.status).toBe("syncing");
    expect((await repository.getPlayer(ACCOUNT_ID))?.status).toBe("public_partial");
    expect(
      (await app.inject({ method: "GET", url: `/v1/players/${ACCOUNT_ID}/matches` })).statusCode,
    ).toBe(200);

    releaseProfile(profile);
    await service.waitForJob(refresh.jobId);
  });

  it("imports one history page without deleting recent matches or downgrading detail", async () => {
    const repository = await createPreparedRepository();
    const provider = createProvider();
    const recentService = new PlayerSyncService({
      repository,
      provider,
      clock: () => new Date(CLOCK_AT),
    });
    const initial = await recentService.requestSync(ACCOUNT_ID);
    await recentService.waitForJob(initial.jobId);
    const existingEnriched = await repository.getMatch("8000000002");
    expect(existingEnriched?.detail.detailStatus).toBe("enriched");

    const historical = {
      ...recent.matches[0]!,
      id: "7000000000",
      startTime: "2026-06-01T00:00:00.000Z",
      patchId: null,
    };
    provider.getPlayerMatchesPage = vi.fn(async (_accountId, limit, offset) => ({
      accountId: ACCOUNT_ID,
      requestedLimit: limit,
      offset,
      rawCount: 2,
      reachedEnd: false,
      eligibleCount: 2,
      excludedCount: 0,
      exclusionReasons: [],
      quality: "complete" as const,
      source: SOURCE,
      candidateLedger: [
        { providerIndex: 0, status: "included" as const, matchId: historical.id },
        { providerIndex: 1, status: "included" as const, matchId: recent.matches[0]!.id },
      ],
      matches: [historical, recent.matches[0]!],
    }));
    const historyService = new PlayerHistorySyncService({
      repository,
      provider,
      clock: () => new Date(CLOCK_AT),
    });
    app = await buildApp({
      environment: "test",
      dataMode: "live",
      repository,
      syncService: recentService,
      historySyncService: historyService,
      clock: () => new Date(CLOCK_AT),
    });

    const accepted = playerHistorySyncResponseSchema.parse(
      json(
        await app.inject({
          method: "POST",
          url: `/v1/players/${ACCOUNT_ID}/history-sync`,
        }),
      ),
    );
    expect(accepted.data.status).toBe("syncing");
    const completed = await historyService.waitForAccount(ACCOUNT_ID);
    expect(completed).toMatchObject({
      status: "partial",
      nextOffset: 2,
      pagesImported: 1,
      matchesImported: 1,
      reachedEnd: false,
    });
    expect((await repository.getMatch("8000000002"))?.detail.detailStatus).toBe("enriched");
    expect((await repository.getMatch(historical.id))?.detail.openDotaPatchId).toBeNull();
    expect(await repository.listPlayerMatches(ACCOUNT_ID)).toHaveLength(3);

    const allImported = playerMatchesResponseSchema.parse(
      json(
        await app.inject({
          method: "GET",
          url: `/v1/players/${ACCOUNT_ID}/matches?window=all_imported&limit=100`,
        }),
      ),
    );
    expect(allImported.data.items).toHaveLength(3);

    const importedProfile = await repository.getPlayer(ACCOUNT_ID);
    expect(importedProfile).toBeDefined();
    await repository.upsertPlayer({ ...importedProfile!, status: "syncing" });
    const fetched = playerHistorySyncResponseSchema.parse(
      json(
        await app.inject({
          method: "GET",
          url: `/v1/players/${ACCOUNT_ID}/history-sync`,
        }),
      ),
    );
    expect(fetched.data).toEqual(completed);

    const refreshed = await recentService.requestSync(ACCOUNT_ID);
    await recentService.waitForJob(refreshed.jobId);
    expect(await repository.listPlayerMatches(ACCOUNT_ID)).toHaveLength(3);
  });

  it("does not advance a failed history page and resumes from the same offset", async () => {
    const repository = await createPreparedRepository();
    const provider = createProvider();
    provider.getPlayerMatchesPage = vi.fn(async () => {
      throw new OpenDotaProviderError(
        "SOURCE_RATE_LIMITED",
        "rate_limited",
        "rate limited",
        true,
        429,
        30,
      );
    });
    const historyService = new PlayerHistorySyncService({
      repository,
      provider,
      clock: () => new Date(CLOCK_AT),
    });

    await historyService.requestSync(ACCOUNT_ID);
    expect(await historyService.waitForAccount(ACCOUNT_ID)).toMatchObject({
      status: "source_rate_limited",
      nextOffset: 0,
      pagesImported: 0,
      errorCode: "SOURCE_RATE_LIMITED",
    });

    provider.getPlayerMatchesPage = vi.fn(async (_accountId, limit, offset) => ({
      accountId: ACCOUNT_ID,
      requestedLimit: limit,
      offset,
      rawCount: 0,
      reachedEnd: true,
      eligibleCount: 0,
      excludedCount: 0,
      exclusionReasons: [],
      candidateLedger: [],
      quality: "complete" as const,
      matches: [],
      source: SOURCE,
    }));
    await historyService.requestSync(ACCOUNT_ID);
    expect(await historyService.waitForAccount(ACCOUNT_ID)).toMatchObject({
      status: "complete",
      nextOffset: 0,
      pagesImported: 1,
      reachedEnd: true,
      errorCode: null,
    });
  });

  it("honors a fresh persisted history-sync lease across service instances", async () => {
    const repository = await createPreparedRepository();
    const provider = createProvider();
    await repository.commitPlayerHistoryPage(ACCOUNT_ID, [], {
      accountId: ACCOUNT_ID,
      status: "syncing",
      nextOffset: 200,
      pageSize: 100,
      pagesImported: 2,
      matchesImported: 150,
      oldestImportedAt: FETCHED_AT,
      reachedEnd: false,
      requestedAt: CLOCK_AT,
      updatedAt: CLOCK_AT,
      errorCode: null,
    });
    const historyService = new PlayerHistorySyncService({
      repository,
      provider,
      clock: () => new Date(CLOCK_AT),
    });

    expect(await historyService.requestSync(ACCOUNT_ID)).toMatchObject({
      status: "syncing",
      nextOffset: 200,
    });
    expect(provider.getPlayerMatchesPage).not.toHaveBeenCalled();
  });

  it("keeps a failed detail as summary without failing the player sync", async () => {
    const repository = await createPreparedRepository();
    const provider = createProvider();
    provider.getMatchDetail = vi.fn(async (matchId) => {
      if (matchId === "8000000002") throw new Error("test-only detail failure");
      return detailFor(matchId);
    });
    const service = new PlayerSyncService({ repository, provider, clock: () => new Date(CLOCK_AT) });

    const job = await service.requestSync(ACCOUNT_ID);
    const terminal = await service.waitForJob(job.jobId);

    expect(terminal?.status).toBe("public_partial");
    expect((await repository.getMatch("8000000002"))?.detail.detailStatus).toBe("summary");
    expect((await repository.getMatch("8000000001"))?.detail.detailStatus).toBe("enriched");
    await service.close();
  });

  it("enriches only the latest 20 matches with at most two requests in flight", async () => {
    const repository = await createPreparedRepository();
    const provider = createProvider();
    const template = recent.matches[0]!;
    const matches = Array.from({ length: 25 }, (_, index) => ({
      ...template,
      id: String(8_200_000_000 + index),
      startTime: new Date(Date.parse(template.startTime) - index * 60_000).toISOString(),
      player: { ...template.player },
    }));
    provider.getRecentMatches = vi.fn(async () => ({
      ...recent,
      eligibleCount: matches.length,
      excludedCount: 0,
      exclusionReasons: [],
      quality: "complete" as const,
      matches,
      candidateLedger: matches.map((match, providerIndex) => ({
        providerIndex,
        status: "included" as const,
        matchId: match.id,
      })),
    }));
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    provider.getMatchDetail = vi.fn(async (matchId) => {
      activeRequests += 1;
      maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeRequests -= 1;
      const match = matches.find((candidate) => candidate.id === matchId)!;
      return { ...detailFor(template.id), ...match, players: [match.player] };
    });
    const service = new PlayerSyncService({ repository, provider, clock: () => new Date(CLOCK_AT) });

    const job = await service.requestSync(ACCOUNT_ID);
    await service.waitForJob(job.jobId);

    expect(provider.getMatchDetail).toHaveBeenCalledTimes(20);
    expect(maximumActiveRequests).toBe(2);
    expect((await repository.getMatch(matches[19]!.id))?.detail.detailStatus).toBe("enriched");
    expect((await repository.getMatch(matches[20]!.id))?.detail.detailStatus).toBe("summary");
    await service.close();
  });

  it("coalesces concurrent requests and reports a complete provider as ready", async () => {
    const repository = await createPreparedRepository();
    const provider = createProvider();
    let releaseProfile!: (value: CanonicalPlayerProfile) => void;
    const profileGate = new Promise<CanonicalPlayerProfile>((resolve) => {
      releaseProfile = resolve;
    });
    provider.getPlayerProfile = vi.fn(() => profileGate);
    provider.getRecentMatches = vi.fn(async () => ({
      ...recent,
      eligibleCount: 2,
      excludedCount: 0,
      exclusionReasons: [],
      quality: "complete" as const,
      candidateLedger: [
        { providerIndex: 0, status: "included" as const, matchId: "8000000002" },
        { providerIndex: 1, status: "included" as const, matchId: "8000000001" },
      ],
    }));
    const service = new PlayerSyncService({ repository, provider, clock: () => new Date(CLOCK_AT) });
    app = await buildApp({
      environment: "test",
      dataMode: "live",
      repository,
      syncService: service,
      clock: () => new Date(CLOCK_AT),
    });

    const first = syncJobResponseSchema.parse(
      json(await app.inject({ method: "POST", url: `/v1/players/${ACCOUNT_ID}/sync` })),
    );
    const second = syncJobResponseSchema.parse(
      json(await app.inject({ method: "POST", url: `/v1/players/${ACCOUNT_ID}/sync` })),
    );
    expect(second.data).toEqual(first.data);

    releaseProfile(profile);
    await service.waitForJob(first.data.jobId);

    expect(provider.getPlayerProfile).toHaveBeenCalledTimes(1);
    expect(provider.getRecentMatches).toHaveBeenCalledTimes(1);
    const status = dataStatusResponseSchema.parse(
      json(await app.inject({ method: "GET", url: "/v1/data-status" })),
    );
    expect(status.data.status).toBe("ready");
    expect(status.data.providers[0]?.message).toBeNull();
  });

  it("derives exact last-20, last-50, and last-100 metrics from the candidate ledger", async () => {
    const repository = await createPreparedRepository();
    const provider = createProvider();
    const excludedIndices = new Set([4, 24, 54, 84]);
    const allMatches = Array.from({ length: 100 }, (_, providerIndex) => {
      if (excludedIndices.has(providerIndex)) return undefined;
      const template = recent.matches[0]!;
      return {
        ...template,
        id: String(8_100_000_000 + providerIndex),
        startTime: new Date(
          Date.parse("2026-07-09T02:00:00.000Z") - providerIndex * 60_000,
        ).toISOString(),
        player: { ...template.player, heroId: "1" },
      };
    }).filter((match): match is NonNullable<typeof match> => match !== undefined);
    provider.getRecentMatches = vi.fn(async () => ({
      accountId: ACCOUNT_ID,
      requestedLimit: 100,
      eligibleCount: 100,
      excludedCount: 4,
      exclusionReasons: ["player_slot_unavailable"],
      quality: "partial" as const,
      source: SOURCE,
      matches: allMatches,
      candidateLedger: Array.from({ length: 100 }, (_, providerIndex) =>
        excludedIndices.has(providerIndex)
          ? {
              providerIndex,
              status: "excluded" as const,
              exclusionReasons: ["player_slot_unavailable"],
            }
          : {
              providerIndex,
              status: "included" as const,
              matchId: String(8_100_000_000 + providerIndex),
            },
      ),
    }));
    const service = new PlayerSyncService({ repository, provider, clock: () => new Date(CLOCK_AT) });
    app = await buildApp({
      environment: "test",
      dataMode: "live",
      repository,
      syncService: service,
      clock: () => new Date(CLOCK_AT),
    });

    const accepted = syncJobResponseSchema.parse(
      json(await app.inject({ method: "POST", url: `/v1/players/${ACCOUNT_ID}/sync` })),
    );
    await service.waitForJob(accepted.data.jobId);

    const expectedByWindow = {
      last_20: { eligibleCount: 20, sampleSize: 19, excludedCount: 1 },
      last_50: { eligibleCount: 50, sampleSize: 48, excludedCount: 2 },
      last_100: { eligibleCount: 100, sampleSize: 96, excludedCount: 4 },
    } as const;
    for (const [window, expected] of Object.entries(expectedByWindow)) {
      const response = playerHeroesResponseSchema.parse(
        json(
          await app.inject({
            method: "GET",
            url: `/v1/players/${ACCOUNT_ID}/heroes?window=${window}`,
          }),
        ),
      );
      expect(response.meta).toMatchObject({
        ...expected,
        coverageRate: expected.sampleSize / expected.eligibleCount,
        exclusionReasons: ["player_slot_unavailable"],
        quality: "partial",
      });
      expect(response.data.items.reduce((sum, hero) => sum + hero.games, 0)).toBe(
        expected.sampleSize,
      );
    }
  });

  it.each([
    {
      name: "private profile",
      stage: "profile",
      error: new OpenDotaProviderError(
        "PROFILE_PRIVATE",
        "profile_unavailable",
        "private",
        false,
        403,
      ),
      jobStatus: "profile_private",
      errorCode: "PROFILE_PRIVATE",
      httpStatus: 403,
      providerStatus: "ready",
    },
    {
      name: "private history",
      stage: "matches",
      error: new OpenDotaProviderError(
        "HISTORY_PRIVATE",
        "history_unavailable",
        "private",
        false,
        403,
      ),
      jobStatus: "history_private",
      errorCode: "HISTORY_PRIVATE",
      httpStatus: 403,
      providerStatus: "ready",
    },
    {
      name: "rate limit",
      stage: "profile",
      error: new OpenDotaProviderError(
        "SOURCE_RATE_LIMITED",
        "rate_limited",
        "limited",
        true,
        429,
        17,
      ),
      jobStatus: "source_rate_limited",
      errorCode: "SOURCE_RATE_LIMITED",
      httpStatus: 429,
      providerStatus: "degraded",
    },
    {
      name: "upstream 5xx",
      stage: "profile",
      error: new OpenDotaProviderError(
        "SOURCE_UNAVAILABLE",
        "upstream_5xx",
        "unavailable",
        true,
        503,
      ),
      jobStatus: "source_unavailable",
      errorCode: "SOURCE_UNAVAILABLE",
      httpStatus: 503,
      providerStatus: "unavailable",
    },
    {
      name: "timeout",
      stage: "profile",
      error: new OpenDotaProviderError(
        "SOURCE_UNAVAILABLE",
        "timeout",
        "timeout",
        true,
      ),
      jobStatus: "source_unavailable",
      errorCode: "SOURCE_UNAVAILABLE",
      httpStatus: 503,
      providerStatus: "unavailable",
    },
    {
      name: "parse pending",
      stage: "matches",
      error: new OpenDotaProviderError(
        "PARSE_PENDING",
        "player_data_unavailable",
        "pending",
        true,
        null,
        null,
        {
          eligibleCount: 2,
          excludedCount: 2,
          exclusionReasons: ["radiant_win_unavailable"],
          candidateLedger: [
            {
              providerIndex: 0,
              status: "excluded",
              exclusionReasons: ["radiant_win_unavailable"],
            },
            {
              providerIndex: 1,
              status: "excluded",
              exclusionReasons: ["radiant_win_unavailable"],
            },
          ],
        },
      ),
      jobStatus: "parse_pending",
      errorCode: "PARSE_PENDING",
      httpStatus: 409,
      providerStatus: "degraded",
    },
  ])(
    "preserves the $name outcome instead of returning empty success",
    async ({ stage, error, jobStatus, errorCode, httpStatus, providerStatus }) => {
      const repository = await createPreparedRepository();
      const provider = createProvider();
      if (stage === "profile") {
        provider.getPlayerProfile = vi.fn(async () => {
          throw error;
        });
      } else {
        provider.getRecentMatches = vi.fn(async () => {
          throw error;
        });
      }
      const service = new PlayerSyncService({ repository, provider, clock: () => new Date(CLOCK_AT) });
      app = await buildApp({
        environment: "test",
        dataMode: "live",
        repository,
        syncService: service,
        clock: () => new Date(CLOCK_AT),
      });

      const accepted = syncJobResponseSchema.parse(
        json(await app.inject({ method: "POST", url: `/v1/players/${ACCOUNT_ID}/sync` })),
      );
      await service.waitForJob(accepted.data.jobId);
      const terminal = syncJobResponseSchema.parse(
        json(await app.inject({ method: "GET", url: `/v1/sync-jobs/${accepted.data.jobId}` })),
      );
      expect(terminal.data).toMatchObject({
        status: jobStatus,
        errorCode,
        completedAt: CLOCK_AT,
      });

      const playerResponse = await app.inject({ method: "GET", url: `/v1/players/${ACCOUNT_ID}` });
      const playerError = apiErrorSchema.parse(json(playerResponse));
      expect(playerResponse.statusCode).toBe(httpStatus);
      expect(playerError.error.code).toBe(errorCode);
      if (errorCode === "SOURCE_RATE_LIMITED") {
        expect(playerError.meta?.retryAfterSeconds).toBe(17);
      }
      if (errorCode === "PARSE_PENDING") {
        expect(await repository.getPlayerSyncBatch(ACCOUNT_ID)).toMatchObject({
          eligibleCount: 2,
          sampleSize: 0,
          excludedCount: 2,
          exclusionReasons: ["radiant_win_unavailable"],
          quality: "partial",
        });
      }

      const status = dataStatusResponseSchema.parse(
        json(await app.inject({ method: "GET", url: "/v1/data-status" })),
      );
      expect(status.data.providers[0]?.status).toBe(providerStatus);
    },
  );

  it("maps unexpected sync failures to a diagnosable failed terminal state", async () => {
    const repository = await createPreparedRepository();
    const provider = createProvider();
    provider.getRecentMatches = vi.fn(async () => {
      throw new Error("test-only unexpected failure");
    });
    const service = new PlayerSyncService({ repository, provider, clock: () => new Date(CLOCK_AT) });
    app = await buildApp({
      environment: "test",
      dataMode: "live",
      repository,
      syncService: service,
      clock: () => new Date(CLOCK_AT),
    });

    const accepted = syncJobResponseSchema.parse(
      json(await app.inject({ method: "POST", url: `/v1/players/${ACCOUNT_ID}/sync` })),
    );
    await service.waitForJob(accepted.data.jobId);

    const terminal = syncJobResponseSchema.parse(
      json(await app.inject({ method: "GET", url: `/v1/sync-jobs/${accepted.data.jobId}` })),
    );
    expect(terminal.data).toMatchObject({ status: "failed", errorCode: "INTERNAL_ERROR" });

    const playerResponse = await app.inject({ method: "GET", url: `/v1/players/${ACCOUNT_ID}` });
    expect(playerResponse.statusCode).toBe(500);
    expect(apiErrorSchema.parse(json(playerResponse)).error.code).toBe("INTERNAL_ERROR");
  });
});
