import type { SyncJob } from "@dodo/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "../app/api/players/[accountId]/sync/route";

const context = { params: Promise.resolve({ accountId: "123456789" }) };

const jobResponse = (): Response => new Response(JSON.stringify({
  data: {
    accountId: "123456789",
    completedAt: null,
    errorCode: null,
    jobId: "job-123456789",
    requestedAt: "2026-07-13T08:00:00.000Z",
    status: "syncing" satisfies SyncJob["status"],
  },
  meta: {
    quality: "partial",
    sources: ["opendota"],
    updatedAt: "2026-07-13T08:00:00.000Z",
  },
}), { status: 202, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("player sync BFF", () => {
  it("forwards only the canonical trigger without leaking extra body fields", async () => {
    vi.stubEnv("API_BASE_URL", "https://api.example.test");
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jobResponse());
    vi.stubGlobal("fetch", fetcher);

    const response = await POST(new Request("http://web.test/api/players/123456789/sync", {
      body: JSON.stringify({ trigger: "automatic", upstreamToken: "must-not-leak" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }), context);

    expect(response.status).toBe(202);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.example.test/v1/players/123456789/sync");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      body: JSON.stringify({ trigger: "automatic" }),
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      method: "POST",
    });
  });

  it("keeps an omitted request body backward compatible as manual", async () => {
    vi.stubEnv("API_BASE_URL", "https://api.example.test");
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jobResponse());
    vi.stubGlobal("fetch", fetcher);

    const response = await POST(
      new Request("http://web.test/api/players/123456789/sync", { method: "POST" }),
      context,
    );
    const missingTriggerResponse = await POST(
      new Request("http://web.test/api/players/123456789/sync", {
        body: "{}",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
      context,
    );

    expect(response.status).toBe(202);
    expect(missingTriggerResponse.status).toBe(202);
    expect(fetcher.mock.calls.map(([, init]) => init?.body)).toEqual([
      JSON.stringify({ trigger: "manual" }),
      JSON.stringify({ trigger: "manual" }),
    ]);
  });

  it.each([
    ["malformed JSON", "{"],
    ["invalid trigger", JSON.stringify({ trigger: "scheduled" })],
  ])("returns 400 for %s", async (_label, body) => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jobResponse());
    vi.stubGlobal("fetch", fetcher);

    const response = await POST(new Request("http://web.test/api/players/123456789/sync", {
      body,
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }), context);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
