import { describe, expect, it, vi } from "vitest";

import patchNotes741c from "../fixtures/patchnotes-7.41c.json";
import patchNotes741d from "../fixtures/patchnotes-7.41d.json";
import patchNotesList from "../fixtures/patchnotes-list.json";
import patchNotesListNewerHotfix from "../fixtures/patchnotes-list-newer-hotfix.json";
import officialHeroData from "../fixtures/official-herodata-1.json";
import officialHeroList from "../fixtures/official-herolist.json";
import officialItemData from "../fixtures/official-itemdata-1.json";
import officialItemDataUnresolved from "../fixtures/official-itemdata-unresolved-4.json";
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

function officialHeroDetailWith(field: string, value?: unknown): unknown {
  const detail = structuredClone(officialHeroData);
  const hero = detail.result.data.heroes[0] as unknown as Record<string, unknown>;
  if (value === undefined) delete hero[field];
  else hero[field] = value;
  return detail;
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

  it("reports a newer unsupported raw index version without adding it to public patch items", async () => {
    const provider = new Dota2OfficialProvider({
      fetchImpl: vi.fn(async () => response(patchNotesListNewerHotfix)),
      clock: () => NOW,
    });

    const result = await provider.getPatchConstants();

    expect(result.officialVersion).toBe("7.41-hotfix");
    expect(result.items).toEqual([
      { id: "7.41c", name: "7.41c", releasedAt: "2026-05-06T07:00:00.000Z" },
      { id: "7.41d", name: "7.41d", releasedAt: "2026-06-04T07:00:00.000Z" },
    ]);
    expect(result.quality).toBe("partial");
    expect(result.exclusions).toContainEqual(expect.objectContaining({
      entityType: "patch",
      entityName: "7.41-hotfix",
      kind: "filtered",
      reason: "unsupported_version_format",
    }));
  });

  it("uses the latest raw official version for hero, ability, and item catalogs", async () => {
    const oneItemList = {
      result: {
        ...officialItemList.result,
        data: { itemabilities: [officialItemList.result.data.itemabilities[0]!] },
      },
    };
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("patchnoteslist")) return response(patchNotesListNewerHotfix);
      if (path.endsWith("herolist")) return response(officialHeroList);
      if (path.endsWith("herodata")) return response(officialHeroData);
      if (path.endsWith("itemlist")) return response(oneItemList);
      if (path.endsWith("itemdata")) return response(officialItemData);
      return response({}, 404);
    });
    const provider = new Dota2OfficialProvider({ fetchImpl, clock: () => NOW });

    const [heroes, abilities, items] = await Promise.all([
      provider.getHeroConstants(),
      provider.getHeroAbilityConstants(),
      provider.getItemConstants(),
    ]);

    expect(heroes.officialVersion).toBe("7.41-hotfix");
    expect(abilities.officialVersion).toBe("7.41-hotfix");
    expect(items.officialVersion).toBe("7.41-hotfix");
    expect(heroes.items[0]?.officialVersion).toBe("7.41-hotfix");
    expect(items.items[0]?.officialVersion).toBe("7.41-hotfix");
  });

  it("validates timestamps for unsupported raw index versions", async () => {
    const invalid = structuredClone(patchNotesListNewerHotfix);
    invalid.patches[1]!.patch_timestamp = 0;
    const provider = new Dota2OfficialProvider({
      fetchImpl: vi.fn(async () => response(invalid)),
    });

    await expect(provider.getPatchConstants()).rejects.toMatchObject({
      reason: "invalid_response",
    });
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
    expect(fetchImpl.mock.calls.every(([input]) =>
      new URL(String(input)).searchParams.get("language") === "schinese"
    )).toBe(true);
    expect(heroes.quality).toBe("partial");
    expect(abilities.quality).toBe("partial");
    expect(heroes.items).toEqual([expect.objectContaining({
      id: "1",
      name: "antimage",
      localizedName: "敌法师",
      primaryAttribute: "agility",
      attackType: "melee",
      roles: ["Carry", "Nuker", "Escape"],
      officialVersion: "7.41d",
      hype: "敌法师会 燃烧敌人的魔法 ，并在战场上快速闪烁。",
      biography: "星隐寺陷落后，最后的侍僧立誓终结世间的魔法。",
      complexity: 1,
      baseStats: {
        maxHealth: 582,
        healthRegen: 3.6,
        maxMana: 219,
        manaRegen: 0.6,
        armor: 6.166667,
        magicResistance: 25,
        damageMin: 54,
        damageMax: 58,
        strength: { base: 21, gain: 1.6 },
        agility: { base: 25, gain: 2.8 },
        intelligence: { base: 12, gain: 1.8 },
        movementSpeed: 315,
        attackRange: 150,
        attackRate: 1.4,
        projectileSpeed: 0,
        turnRate: 0.6,
        sightRangeDay: 1800,
        sightRangeNight: 800,
      },
    })]);
    const antiMage = abilities.heroes.npc_dota_hero_antimage!;
    expect(antiMage.facetsStatus).toBe("removed");
    expect(antiMage.facets).toEqual([]);
    expect(antiMage.excludedAbilityNames).toEqual([
      "generic_hidden",
      "special_bonus_hidden_fixture",
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
        entityId: "1497",
        entityName: "special_bonus_unresolved_fixture",
        reason: expect.stringMatching(/^unresolved_template:/),
      }),
    ]));
    expect(antiMage.abilities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "antimage_blink",
        localizedName: "闪烁",
        description: "主动：闪烁 最远传送 875 / 950 / 1025 / 1100 距离。",
        attributes: [
          { label: "魔法消耗：", value: "50 / 55 / 60 / 65" },
          { label: "冷却时间（秒）：", value: "13 / 11 / 9 / 7" },
          { label: "施法距离：", value: "875 / 950 / 1025 / 1100" },
          { label: "施法前摇（秒）：", value: "0 / 0.1 / 0.2 / 0.3" },
        ],
        type: "basic",
      }),
      expect.objectContaining({
        name: "antimage_persecutor",
        localizedName: "迫害者",
        description: "减速 24%。",
        attributes: [{ label: "减速：", value: "24" }],
        type: "innate",
      }),
      expect.objectContaining({
        name: "special_bonus_hp_regen_3",
        localizedName: "+3 生命恢复",
        attributes: [],
        type: "talent",
      }),
      expect.objectContaining({
        id: "1497",
        name: "special_bonus_unresolved_fixture",
        localizedName: "+20 攻击速度",
        description: "",
        attributes: [],
        type: "talent",
      }),
    ]));
    expect(JSON.stringify(antiMage)).not.toMatch(/<[^>]+>|\{s:|%blink_range%/);
  });

  it.each([
    "hype_loc",
    "bio_loc",
    "complexity",
    "max_health",
    "health_regen",
    "max_mana",
    "mana_regen",
    "armor",
    "magic_resistance",
    "damage_min",
    "damage_max",
    "str_base",
    "str_gain",
    "agi_base",
    "agi_gain",
    "int_base",
    "int_gain",
    "movement_speed",
    "attack_range",
    "attack_rate",
    "projectile_speed",
    "turn_rate",
    "sight_range_day",
    "sight_range_night",
  ])("rejects official hero detail missing %s", async (field) => {
    const provider = new Dota2OfficialProvider({
      fetchImpl: vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith("patchnoteslist")) return response(patchNotesList);
        return response(path.endsWith("herolist") ? officialHeroList : officialHeroDetailWith(field));
      }),
    });

    await expect(provider.getHeroConstants()).rejects.toMatchObject({
      reason: "invalid_response",
    });
  });

  it.each([
    { field: "hype_loc", value: "<br>", label: "empty normalized hype" },
    { field: "bio_loc", value: 42, label: "non-string biography" },
    { field: "complexity", value: 4, label: "out-of-range complexity" },
    { field: "health_regen", value: "3.6", label: "non-number stat" },
    { field: "max_health", value: -1, label: "negative max health" },
    { field: "max_mana", value: -1, label: "negative max mana" },
    { field: "movement_speed", value: -1, label: "negative movement speed" },
    { field: "attack_range", value: -1, label: "negative attack range" },
    { field: "attack_rate", value: -1, label: "negative attack rate" },
    { field: "projectile_speed", value: -1, label: "negative projectile speed" },
    { field: "sight_range_day", value: -1, label: "negative day sight" },
    { field: "sight_range_night", value: -1, label: "negative night sight" },
  ])("rejects official hero detail with $label", async ({ field, value }) => {
    const provider = new Dota2OfficialProvider({
      fetchImpl: vi.fn(async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith("patchnoteslist")) return response(patchNotesList);
        return response(
          path.endsWith("herolist") ? officialHeroList : officialHeroDetailWith(field, value),
        );
      }),
    });

    await expect(provider.getHeroConstants()).rejects.toMatchObject({
      reason: "invalid_response",
    });
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

    expect(fetchImpl.mock.calls.every(([input]) =>
      new URL(String(input)).searchParams.get("language") === "schinese"
    )).toBe(true);
    expect(result.officialVersion).toBe("7.41d");
    expect(result.quality).toBe("partial");
    expect(result.items).toEqual([expect.objectContaining({
      id: "1",
      name: "blink",
      localizedName: "闪烁匕首",
      category: "official_quality_1",
      kind: "item",
      availabilityStatus: "verified_current",
      description: "主动：闪烁 最远传送 1200 距离。",
      componentNames: ["blades_of_attack", "broadsword"],
      attributes: [
        { label: "冷却时间（秒）：", value: "15" },
        { label: "施法距离：", value: "1200" },
        { label: "全属性：", value: "+0 / +10 / -5" },
        { label: "闪避：", value: "+15% / +25%" },
        { label: "减速：", value: "10% / 20%" },
      ],
      officialVersion: "7.41d",
      officialRecipes: [{
        componentIds: ["2", "3"],
        componentNames: ["blades_of_attack", "broadsword"],
      }],
    })]);
    expect(result.exclusions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityId: "1001",
        kind: "filtered",
        reason: "recipe_definition",
      }),
      expect.objectContaining({ entityId: "2", kind: "failed", reason: "upstream_5xx" }),
      expect.objectContaining({ entityId: "3", kind: "failed", reason: "upstream_5xx" }),
      expect.objectContaining({
        entityId: "182",
        kind: "filtered",
        reason: "current_availability_unverified",
      }),
    ]));
  });

  it("keeps an item partial without exposing an unknown official attribute token", async () => {
    const listItem = {
      ...officialItemList.result.data.itemabilities[0]!,
      id: 6,
      name: "item_unknown_token_fixture",
      name_loc: "未知令牌测试物品",
      recipes: [],
    };
    const detail = structuredClone(officialItemData);
    detail.result.data.items[0]!.id = 6;
    detail.result.data.items[0]!.name = "item_unknown_token_fixture";
    detail.result.data.items[0]!.name_loc = "未知令牌测试物品";
    detail.result.data.items[0]!.special_values.push({
      name: "unknown",
      values_float: [42],
      heading_loc: "+$unknown_fixture",
    });
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("patchnoteslist")) return response(patchNotesList);
      if (path.endsWith("itemlist")) {
        return response({ result: { status: 1, data: { itemabilities: [listItem] } } });
      }
      if (path.endsWith("itemdata")) return response(detail);
      return response({}, 404);
    });
    const result = await new Dota2OfficialProvider({ fetchImpl, clock: () => NOW })
      .getItemConstants();

    expect(result.quality).toBe("partial");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.description).toBe("主动：闪烁 最远传送 1200 距离。");
    expect(JSON.stringify(result)).not.toContain("$unknown_fixture");
    expect(result.exclusions).toContainEqual(expect.objectContaining({
      entityType: "item",
      entityId: "6",
      kind: "filtered",
      reason: "unresolved_template:unknown_attribute_heading",
    }));
  });

  it("keeps only official current item classifications as verified current", async () => {
    const listItems = [
      { id: 1, name: "item_blink", name_loc: "Blink Dagger", neutral_item_tier: -1 },
      { id: 2, name: "item_recipe_fixture", name_loc: "Recipe Fixture", neutral_item_tier: -1 },
      { id: 3, name: "item_dandelion_amulet", name_loc: "Dandelion Amulet", neutral_item_tier: 2 },
      { id: 1592, name: "item_enhancement_timeless", name_loc: "Timeless", neutral_item_tier: -1 },
    ].map((item) => ({
      ...item,
      is_pregame_suggested: false,
      is_earlygame_suggested: false,
      is_lategame_suggested: item.id === 1,
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
      { id: "1", kind: "item", availabilityStatus: "verified_current" },
      { id: "3", kind: "neutral_item", availabilityStatus: "verified_current" },
      { id: "1592", kind: "neutral_enhancement", availabilityStatus: "verified_current" },
    ]);
    expect(result.exclusions).toContainEqual(expect.objectContaining({
      entityId: "2",
      reason: "recipe_definition",
    }));
  });

  it("uses the official active recipe graph and audited standalone shop allowlist", async () => {
    const listItems = officialItemList.result.data.itemabilities;
    const requestedDetailIds: number[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("patchnoteslist")) return response(patchNotesList);
      if (url.pathname.endsWith("itemlist")) return response(officialItemList);
      if (url.pathname.endsWith("itemdata")) {
        const id = Number(url.searchParams.get("item_id"));
        requestedDetailIds.push(id);
        const listItem = listItems.find((item) => item.id === id)!;
        const detail = structuredClone(officialItemData);
        detail.result.data.items[0]!.id = id;
        detail.result.data.items[0]!.name = listItem.name;
        detail.result.data.items[0]!.name_loc = listItem.name_loc;
        return response(detail);
      }
      return response({}, 404);
    });
    const result = await new Dota2OfficialProvider({ fetchImpl, clock: () => NOW })
      .getItemConstants();

    expect(result.items.map(({ id, kind, availabilityStatus }) => ({
      id,
      kind,
      availabilityStatus,
    }))).toEqual([
      { id: "1", kind: "item", availabilityStatus: "verified_current" },
      { id: "2", kind: "item", availabilityStatus: "verified_current" },
      { id: "3", kind: "item", availabilityStatus: "verified_current" },
      { id: "10", kind: "item", availabilityStatus: "verified_current" },
      { id: "30", kind: "item", availabilityStatus: "verified_current" },
      { id: "40", kind: "item", availabilityStatus: "verified_current" },
      { id: "42", kind: "item", availabilityStatus: "verified_current" },
      { id: "46", kind: "item", availabilityStatus: "verified_current" },
      { id: "104", kind: "item", availabilityStatus: "verified_current" },
      { id: "133", kind: "item", availabilityStatus: "verified_current" },
      { id: "204", kind: "item", availabilityStatus: "verified_current" },
      { id: "1125", kind: "item", availabilityStatus: "verified_current" },
      { id: "1500", kind: "neutral_item", availabilityStatus: "verified_current" },
      { id: "1592", kind: "neutral_enhancement", availabilityStatus: "verified_current" },
    ]);
    expect(requestedDetailIds.sort((left, right) => left - right)).toEqual([
      1, 2, 3, 10, 30, 40, 42, 46, 104, 133, 204, 1125, 1500, 1592,
    ]);
    expect(result.quality).toBe("partial");
    expect(result.exclusions).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityId: "1001", reason: "recipe_definition" }),
      expect.objectContaining({ entityId: "200", reason: "recipe_definition" }),
      expect.objectContaining({ entityId: "182", reason: "current_availability_unverified" }),
      expect.objectContaining({ entityId: "212", reason: "current_availability_unverified" }),
      expect.objectContaining({ entityId: "239", reason: "current_availability_unverified" }),
      expect.objectContaining({ entityId: "369", reason: "current_availability_unverified" }),
      expect.objectContaining({ entityId: "117", reason: "current_availability_unverified" }),
      expect.objectContaining({ entityId: "1999", reason: "internal_definition" }),
    ]));
    expect(result.exclusions.map((exclusion) => exclusion.reason).join(","))
      .not.toMatch(/\$|\{s:|<[^>]*>/);
  });

  it("keeps a localized official item when only its description template is unresolved", async () => {
    const listItems = [
      { id: 4, name: "item_claymore", name_loc: "大剑" },
      { id: 5, name: "item_removed_internal", name_loc: "" },
    ].map((item) => ({
      ...item,
      neutral_item_tier: -1,
      is_pregame_suggested: false,
      is_earlygame_suggested: item.id === 4,
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
      if (url.pathname.endsWith("itemdata") && url.searchParams.get("item_id") === "4") {
        return response(officialItemDataUnresolved);
      }
      return response({}, 404);
    });
    const provider = new Dota2OfficialProvider({ fetchImpl, clock: () => NOW });

    const result = await provider.getItemConstants();

    expect(result.quality).toBe("partial");
    expect(result.items).toEqual([expect.objectContaining({
      id: "4",
      name: "claymore",
      localizedName: "大剑",
      description: "",
      cost: 1350,
    })]);
    expect(result.exclusions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityType: "item",
        entityId: "4",
        entityName: "item_claymore",
        kind: "filtered",
        reason: "unresolved_template:{s:missing_damage}",
      }),
      expect.objectContaining({
        entityType: "item",
        entityId: "5",
        kind: "filtered",
        reason: "localized_name_unavailable",
      }),
    ]));
    expect(JSON.stringify(result.items)).not.toContain("{s:missing_damage}");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
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
    expect(fetchImpl.mock.calls.every(([input]) =>
      new URL(String(input)).searchParams.get("language") === "schinese"
    )).toBe(true);
    expect(latest.sourceUrl).toBe("https://www.dota2.com/patches/7.41d?l=schinese");
    expect(new Set(latest.groups.map((group) => group.kind))).toEqual(new Set([
      "general", "hero", "item", "neutral_item", "neutral_creep",
    ]));
    expect(latest.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "item", entityId: "104" }),
      expect.objectContaining({ kind: "hero", subsection: "talent", entityId: "107" }),
      expect.objectContaining({
        kind: "hero",
        subsection: "ability",
        entityId: "107",
        relatedAbilityId: "5608",
      }),
      expect.objectContaining({ kind: "neutral_item", entityId: null, title: "宝物" }),
      expect.objectContaining({
        kind: "neutral_item",
        entityId: "301",
        title: "中立物品测试",
      }),
      expect.objectContaining({
        kind: "neutral_creep",
        entityId: "12",
        entityName: "狗头人",
        title: "npc_dota_neutral_kobold",
      }),
    ]));
    expect(latest.groups.every((group) => group.notes.length > 0)).toBe(true);
    expect(latest.groups.find((group) => group.title === "宝物")?.notes[0]?.text)
      .toBe("宝物");
  });

  it("strips HTML, decodes entities, and marks empty excluded notes partial", async () => {
    const result = await providerFor().provider.getRecentUpdateReleases(1);
    const latest = result.items[0]!;
    const general = latest.groups.find((group) => group.kind === "general")!;

    expect(general.title).toBe("机制与系统");
    expect(general.notes[0]).toEqual({
      text: "护甲机制 已调整 并完成平衡 & 测试",
      info: "官方说明",
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
