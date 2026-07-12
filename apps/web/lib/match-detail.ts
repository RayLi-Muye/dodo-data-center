import type { HeroDetail, MatchDetail } from "@dodo/contracts";

import { formatGameTime } from "./format";

export type AbilitiesByHeroId = Record<string, HeroDetail["abilities"]>;

export function resolveHeroAbility(
  abilitiesByHeroId: AbilitiesByHeroId,
  heroId: string,
  abilityId: string,
): HeroDetail["abilities"][number] | undefined {
  return abilitiesByHeroId[heroId]?.find((ability) => ability.id === abilityId);
}

export function abilityUpgradeContext(
  event: MatchDetail["players"][number]["abilityBuild"][number],
  status: MatchDetail["players"][number]["abilityBuildStatus"],
): string {
  const parts = [`第 ${event.sequence} 次加点`];
  if (status === "timed") {
    if (event.heroLevel !== null) parts.push(`英雄等级 ${event.heroLevel}`);
    if (event.gameTimeSeconds !== null) parts.push(`游戏时间 ${formatGameTime(event.gameTimeSeconds)}`);
  }
  return parts.join(" · ");
}

export function itemTimelineNotice(
  status: MatchDetail["players"][number]["itemTimelineStatus"],
  eventCount: number,
): string | null {
  if (status === "unavailable") return "上游未提供真实物品交易时间线。";
  if (status === "partial") {
    return eventCount > 0
      ? "时间线仅部分可用；下方只展示上游实际提供的交易事件。"
      : "时间线仅部分可用，目前没有真实交易事件可展示。";
  }
  return eventCount > 0 ? null : "该玩家没有可展示的真实物品交易事件。";
}
