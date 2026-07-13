import { describe, expect, it, vi } from "vitest";

import heroesFixture from "../fixtures/heroes.json";
import abilityIdsFixture from "../fixtures/ability-ids.json";
import abilitiesFixture from "../fixtures/abilities.json";
import errorsFixture from "../fixtures/http-errors.json";
import matchDetailFixture from "../fixtures/match-detail.json";
import emptyMatchesFixture from "../fixtures/matches-empty.json";
import publicMatchesFixture from "../fixtures/matches-public.json";
import itemsFixture from "../fixtures/items.json";
import patchesFixture from "../fixtures/patches.json";
import partialProfileFixture from "../fixtures/profile-partial.json";
import publicProfileFixture from "../fixtures/profile-public.json";
import heroAbilitiesFixture from "../fixtures/hero-abilities.json";
import { OpenDotaProviderError } from "../src/errors.js";
import { OpenDotaProvider } from "../src/opendota-provider.js";

const NOW = new Date("2026-07-10T00:00:00.000Z");

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function providerFor(body: unknown, status = 200, headers?: HeadersInit) {
  const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
    jsonResponse(body, status, headers),
  );
  const sleep = vi.fn(async (_delayMs: number) => undefined);
  const provider = new OpenDotaProvider({
    baseUrl: "https://opendota.fixture/api/",
    fetchImpl,
    clock: () => NOW,
    sleep,
  });
  return { provider, fetchImpl, sleep };
}

function providerForHeroAbilities({
  abilityIds = abilityIdsFixture,
  abilities = abilitiesFixture,
  heroAbilities = heroAbilitiesFixture,
}: {
  abilityIds?: unknown;
  abilities?: unknown;
  heroAbilities?: unknown;
} = {}) {
  const responseByPath: Record<string, unknown> = {
    "/api/constants/ability_ids": abilityIds,
    "/api/constants/abilities": abilities,
    "/api/constants/hero_abilities": heroAbilities,
  };
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    return jsonResponse(responseByPath[path]);
  });
  return {
    provider: new OpenDotaProvider({
      baseUrl: "https://opendota.fixture/api/",
      fetchImpl,
      clock: () => NOW,
    }),
    fetchImpl,
  };
}

function summarizeLedgerWindow(
  ledger: Array<{ status: "included" | "excluded" }>,
  size: 20 | 50 | 100,
) {
  const window = ledger.slice(0, size);
  const sampleSize = window.filter((entry) => entry.status === "included").length;
  const excludedCount = window.filter((entry) => entry.status === "excluded").length;
  return { eligibleCount: window.length, sampleSize, excludedCount };
}

