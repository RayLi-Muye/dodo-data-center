import type { ItemDetail, ItemSummary } from "@dodo/contracts";

export type ItemCatalogEntry = {
  id: string;
  item: ItemSummary;
  members: Array<{ item: ItemSummary; level: number }>;
};

export type ItemCatalogGroup = {
  entries: ItemCatalogEntry[];
  key: string;
  label: string;
};

export type ItemCatalogZone = {
  groups: ItemCatalogGroup[];
  key: "basic" | "crafted" | "neutral";
  label: string;
};

const categoryDefinitions: Record<string, { groupLabel: string; rank: number; zone: ItemCatalogZone["key"] }> = {
  official_quality_0: { groupLabel: "消耗用品", rank: 10, zone: "basic" },
  official_quality_1: { groupLabel: "基础组件", rank: 11, zone: "basic" },
  official_quality_6: { groupLabel: "神秘商店", rank: 12, zone: "basic" },
  official_quality_2: { groupLabel: "常规装备", rank: 20, zone: "crafted" },
  official_quality_3: { groupLabel: "进阶装备", rank: 21, zone: "crafted" },
  official_quality_4: { groupLabel: "高阶装备", rank: 22, zone: "crafted" },
  official_quality_5: { groupLabel: "特殊装备", rank: 23, zone: "crafted" },
};

const zoneOrder: ItemCatalogZone["key"][] = ["basic", "crafted", "neutral"];
const zoneLabels: Record<ItemCatalogZone["key"], string> = {
  basic: "基础分类",
  crafted: "合成分类",
  neutral: "中立物品",
};

export function buildItemCatalogEntries(items: ItemSummary[]): ItemCatalogEntry[] {
  const currentItems = items.filter((item) => item.kind !== "recipe");
  const itemByName = new Map(currentItems.map((item) => [item.name, item]));
  const suffixesByBase = new Map<string, Map<number, ItemSummary>>();

  for (const item of currentItems) {
    const match = /^(.*)_(\d+)$/.exec(item.name);
    const level = match ? Number(match[2]) : 0;
    if (!match || level < 2 || !Number.isSafeInteger(level)) continue;
    const levels = suffixesByBase.get(match[1]!) ?? new Map<number, ItemSummary>();
    levels.set(level, item);
    suffixesByBase.set(match[1]!, levels);
  }

  const familyByItemId = new Map<string, ItemCatalogEntry>();
  for (const [baseName, suffixes] of suffixesByBase) {
    const base = itemByName.get(baseName);
    const maxLevel = Math.max(...suffixes.keys());
    if (!base || maxLevel < 2) continue;
    const members = [{ item: base, level: 1 }];
    let valid = true;
    for (let level = 2; level <= maxLevel; level += 1) {
      const member = suffixes.get(level);
      if (!member || member.localizedName !== base.localizedName) {
        valid = false;
        break;
      }
      members.push({ item: member, level });
    }
    if (!valid || members.length !== suffixes.size + 1) continue;
    const family = { id: base.id, item: base, members };
    for (const member of members) familyByItemId.set(member.item.id, family);
  }

  const entries: ItemCatalogEntry[] = [];
  const emitted = new Set<string>();
  for (const item of currentItems) {
    const family = familyByItemId.get(item.id);
    const entry = family ?? { id: item.id, item, members: [{ item, level: 1 }] };
    if (emitted.has(entry.id)) continue;
    emitted.add(entry.id);
    entries.push(entry);
  }
  return entries;
}

export function groupItemCatalogEntries(entries: ItemCatalogEntry[]): ItemCatalogZone[] {
  const groups = new Map<string, ItemCatalogGroup & { rank: number; zone: ItemCatalogZone["key"] }>();
  for (const entry of entries) {
    const descriptor = itemGroupDescriptor(entry.item);
    const groupKey = `${descriptor.zone}:${descriptor.key}`;
    const existing = groups.get(groupKey);
    if (existing) existing.entries.push(entry);
    else groups.set(groupKey, { entries: [entry], key: descriptor.key, label: descriptor.label, rank: descriptor.rank, zone: descriptor.zone });
  }
  return zoneOrder.map((zone) => ({
    key: zone,
    label: zoneLabels[zone],
    groups: [...groups.values()]
      .filter((group) => group.zone === zone)
      .sort((left, right) => left.rank - right.rank || left.label.localeCompare(right.label, "zh-CN")),
  }));
}

export function findItemCatalogEntry(entries: ItemCatalogEntry[], itemId: string | undefined): ItemCatalogEntry | undefined {
  return itemId ? entries.find((entry) => entry.members.some((member) => member.item.id === itemId)) : undefined;
}

export function filterItemCatalogEntries(entries: ItemCatalogEntry[], query: string | undefined): ItemCatalogEntry[] {
  const search = query?.trim().toLocaleLowerCase();
  if (!search) return entries;
  return entries.filter((entry) => entry.members.some(({ item }) => (
    item.name.toLocaleLowerCase().includes(search) || item.localizedName.toLocaleLowerCase().includes(search)
  )));
}

export function itemCatalogHref(itemId: string, q?: string): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  params.set("selected", itemId);
  return `/items?${params.toString()}`;
}

export function levelAttributeValues(details: ItemDetail[], attributeIndex: number): string[] | null {
  if (details.length < 2) return null;
  const label = details[0]?.attributes[attributeIndex]?.label;
  if (!label) return null;
  const occurrence = details[0]!.attributes.slice(0, attributeIndex + 1).filter((attribute) => attribute.label === label).length - 1;
  const values = details.map((detail) => detail.attributes.filter((attribute) => attribute.label === label)[occurrence]?.value);
  const first = values[0];
  if (!first) return null;
  const tokens = first.split(/\s*\/\s*/).map((token) => token.trim());
  if (tokens.length === details.length && tokens.every(Boolean)) return tokens;
  if (values.every((value): value is string => typeof value === "string" && value.length > 0 && !value.includes("/"))) {
    return new Set(values).size > 1 ? values : null;
  }
  return null;
}

function itemGroupDescriptor(item: ItemSummary) {
  if (item.kind === "neutral_enhancement") {
    return { key: "neutral_enhancement", label: "中立附魔", rank: 99, zone: "neutral" as const };
  }
  if (item.kind === "neutral_item") {
    const tier = /^neutral_tier_(\d+)$/.exec(item.category)?.[1];
    return tier
      ? { key: `neutral_${tier}`, label: `${tier} 级`, rank: 80 + Number(tier), zone: "neutral" as const }
      : { key: "neutral", label: "其他中立物品", rank: 98, zone: "neutral" as const };
  }
  const category = categoryDefinitions[item.category];
  return category
    ? { key: item.category, label: category.groupLabel, rank: category.rank, zone: category.zone }
    : { key: "other", label: "其他当前物品", rank: 100, zone: "crafted" as const };
}
