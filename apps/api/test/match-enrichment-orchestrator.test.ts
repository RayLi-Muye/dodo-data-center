import {
  apiErrorSchema,
  emptyMatchAnalysis,
  matchDetailResponseSchema,
  playerEnrichmentProgressResponseSchema,
  type MatchDetail,
} from "@dodo/contracts";
import {
  OpenDotaProviderError,
  type CanonicalMatchDetail,
  type OpenDotaProvider,
  type StratzProvider,
} from "@dodo/dota-data";
import {
  createSeedRepository,
  SEED_ACCOUNT_ID,
  type StoredMatch,
} from "@dodo/db";
import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import { MatchEnrichmentOrchestrator } from "../src/match-enrichment-orchestrator.js";
import type { PlayerDataProvider } from "../src/player-data-provider.js";
import { StratzMatchEnrichmentService } from "../src/stratz-match-enrichment-service.js";

const NOW = "2026-07-13T12:00:00.000Z";

const json = (response: { body: string }): unknown => JSON.parse(response.body);

const canonicalDetail = (match: StoredMatch): CanonicalMatchDetail => ({
  id: match.detail.id,
  startTime: match.detail.startTime,
  durationSeconds: match.detail.durationSeconds,
  patchId: match.detail.openDotaPatchId,
  gameMode: match.detail.gameMode,
  region: match.detail.region,
  lobbyType: match.detail.lobbyType,
  cluster: match.detail.cluster,
  radiantScore: match.detail.radiantScore,
  direScore: match.detail.direScore,
  radiantWin: match.detail.radiantWin,
  eligiblePlayerCount: 1,
  excludedPlayerCount: 0,
  exclusionReasons: [],
  quality: "complete",
  players: [
    {
      ...match.detail.players[0]!,
      eligibleForPersonalAggregation: true,
      abilityBuild: [],
      abilityBuildStatus: "unavailable",
      itemTimeline: [],
      itemTimelineStatus: "unavailable",
    },
  ],
  parseStatus: "parsed",
  analysis: emptyMatchAnalysis(NOW),
  source: { source: "opendota", fetchedAt: NOW },
});

const summaryCopy = (match: StoredMatch, id: string): StoredMatch => ({
  ...match,
  detail: {
    ...match.detail,
    id,
    detailStatus: "summary",
    players: [match.detail.players[0]!],
    enrichmentSources: [],
    stratzEnrichment: {
      status: "not_requested",
      resultQuality: null,
      attemptCount: 0,
      lastAttemptAt: null,
      nextAttemptAt: null,
      reasonCode: null,
      providerRevision: "stratz-graphql-v1",
    },
  },
});

const markStoredAnalysesCurrent = async (
  repository: Awaited<ReturnType<typeof createSeedRepository>>,
): Promise<void> => {
  const matches = await repository.listPlayerMatches(SEED_ACCOUNT_ID);
  await Promise.all(matches.flatMap((match) => [
    repository.upsertMatch({
      ...match,
      detail: { ...match.detail, parseStatus: "parsed" },
    }),
    repository.upsertMatchAnalysis({
      matchId: match.detail.id,
      analysis: emptyMatchAnalysis(NOW),
      importedAt: NOW,
      quality: "partial",
    }),
  ]));
};

