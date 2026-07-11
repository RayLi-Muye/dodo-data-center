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
    expect(getApiBaseUrl({})).toBe("http://127.0.0.1:3001");
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
});
