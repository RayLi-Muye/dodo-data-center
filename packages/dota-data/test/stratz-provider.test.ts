import { describe, expect, it, vi } from "vitest";

import matchFixture from "../fixtures/stratz-match-detail.json";
import playerFixture from "../fixtures/stratz-player-summary.json";
import { StratzProviderError } from "../src/stratz-errors.js";
import { StratzProvider } from "../src/stratz-provider.js";

const NOW = new Date("2026-07-13T00:00:00.000Z");
const TOKEN = "fixture-secret-token";

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function providerFor(body: unknown, status = 200, headers?: HeadersInit) {
  const fetchImpl = vi.fn(async (
    _input: string | URL | Request,
    _init?: RequestInit,
  ) => jsonResponse(body, status, headers));
  const provider = new StratzProvider({
    token: TOKEN,
    endpoint: "https://stratz.fixture/graphql",
    fetchImpl,
    clock: () => NOW,
  });
  return { provider, fetchImpl };
}

describe("StratzProvider", () => {
  it("authenticates server-side and normalizes ten unique match players", async () => {
    const { provider, fetchImpl } = providerFor(matchFixture);

    const result = await provider.getMatchDetail("9003000001");

    expect(result).toMatchObject({
      id: "9003000001",
      gameVersionId: "60",
      gameMode: "ALL_PICK",
      lobbyType: "RANKED",
      region: "3",
      cluster: "156",
      radiantWin: true,
      eligiblePlayerCount: 10,
      excludedPlayerCount: 0,
      quality: "partial",
      source: { source: "stratz", fetchedAt: NOW.toISOString() },
    });
    expect(new Set(result.players.map((player) => player.playerSlot)).size).toBe(10);
    expect(result.exclusionReasons).toEqual([
      "ability_event_duplicate",
      "purchase_event_duplicate",
    ]);

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://stratz.fixture/graphql");
    expect(String(url)).not.toContain(TOKEN);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect((init?.headers as Record<string, string>)["User-Agent"]).toBe("STRATZ_API");
    expect(init?.redirect).toBe("error");
    expect(String(init?.body)).not.toContain(TOKEN);
  });

  it("keeps zero-based first-rank skills and talents while sorting and deduplicating events", async () => {
    const result = await providerFor(matchFixture).provider.getMatchDetail("9003000001");
    const player = result.players[0];

    expect(player?.abilityBuild).toEqual([
      { abilityId: "5010", sequence: 1, heroLevel: 1, gameTimeSeconds: 0 },
      { abilityId: "5011", sequence: 2, heroLevel: 3, gameTimeSeconds: 120 },
      { abilityId: "6001", sequence: 3, heroLevel: 10, gameTimeSeconds: 600 },
    ]);
    expect(player?.abilityBuildStatus).toBe("timed");
    expect(player?.itemTimeline).toEqual([
      { itemId: "1", action: "purchase", gameTimeSeconds: 100, charges: null },
      { itemId: "1", action: "purchase", gameTimeSeconds: 420, charges: null },
    ]);
    expect(player?.itemTimelineStatus).toBe("partial");
    expect(result.players[1]).toMatchObject({
      abilityBuild: [],
      abilityBuildStatus: "unavailable",
      itemTimeline: [],
      itemTimelineStatus: "unavailable",
    });
  });

  it("rejects mismatched match IDs and duplicate player slots", async () => {
    await expect(providerFor(matchFixture).provider.getMatchDetail("9003000002"))
      .rejects.toMatchObject({ code: "FAILED", reason: "invalid_response" });

    const duplicateSlots = structuredClone(matchFixture);
    duplicateSlots.data.match.players[1]!.playerSlot = 0;
    await expect(providerFor(duplicateSlots).provider.getMatchDetail("9003000001"))
      .rejects.toMatchObject({ code: "FAILED", reason: "invalid_response" });
  });

  it("normalizes a public player summary without converting STRATZ versions to official versions", async () => {
    await expect(providerFor(playerFixture).provider.getPlayerSummary("224328273")).resolves.toEqual({
      steamAccountId: "224328273",
      personaName: "Synthetic STRATZ Player",
      avatarUrl: "https://fixtures.invalid/stratz-avatar.png",
      matchCount: 1250,
      winCount: 660,
      lastMatchAt: "2026-07-11T20:00:00.000Z",
      privacyStatus: "public",
      quality: "complete",
      source: { source: "stratz", fetchedAt: NOW.toISOString() },
    });
  });

  it("normalizes, sorts, and deduplicates a player's recent matches", async () => {
    const newest = structuredClone(matchFixture.data.match);
    newest.players = [newest.players[0]!];
    const older = structuredClone(newest);
    older.id = 9003000000;
    older.startDateTime -= 100;
    const body = {
      data: {
        player: {
          steamAccountId: 224328273,
          steamAccount: {
            id: 224328273,
            isAnonymous: false,
          },
          matches: [older, newest, structuredClone(newest)],
        },
      },
    };

    const result = await providerFor(body).provider.getRecentMatches("224328273", 3);

    expect(result.matches.map((match) => match.id)).toEqual(["9003000001", "9003000000"]);
    expect(result.matches[0]?.player.steamAccountId).toBe("224328273");
    expect(result).toMatchObject({
      eligibleCount: 3,
      excludedCount: 1,
      quality: "partial",
      exclusionReasons: ["duplicate_match", "match_partial"],
    });
  });

  it("keeps anonymous histories distinct from public empty histories", async () => {
    const body = {
      data: {
        player: {
          steamAccountId: 224328273,
          steamAccount: {
            id: 224328273,
            isAnonymous: true,
          },
          matches: [],
        },
      },
    };
    const result = await providerFor(body).provider.getRecentMatches("224328273");
    expect(result).toMatchObject({
      privacyStatus: "anonymous",
      matches: [],
      quality: "complete",
    });
  });

  it("does not infer Steam history privacy from STRATZ profile visibility", async () => {
    const match = structuredClone(matchFixture.data.match);
    match.players = [match.players[0]!];
    const body = {
      data: {
        player: {
          steamAccountId: 224328273,
          steamAccount: {
            id: 224328273,
            isAnonymous: false,
            isStratzPublic: false,
          },
          matches: [match],
        },
      },
    };

    const result = await providerFor(body).provider.getRecentMatches("224328273");

    expect(result.privacyStatus).toBe("public");
    expect(result.matches.map((candidate) => candidate.id)).toEqual(["9003000001"]);
  });

  it("keeps usable match data with GraphQL errors and marks it partial", async () => {
    const body = {
      ...structuredClone(matchFixture),
      errors: [{ message: `partial upstream detail ${TOKEN}` }],
    };

    const result = await providerFor(body).provider.getMatchDetail("9003000001");

    expect(result.quality).toBe("partial");
    expect(result.exclusionReasons).toContain("graphql_partial");
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain("partial upstream detail");
  });

  it("forces player summary quality to partial when GraphQL returns data with errors", async () => {
    const body = {
      ...structuredClone(playerFixture),
      errors: [{ message: `partial player detail ${TOKEN}` }],
    };

    const result = await providerFor(body).provider.getPlayerSummary("224328273");

    expect(result.quality).toBe("partial");
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("marks recent matches as partial when GraphQL returns usable data with errors", async () => {
    const match = structuredClone(matchFixture.data.match);
    match.players = [match.players[0]!];
    const body = {
      data: {
        player: {
          steamAccountId: 224328273,
          steamAccount: { id: 224328273, isAnonymous: false },
          matches: [match],
        },
      },
      errors: [{ message: `partial recent matches ${TOKEN}` }],
    };

    const result = await providerFor(body).provider.getRecentMatches("224328273");

    expect(result.quality).toBe("partial");
    expect(result.exclusionReasons).toContain("graphql_partial");
    expect(result.matches[0]?.exclusionReasons).toContain("graphql_partial");
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("preserves authentication classification when partial match data is null", async () => {
    const error = await providerFor({
      data: { match: null },
      errors: [{ message: `Unauthenticated ${TOKEN}`, extensions: { code: "UNAUTHENTICATED" } }],
    }).provider.getMatchDetail("9003000001").catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "AUTHENTICATION",
      reason: "invalid_token",
      retryable: false,
    });
    expect(String(error)).not.toContain(TOKEN);
  });

  it("preserves rate-limit classification when partial player data is null", async () => {
    const error = await providerFor({
      data: { player: null },
      errors: [{ message: `Rate limit exceeded ${TOKEN}` }],
    }).provider.getPlayerSummary("224328273").catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "RATE_LIMITED",
      reason: "rate_limited",
      retryable: true,
    });
    expect(String(error)).not.toContain(TOKEN);
  });

  it("preserves GraphQL failure classification when recent player data is missing", async () => {
    const error = await providerFor({
      data: {},
      errors: [{ message: `Unknown field ${TOKEN}`, extensions: { code: "GRAPHQL_VALIDATION_FAILED" } }],
    }).provider.getRecentMatches("224328273").catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: "FAILED",
      reason: "graphql_error",
      retryable: false,
    });
    expect(String(error)).not.toContain(TOKEN);
  });

  it.each([
    { name: "401", status: 401, headers: undefined, expected: { code: "AUTHENTICATION", reason: "invalid_token", retryable: false } },
    { name: "403", status: 403, headers: undefined, expected: { code: "AUTHENTICATION", reason: "forbidden", retryable: false } },
    { name: "Cloudflare challenge", status: 403, headers: { "cf-mitigated": "challenge" }, expected: { code: "UNAVAILABLE", reason: "cloudflare_challenge", retryable: true } },
    { name: "429", status: 429, headers: { "retry-after": "30" }, expected: { code: "RATE_LIMITED", reason: "rate_limited", retryable: true, retryAfterSeconds: 30 } },
    { name: "5xx", status: 503, headers: undefined, expected: { code: "UNAVAILABLE", reason: "upstream_5xx", retryable: true } },
    { name: "other HTTP", status: 400, headers: undefined, expected: { code: "FAILED", reason: "upstream_http", retryable: false } },
  ])("classifies $name without exposing the token", async ({ status, headers, expected }) => {
    const error = await providerFor({}, status, headers).provider
      .getMatchDetail("9003000001")
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject(expected);
    expect(String(error)).not.toContain(TOKEN);
  });

  it.each([
    { errors: [{ message: "Unauthenticated", extensions: { code: "UNAUTHENTICATED" } }], expected: { code: "AUTHENTICATION", retryable: false } },
    { errors: [{ message: "Forbidden", extensions: { code: "AUTHENTICATION" } }], expected: { code: "AUTHENTICATION", reason: "forbidden", retryable: false } },
    { errors: [{ message: "Authentication failed", extensions: { code: "AUTHENTICATION" } }], expected: { code: "AUTHENTICATION", reason: "invalid_token", retryable: false } },
    { errors: [{ message: "Rate limit exceeded" }], expected: { code: "RATE_LIMITED", retryable: true } },
    { errors: [{ message: "Unknown field", extensions: { code: "GRAPHQL_VALIDATION_FAILED" } }], expected: { code: "FAILED", retryable: false } },
  ])("classifies sanitized GraphQL errors", async ({ errors, expected }) => {
    const error = await providerFor({ errors, data: null }).provider
      .getMatchDetail("9003000001")
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject(expected);
    expect(String(error)).not.toContain(TOKEN);
    expect(String(error)).not.toContain(JSON.stringify(errors));
  });

  it("classifies invalid JSON, network errors, and timeouts", async () => {
    const invalidJson = new StratzProvider({
      token: TOKEN,
      fetchImpl: async () => new Response("not-json", { status: 200 }),
    });
    await expect(invalidJson.getMatchDetail("9003000001")).rejects.toMatchObject({
      code: "FAILED",
      reason: "invalid_response",
    });

    const network = new StratzProvider({
      token: TOKEN,
      fetchImpl: async () => { throw new TypeError(`offline ${TOKEN}`); },
    });
    const networkError = await network.getMatchDetail("9003000001").catch((error: unknown) => error);
    expect(networkError).toMatchObject({ code: "UNAVAILABLE", reason: "network" });
    expect(String(networkError)).not.toContain(TOKEN);

    const fetchImpl = vi.fn((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    );
    const timeout = new StratzProvider({ token: TOKEN, fetchImpl, timeoutMs: 5 });
    await expect(timeout.getMatchDetail("9003000001")).rejects.toMatchObject({
      code: "UNAVAILABLE",
      reason: "timeout",
    });
    expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("validates token, IDs, timeout, and recent match bounds before fetching", async () => {
    expect(() => new StratzProvider({ token: "\n" })).toThrow(TypeError);
    const { provider, fetchImpl } = providerFor(matchFixture);
    await expect(provider.getMatchDetail("0")).rejects.toThrow(TypeError);
    await expect(provider.getRecentMatches("224328273", 101)).rejects.toThrow(RangeError);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(() => new StratzProvider({ token: TOKEN, timeoutMs: 0 })).toThrow(TypeError);
  });

  it("exposes typed provider errors", () => {
    expect(new StratzProviderError("FAILED", "graphql_error", "failed", false)).toBeInstanceOf(Error);
  });
});
