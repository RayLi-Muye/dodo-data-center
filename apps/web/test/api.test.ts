import { dataStatusResponseSchema, mapFeatureTypeSchema } from "@dodo/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, collectAllHeroesWithMeta, DodoApiError, fetchApi, getApiBaseUrl } from "../lib/api";

const validMapResponse = {
  data: {
    id: "map-7.41d-build-123456",
    patch: "7.41d",
    quality: "partial",
    coordinateSystem: "source2-world-units",
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    features: [{
      id: "radiant-top-tier-one",
      type: "tower",
      localizedName: "天辉上路一塔",
      description: "结构化防御塔位置。",
      geometry: { type: "Point", coordinates: [25, 30] },
      sourceRefs: [{
        resourcePath: "game/dota/maps/dota.vmap_c",
        entityClassname: "npc_dota_tower",
        entityTargetName: "radiant_top_tier_one",
        entityIndex: 18,
      }],
    }],
    sourceSnapshot: "https://example.com/maps/7.41d/manifest.json",
    sourceUrls: ["https://www.dota2.com/patches/7.41d"],
    sourceRevision: {
      appId: "570",
      buildId: "123456",
      depotManifestId: "987654",
      resourcePath: "game/dota/maps/dota.vmap_c",
      resourceSha256: "a".repeat(64),
      extractor: "dodo-map-extractor",
      extractorVersion: "1.0.0",
      snapshotSha256: "b".repeat(64),
    },
    coverage: {
      includedTypes: ["tower"],
      exclusions: [
        { type: "lane", reason: "最小 Web 合约测试快照未包含兵线拓扑。" },
        { type: "tormentor", reason: "最小 Web 合约测试快照未包含痛苦魔方。" },
        { type: "twin_gate", reason: "最小 Web 合约测试快照未包含双生之门。" },
        { type: "watcher", reason: "最小 Web 合约测试快照未包含观测者。" },
        { type: "wisdom_rune", reason: "最小 Web 合约测试快照未包含智慧神符。" },
        { type: "outpost", reason: "最小 Web 合约测试快照未包含前哨。" },
        { type: "shop", reason: "最小 Web 合约测试快照未包含商店。" },
        { type: "roshan", reason: "最小 Web 合约测试快照未包含肉山巢穴。" },
        { type: "rune", reason: "最小 Web 合约测试快照未包含其他神符点。" },
        { type: "lotus_pool", reason: "最小 Web 合约测试快照未包含莲花池。" },
        { type: "neutral_camp", reason: "最小 Web 合约测试快照未包含野怪营地。" },
        { type: "landmark", reason: "最小 Web 合约测试快照未包含其他地标。" },
      ],
    },
    verifiedAt: "2026-07-12T00:00:00.000Z",
  },
  meta: {
    quality: "partial",
    sources: ["curated_map"],
    updatedAt: "2026-07-12T00:00:00.000Z",
  },
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("server API client", () => {
  it("uses the documented environment precedence and trims trailing slashes", () => {
    expect(getApiBaseUrl({ API_BASE_URL: "http://api.internal///", NEXT_PUBLIC_API_BASE_URL: "http://public" })).toBe("http://api.internal");
    expect(getApiBaseUrl({ NEXT_PUBLIC_API_BASE_URL: "http://public/" })).toBe("http://public");
    expect(getApiBaseUrl({ API_BASE_URL: "   ", NEXT_PUBLIC_API_BASE_URL: " http://public/ " })).toBe("http://public");
    expect(getApiBaseUrl({})).toBe("http://127.0.0.1:3001");
  });

  it("never silently targets localhost when production has no API URL", () => {
    expect(() => getApiBaseUrl({ NODE_ENV: "production" })).toThrow(
      "API_BASE_URL must be configured for production Web requests.",
    );
    expect(() => getApiBaseUrl({ API_BASE_URL: " ", NODE_ENV: "production" })).toThrow(
      "API_BASE_URL must be configured for production Web requests.",
    );
  });

  it("checks response.ok and preserves a frozen API error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "HISTORY_PRIVATE", message: "private", retryable: false },
    }), { status: 403, headers: { "Content-Type": "application/json" } })));

    await expect(fetchApi(dataStatusResponseSchema, "/v1/data-status")).rejects.toMatchObject({
      status: 403,
      payload: { error: { code: "HISTORY_PRIVATE" } },
    });
  });

  it("validates successful responses against the frozen Zod schema", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    await expect(fetchApi(dataStatusResponseSchema, "/v1/data-status")).rejects.toBeInstanceOf(DodoApiError);
  });

  it("keeps encyclopedia requests on the one-hour Next fetch cache", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { items: [], nextCursor: null },
      meta: {
        quality: "complete",
        sources: ["seed"],
        updatedAt: "2025-01-02T00:00:00.000Z",
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await api.heroes();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/v1\/heroes\?limit=100$/),
      expect.objectContaining({ next: { revalidate: 3_600 } }),
    );
  });

  it("collects every hero catalog page instead of stopping at the first 100 rows", async () => {
    const meta = { quality: "complete", sources: ["seed"], updatedAt: "2026-07-14T00:00:00.000Z" };
    const hero = (id: string) => ({
      attackType: "melee" as const,
      id,
      localizedName: `英雄 ${id}`,
      name: `hero_${id}`,
      officialVersion: "7.41d",
      primaryAttribute: "strength" as const,
      roles: [],
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { items: [hero("1")], nextCursor: "page-2" }, meta }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { items: [hero("2")], nextCursor: null }, meta }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(collectAllHeroesWithMeta()).resolves.toMatchObject({ items: [{ id: "1" }, { id: "2" }], meta });
    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringContaining("cursor=page-2"), expect.anything());
  });

  it("conservatively merges catalog metadata across every page", async () => {
    const pages = [
      { quality: "complete", sources: ["seed"], updatedAt: "2026-07-12T00:00:00.000Z" },
      { quality: "partial", sources: ["dota2_official"], updatedAt: "2026-07-14T00:00:00.000Z" },
      { quality: "stale", sources: ["seed", "opendota"], updatedAt: "2026-07-13T00:00:00.000Z" },
    ] as const;
    let index = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      const meta = pages[index]!;
      index += 1;
      return new Response(JSON.stringify({
        data: { items: [], nextCursor: index < pages.length ? `page-${index + 1}` : null },
        meta,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    await expect(collectAllHeroesWithMeta()).resolves.toEqual({
      items: [],
      meta: {
        quality: "stale",
        sources: ["seed", "dota2_official", "opendota"],
        updatedAt: "2026-07-14T00:00:00.000Z",
      },
    });
  });

  it("rejects a repeated hero catalog cursor", async () => {
    const body = JSON.stringify({
      data: { items: [], nextCursor: "same-cursor" },
      meta: { quality: "complete", sources: ["seed"], updatedAt: "2026-07-14T00:00:00.000Z" },
    });
    const fetchMock = vi.fn().mockImplementation(async () => new Response(body, { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(collectAllHeroesWithMeta()).rejects.toThrow("Catalog pagination returned a repeated cursor.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caps a hero catalog traversal at 50 pages", async () => {
    let page = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      page += 1;
      return new Response(JSON.stringify({
        data: { items: [], nextCursor: `page-${page}` },
        meta: { quality: "complete", sources: ["seed"], updatedAt: "2026-07-14T00:00:00.000Z" },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(collectAllHeroesWithMeta()).rejects.toThrow("Catalog pagination exceeded 50 pages.");
    expect(fetchMock).toHaveBeenCalledTimes(50);
  });

  it("does not cache hero details across live catalog refreshes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        id: "107",
        name: "earth_spirit",
        localizedName: "Earth Spirit",
        primaryAttribute: "strength",
        attackType: "melee",
        roles: [],
        officialVersion: "7.41d",
        facetsStatus: "removed",
        facets: [],
        abilities: [],
        sourceSnapshot: "opendota://constants/heroes@test",
      },
      meta: {
        quality: "complete",
        sources: ["opendota"],
        updatedAt: "2026-07-12T00:00:00.000Z",
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await api.hero("107");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/v1\/heroes\/107$/),
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("does not cache the current map availability response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(validMapResponse), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const map = await api.map();

    expect(map.data.quality).toBe("partial");
    expect(new Set([
      ...map.data.coverage.includedTypes,
      ...map.data.coverage.exclusions.map((exclusion) => exclusion.type),
    ])).toEqual(new Set(mapFeatureTypeSchema.options));

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/v1\/maps\/current$/),
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("rejects a legacy complete map response with no features", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...validMapResponse,
      data: {
        ...validMapResponse.data,
        quality: "complete",
        features: [],
        coverage: { includedTypes: [], exclusions: [] },
      },
      meta: { ...validMapResponse.meta, quality: "complete" },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(api.map()).rejects.toMatchObject({
      kind: "invalid-response",
      message: "数据格式与当前客户端契约不一致",
    });
  });

  it("validates official update lists and details without caching them", async () => {
    const meta = {
      quality: "complete",
      sources: ["dota2_official"],
      updatedAt: "2026-07-12T00:00:00.000Z",
    };
    const summary = {
      changeGroupCount: 2,
      contentStatus: "complete",
      excludedNoteCount: 0,
      releasedAt: "2026-07-11T00:00:00.000Z",
      sourceUrl: "https://www.dota2.com/patches/7.41d",
      version: "7.41d",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { items: [summary], nextCursor: null },
        meta,
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { ...summary, groups: [] },
        meta,
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await api.updates();
    await api.update("7.41d");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/\/v1\/updates\?limit=100$/),
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/\/v1\/updates\/7\.41d$/),
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("requests five recent entity updates without coupling them to detail caching", async () => {
    const response = {
      data: {
        items: [{
          contentStatus: "complete",
          excludedNoteCount: 0,
          groups: [{
            entityId: "107",
            entityName: "Earth Spirit",
            kind: "hero",
            notes: [{ indentLevel: 1, info: null, text: "基础力量增加。" }],
            relatedAbilityId: null,
            subsection: "overview",
            title: null,
          }],
          matchedGroupCount: 1,
          releasedAt: "2026-07-11T00:00:00.000Z",
          sourceUrl: "https://www.dota2.com/patches/7.41d",
          version: "7.41d",
        }],
        nextCursor: null,
      },
      meta: {
        quality: "complete",
        sources: ["dota2_official"],
        updatedAt: "2026-07-12T00:00:00.000Z",
      },
    };
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(response), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await api.heroUpdates("107");
    await api.itemUpdates("1");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/\/v1\/heroes\/107\/updates\?limit=5$/),
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/\/v1\/items\/1\/updates\?limit=5$/),
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("forwards lobby and game-mode filters independently for player matches", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { items: [], nextCursor: null },
      meta: {
        filtersApplied: { gameMode: "23", lobbyType: "7" },
        quality: "complete",
        sources: ["opendota"],
        updatedAt: "2026-07-12T00:00:00.000Z",
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await api.playerMatches("224328273", { gameMode: "23", lobbyType: "7", limit: 30 });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/v1\/players\/224328273\/matches\?.*gameMode=23.*limit=30.*lobbyType=7/),
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});
