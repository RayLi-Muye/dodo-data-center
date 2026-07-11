export type DotaAssetKind = "hero" | "item";

const ITEM_ALIASES: Record<string, string> = {
  bkb: "black_king_bar",
  treads: "power_treads",
};

export function normalizeDotaAssetName(name: string, kind: DotaAssetKind): string | null {
  let normalized = name.toLowerCase();
  normalized = normalized.replace(kind === "hero" ? /^npc_dota_hero_/ : /^item_/, "");
  normalized = normalized.replace(/^seed_/, "");
  if (kind === "item") normalized = ITEM_ALIASES[normalized] ?? normalized;
  return /^[a-z0-9_]+$/.test(normalized) ? normalized : null;
}

export function dotaAssetUrl(name: string, kind: DotaAssetKind): string | null {
  const normalized = normalizeDotaAssetName(name, kind);
  if (!normalized) return null;
  const directory = kind === "hero" ? "heroes" : "items";
  return `https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/${directory}/${normalized}.png`;
}
