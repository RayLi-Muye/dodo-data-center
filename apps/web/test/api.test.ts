import { dataStatusResponseSchema } from "@dodo/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, DodoApiError, fetchApi, getApiBaseUrl } from "../lib/api";

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

  it("does not cache hero details across live catalog refreshes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        id: "107",
        name: "earth_spirit",
        localizedName: "Earth Spirit",
        primaryAttribute: "strength",
        attackType: "melee",
        roles: [],
        patch: "unknown",
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
});
