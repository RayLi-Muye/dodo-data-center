import type { HeroDetail, MatchDetail, StratzEnrichmentState } from "@dodo/contracts";

import { formatGameTime } from "./format";

export type AbilitiesByHeroId = Record<string, HeroDetail["abilities"]>;

export type StratzEnrichmentPresentation = {
  detail: string;
  title: string;
  tone: "neutral" | "positive" | "warning";
};

const stratzReasonLabels: Record<NonNullable<StratzEnrichmentState["reasonCode"]>, string> = {
  partial_response: "上游仅返回部分增强字段",
  not_found: "STRATZ 未找到该比赛",
  core_conflict: "核心比赛字段与 OpenDota 冲突",
  player_conflict: "玩家身份字段与 OpenDota 冲突",
  rate_limited: "STRATZ 请求受到限流",
  authentication: "STRATZ 鉴权或访问受限",
  unavailable: "STRATZ 网络或上游暂不可用",
  invalid_response: "STRATZ 响应无法安全读取",
};

export const stratzEnrichmentReasonLabel = (
  reasonCode: StratzEnrichmentState["reasonCode"],
): string => reasonCode === null ? "无" : stratzReasonLabels[reasonCode];

export const stratzEnrichmentPresentation = (
  state: StratzEnrichmentState,
): StratzEnrichmentPresentation => {
  const reason = stratzEnrichmentReasonLabel(state.reasonCode);
  switch (state.status) {
    case "complete":
      return {
        detail: "增强字段已安全写入当前比赛；这不代表拥有完整回放事件。",
        title: "STRATZ 增强已完成",
        tone: "positive",
      };
    case "retry_scheduled":
      return {
        detail: state.nextAttemptAt === null
          ? `${reason}。状态标记为等待重试，但上游未提供下次尝试时间；现有 OpenDota 数据继续可读。`
          : `${reason}。系统已安排下一次尝试；现有 OpenDota 数据继续可读。`,
        title: "STRATZ 增强等待重试",
        tone: "warning",
      };
    case "terminal_partial":
      return {
        detail: `${reason}。已保留可安全写入的字段，当前不会自动重试。`,
        title: "STRATZ 增强部分可用",
        tone: "warning",
      };
    case "terminal_failed":
      return {
        detail: `${reason}。没有新增可安全写入的字段，当前不会自动重试。`,
        title: "STRATZ 增强失败",
        tone: "warning",
      };
    case "provider_blocked":
      return {
        detail: `${reason}。提供方级阻断使当前增强无法继续；现有基础数据仍保留。`,
        title: "STRATZ 提供方暂不可用",
        tone: "warning",
      };
    case "not_requested":
      return {
        detail: "当前比赛尚未请求 STRATZ 增强；页面仅展示已经取得的基础来源数据。",
        title: "STRATZ 增强尚未请求",
        tone: "neutral",
      };
  }
};

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

export function abilityBuildNotice(
  status: MatchDetail["players"][number]["abilityBuildStatus"],
  eventCount: number,
): string | null {
  if (status === "unavailable") return "上游未提供技能加点顺序。";
  if (status === "ordered") return "上游仅提供加点顺序，没有英雄等级或游戏时间。";
  return eventCount > 0 ? null : "没有可展示的真实技能加点记录。";
}

export function itemTimelineNotice(
  status: MatchDetail["players"][number]["itemTimelineStatus"],
  eventCount: number,
): string | null {
  if (status === "unavailable") {
    return "上游未提供真实物品购买或出售时间线，无法判断是否发生出售。";
  }
  if (status === "partial") {
    return eventCount > 0
      ? "时间线仅部分可用；购买或出售事件都可能缺失，不能从未显示出售推断没有出售。下方只展示上游实际提供的事件。"
      : "时间线仅部分可用，目前没有真实事件可展示，无法判断是否发生购买或出售。";
  }
  return eventCount > 0 ? null : "该玩家没有可展示的真实物品交易事件。";
}
