import type { MatchDetail } from "@dodo/contracts";
import type { StratzMatchDetail, StratzProvider } from "@dodo/dota-data";
import { createLiveRepository, type StoredMatch } from "@dodo/db";
import { describe, expect, it, vi } from "vitest";

import { StratzMatchEnrichmentService } from "../src/stratz-match-enrichment-service.js";

const FETCHED_AT = "2026-07-13T01:00:00.000Z";
const CLOCK_AT = "2026-07-13T01:00:01.000Z";

const player = (): MatchDetail["players"][number] => ({
  accountId: "224328273",
  playerSlot: 0,
  heroId: "1",
  side: "radiant",
  isWin: true,
  kills: 5,
  deaths: 2,
  assists: 8,
  gpm: 500,
  xpm: 600,
  lastHits: 200,
  denies: 5,
  heroDamage: 20_000,
  heroHealing: 0,
  towerDamage: 2_000,
  level: 25,
  netWorth: 22_000,
  finalItemIds: ["1"],
  backpackItemIds: [],
  neutralItemId: null,
  neutralItemEnhancementId: null,
  abilityBuild: [
    { abilityId: "5003", sequence: 1, heroLevel: null, gameTimeSeconds: null },
  ],
  abilityBuildStatus: "ordered",
  itemTimeline: [
    { itemId: "1", action: "sell", gameTimeSeconds: 1_200, charges: null },
  ],
  itemTimelineStatus: "partial",
});

const storedMatch = (): StoredMatch => ({
  detail: {
    id: "9000000001",
    startTime: "2026-07-12T00:00:00.000Z",
    durationSeconds: 2_000,
    officialVersion: "7.41d",
    openDotaPatchId: "60",
    officialVersionSource: "start_time_inferred",
    gameMode: "22",
    lobbyType: "7",
    region: "2",
    radiantWin: true,
    players: [player()],
    detailStatus: "enriched",
    enrichmentSources: [],
    parseStatus: "parsed",
    cluster: "156",
    radiantScore: 30,
    direScore: 20,
  },
  importedAt: "2026-07-12T01:00:00.000Z",
  source: "opendota",
  quality: "complete",
});

const stratzDetail = (): StratzMatchDetail => ({
  id: "9000000001",
  startTime: "2026-07-12T00:00:00.000Z",
  durationSeconds: 2_000,
  gameVersionId: "999",
  gameMode: "ALL_PICK_RANKED",
  lobbyType: "RANKED",
  region: "2",
  cluster: "156",
  radiantWin: true,
  quality: "complete",
  eligiblePlayerCount: 1,
  excludedPlayerCount: 0,
  exclusionReasons: [],
  players: [
    {
      steamAccountId: "224328273",
      playerSlot: 0,
      heroId: "1",
      side: "radiant",
      isWin: true,
      kills: 5,
      deaths: 2,
      assists: 8,
      gpm: 500,
      xpm: 600,
      lastHits: 200,
      denies: 5,
      heroDamage: 20_000,
      heroHealing: 0,
      towerDamage: 2_000,
      level: 25,
      netWorth: 22_000,
      finalItemIds: ["1"],
      backpackItemIds: [],
      neutralItemId: null,
      abilityBuild: [
        { abilityId: "5003", sequence: 1, heroLevel: 1, gameTimeSeconds: 0 },
        { abilityId: "5004", sequence: 2, heroLevel: 2, gameTimeSeconds: 80 },
      ],
      abilityBuildStatus: "timed",
      itemTimeline: [
        { itemId: "1", action: "purchase", gameTimeSeconds: 900, charges: null },
      ],
      itemTimelineStatus: "partial",
    },
  ],
  source: { source: "stratz", fetchedAt: FETCHED_AT },
});

const provider = (detail = stratzDetail()) => ({
  getMatchDetail: vi.fn(async () => detail),
}) as unknown as Pick<StratzProvider, "getMatchDetail">;

