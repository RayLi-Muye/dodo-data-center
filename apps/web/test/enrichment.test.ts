import type { PlayerEnrichmentProgress } from "@dodo/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  EnrichmentRequestError,
  loadPlayerEnrichment,
  refreshMatchEnrichment,
  startAndPollPlayerEnrichment,
} from "../lib/enrichment";

const progress = (running: boolean, notRequestedCount = 4): PlayerEnrichmentProgress => ({
  accountId: "123456789",
  batchSize: 20,
  completeCount: 8,
  detailReadyCount: 12,
  notRequestedCount,
  providerBlockedCount: 0,
  retryEligibleCount: notRequestedCount,
  retryScheduledCount: 0,
  running,
  scope: "recent",
  terminalFailedCount: 0,
  terminalPartialCount: 0,
  totalMatches: 12,
  updatedAt: "2026-07-13T10:00:00.000Z",
});

const progressResponse = (data: PlayerEnrichmentProgress): Response => new Response(JSON.stringify({
  data,
  meta: {
    coverageRate: data.totalMatches === 0 ? 0 : data.completeCount / data.totalMatches,
    eligibleCount: data.totalMatches,
    excludedCount: 0,
    exclusionReasons: [],
    filtersApplied: { scope: data.scope },
    inputWatermark: data.updatedAt,
    metricVersion: "match-enrichment-v1",
    quality: data.completeCount === data.totalMatches ? "complete" : "partial",
    sampleSize: data.totalMatches,
    sources: ["opendota"],
    updatedAt: data.updatedAt ?? "2026-07-13T10:00:00.000Z",
  },
}), { status: data.running ? 202 : 200 });

describe("match enrichment workflow", () => {
  it("loads the selected scope with GET", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      progressResponse(progress(false)));
    const result = await loadPlayerEnrichment("123456789", "recent", { fetcher });

    expect(result.totalMatches).toBe(12);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/players/123456789/enrichment?scope=recent",
      expect.objectContaining({ method: "GET", signal: expect.any(AbortSignal) }),
    );
  });

  it("starts exactly one batch and only polls GET while it is running", async () => {
    const responses = [
      progressResponse(progress(true)),
      progressResponse(progress(true)),
      progressResponse(progress(false, 2)),
    ];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      responses.shift()!);

    const result = await startAndPollPlayerEnrichment("123456789", "recent", {
      fetcher,
      maxPollAttempts: 3,
      wait: async () => undefined,
    });

    expect(result.notRequestedCount).toBe(2);
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "GET", "GET"]);
  });

  it("does not automatically start another batch when eligible matches remain", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      progressResponse(progress(false, 4)));

    const result = await startAndPollPlayerEnrichment("123456789", "all_imported", { fetcher });

    expect(result.notRequestedCount).toBe(4);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe("POST");
  });

  it("classifies single-match failures without exposing an unknown response", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      error: { code: "SOURCE_UNAVAILABLE", message: "internal host detail", retryable: true },
    }), { status: 503 }));

    await expect(refreshMatchEnrichment("9000000001", { fetcher })).rejects.toEqual(
      new EnrichmentRequestError("增强服务暂时不可用，已有比赛数据仍会保留。"),
    );
  });
});