describe("bounded match enrichment orchestration", () => {
  it("reports recent/all progress and coalesces one bounded account batch", async () => {
    const repository = await createSeedRepository();
    await markStoredAnalysesCurrent(repository);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const getStratzDetail = vi.fn(async () => {
      await gate;
      throw { code: "NOT_FOUND", reason: "not_found" };
    });
    const stratzService = new StratzMatchEnrichmentService({
      repository,
      provider: { getMatchDetail: getStratzDetail } as unknown as Pick<StratzProvider, "getMatchDetail">,
      clock: () => new Date(NOW),
    });
    const openDotaProvider = {
      getMatchDetail: vi.fn(async () => { throw new Error("summary detail was not expected"); }),
    } as unknown as Pick<OpenDotaProvider, "getMatchDetail">;
    const orchestrator = new MatchEnrichmentOrchestrator({
      repository,
      provider: openDotaProvider,
      stratzService,
      clock: () => new Date(NOW),
    });
    const app = await buildApp({
      dataMode: "seed",
      repository,
      matchEnrichmentOrchestrator: orchestrator,
    });

    const recent = playerEnrichmentProgressResponseSchema.parse(json(await app.inject({
      method: "GET",
      url: `/v1/players/${SEED_ACCOUNT_ID}/enrichment?scope=recent`,
    })));
    expect(recent.data.totalMatches).toBe(20);
    expect(recent.meta).toMatchObject({
      sampleSize: 20,
      eligibleCount: 20,
      coverageRate: 0,
      metricVersion: "match-enrichment-v1",
      filtersApplied: { scope: "recent" },
    });

    const first = await app.inject({
      method: "POST",
      url: `/v1/players/${SEED_ACCOUNT_ID}/enrichment?scope=all_imported`,
    });
    const second = await app.inject({
      method: "POST",
      url: `/v1/players/${SEED_ACCOUNT_ID}/enrichment?scope=all_imported`,
    });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(playerEnrichmentProgressResponseSchema.parse(json(first)).data).toMatchObject({
      totalMatches: 105,
      running: true,
      batchSize: 20,
    });
    expect(getStratzDetail).toHaveBeenCalledOnce();

    release();
    await orchestrator.close();
    const completed = playerEnrichmentProgressResponseSchema.parse(json(await app.inject({
      method: "GET",
      url: `/v1/players/${SEED_ACCOUNT_ID}/enrichment?scope=all_imported`,
    })));
    expect(getStratzDetail).toHaveBeenCalledTimes(20);
    expect(completed.data).toMatchObject({
      totalMatches: 105,
      running: false,
      retryScheduledCount: 20,
      notRequestedCount: 85,
      retryEligibleCount: 85,
    });
    expect(completed.meta.sources).toEqual(expect.arrayContaining(["seed", "stratz"]));
    await app.close();
  });

  it("coalesces summary detail work for one match before returning enriched data", async () => {
    const repository = await createSeedRepository();
    const original = (await repository.listPlayerMatches(SEED_ACCOUNT_ID))[0]!;
    const summary = summaryCopy(original, "8999999999");
    await repository.upsertPlayerMatches(SEED_ACCOUNT_ID, [summary]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const getMatchDetail = vi.fn(async () => {
      await gate;
      return canonicalDetail(summary);
    });
    const orchestrator = new MatchEnrichmentOrchestrator({
      repository,
      provider: { getMatchDetail } as Pick<OpenDotaProvider, "getMatchDetail">,
      clock: () => new Date(NOW),
    });

    const first = orchestrator.enrichMatch(summary.detail.id);
    const second = orchestrator.enrichMatch(summary.detail.id);
    await vi.waitFor(() => expect(getMatchDetail).toHaveBeenCalledOnce());
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual(secondResult);
    expect(firstResult?.detail.detailStatus).toBe("enriched");
    expect(getMatchDetail).toHaveBeenCalledOnce();
  });

  it("persists real-shaped canonical analysis and composes a schema-valid match response", async () => {
    const repository = await createSeedRepository();
    const stored = (await repository.listPlayerMatches(SEED_ACCOUNT_ID))[0]!;
    const analysis = emptyMatchAnalysis(NOW);
    analysis.playerTimelines = {
      status: "complete",
      excludedCount: 0,
      exclusionReasons: [],
      players: Array.from({ length: 10 }, (_, playerSlot) => ({
        playerSlot,
        samples: [{ gameTimeSeconds: 60, gold: 500 + playerSlot, xp: 300, lastHits: 5, denies: 1 }],
      })),
    };
    analysis.teamAdvantages = {
      status: "complete",
      excludedCount: 0,
      exclusionReasons: [],
      axis: "inferred_60s",
      samples: [{ gameTimeSeconds: 60, radiantGoldAdvantage: -250, radiantXpAdvantage: -100 }],
    };
    analysis.kills.status = "complete";
    analysis.damage.status = "complete";
    analysis.objectives.status = "complete";
    analysis.teamfights = {
      status: "complete",
      excludedCount: 0,
      exclusionReasons: [],
      fights: [{
        startTimeSeconds: 600,
        endTimeSeconds: 630,
        lastDeathTimeSeconds: 625,
        deathCount: 1,
        players: [{
          playerIndex: 0,
          playerSlot: stored.detail.players[0]!.playerSlot,
          deaths: 1,
          buybacks: 0,
          damage: 900,
          healing: 0,
          goldDelta: -200,
          xpDelta: -100,
          xpStart: 2000,
          xpEnd: 1900,
        }],
      }],
    };
    const canonical = { ...canonicalDetail(stored), analysis };
    const orchestrator = new MatchEnrichmentOrchestrator({
      repository,
      provider: { getMatchDetail: vi.fn(async () => canonical) },
      clock: () => new Date(NOW),
    });
    await orchestrator.enrichMatch(stored.detail.id);
    const app = await buildApp({
      dataMode: "seed",
      repository,
      matchEnrichmentOrchestrator: orchestrator,
    });

    const response = matchDetailResponseSchema.parse(json(await app.inject({
      method: "GET",
      url: `/v1/matches/${stored.detail.id}`,
    })));
    expect(response.data.analysis.playerTimelines.players).toHaveLength(10);
    expect(response.data.analysis.teamAdvantages.samples[0]?.radiantGoldAdvantage).toBe(-250);
    expect(response.data.analysis.teamfights.fights[0]?.players[0]?.playerSlot).toBe(
      stored.detail.players[0]!.playerSlot,
    );
    expect(response.data.analysis).toMatchObject({
      providerRevision: "opendota-match-analysis-v1",
      updatedAt: NOW,
    });
    expect(response.meta.quality).toBe("complete");
    await app.close();
  });

  it("automatically retries unparsed core once without repeatedly scanning current partial analysis", async () => {
    const repository = await createSeedRepository();
    const stored = (await repository.listPlayerMatches(SEED_ACCOUNT_ID))[0]!;
    await repository.replacePlayerMatches(SEED_ACCOUNT_ID, [stored]);
    await repository.upsertMatchAnalysis({
      matchId: stored.detail.id,
      analysis: emptyMatchAnalysis(NOW),
      importedAt: NOW,
      quality: "partial",
    });
    const getMatchDetail = vi.fn(async () => canonicalDetail(stored));
    const orchestrator = new MatchEnrichmentOrchestrator({
      repository,
      provider: { getMatchDetail },
      clock: () => new Date(NOW),
    });

    await orchestrator.requestPlayerEnrichment(SEED_ACCOUNT_ID, "recent");
    await orchestrator.close();
    expect(getMatchDetail).toHaveBeenCalledOnce();
    expect((await repository.getMatch(stored.detail.id))?.detail.parseStatus).toBe("parsed");

    await orchestrator.requestPlayerEnrichment(SEED_ACCOUNT_ID, "recent");
    await orchestrator.close();
    expect(getMatchDetail).toHaveBeenCalledOnce();
  });

  it("does not turn a repository write failure into a successful single-match response", async () => {
    const repository = await createSeedRepository();
    const original = (await repository.listPlayerMatches(SEED_ACCOUNT_ID))[0]!;
    const summary = summaryCopy(original, "8999999998");
    await repository.upsertPlayerMatches(SEED_ACCOUNT_ID, [summary]);
    const getMatchDetail = vi.fn(async () => canonicalDetail(summary));
    const orchestrator = new MatchEnrichmentOrchestrator({
      repository,
      provider: { getMatchDetail } as Pick<OpenDotaProvider, "getMatchDetail">,
      clock: () => new Date(NOW),
    });
    vi.spyOn(repository, "upsertMatch").mockRejectedValueOnce(
      new Error("test-only repository write failure"),
    );
    const app = await buildApp({
      dataMode: "seed",
      repository,
      matchEnrichmentOrchestrator: orchestrator,
    });

    const response = await app.inject({
      method: "POST",
      url: `/v1/matches/${summary.detail.id}/enrichment`,
    });
    expect(response.statusCode).toBe(500);
    expect(apiErrorSchema.parse(json(response)).error.code).toBe("INTERNAL_ERROR");
    expect((await repository.getMatch(summary.detail.id))?.detail.detailStatus).toBe("summary");
    await app.close();
  });

  it("returns a visible classified error when single-match OpenDota enrichment fails", async () => {
    const repository = await createSeedRepository();
    const original = (await repository.listPlayerMatches(SEED_ACCOUNT_ID))[0]!;
    const summary = summaryCopy(original, "8999999997");
    await repository.upsertPlayerMatches(SEED_ACCOUNT_ID, [summary]);
    const previousAnalysis = emptyMatchAnalysis("2026-07-20T00:00:00.000Z");
    previousAnalysis.kills = {
      status: "partial",
      excludedCount: 0,
      exclusionReasons: [],
      events: [{ killerPlayerSlot: 0, gameTimeSeconds: 120, victimEntityName: "npc_dota_hero_axe" }],
    };
    await repository.upsertMatchAnalysis({
      matchId: summary.detail.id,
      analysis: previousAnalysis,
      importedAt: "2026-07-20T00:00:00.000Z",
      quality: "partial",
    });
    const orchestrator = new MatchEnrichmentOrchestrator({
      repository,
      provider: {
        getMatchDetail: vi.fn(async () => {
          throw new OpenDotaProviderError(
            "SOURCE_RATE_LIMITED",
            "rate_limited",
            "test-only rate limit",
            true,
            429,
            120,
          );
        }),
      } as Pick<OpenDotaProvider, "getMatchDetail">,
      clock: () => new Date(NOW),
    });
    const app = await buildApp({
      dataMode: "seed",
      repository,
      matchEnrichmentOrchestrator: orchestrator,
    });

    const response = await app.inject({
      method: "POST",
      url: `/v1/matches/${summary.detail.id}/enrichment`,
    });
    expect(response.statusCode).toBe(429);
    expect(apiErrorSchema.parse(json(response))).toMatchObject({
      error: { code: "SOURCE_RATE_LIMITED", retryable: true },
      meta: { retryAfterSeconds: 120, sources: ["opendota"] },
    });
    expect((await repository.getMatch(summary.detail.id))?.detail.detailStatus).toBe("summary");
    expect((await repository.getMatchAnalysis(summary.detail.id))?.analysis).toEqual(previousAnalysis);
    await app.close();
  });

  it("consumes background repository failures through the injected error handler", async () => {
    const repository = await createSeedRepository();
    await markStoredAnalysesCurrent(repository);
    const onError = vi.fn();
    const stratzService = new StratzMatchEnrichmentService({
      repository,
      provider: {
        getMatchDetail: vi.fn(async () => {
          throw { code: "NOT_FOUND", reason: "not_found" };
        }),
      } as unknown as Pick<StratzProvider, "getMatchDetail">,
      clock: () => new Date(NOW),
    });
    const orchestrator = new MatchEnrichmentOrchestrator({
      repository,
      provider: {
        getMatchDetail: vi.fn(async () => { throw new Error("not expected"); }),
      } as unknown as Pick<OpenDotaProvider, "getMatchDetail">,
      stratzService,
      clock: () => new Date(NOW),
      onError,
    });
    vi.spyOn(repository, "upsertMatch").mockRejectedValueOnce(
      new Error("test-only background repository failure"),
    );

    await orchestrator.requestPlayerEnrichment(SEED_ACCOUNT_ID, "recent");
    await expect(orchestrator.close()).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "test-only background repository failure" }),
    );
  });

  it.each([
    ["SOURCE_RATE_LIMITED", "rate_limited", 300],
    ["SOURCE_UNAVAILABLE", "upstream_5xx", null],
  ] as const)("stops an account batch after provider-wide OpenDota %s", async (
    code,
    reason,
    retryAfterSeconds,
  ) => {
    const repository = await createSeedRepository();
    const original = (await repository.listPlayerMatches(SEED_ACCOUNT_ID))[0]!;
    const summaries = ["8999999901", "8999999902", "8999999903"].map((id) =>
      summaryCopy(original, id)
    );
    await repository.replacePlayerMatches(SEED_ACCOUNT_ID, summaries);
    const getMatchDetail = vi.fn(async () => {
      throw new OpenDotaProviderError(
        code,
        reason,
        "test-only provider-wide failure",
        true,
        code === "SOURCE_RATE_LIMITED" ? 429 : 503,
        retryAfterSeconds,
      );
    });
    const onError = vi.fn();
    const orchestrator = new MatchEnrichmentOrchestrator({
      repository,
      provider: { getMatchDetail } as Pick<OpenDotaProvider, "getMatchDetail">,
      clock: () => new Date(NOW),
      onError,
    });

    await orchestrator.requestPlayerEnrichment(SEED_ACCOUNT_ID, "recent");
    await orchestrator.close();

    expect(getMatchDetail).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
    for (const match of await repository.listPlayerMatches(SEED_ACCOUNT_ID)) {
      expect(match.detail.detailStatus).toBe("summary");
      expect(match.detail.stratzEnrichment).toEqual(summaryCopy(original, match.detail.id).detail.stratzEnrichment);
    }
  });

  it.each([
    ["NOT_FOUND", "not_found"],
    ["PARSE_PENDING", "match_data_unavailable"],
  ] as const)("continues after match-local OpenDota %s without polluting its state", async (
    code,
    reason,
  ) => {
    const repository = await createSeedRepository();
    const original = (await repository.listPlayerMatches(SEED_ACCOUNT_ID))[0]!;
    const summaries = ["8999999801", "8999999802", "8999999803"].map((id) =>
      summaryCopy(original, id)
    );
    await repository.replacePlayerMatches(SEED_ACCOUNT_ID, summaries);
    const ordered = await repository.listPlayerMatches(SEED_ACCOUNT_ID);
    const byId = new Map(ordered.map((match) => [match.detail.id, match]));
    const firstId = ordered[0]!.detail.id;
    const getMatchDetail = vi.fn(async (matchId: string) => {
      if (matchId === firstId) {
        throw new OpenDotaProviderError(
          code,
          reason,
          "test-only match-local failure",
          true,
          code === "NOT_FOUND" ? 404 : 202,
        );
      }
      return canonicalDetail(byId.get(matchId)!);
    });
    const orchestrator = new MatchEnrichmentOrchestrator({
      repository,
      provider: { getMatchDetail } as Pick<OpenDotaProvider, "getMatchDetail">,
      clock: () => new Date(NOW),
    });

    await orchestrator.requestPlayerEnrichment(SEED_ACCOUNT_ID, "recent");
    await orchestrator.close();

    expect(getMatchDetail.mock.calls.map(([matchId]) => matchId)).toEqual(
      ordered.map((match) => match.detail.id),
    );
    const failed = await repository.getMatch(firstId);
    expect(failed?.detail.detailStatus).toBe("summary");
    expect(failed?.detail.stratzEnrichment).toEqual(
      summaryCopy(original, firstId).detail.stratzEnrichment,
    );
    for (const match of ordered.slice(1)) {
      expect((await repository.getMatch(match.detail.id))?.detail.detailStatus).toBe("enriched");
    }
  });

  it("passes the actual background error to the production app logger", async () => {
    const repository = await createSeedRepository();
    await markStoredAnalysesCurrent(repository);
    const stratzService = new StratzMatchEnrichmentService({
      repository,
      provider: {
        getMatchDetail: vi.fn(async () => {
          throw { code: "NOT_FOUND", reason: "not_found" };
        }),
      } as unknown as Pick<StratzProvider, "getMatchDetail">,
      clock: () => new Date(NOW),
    });
    const playerDataProvider = {
      getMatchDetail: vi.fn(async () => { throw new Error("not expected"); }),
    } as unknown as PlayerDataProvider;
    const app = await buildApp({
      dataMode: "live",
      repository,
      playerDataProvider,
      stratzMatchEnrichmentService: stratzService,
      clock: () => new Date(NOW),
    });
    const logError = vi.spyOn(app.log, "error");
    const backgroundError = new Error("test-only production background failure");
    vi.spyOn(repository, "upsertMatch").mockRejectedValueOnce(backgroundError);

    const response = await app.inject({
      method: "POST",
      url: `/v1/players/${SEED_ACCOUNT_ID}/enrichment?scope=recent`,
    });
    expect(response.statusCode).toBe(202);
    await app.close();

    expect(logError).toHaveBeenCalledWith(
      { err: backgroundError },
      "Background match enrichment failed.",
    );
  });
});