describe("STRATZ match enrichment", () => {
  it("monotonically adds timed abilities and purchases without clearing OpenDota events", async () => {
    const repository = await createLiveRepository();
    await repository.upsertMatch(storedMatch());
    const service = new StratzMatchEnrichmentService({
      repository,
      provider: provider(),
      clock: () => new Date(CLOCK_AT),
    });

    await expect(service.enrichMatch("9000000001")).resolves.toEqual({
      changed: true,
      status: "complete",
    });
    const stored = await repository.getMatch("9000000001");
    expect(stored?.detail.enrichmentSources).toEqual(["stratz"]);
    expect(stored?.detail.officialVersion).toBe("7.41d");
    expect(stored?.detail.players[0]?.abilityBuildStatus).toBe("timed");
    expect(stored?.detail.players[0]?.abilityBuild).toHaveLength(2);
    expect(stored?.detail.players[0]?.itemTimeline).toEqual([
      { itemId: "1", action: "purchase", gameTimeSeconds: 900, charges: null },
      { itemId: "1", action: "sell", gameTimeSeconds: 1_200, charges: null },
    ]);
    expect(stored?.detail.players[0]?.itemTimelineStatus).toBe("partial");
    expect(await repository.getProviderHealth("stratz")).toMatchObject({ status: "ready" });
  });

  it("does not rewrite a match when canonical enrichment is unchanged", async () => {
    const repository = await createLiveRepository();
    await repository.upsertMatch(storedMatch());
    const upsert = vi.spyOn(repository, "upsertMatch");
    const service = new StratzMatchEnrichmentService({ repository, provider: provider() });

    await service.enrichMatch("9000000001");
    await service.enrichMatch("9000000001");

    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("discards all STRATZ fields when player identity conflicts", async () => {
    const repository = await createLiveRepository();
    await repository.upsertMatch(storedMatch());
    const conflicting = stratzDetail();
    conflicting.players[0] = { ...conflicting.players[0]!, heroId: "2" };
    const service = new StratzMatchEnrichmentService({
      repository,
      provider: provider(conflicting),
    });

    await expect(service.enrichMatch("9000000001")).resolves.toEqual({
      changed: false,
      status: "failed",
    });
    expect((await repository.getMatch("9000000001"))?.detail.enrichmentSources).toEqual([]);
  });

  it.each([
    ["1", "0", "ALL_PICK", "NORMAL"],
    ["23", "0", "TURBO", "NORMAL"],
  ] as const)(
    "accepts equivalent OpenDota %s/%s and STRATZ %s/%s modes",
    async (gameMode, lobbyType, stratzGameMode, stratzLobbyType) => {
      const repository = await createLiveRepository();
      const stored = storedMatch();
      stored.detail.gameMode = gameMode;
      stored.detail.lobbyType = lobbyType;
      await repository.upsertMatch(stored);
      const detail = stratzDetail();
      detail.gameMode = stratzGameMode;
      detail.lobbyType = stratzLobbyType;
      const service = new StratzMatchEnrichmentService({
        repository,
        provider: provider(detail),
      });

      await expect(service.enrichMatch(stored.detail.id)).resolves.toMatchObject({
        changed: true,
      });
    },
  );

  it("rejects a genuine game mode mismatch", async () => {
    const repository = await createLiveRepository();
    await repository.upsertMatch(storedMatch());
    const detail = stratzDetail();
    detail.gameMode = "TURBO";
    const service = new StratzMatchEnrichmentService({
      repository,
      provider: provider(detail),
    });

    await expect(service.enrichMatch("9000000001")).resolves.toEqual({
      changed: false,
      status: "failed",
    });
    expect((await repository.getMatch("9000000001"))?.detail.enrichmentSources).toEqual([]);
  });

  it.each([
    ["STRATZ_RATE_LIMITED", "rate_limited", "degraded"],
    ["STRATZ_UNAVAILABLE", "unavailable", "unavailable"],
    ["STRATZ_FAILED", "failed", "degraded"],
  ] as const)("classifies %s without erasing OpenDota data", async (code, status, health) => {
    const repository = await createLiveRepository();
    await repository.upsertMatch(storedMatch());
    const failingProvider = {
      getMatchDetail: vi.fn(async () => {
        throw { code };
      }),
    } as unknown as Pick<StratzProvider, "getMatchDetail">;
    const service = new StratzMatchEnrichmentService({ repository, provider: failingProvider });

    await expect(service.enrichMatch("9000000001")).resolves.toEqual({ changed: false, status });
    expect((await repository.getMatch("9000000001"))?.detail.players[0]).toEqual(player());
    expect(await repository.getProviderHealth("stratz")).toMatchObject({ status: health });
  });
});
