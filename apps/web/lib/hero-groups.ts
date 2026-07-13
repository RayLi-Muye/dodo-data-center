export type HeroGroup = {
  heroIds: string[];
  id: string;
  name: string;
};

const STORAGE_KEY = "dodo.hero-groups.v1";
const MAX_CUSTOM_GROUPS = 20;
const MAX_GROUP_CANDIDATES = MAX_CUSTOM_GROUPS * 5;
const MAX_HERO_IDS_PER_GROUP = 256;
const MAX_HERO_ID_LENGTH = 32;
const MAX_STORAGE_LENGTH = 256_000;

export function parseHeroGroups(value: string | null): HeroGroup[] {
  if (!value || value.length > MAX_STORAGE_LENGTH) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const groups: HeroGroup[] = [];
    const seenGroupIds = new Set<string>();
    for (const candidate of parsed.slice(0, MAX_GROUP_CANDIDATES)) {
      if (groups.length >= MAX_CUSTOM_GROUPS) break;
      if (!candidate || typeof candidate !== "object") continue;
      const record = candidate as Record<string, unknown>;
      if (typeof record.id !== "string" || !record.id.trim()) continue;
      if (typeof record.name !== "string" || !record.name.trim()) continue;
      if (!Array.isArray(record.heroIds)) continue;
      const id = record.id.trim().slice(0, 80);
      if (seenGroupIds.has(id)) continue;
      const heroIds = [...new Set(record.heroIds.flatMap((candidateId) => {
        if (typeof candidateId !== "string") return [];
        const heroId = candidateId.trim();
        return heroId && heroId.length <= MAX_HERO_ID_LENGTH ? [heroId] : [];
      }))].slice(0, MAX_HERO_IDS_PER_GROUP);
      groups.push({ id, name: record.name.trim().slice(0, 32), heroIds });
      seenGroupIds.add(id);
    }
    return groups;
  } catch {
    return [];
  }
}

type HeroGroupStorage = Pick<Storage, "getItem" | "setItem">;

export function readHeroGroups(storage: HeroGroupStorage): HeroGroup[] {
  try {
    return parseHeroGroups(storage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

export function writeHeroGroups(storage: HeroGroupStorage, groups: HeroGroup[]): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(groups));
    return true;
  } catch {
    return false;
  }
}

export function canCreateHeroGroup(groupCount: number): boolean {
  return groupCount < MAX_CUSTOM_GROUPS;
}
