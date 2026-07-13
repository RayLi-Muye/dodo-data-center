import type { MatchDetail } from "@dodo/contracts";
import type { StratzMatchDetail, StratzProvider } from "@dodo/dota-data";
import { createLiveRepository, type StoredMatch } from "@dodo/db";
import { describe, expect, it, vi } from "vitest";

import { StratzMatchEnrichmentService } from "../src/stratz-match-enrichment-service.js";

const FETCHED_AT = "2026-07-13T01:00:00.000Z";
const CLOCK_AT = "2026-07-13T01:00:01.000Z";

const initialEnrichment = (): MatchDetail["stratzEnrichment"] => ({
  status: "not_requested",
  resultQuality: null,
  attemptCount: 0,
  lastAttemptAt: null,
  nextAttemptAt: null,
  reasonCode: null,
  providerRevision: "stratz-graphql-v1",
});

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
    stratzEnrichment: initialEnrichment(),
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
    expect(stored?.detail.stratzEnrichment).toEqual({
      status: "complete",
      resultQuality: "complete",
      attemptCount: 1,
      lastAttemptAt: CLOCK_AT,
      nextAttemptAt: null,
      reasonCode: null,
      providerRevision: "stratz-graphql-v1",
    });
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

  it("keeps richer match data when provider health persistence fails", async () => {
    const repository = await createLiveRepository();
    await repository.upsertMatch(storedMatch());
    const upsertMatch = vi.spyOn(repository, "upsertMatch");
    vi.spyOn(repository, "upsertProviderHealth").mockRejectedValue(
      new Error("test-only health write failure"),
    );
    const service = new StratzMatchEnrichmentService({
      repository,
      provider: provider(),
      clock: () => new Date(CLOCK_AT),
    });

    await expect(service.enrichMatch("9000000001")).resolves.toMatchObject({
      changed: true,
      status: "complete",
    });
    expect(upsertMatch).toHaveBeenCalledOnce();
    const stored = await repository.getMatch("9000000001");
    expect(stored?.detail.players[0]?.abilityBuildStatus).toBe("timed");
    expect(stored?.detail.stratzEnrichment.status).toBe("complete");
  });

  it("does not classify a repository match write failure as an invalid provider response", async () => {
    const repository = await createLiveRepository();
    await repository.upsertMatch(storedMatch());
    const upsertMatch = vi.spyOn(repository, "upsertMatch").mockRejectedValueOnce(
      new Error("test-only match write failure"),
    );
    const service = new StratzMatchEnrichmentService({
      repository,
      provider: provider(),
      clock: () => new Date(CLOCK_AT),
    });

    await expect(service.enrichMatch("9000000001")).rejects.toThrow(
      "test-only match write failure",
    );
    expect(upsertMatch).toHaveBeenCalledOnce();
    expect((await repository.getMatch("9000000001"))?.detail.stratzEnrichment)
      .toEqual(initialEnrichment());
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
      status: "terminal_failed",
    });
    expect((await repository.getMatch("9000000001"))?.detail.enrichmentSources).toEqual([]);
    expect((await repository.getMatch("9000000001"))?.detail.stratzEnrichment).toMatchObject({
      status: "terminal_failed",
      reasonCode: "player_conflict",
      attemptCount: 1,
    });
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
      status: "terminal_failed",
    });
    expect((await repository.getMatch("9000000001"))?.detail.enrichmentSources).toEqual([]);
    expect((await repository.getMatch("9000000001"))?.detail.stratzEnrichment).toMatchObject({
      status: "terminal_failed",
      reasonCode: "core_conflict",
      attemptCount: 1,
    });
  });

  it.each([
    ["AUTHENTICATION", "unavailable", "invalid_token", "authentication", 86_400],
    ["RATE_LIMITED", "degraded", "rate_limited", "rate_limited", 120],
    ["UNAVAILABLE", "unavailable", "timeout", "unavailable", 900],
  ] as const)("blocks the provider for %s without consuming a match attempt", async (
    code,
    health,
    reason,
    reasonCode,
    retryAfterSeconds,
  ) => {
    const repository = await createLiveRepository();
    await repository.upsertMatch(storedMatch());
    const failingProvider = {
      getMatchDetail: vi.fn(async () => {
        throw { code, reason, retryAfterSeconds: code === "RATE_LIMITED" ? retryAfterSeconds : null };
      }),
    } as unknown as Pick<StratzProvider, "getMatchDetail">;
    const service = new StratzMatchEnrichmentService({
      repository,
      provider: failingProvider,
      clock: () => new Date(CLOCK_AT),
    });

    await expect(service.enrichMatch("9000000001")).resolves.toEqual({
      changed: false,
      status: "provider_blocked",
      stopBatch: true,
    });
    expect((await repository.getMatch("9000000001"))?.detail.players[0]).toEqual(player());
    expect((await repository.getMatch("9000000001"))?.detail.stratzEnrichment).toMatchObject({
      status: "provider_blocked",
      attemptCount: 0,
      lastAttemptAt: CLOCK_AT,
      reasonCode,
      nextAttemptAt: new Date(Date.parse(CLOCK_AT) + retryAfterSeconds * 1_000).toISOString(),
    });
    expect(await repository.getProviderHealth("stratz")).toMatchObject({
      status: health,
      message: expect.stringContaining(`${code}: ${reason}`),
    });
  });

  it("stops all provider calls until a provider-wide retry window expires", async () => {
    const repository = await createLiveRepository();
    const first = storedMatch();
    const second = storedMatch();
    second.detail.id = "9000000002";
    await repository.upsertMatch(first);
    await repository.upsertMatch(second);
    const failingProvider = {
      getMatchDetail: vi.fn(async () => {
        throw { code: "RATE_LIMITED", reason: "rate_limited", retryAfterSeconds: 120 };
      }),
    } as unknown as Pick<StratzProvider, "getMatchDetail">;
    let now = new Date(CLOCK_AT);
    const service = new StratzMatchEnrichmentService({
      repository,
      provider: failingProvider,
      clock: () => now,
    });

    await expect(service.enrichMatch(first.detail.id)).resolves.toMatchObject({
      status: "provider_blocked",
      stopBatch: true,
    });
    await expect(service.enrichMatch(second.detail.id)).resolves.toEqual({
      changed: false,
      status: "skipped",
      stopBatch: true,
    });
    expect(failingProvider.getMatchDetail).toHaveBeenCalledOnce();
    expect((await repository.getMatch(second.detail.id))?.detail.stratzEnrichment)
      .toEqual(initialEnrichment());

    now = new Date(Date.parse(CLOCK_AT) + 120_000);
    await expect(service.enrichMatch(second.detail.id)).resolves.toMatchObject({
      status: "provider_blocked",
      stopBatch: true,
    });
    expect(failingProvider.getMatchDetail).toHaveBeenCalledTimes(2);
  });

  it("persists a complete result even when STRATZ contributes no new events", async () => {
    const repository = await createLiveRepository();
    await repository.upsertMatch(storedMatch());
    const detail = stratzDetail();
    detail.players[0] = {
      ...detail.players[0]!,
      abilityBuild: [],
      abilityBuildStatus: "unavailable",
      itemTimeline: [],
      itemTimelineStatus: "unavailable",
    };
    const service = new StratzMatchEnrichmentService({
      repository,
      provider: provider(detail),
      clock: () => new Date(CLOCK_AT),
    });

    await expect(service.enrichMatch("9000000001")).resolves.toEqual({
      changed: false,
      status: "complete",
    });
    const stored = await repository.getMatch("9000000001");
    expect(stored?.detail.enrichmentSources).toEqual([]);
    expect(stored?.detail.players[0]).toEqual(player());
    expect(stored?.detail.stratzEnrichment).toMatchObject({
      status: "complete",
      resultQuality: "complete",
      attemptCount: 1,
    });
  });

  it("schedules an empty partial response without deleting old events", async () => {
    const repository = await createLiveRepository();
    await repository.upsertMatch(storedMatch());
    const detail = stratzDetail();
    detail.quality = "partial";
    detail.players[0] = {
      ...detail.players[0]!,
      abilityBuild: [],
      abilityBuildStatus: "unavailable",
      itemTimeline: [],
      itemTimelineStatus: "unavailable",
    };
    const service = new StratzMatchEnrichmentService({
      repository,
      provider: provider(detail),
      clock: () => new Date(CLOCK_AT),
    });

    await expect(service.enrichMatch("9000000001")).resolves.toEqual({
      changed: false,
      status: "retry_scheduled",
    });
    const stored = await repository.getMatch("9000000001");
    expect(stored?.detail.enrichmentSources).toEqual([]);
    expect(stored?.detail.players[0]).toEqual(player());
    expect(stored?.detail.stratzEnrichment).toMatchObject({
      status: "retry_scheduled",
      resultQuality: "partial",
      attemptCount: 1,
      reasonCode: "partial_response",
    });
  });

  it.each([
    ["FAILED", "invalid_response"],
    ["NOT_FOUND", "not_found"],
  ] as const)("retries %s after 15m, 2h, and 24h before terminal failure", async (
    code,
    reasonCode,
  ) => {
    const repository = await createLiveRepository();
    await repository.upsertMatch(storedMatch());
    const failingProvider = {
      getMatchDetail: vi.fn(async () => {
        throw { code, reason: reasonCode };
      }),
    } as unknown as Pick<StratzProvider, "getMatchDetail">;
    let now = new Date(CLOCK_AT);
    const service = new StratzMatchEnrichmentService({
      repository,
      provider: failingProvider,
      clock: () => now,
    });
    const delays = [15 * 60_000, 2 * 60 * 60_000, 24 * 60 * 60_000];

    for (const [index, delay] of delays.entries()) {
      await expect(service.enrichMatch("9000000001")).resolves.toMatchObject({
        status: "retry_scheduled",
      });
      const state = (await repository.getMatch("9000000001"))!.detail.stratzEnrichment;
      expect(state).toMatchObject({
        attemptCount: index + 1,
        reasonCode,
        nextAttemptAt: new Date(now.getTime() + delay).toISOString(),
      });
      const dueAt = new Date(state.nextAttemptAt!);
      now = new Date(dueAt.getTime() - 1);
      await expect(service.enrichMatch("9000000001")).resolves.toEqual({
        changed: false,
        status: "skipped",
      });
      now = dueAt;
    }

    await expect(service.enrichMatch("9000000001")).resolves.toMatchObject({
      status: "terminal_failed",
    });
    expect((await repository.getMatch("9000000001"))?.detail.stratzEnrichment).toMatchObject({
      status: "terminal_failed",
      resultQuality: null,
      attemptCount: 4,
      nextAttemptAt: null,
      reasonCode,
    });
    expect(failingProvider.getMatchDetail).toHaveBeenCalledTimes(4);
  });

  it("preserves old events and terminates partial after the third scheduled retry", async () => {
    const repository = await createLiveRepository();
    await repository.upsertMatch(storedMatch());
    const detail = stratzDetail();
    detail.quality = "partial";
    const matchProvider = provider(detail);
    let now = new Date(CLOCK_AT);
    const service = new StratzMatchEnrichmentService({
      repository,
      provider: matchProvider,
      clock: () => now,
    });
    const delays = [15 * 60_000, 2 * 60 * 60_000, 24 * 60 * 60_000];

    for (const delay of delays) {
      await expect(service.enrichMatch("9000000001")).resolves.toMatchObject({
        status: "retry_scheduled",
      });
      const nextAttemptAt = (await repository.getMatch("9000000001"))!
        .detail.stratzEnrichment.nextAttemptAt!;
      now = new Date(nextAttemptAt);
    }
    await expect(service.enrichMatch("9000000001")).resolves.toMatchObject({
      status: "terminal_partial",
    });

    const stored = await repository.getMatch("9000000001");
    expect(stored?.detail.enrichmentSources).toEqual(["stratz"]);
    expect(stored?.detail.stratzEnrichment).toMatchObject({
      status: "terminal_partial",
      resultQuality: "partial",
      attemptCount: 4,
      nextAttemptAt: null,
    });
    expect(stored?.detail.players[0]?.itemTimeline).toEqual([
      { itemId: "1", action: "purchase", gameTimeSeconds: 900, charges: null },
      { itemId: "1", action: "sell", gameTimeSeconds: 1_200, charges: null },
    ]);
  });

  it("requests a terminal match again when the provider revision changes", async () => {
    const repository = await createLiveRepository();
    const stored = storedMatch();
    stored.detail.stratzEnrichment = {
      status: "terminal_failed",
      resultQuality: null,
      attemptCount: 4,
      lastAttemptAt: CLOCK_AT,
      nextAttemptAt: null,
      reasonCode: "invalid_response",
      providerRevision: "stratz-graphql-v0",
    };
    await repository.upsertMatch(stored);
    const matchProvider = provider();
    const service = new StratzMatchEnrichmentService({
      repository,
      provider: matchProvider,
      clock: () => new Date(CLOCK_AT),
    });

    await expect(service.enrichMatch(stored.detail.id)).resolves.toMatchObject({ status: "complete" });
    expect(matchProvider.getMatchDetail).toHaveBeenCalledOnce();
    expect((await repository.getMatch(stored.detail.id))?.detail.stratzEnrichment).toMatchObject({
      status: "complete",
      attemptCount: 1,
      providerRevision: "stratz-graphql-v1",
    });
  });
});
