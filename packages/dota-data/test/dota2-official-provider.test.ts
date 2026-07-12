import { describe, expect, it, vi } from "vitest";

import patchNotes741c from "../fixtures/patchnotes-7.41c.json";
import patchNotes741d from "../fixtures/patchnotes-7.41d.json";
import patchNotesList from "../fixtures/patchnotes-list.json";
import { Dota2OfficialProviderError } from "../src/dota2-official-errors.js";
import { Dota2OfficialProvider, officialNoteText } from "../src/dota2-official-provider.js";

const NOW = new Date("2026-07-12T00:00:00.000Z");

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function providerFor(
  detailOverrides: Record<string, { body?: unknown; status?: number }> = {},
) {
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("patchnoteslist")) return response(patchNotesList);
    const version = url.searchParams.get("version") ?? "";
    const override = detailOverrides[version];
    if (override) return response(override.body ?? {}, override.status ?? 200);
    return response(version === "7.41d" ? patchNotes741d : patchNotes741c);
  });
  return {
    provider: new Dota2OfficialProvider({
      baseUrl: "https://dota2.fixture/",
      fetchImpl,
      clock: () => NOW,
    }),
    fetchImpl,
  };
}

describe("Dota2OfficialProvider", () => {
  it("normalizes the five section kinds and hero ability and talent groups", async () => {
    const { provider, fetchImpl } = providerFor();
    const result = await provider.getRecentUpdateReleases(2);
    const latest = result.items[0]!;

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.items.map((item) => item.version)).toEqual(["7.41d", "7.41c"]);
    expect(result.excludedVersions).toContain("7.41-hotfix");
    expect(result.source).toEqual({ source: "dota2_official", fetchedAt: NOW.toISOString() });
    expect(latest.sourceUrl).toBe("https://www.dota2.com/patches/7.41d?l=english");
    expect(new Set(latest.groups.map((group) => group.kind))).toEqual(new Set([
      "general", "hero", "item", "neutral_item", "neutral_creep",
    ]));
    expect(latest.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "hero", subsection: "talent", entityId: "107" }),
      expect.objectContaining({
        kind: "hero",
        subsection: "ability",
        entityId: "107",
        relatedAbilityId: "5608",
      }),
      expect.objectContaining({ kind: "neutral_item", entityId: null, title: "Artifacts" }),
      expect.objectContaining({
        kind: "neutral_creep",
        entityId: "12",
        entityName: "Kobold",
        title: "npc_dota_neutral_kobold",
      }),
    ]));
    expect(latest.groups.every((group) => group.notes.length > 0)).toBe(true);
    expect(latest.groups.find((group) => group.title === "Artifacts")?.notes[0]?.text)
      .toBe("Artifacts");
  });

  it("strips HTML, decodes entities, and marks empty excluded notes partial", async () => {
    const result = await providerFor().provider.getRecentUpdateReleases(1);
    const latest = result.items[0]!;
    const general = latest.groups.find((group) => group.kind === "general")!;

    expect(general.title).toBe("Mechanics & Systems");
    expect(general.notes[0]).toEqual({
      text: "Armor changed and tuned & tested",
      info: "Official detail",
      indentLevel: 1,
    });
    expect(latest.excludedNoteCount).toBe(1);
    expect(latest.contentStatus).toBe("partial");
    expect(JSON.stringify(latest)).not.toMatch(/<\/?[a-z][^>]*>/i);
    expect(officialNoteText("&lt;script&gt;bad&lt;/script&gt; safe&nbsp;text")).toBe("bad safe text");
  });

  it("excludes a failed detail without discarding successful versions", async () => {
    const result = await providerFor({ "7.41c": { status: 503 } })
      .provider.getRecentUpdateReleases(2);

    expect(result.items.map((item) => item.version)).toEqual(["7.41d"]);
    expect(result.excludedVersions).toEqual(expect.arrayContaining(["7.41-hotfix", "7.41c"]));
  });

  it("bounds concurrent detail requests at three", async () => {
    const versions = ["7.41d", "7.41c", "7.41b", "7.41a", "7.41"];
    let activeDetails = 0;
    let maxActiveDetails = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("patchnoteslist")) {
        return response({
          success: true,
          patches: versions.map((version, index) => ({
            patch_number: version,
            patch_timestamp: 1780556400 - index,
          })),
        });
      }
      const version = url.searchParams.get("version")!;
      activeDetails += 1;
      maxActiveDetails = Math.max(maxActiveDetails, activeDetails);
      await new Promise((resolve) => setTimeout(resolve, 2));
      activeDetails -= 1;
      return response({
        ...patchNotes741c,
        patch_number: version,
      });
    });
    const provider = new Dota2OfficialProvider({ fetchImpl });

    const result = await provider.getRecentUpdateReleases(5);

    expect(result.items).toHaveLength(5);
    expect(maxActiveDetails).toBe(3);
  });

  it.each([
    { name: "429", status: 429, reason: "rate_limited" },
    { name: "5xx", status: 503, reason: "upstream_5xx" },
  ])("classifies list $name responses", async ({ status, reason }) => {
    const provider = new Dota2OfficialProvider({
      fetchImpl: vi.fn(async () => response({}, status)),
    });
    await expect(provider.getRecentUpdateReleases(1)).rejects.toMatchObject({
      code: status === 429 ? "DOTA2_OFFICIAL_RATE_LIMITED" : "DOTA2_OFFICIAL_UNAVAILABLE",
      reason,
      status,
    });
  });

  it.each([
    { body: {}, label: "missing patches" },
    { body: { success: true, patches: [] }, label: "empty patches" },
    { body: { success: true, patches: "invalid" }, label: "malformed patches" },
  ])("classifies $label as an invalid response", async ({ body }) => {
    const provider = new Dota2OfficialProvider({ fetchImpl: vi.fn(async () => response(body)) });
    await expect(provider.getRecentUpdateReleases(1)).rejects.toMatchObject({
      reason: "invalid_response",
      retryable: true,
    });
  });

  it("classifies timeouts with a source-specific error", async () => {
    const fetchImpl = vi.fn((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
    );
    const provider = new Dota2OfficialProvider({ fetchImpl, timeoutMs: 5 });
    const error = await provider.getRecentUpdateReleases(1).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Dota2OfficialProviderError);
    expect(error).toMatchObject({ reason: "timeout", retryable: true });
  });
});