describe("OpenDotaProvider", () => {
  it("normalizes a complete public profile and sends API keys only in Authorization", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      jsonResponse(publicProfileFixture),
    );
    const provider = new OpenDotaProvider({
      baseUrl: "https://opendota.fixture/api/",
      apiKey: "test-only-value",
      fetchImpl,
      clock: () => NOW,
    });

    await expect(provider.getPlayerProfile("123456789")).resolves.toEqual({
      accountId: "123456789",
      steamId64: "76561198083722517",
      personaName: "Synthetic Fixture Player",
      avatarUrl: "https://fixtures.invalid/avatar.png",
      status: "public_complete",
      source: { source: "opendota", fetchedAt: NOW.toISOString() },
    });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://opendota.fixture/api/players/123456789");
    expect(String(url)).not.toContain("test-only-value");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-only-value");
    expect(init?.redirect).toBe("error");
  });

  it("marks profiles with missing optional fields as partial", async () => {
    const { provider } = providerFor(partialProfileFixture);
    const result = await provider.getPlayerProfile("123456789");
    expect(result.status).toBe("public_partial");
    expect(result.avatarUrl).toBeNull();
  });

  it("normalizes partial match fields and applies the required stable sort", async () => {
    const { provider, fetchImpl } = providerFor(publicMatchesFixture);
    const result = await provider.getRecentMatches("123456789");

    expect(result.requestedLimit).toBe(100);
    expect(result).toMatchObject({
      eligibleCount: 3,
      excludedCount: 0,
      exclusionReasons: [],
      quality: "complete",
    });
    expect(result.matches.map((match) => match.id)).toEqual(["9003", "9002", "9001"]);
    expect(result.candidateLedger).toEqual([
      { providerIndex: 0, status: "included", matchId: "9001" },
      { providerIndex: 1, status: "included", matchId: "9002" },
      { providerIndex: 2, status: "included", matchId: "9003" },
    ]);
    expect(result.matches[0]?.player).toMatchObject({
      accountId: "123456789",
      eligibleForPersonalAggregation: true,
      gpm: 420,
      xpm: null,
      lastHits: null,
      heroDamage: null,
    });
    expect(result.matches[0]?.lobbyType).toBe("7");
    expect(result.matches[1]?.lobbyType).toBeNull();
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("?limit=100");
  });

  it("reads a bounded player match page with an explicit offset", async () => {
    const pageFixture = publicMatchesFixture.slice(0, 2);
    const { provider, fetchImpl } = providerFor(pageFixture);

    const result = await provider.getPlayerMatchesPage("123456789", 2, 100);

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "https://opendota.fixture/api/players/123456789/matches?limit=2&offset=100",
    );
    expect(result).toMatchObject({
      accountId: "123456789",
      requestedLimit: 2,
      offset: 100,
      rawCount: 2,
      reachedEnd: false,
      eligibleCount: 2,
      excludedCount: 0,
    });
    expect(result.matches).toHaveLength(2);
  });

  it("returns a natural end marker for an empty deep history page", async () => {
    const result = await providerFor([]).provider.getPlayerMatchesPage("123456789", 100, 300);

    expect(result).toMatchObject({
      offset: 300,
      rawCount: 0,
      reachedEnd: true,
      eligibleCount: 0,
      excludedCount: 0,
      quality: "complete",
      matches: [],
    });
  });

  it("returns an excluded partial page so a history checkpoint can advance", async () => {
    const matches: Array<Record<string, unknown>> = structuredClone(publicMatchesFixture);
    matches.forEach((match) => {
      match.duration = 0;
    });

    const result = await providerFor(matches).provider.getPlayerMatchesPage("123456789", 100, 200);

    expect(result).toMatchObject({
      offset: 200,
      rawCount: 3,
      reachedEnd: true,
      eligibleCount: 3,
      excludedCount: 3,
      exclusionReasons: ["candidate_invalid"],
      quality: "partial",
      matches: [],
    });
    expect(result.candidateLedger).toHaveLength(3);
  });

  it("validates player match page bounds before requesting OpenDota", async () => {
    const { provider, fetchImpl } = providerFor(publicMatchesFixture);

    await expect(provider.getPlayerMatchesPage("123456789", 101, 0)).rejects.toThrow(RangeError);
    await expect(provider.getPlayerMatchesPage("123456789", 100, -1)).rejects.toThrow(RangeError);
    await expect(provider.getPlayerMatchesPage("123456789", 100, 1.5)).rejects.toThrow(RangeError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not classify an empty or private history as public empty data", async () => {
    const { provider } = providerFor(emptyMatchesFixture);
    await expect(provider.getRecentMatches("123456789")).rejects.toMatchObject({
      code: "HISTORY_PRIVATE",
      reason: "history_unavailable",
      retryable: false,
    });
  });

  it("excludes documented null outcomes without failing the public history", async () => {
    const matches: Array<Record<string, unknown>> = structuredClone(publicMatchesFixture);
    matches[1]!.radiant_win = null;

    const result = await providerFor(matches).provider.getRecentMatches("123456789");

    expect(result.matches.map((match) => match.id)).toEqual(["9003", "9001"]);
    expect(result).toMatchObject({
      eligibleCount: 3,
      excludedCount: 1,
      exclusionReasons: ["radiant_win_unavailable"],
      quality: "partial",
    });
    expect(result.candidateLedger).toEqual([
      { providerIndex: 0, status: "included", matchId: "9001" },
      {
        providerIndex: 1,
        status: "excluded",
        exclusionReasons: ["radiant_win_unavailable"],
      },
      { providerIndex: 2, status: "included", matchId: "9003" },
    ]);
    expect(result.matches.length + result.excludedCount).toBe(result.eligibleCount);
  });

  it("excludes documented null player slots without failing the public history", async () => {
    const matches: Array<Record<string, unknown>> = structuredClone(publicMatchesFixture);
    matches[1]!.player_slot = null;

    const result = await providerFor(matches).provider.getRecentMatches("123456789");

    expect(result.matches.map((match) => match.id)).toEqual(["9003", "9001"]);
    expect(result).toMatchObject({
      eligibleCount: 3,
      excludedCount: 1,
      exclusionReasons: ["player_slot_unavailable"],
      quality: "partial",
    });
    expect(result.matches.length + result.excludedCount).toBe(result.eligibleCount);
  });

  it("records a per-candidate canonical validation failure as a sanitized exclusion", async () => {
    const matches: Array<Record<string, unknown>> = structuredClone(publicMatchesFixture);
    matches[1]!.duration = 0;

    const result = await providerFor(matches).provider.getRecentMatches("123456789");

    expect(result.candidateLedger[1]).toEqual({
      providerIndex: 1,
      status: "excluded",
      exclusionReasons: ["candidate_invalid"],
    });
    expect(result).toMatchObject({
      eligibleCount: 3,
      excludedCount: 1,
      exclusionReasons: ["candidate_invalid"],
      quality: "partial",
    });
    expect(result.matches.length + result.excludedCount).toBe(result.eligibleCount);
  });

  it("attaches a reconciled candidate ledger when every public match is unusable", async () => {
    const matches: Array<Record<string, unknown>> = structuredClone(publicMatchesFixture);
    matches.forEach((match) => {
      match.duration = 0;
    });

    const error = await providerFor(matches)
      .provider.getRecentMatches("123456789")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OpenDotaProviderError);
    expect(error).toMatchObject({
      code: "PARSE_PENDING",
      reason: "player_data_unavailable",
      retryable: true,
      qualityContext: {
        eligibleCount: 3,
        excludedCount: 3,
        exclusionReasons: ["candidate_invalid"],
      },
    });
    if (!(error instanceof OpenDotaProviderError)) throw new Error("Expected provider error");
    expect(error.qualityContext?.candidateLedger).toEqual([
      {
        providerIndex: 0,
        status: "excluded",
        exclusionReasons: ["candidate_invalid"],
      },
      {
        providerIndex: 1,
        status: "excluded",
        exclusionReasons: ["candidate_invalid"],
      },
      {
        providerIndex: 2,
        status: "excluded",
        exclusionReasons: ["candidate_invalid"],
      },
    ]);
    expect(error.qualityContext?.eligibleCount).toBe(
      (error.qualityContext?.excludedCount ?? 0) + 0,
    );
  });

  it("derives exact last-20, last-50, and last-100 quality counts from provider order", async () => {
    const base = publicMatchesFixture[0] as Record<string, unknown>;
    const excludedIndices = new Set([4, 24, 54, 84]);
    const candidates = Array.from({ length: 100 }, (_, providerIndex) => ({
      ...base,
      match_id: 10000 + providerIndex,
      start_time: 1700010000 - providerIndex,
      player_slot: excludedIndices.has(providerIndex) ? null : base.player_slot,
    }));

    const result = await providerFor(candidates).provider.getRecentMatches("123456789");

    expect(summarizeLedgerWindow(result.candidateLedger, 20)).toEqual({
      eligibleCount: 20,
      sampleSize: 19,
      excludedCount: 1,
    });
    expect(summarizeLedgerWindow(result.candidateLedger, 50)).toEqual({
      eligibleCount: 50,
      sampleSize: 48,
      excludedCount: 2,
    });
    expect(summarizeLedgerWindow(result.candidateLedger, 100)).toEqual({
      eligibleCount: 100,
      sampleSize: 96,
      excludedCount: 4,
    });
    expect(result.candidateLedger).toHaveLength(result.eligibleCount);
    expect(result.matches.length + result.excludedCount).toBe(result.eligibleCount);
  });

  it("keeps anonymous match players out of personal aggregation", async () => {
    const { provider } = providerFor(matchDetailFixture);
    const match = await provider.getMatchDetail("9003");
    expect(match.id).toBe("9003");
    expect(match.patchId).toBe("58");
    expect(match).toMatchObject({
      lobbyType: "7",
      cluster: "156",
      radiantScore: 31,
      direScore: 42,
      eligiblePlayerCount: 2,
      excludedPlayerCount: 0,
      exclusionReasons: [],
      quality: "complete",
    });
    expect(match.players[1]).toMatchObject({
      accountId: null,
      eligibleForPersonalAggregation: false,
    });
  });

  it("normalizes enriched player metrics, inventory, ordered abilities, and real purchases", async () => {
    const match = await providerFor(matchDetailFixture).provider.getMatchDetail("9003");

    expect(match.players[0]).toMatchObject({
      denies: 12,
      heroHealing: 250,
      towerDamage: 3100,
      level: 24,
      netWorth: 21450,
      finalItemIds: ["1", "2"],
      backpackItemIds: ["3"],
      neutralItemId: "4",
      neutralItemEnhancementId: "1592",
      abilityBuildStatus: "ordered",
      abilityBuild: [
        { abilityId: "5010", sequence: 1, heroLevel: null, gameTimeSeconds: null },
        { abilityId: "5011", sequence: 2, heroLevel: null, gameTimeSeconds: null },
        { abilityId: "5010", sequence: 3, heroLevel: null, gameTimeSeconds: null },
      ],
      itemTimelineStatus: "partial",
      itemTimeline: [
        {
          itemKey: "tango",
          action: "purchase",
          gameTimeSeconds: -85,
          charges: null,
        },
        {
          itemKey: "blink",
          action: "purchase",
          gameTimeSeconds: 412,
          charges: null,
        },
      ],
    });
  });

  it("marks absent ability and purchase logs as unavailable without inferring events", async () => {
    const match = await providerFor(matchDetailFixture).provider.getMatchDetail("9003");

    expect(match.players[1]).toMatchObject({
      denies: null,
      heroHealing: null,
      towerDamage: null,
      level: null,
      netWorth: null,
      backpackItemIds: [],
      neutralItemId: null,
      neutralItemEnhancementId: null,
      abilityBuild: [],
      abilityBuildStatus: "unavailable",
      itemTimeline: [],
      itemTimelineStatus: "unavailable",
    });
  });

  it("treats a present purchase-only log as partial even when it is empty", async () => {
    const detail = structuredClone(matchDetailFixture);
    detail.players[0]!.purchase_log = [];

    const match = await providerFor(detail).provider.getMatchDetail("9003");

    expect(match.players[0]).toMatchObject({
      itemTimeline: [],
      itemTimelineStatus: "partial",
    });
  });

  it("classifies a match with an unresolved outcome as parse pending", async () => {
    const detail = structuredClone(matchDetailFixture) as unknown as Record<string, unknown>;
    detail.radiant_win = null;

    await expect(providerFor(detail).provider.getMatchDetail("9003")).rejects.toMatchObject({
      code: "PARSE_PENDING",
      reason: "match_data_unavailable",
      retryable: true,
    });
  });

  it("excludes a partial match-detail player with a null slot", async () => {
    const detail = structuredClone(matchDetailFixture);
    const players = detail.players as unknown as Array<Record<string, unknown>>;
    players[1]!.player_slot = null;

    const result = await providerFor(detail).provider.getMatchDetail("9003");

    expect(result.players).toHaveLength(1);
    expect(result).toMatchObject({
      eligiblePlayerCount: 1,
      excludedPlayerCount: 1,
      exclusionReasons: ["player_slot_unavailable"],
      quality: "partial",
    });
  });

  it("treats the upstream zero account sentinel as anonymous", async () => {
    const detail = structuredClone(matchDetailFixture);
    detail.players[1]!.account_id = 0;
    const match = await providerFor(detail).provider.getMatchDetail("9003");
    expect(match.players[1]).toMatchObject({
      accountId: null,
      eligibleForPersonalAggregation: false,
    });
  });

  it("excludes a scoped account mismatch without leaking the upstream account ID", async () => {
    const matches: Array<Record<string, unknown>> = structuredClone(publicMatchesFixture);
    matches[0]!.account_id = 987654321;
    const { provider } = providerFor(matches);
    const result = await provider.getRecentMatches("123456789");

    expect(result.candidateLedger[0]).toEqual({
      providerIndex: 0,
      status: "excluded",
      exclusionReasons: ["candidate_invalid"],
    });
    expect(JSON.stringify(result.candidateLedger)).not.toContain("987654321");
  });

  it("normalizes hero and item constants with external string IDs", async () => {
    const heroes = await providerFor(heroesFixture).provider.getHeroConstants();
    const items = await providerFor(itemsFixture).provider.getItemConstants();

    expect(heroes.items[0]).toMatchObject({
      id: "1",
      name: "antimage",
      primaryAttribute: "agility",
      attackType: "melee",
    });
    expect(items.items.map((item) => item.id)).toEqual(["1", "2"]);
    expect(items.items[1]?.attributes).toEqual([{ label: "+", value: "45" }]);
    expect(items.items.map(({ id, kind, availabilityStatus }) => ({
      id,
      kind,
      availabilityStatus,
    }))).toEqual([
      { id: "1", kind: "item", availabilityStatus: "unverified" },
      { id: "2", kind: "item", availabilityStatus: "unverified" },
    ]);
  });

  it("joins hero abilities, talents, and facets without inventing missing IDs", async () => {
    const { provider, fetchImpl } = providerForHeroAbilities();

    const result = await provider.getHeroAbilityConstants();
    const earthSpirit = result.heroes.npc_dota_hero_earth_spirit;

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls.map(([input]) => String(input)).sort()).toEqual([
      "https://opendota.fixture/api/constants/abilities",
      "https://opendota.fixture/api/constants/ability_ids",
      "https://opendota.fixture/api/constants/hero_abilities",
    ]);
    expect(earthSpirit?.abilities).toEqual([
      {
        id: "5608",
        name: "earth_spirit_boulder_smash",
        localizedName: "Boulder Smash",
        description: "Smashes a target in the direction Earth Spirit is facing.",
        slot: 0,
        type: "basic",
      },
      {
        id: "5610",
        name: "earth_spirit_geomagnetic_grip",
        localizedName: "Geomagnetic Grip",
        description: "Pulls a Stone Remnant toward Earth Spirit.",
        slot: 2,
        type: "basic",
      },
      {
        id: "1395",
        name: "earth_spirit_stone_caller",
        localizedName: "Stone Remnant",
        description: "Places a Stone Remnant.",
        slot: 3,
        type: "innate",
      },
      {
        id: "5648",
        name: "earth_spirit_petrify",
        localizedName: "Enchant Remnant",
        description: "Temporarily turns a hero into a Stone Remnant.",
        slot: 4,
        type: "basic",
      },
      {
        id: "5612",
        name: "earth_spirit_magnetize",
        localizedName: "Magnetize",
        description: "Magnetizes nearby enemy units.",
        slot: 5,
        type: "ultimate",
      },
      {
        id: "324",
        name: "special_bonus_unique_earth_spirit_4",
        localizedName: "+150 Rolling Boulder Distance",
        description: "",
        slot: 6,
        type: "talent",
      },
    ]);
    expect(earthSpirit?.excludedAbilityNames).toEqual([
      "earth_spirit_missing_skill",
      "earth_spirit_missing_talent",
    ]);
    expect(earthSpirit?.facets).toEqual([
      { name: "Resonance", description: "Stone Remnants resonate with Magnetize." },
      { name: "earth_spirit_stepping_stone", description: "Rolling Boulder moves farther." },
    ]);
    expect(result.source).toEqual({ source: "opendota", fetchedAt: NOW.toISOString() });
  });

  it.each([
    { field: "ability IDs", input: { abilityIds: {} } },
    { field: "abilities", input: { abilities: [] } },
    { field: "hero abilities", input: { heroAbilities: null } },
  ])("classifies malformed or empty $field constants as invalid", async ({ input }) => {
    await expect(providerForHeroAbilities(input).provider.getHeroAbilityConstants())
      .rejects.toMatchObject({
        code: "SOURCE_UNAVAILABLE",
        reason: "invalid_response",
        retryable: false,
      });
  });

  it("normalizes patch constants and sorts by release time then numeric ID", async () => {
    const { provider, fetchImpl } = providerFor(patchesFixture);

    await expect(provider.getPatchConstants()).resolves.toEqual({
      items: [
        { id: "57", name: "7.38", releasedAt: "2025-02-19T00:00:00.000Z" },
        { id: "58", name: "7.39", releasedAt: "2025-05-21T00:00:00.000Z" },
        { id: "59", name: "7.40", releasedAt: "2025-05-21T00:00:00.000Z" },
      ],
      source: { source: "opendota", fetchedAt: NOW.toISOString() },
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "https://opendota.fixture/api/constants/patch",
    );
  });

  it("classifies empty patch constants as an invalid response", async () => {
    await expect(providerFor([]).provider.getPatchConstants()).rejects.toMatchObject({
      code: "SOURCE_UNAVAILABLE",
      reason: "invalid_response",
      retryable: false,
    });
  });

  it.each([
    { field: "array", payload: {} },
    { field: "id", payload: [{ id: -1, name: "7.39", date: "2025-05-21T00:00:00Z" }] },
    { field: "name", payload: [{ id: 58, name: "", date: "2025-05-21T00:00:00Z" }] },
    { field: "date", payload: [{ id: 58, name: "7.39", date: "May 21, 2025" }] },
    { field: "calendar date", payload: [{ id: 58, name: "7.39", date: "2025-02-30T00:00:00Z" }] },
  ])("classifies malformed patch $field data as an invalid response", async ({ payload }) => {
    await expect(providerFor(payload).provider.getPatchConstants()).rejects.toMatchObject({
      code: "SOURCE_UNAVAILABLE",
      reason: "invalid_response",
      retryable: false,
    });
  });

  it.each([
    {
      name: "404",
      status: 404,
      expected: { code: "NOT_FOUND", reason: "not_found", retryable: false },
    },
    {
      name: "429",
      status: errorsFixture.rateLimited.status,
      expected: {
        code: "SOURCE_RATE_LIMITED",
        reason: "rate_limited",
        retryable: true,
        retryAfterSeconds: 30,
      },
    },
    {
      name: "5xx",
      status: errorsFixture.upstreamUnavailable.status,
      expected: { code: "SOURCE_UNAVAILABLE", reason: "upstream_5xx", retryable: true },
    },
  ])("classifies $name responses", async ({ status, expected }) => {
    const headers = status === 429 ? { "retry-after": errorsFixture.rateLimited.retryAfter } : undefined;
    const { provider } = providerFor({}, status, headers);
    await expect(provider.getPlayerProfile("123456789")).rejects.toMatchObject(expected);
  });

  it("classifies invalid upstream JSON independently from network failure", async () => {
    const fetchImpl = vi.fn(async () => new Response("not-json", { status: 200 }));
    const provider = new OpenDotaProvider({
      fetchImpl,
    });
    await expect(provider.getPlayerProfile("123456789")).rejects.toMatchObject({
      code: "SOURCE_UNAVAILABLE",
      reason: "invalid_response",
      retryable: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("classifies a valid JSON response with an invalid shape", async () => {
    const { provider } = providerFor({ profile: "not-an-object" });
    await expect(provider.getPlayerProfile("123456789")).rejects.toMatchObject({
      code: "SOURCE_UNAVAILABLE",
      reason: "invalid_response",
    });
  });

  it("classifies network errors", async () => {
    const sleep = vi.fn(async (_delayMs: number) => undefined);
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("offline");
    });
    const provider = new OpenDotaProvider({
      fetchImpl,
      sleep,
    });
    await expect(provider.getPlayerProfile("123456789")).rejects.toMatchObject({
      code: "SOURCE_UNAVAILABLE",
      reason: "network",
      retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("aborts and classifies timed out requests", async () => {
    const fetchImpl = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const sleep = vi.fn(async (_delayMs: number) => undefined);
    const provider = new OpenDotaProvider({ fetchImpl, timeoutMs: 5, sleep });

    await expect(provider.getPlayerProfile("123456789")).rejects.toMatchObject({
      code: "SOURCE_UNAVAILABLE",
      reason: "timeout",
      retryable: true,
    });
    expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("retries once after a first-attempt timeout and then succeeds", async () => {
    const fetchImpl = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          if (fetchImpl.mock.calls.length === 1) {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
            return;
          }
          resolve(jsonResponse(publicProfileFixture));
        }),
    );
    const sleep = vi.fn(async (_delayMs: number) => undefined);
    const provider = new OpenDotaProvider({ fetchImpl, sleep, timeoutMs: 5 });

    await expect(provider.getPlayerProfile("123456789")).resolves.toMatchObject({
      accountId: "123456789",
      status: "public_complete",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("retries once after a first-attempt HTTP 503 and then succeeds", async () => {
    const fetchImpl = vi
      .fn(async () => jsonResponse(publicProfileFixture))
      .mockResolvedValueOnce(jsonResponse({}, 503));
    const sleep = vi.fn(async (_delayMs: number) => undefined);
    const provider = new OpenDotaProvider({ fetchImpl, sleep });

    await expect(provider.getPlayerProfile("123456789")).resolves.toMatchObject({
      accountId: "123456789",
      status: "public_complete",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("honors Retry-After within the bounded retry delay", async () => {
    const fetchImpl = vi
      .fn(async () => jsonResponse(publicProfileFixture))
      .mockResolvedValueOnce(jsonResponse({}, 429, { "retry-after": "30" }))
      .mockResolvedValueOnce(jsonResponse(publicProfileFixture));
    const sleep = vi.fn(async (_delayMs: number) => undefined);
    const provider = new OpenDotaProvider({ fetchImpl, sleep, clock: () => NOW });

    await expect(provider.getPlayerProfile("123456789")).resolves.toMatchObject({
      accountId: "123456789",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(10_000);
  });

  it.each([
    { name: "not found", body: {}, status: 404, reason: "not_found" },
    {
      name: "private profile",
      body: { profile: null },
      status: 200,
      reason: "profile_unavailable",
    },
    { name: "invalid payload", body: { profile: [] }, status: 200, reason: "invalid_response" },
  ])("does not retry a $name response", async ({ body, status, reason }) => {
    const { provider, fetchImpl, sleep } = providerFor(body, status);

    await expect(provider.getPlayerProfile("123456789")).rejects.toMatchObject({
      reason,
      retryable: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("keeps the final retryable failure classification after attempts are exhausted", async () => {
    const fetchImpl = vi
      .fn(async () => jsonResponse({}, 503))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(jsonResponse({}, 503));
    const sleep = vi.fn(async (_delayMs: number) => undefined);
    const provider = new OpenDotaProvider({ fetchImpl, sleep });

    await expect(provider.getPlayerProfile("123456789")).rejects.toMatchObject({
      code: "SOURCE_UNAVAILABLE",
      reason: "upstream_5xx",
      status: 503,
      retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("exposes typed provider errors", () => {
    const error = new OpenDotaProviderError(
      "SOURCE_UNAVAILABLE",
      "network",
      "network failed",
      true,
    );
    expect(error).toBeInstanceOf(Error);
  });
});
