import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GET as getPlayerEnrichment,
  POST as postPlayerEnrichment,
} from "../app/api/players/[accountId]/enrichment/route";
import { POST as postMatchEnrichment } from "../app/api/matches/[matchId]/enrichment/route";

const playerContext = { params: Promise.resolve({ accountId: "123456789" }) };

const progressResponse = (): Response => new Response(JSON.stringify({
  data: {
    accountId: "123456789",
    batchSize: 20,
    completeCount: 8,
    detailReadyCount: 12,
    notRequestedCount: 4,
    providerBlockedCount: 0,
    retryEligibleCount: 4,
    retryScheduledCount: 0,
    running: false,
    scope: "recent",
    terminalFailedCount: 0,
    terminalPartialCount: 0,
    totalMatches: 12,
    updatedAt: "2026-07-13T10:00:00.000Z",
  },
  meta: {
    coverageRate: 8 / 12,
    eligibleCount: 12,
    excludedCount: 0,
    exclusionReasons: [],
    filtersApplied: { scope: "recent" },
    inputWatermark: "2026-07-13T10:00:00.000Z",
    metricVersion: "match-enrichment-v1",
    quality: "partial",
    sampleSize: 12,
    sources: ["opendota"],
    updatedAt: "2026-07-13T10:00:00.000Z",
  },
}), { status: 200 });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("enrichment BFF routes", () => {
  it("validates scope and proxies GET/POST without forwarding a request body", async () => {
    vi.stubEnv("API_BASE_URL", "https://api.example.test");
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      progressResponse());
    vi.stubGlobal("fetch", fetcher);

    const getResponse = await getPlayerEnrichment(
      new Request("http://web.test/api/players/123456789/enrichment?scope=recent"),
      playerContext,
    );
    const postResponse = await postPlayerEnrichment(
      new Request("http://web.test/api/players/123456789/enrichment?scope=recent", { method: "POST" }),
      playerContext,
    );

    expect(getResponse.status).toBe(200);
    expect(postResponse.status).toBe(202);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "https://api.example.test/v1/players/123456789/enrichment?scope=recent",
      "https://api.example.test/v1/players/123456789/enrichment?scope=recent",
    ]);
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(["GET", "POST"]);
    expect(fetcher.mock.calls.every(([, init]) => init?.body === undefined)).toBe(true);
    expect(fetcher.mock.calls.every(([, init]) => init?.signal instanceof AbortSignal)).toBe(true);
  });

  it("rejects an unknown scope before contacting the API", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const response = await getPlayerEnrichment(
      new Request("http://web.test/api/players/123456789/enrichment?scope=everything"),
      playerContext,
    );

    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps match route failures sanitized while forwarding the canonical path", async () => {
    vi.stubEnv("API_BASE_URL", "https://api.example.test");
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      error: { code: "SOURCE_RATE_LIMITED", message: "safe upstream message", retryable: true },
    }), { status: 429 }));
    vi.stubGlobal("fetch", fetcher);

    const response = await postMatchEnrichment(
      new Request("http://web.test/api/matches/9000000001/enrichment", { method: "POST" }),
      { params: Promise.resolve({ matchId: "9000000001" }) },
    );

    expect(response.status).toBe(429);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.example.test/v1/matches/9000000001/enrichment");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
  });
});
