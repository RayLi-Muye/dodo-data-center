import type { ItemDetail, ItemSummary } from "@dodo/contracts";
import { describe, expect, it } from "vitest";

import { buildItemCatalogEntries, filterItemCatalogEntries, findItemCatalogEntry, levelAttributeValues } from "../lib/item-catalog";

function item(id: string, name: string, localizedName: string): ItemSummary {
  return { availabilityStatus: "verified_current", category: "official_quality_4", cost: 1, id, kind: "item", localizedName, name, officialVersion: "7.41d" };
}

function detail(summary: ItemSummary, value: string): ItemDetail {
  return { ...summary, attributes: [{ label: "伤害", value }], components: [], description: "", sourceSnapshot: "fixture" };
}

describe("item catalog upgrade families", () => {
  it("folds a continuous, same-name Dagon chain without deleting its entities", () => {
    const dagons = [
      item("1", "dagon", "达贡之神力"),
      item("2", "dagon_2", "达贡之神力"),
      item("3", "dagon_3", "达贡之神力"),
      item("4", "dagon_4", "达贡之神力"),
      item("5", "dagon_5", "达贡之神力"),
    ];
    const entries = buildItemCatalogEntries(dagons);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.members.map(({ item: member, level }) => [member.id, level])).toEqual([
      ["1", 1], ["2", 2], ["3", 3], ["4", 4], ["5", 5],
    ]);
    expect(findItemCatalogEntry(entries, "4")?.id).toBe("1");
  });

  it("folds the two-level Boots of Travel chain", () => {
    const entries = buildItemCatalogEntries([
      item("48", "travel_boots", "远行鞋"),
      item("220", "travel_boots_2", "远行鞋"),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.members.map(({ level }) => level)).toEqual([1, 2]);
  });

  it("reports 263 visible entries for the production-shaped 268 entity inventory", () => {
    const dagons = Array.from({ length: 5 }, (_, index) => item(String(104 + index), index === 0 ? "dagon" : `dagon_${index + 1}`, "达贡之神力"));
    const travelBoots = [item("48", "travel_boots", "远行鞋"), item("220", "travel_boots_2", "远行鞋")];
    const fixedItems = Array.from({ length: 261 }, (_, index) => item(`fixed-${index}`, `current_fixed_item_${index}`, `固定物品 ${index}`));
    const entities = [...dagons, ...travelBoots, ...fixedItems];

    expect(entities).toHaveLength(268);
    expect(buildItemCatalogEntries(entities)).toHaveLength(263);
  });

  it("does not fold missing levels, different localized names, recipes, or fixed BKB text", () => {
    const entries = buildItemCatalogEntries([
      item("1", "dagon", "达贡之神力"),
      item("2", "dagon_2", "达贡之神力"),
      item("4", "dagon_4", "达贡之神力"),
      item("bkb", "black_king_bar", "黑皇杖"),
      { ...item("r", "recipe_dagon", "达贡之神力图纸"), kind: "recipe" },
    ]);

    expect(entries.map((entry) => entry.item.name)).toEqual(["dagon", "dagon_2", "dagon_4", "black_king_bar"]);
    expect(entries.find((entry) => entry.id === "bkb")?.members).toHaveLength(1);
  });

  it("only tokenizes slash values when a recognized multi-level family supplies the level count", () => {
    const base = item("1", "dagon", "达贡之神力");
    const levels = Array.from({ length: 5 }, (_, index) => detail({ ...base, id: String(index + 1) }, "400 / 500 / 600 / 700 / 800"));
    expect(levelAttributeValues(levels, 0)).toEqual(["400", "500", "600", "700", "800"]);
    expect(levelAttributeValues([detail(item("bkb", "black_king_bar", "黑皇杖"), "9 / 8 / 7")], 0)).toBeNull();
  });

  it("keeps repeated Dagon attribute labels aligned by occurrence", () => {
    const base = item("1", "dagon", "达贡之神力");
    const levels = Array.from({ length: 5 }, (_, index): ItemDetail => ({
      ...base,
      id: String(index + 1),
      attributes: [
        { label: "施法距离：", value: "640" },
        { label: "施法距离：", value: "+60 / +90 / +120 / +150 / +180" },
      ],
      components: [],
      description: "",
      sourceSnapshot: "fixture",
    }));

    expect(levelAttributeValues(levels, 0)).toBeNull();
    expect(levelAttributeValues(levels, 1)).toEqual(["+60", "+90", "+120", "+150", "+180"]);
  });

  it("filters after folding so a level-specific search keeps the complete upgrade family", () => {
    const entries = buildItemCatalogEntries([
      item("1", "dagon", "达贡之神力"),
      item("2", "dagon_2", "达贡之神力"),
      item("3", "dagon_3", "达贡之神力"),
      item("4", "dagon_4", "达贡之神力"),
      item("5", "dagon_5", "达贡之神力"),
      item("bkb", "black_king_bar", "黑皇杖"),
    ]);

    const filtered = filterItemCatalogEntries(entries, "DAGON_4");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.members.map(({ level }) => level)).toEqual([1, 2, 3, 4, 5]);
  });
});
