import { describe, expect, it, vi } from "vitest";

import patchNotes741c from "../fixtures/patchnotes-7.41c.json";
import patchNotes741d from "../fixtures/patchnotes-7.41d.json";
import patchNotesList from "../fixtures/patchnotes-list.json";
import officialHeroData from "../fixtures/official-herodata-1.json";
import officialHeroList from "../fixtures/official-herolist.json";
import officialItemData from "../fixtures/official-itemdata-1.json";
import officialItemList from "../fixtures/official-itemlist.json";
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
  it("uses official versions, including letter patches, as patch IDs", async () => {
    const provider = new Dota2OfficialProvider({
      fetchImpl: vi.fn(async () => response(patchNotesList)),
      clock: () => NOW,
    });

    const result = await provider.getPatchConstants();

    expect(result.officialVersion).toBe("7.41d");
    expect(result.items.slice(-2)).toEqual([
      { id: "7.41c", name: "7.41c", releasedAt: "2026-05-06T07:00:00.000Z" },
      { id: "7.41d", name: "7.41d", releasedAt: "2026-06-04T07:00:00.000Z" },
    ]);
    expect(result.quality).toBe("partial");
    expect(result.exclusions).toContainEqual(expect.objectContaining({
      entityType: "patch",
      entityName: "7.41-hotfix",
      kind: "filtered",
    }));
  });

  it("normalizes official heroes and abilities once for concurrent catalog consumers", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("patchnoteslist")) return response(patchNotesList);
      if (path.endsWith("herolist")) return response(officialHeroList);
      if (path.endsWith("herodata")) return response(officialHeroData);
      return response({}, 404);
    });
    const provider = new Dota2OfficialProvider({ fetchImpl, clock: () => NOW });

    const [heroes, abilities] = await Promise.all([
      provider.getHeroConstants(),
      provider.getHeroAbilityConstants(),
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(heroes.quality).toBe("partial");
    expect(abilities.quality).toBe("partial");
    expect(heroes.items).toEqual([expect.objectContaining({
      id: "1",
      name: "antimage",
      localizedName: "Anti-Mage",
      primaryAttribute: "agility",
      attackType: "melee",
      roles: ["Carry", "Nuker", "Escape"],
      officialVersion: "7.41d",
    })]);
    const antiMage = abilities.heroes.npc_dota_hero_antimage!;
    expect(antiMage.facetsStatus).toBe("removed");
    expect(antiMage.facets).toEqual([]);
    expect(antiMage.excludedAbilityNames).toEqual([
      "generic_hidden",
      "special_bonus_hidden_fixture",
      "special_bonus_unresolved_fixture",
    ]);
    expect(abilities.exclusions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityType: "ability",
        entityId: null,
        entityName: "generic_hidden",
        reason: "hidden_or_deprecated",
      }),
      expect.objectContaining({
        entityType: "ability",
        entityName: "special_bonus_hidden_fixture",
        reason: "localized_name_unavailable",
      }),
      expect.objectContaining({
        entityType: "ability",
        entityName: "special_bonus_unresolved_fixture",
        reason: expect.stringMatching(/^unresolved_template:/),
      }),
    ]));
    expect(antiMage.abilities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "antimage_blink",
        description: "Active: Blink Teleport up to 875 / 950 / 1025 / 1100 units.",
        type: "basic",
      }),
      expect.objectContaining({
        name: "antimage_persecutor",
        description: "Slows by 24%.",
        type: "innate",
      }),
      expect.objectContaining({
        name: "special_bonus_hp_regen_3",
        localizedName: "+3 Health Regen",
        type: "talent",
      }),
    ]));
    expect(JSON.stringify(antiMage)).not.toMatch(/<[^>]+>|\{s:|%blink_range%/);
  });

  it.each([
    { label: "non-success", status: 8 },
    { label: "string success", status: "1" },
    { label: "null", status: null },
  ])("rejects $label optional status values on list and detail envelopes", async ({ status }) => {
    const heroListWithStatus = {
      result: { ...officialHeroList.result, status },
    };
    const heroDetailWithStatus = {
      result: { ...officialHeroData.result, status },
    };
    const itemDetailWithStatus = {
      result: { ...officialItemData.result, status },
    };
    const oneItemList = {
      result: {
        ...officialItemList.result,
        data: { itemabilities: [officialItemList.result.data.itemabilities[0]!] },
      },
    };
    const providerForHeroList = new Dota2OfficialProvider({
      fetchImpl: vi.fn(async (input: string | URL | Request) =>
        new URL(String(input)).pathname.endsWith("patchnoteslist")
          ? response(patchNotesList)
          : response(heroListWithStatus)
      ),
    });
    const providerForHeroDetail = new Dota2OfficialProvider({
      fetchImpl: vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith("patchnoteslist")) return response(patchNotesList);
        return response(path.endsWith("herolist") ? officialHeroList : heroDetailWithStatus);
      }),
    });
    const providerForItemDetail = new Dota2OfficialProvider({
      fetchImpl: vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith("patchnoteslist")) return response(patchNotesList);
        return response(path.endsWith("itemlist") ? oneItemList : itemDetailWithStatus);
      }),
    });

    await expect(providerForHeroList.getHeroConstants()).rejects.toMatchObject({
      reason: "invalid_response",
    });
    await expect(providerForHeroDetail.getHeroConstants()).rejects.toMatchObject({
      reason: "invalid_response",
    });
    await expect(providerForItemDetail.getItemConstants()).rejects.toMatchObject({
      reason: "invalid_response",
    });
  });

  it("keeps official item classification and recipe evidence and reports partial detail failures", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("patchnoteslist")) return response(patchNotesList);
      if (url.pathname.endsWith("itemlist")) return response(officialItemList);
      if (url.pathname.endsWith("itemdata") && url.searchParams.get("item_id") === "1") {
        return response(officialItemData);
      }
      if (url.pathname.endsWith("itemdata")) return response({}, 503);
      return response({}, 404);
    });
    const provider = new Dota2OfficialProvider({ fetchImpl, clock: () => NOW });

    const result = await provider.getItemConstants();

    expect(result.officialVersion).toBe("7.41d");
    expect(result.quality).toBe("partial");
    expect(result.items).toEqual([expect.objectContaining({
      id: "1",
      name: "blink",
      localizedName: "Blink Dagger",
      category: "official_quality_1",
      kind: "item",
      availabilityStatus: "unverified",
      description: "Active: Blink Teleport up to 1200 units.",
      componentNames: ["blades_of_attack", "broadsword"],
      officialVersion: "7.41d",
      officialRecipes: [{
        componentIds: ["2", "3"],
        componentNames: ["blades_of_attack", "broadsword"],
      }],
    })]);
    expect(result.exclusions).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityId: "1001", kind: "filtered" }),
      expect.objectContaining({ entityId: "182", kind: "failed", reason: "upstream_5xx" }),
    ]));
  });

  it("classifies official item definitions without claiming current availability", async () => {
    const listItems = [
      { id: 1, name: "item_blink", name_loc: "Blink Dagger", neutral_item_tier: -1 },
      { id: 2, name: "item_recipe_fixture", name_loc: "Recipe Fixture", neutral_item_tier: -1 },
      { id: 3, name: "item_dandelion_amulet", name_loc: "Dandelion Amulet", neutral_item_tier: 2 },
      { id: 1592, name: "item_enhancement_timeless", name_loc: "Timeless", neutral_item_tier: -1 },
    ].map((item) => ({
      ...item,
      is_pregame_suggested: false,
      is_earlygame_suggested: false,
      is_lategame_suggested: false,
      recipes: [],
      is_innate: false,
    }));
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("patchnoteslist")) return response(patchNotesList);
      if (url.pathname.endsWith("itemlist")) {
        return response({ result: { status: 1, data: { itemabilities: listItems } } });
      }
      const id = Number(url.searchParams.get("item_id"));
      const listItem = listItems.find((item) => item.id === id)!;
      const detail = structuredClone(officialItemData);
      detail.result.data.items[0]!.id = id;
      detail.result.data.items[0]!.name = listItem.name;
      detail.result.data.items[0]!.name_loc = listItem.name_loc;
      return response(detail);
    });
    const provider = new Dota2OfficialProvider({ fetchImpl, clock: () => NOW });

    const result = await provider.getItemConstants();

    expect(result.items.map(({ id, kind, availabilityStatus }) => ({
      id,
      kind,
      availabilityStatus,
    }))).toEqual([
      { id: "1", kind: "item", availabilityStatus: "unverified" },
      { id: "2", kind: "recipe", availabilityStatus: "unverified" },
      { id: "3", kind: "neutral_item", availabilityStatus: "unverified" },
      { id: "1592", kind: "neutral_enhancement", availabilityStatus: "unverified" },
    ]);
  });

  it("bounds hero detail requests at three", async () => {
    const ids = [1, 2, 3, 4, 5];
    let activeDetails = 0;
    let maxActiveDetails = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("patchnoteslist")) return response(patchNotesList);
      if (url.pathname.endsWith("herolist")) {
        return response({
          result: {
            status: 1,
            data: { heroes: ids.map((id) => ({ id, name: `npc_dota_hero_fixture_${id}` })) },
          },
        });
      }
      const id = Number(url.searchParams.get("hero_id"));
      activeDetails += 1;
      maxActiveDetails = Math.max(maxActiveDetails, activeDetails);
      await new Promise((resolve) => setTimeout(resolve, 2));
      activeDetails -= 1;
      const hero = structuredClone(officialHeroData);
      hero.result.data.heroes[0]!.id = id;
      hero.result.data.heroes[0]!.name = `npc_dota_hero_fixture_${id}`;
      return response(hero);
    });
    const provider = new Dota2OfficialProvider({ fetchImpl });

    const result = await provider.getHeroConstants();

    expect(result.items).toHaveLength(5);
    expect(maxActiveDetails).toBe(3);
  });

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

  it.each([
    {
      label: "unavailable",
      status: 503,
      reason: "upstream_5xx",
      code: "DOTA2_OFFICIAL_UNAVAILABLE",
    },
    {
      label: "rate limited",
      status: 429,
      reason: "rate_limited",
      code: "DOTA2_OFFICIAL_RATE_LIMITED",
    },
  ])("throws a typed $label error when every patch detail fails", async ({ status, reason, code }) => {
    const { provider } = providerFor({
      "7.41c": { status },
      "7.41d": { status },
    });

    await expect(provider.getRecentUpdateReleases(2)).rejects.toMatchObject({
      code,
      reason,
      retryable: true,
      status,
    });
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
