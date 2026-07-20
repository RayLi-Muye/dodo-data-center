import { readFileSync } from "node:fs";

import type { MatchDetail } from "@dodo/contracts";
import { describe, expect, it } from "vitest";

import {
  abilityBuildNotice,
  abilityUpgradeContext,
  itemTimelineNotice,
  resolveHeroAbility,
  stratzEnrichmentPresentation,
  type AbilitiesByHeroId,
} from "../lib/match-detail";
import {
  advancedSectionPresentation,
  aggregatePlayerMetric,
  aggregateTeamTimelines,
  chartPolyline,
  comparisonWidth,
} from "../lib/match-analysis";

const source = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

function timelineMatch({
  direCount = 5,
  radiantCount = 5,
  status = "complete",
  times = [60],
  valueFor = (_side: "radiant" | "dire", index: number, gameTimeSeconds: number) => ({
    gold: (index + 1) * 100 + gameTimeSeconds,
    xp: (index + 1) * 10 + gameTimeSeconds,
  }),
}: {
  direCount?: number;
  radiantCount?: number;
  status?: "complete" | "partial";
  times?: number[];
  valueFor?: (side: "radiant" | "dire", index: number, gameTimeSeconds: number) => { gold: number | null; xp: number | null };
} = {}): MatchDetail {
  const players = [
    ...Array.from({ length: radiantCount }, (_, index) => ({ index, playerSlot: index, side: "radiant" as const })),
    ...Array.from({ length: direCount }, (_, index) => ({ index, playerSlot: 128 + index, side: "dire" as const })),
  ];
  return {
    players,
    analysis: {
      playerTimelines: {
        excludedCount: status === "partial" ? 1 : 0,
        exclusionReasons: status === "partial" ? ["fixture_missing_sample"] : [],
        players: players.map((player) => ({
          playerSlot: player.playerSlot,
          samples: times.map((gameTimeSeconds) => ({
            gameTimeSeconds,
            ...valueFor(player.side, player.index, gameTimeSeconds),
            denies: null,
            lastHits: null,
          })),
        })),
        status,
      },
    },
  } as unknown as MatchDetail;
}

describe("match detail presentation", () => {
  it("never invents hero level or game time for ordered-only ability builds", () => {
    const event = { abilityId: "axe_berserkers_call", gameTimeSeconds: 125, heroLevel: 3, sequence: 2 };

    expect(abilityUpgradeContext(event, "ordered")).toBe("第 2 次加点");
    expect(abilityUpgradeContext(event, "timed")).toBe("第 2 次加点 · 英雄等级 3 · 游戏时间 2:05");
    expect(abilityBuildNotice("ordered", 2)).toBe("上游仅提供加点顺序，没有英雄等级或游戏时间。");
  });

  it("makes unavailable and partial item timelines explicit", () => {
    expect(itemTimelineNotice("unavailable", 0)).toContain("无法判断是否发生出售");
    expect(itemTimelineNotice("partial", 0)).toContain("无法判断是否发生购买或出售");
    expect(itemTimelineNotice("partial", 2)).toContain("不能从未显示出售推断没有出售");
    expect(itemTimelineNotice("complete", 2)).toBeNull();
  });

  it("keeps advanced empty, partial, and unavailable states distinct", () => {
    const base = { completeEmptyDetail: "确认无事件。", count: 0, excludedCount: 0, label: "事件" };
    expect(advancedSectionPresentation({ ...base, status: "complete" })).toMatchObject({ detail: "确认无事件。", showData: false, tone: "complete" });
    expect(advancedSectionPresentation({ ...base, count: 2, excludedCount: 1, status: "partial" })).toMatchObject({ showData: true, tone: "partial" });
    expect(advancedSectionPresentation({ ...base, status: "unavailable" })).toMatchObject({ showData: false, tone: "unavailable" });
  });

  it("normalizes comparison bars and never bridges a null chart sample", () => {
    expect(comparisonWidth(null, [10, null])).toBe(0);
    expect(comparisonWidth(5, [5, 10])).toBe(50);
    const segments = chartPolyline(
      [{ t: 0, v: 1 }, { t: 1, v: 2 }, { t: 2, v: null }, { t: 3, v: 3 }, { t: 4, v: 4 }],
      (sample) => sample.t,
      (sample) => sample.v,
    );
    expect(segments).toHaveLength(2);
  });

  it("does not turn missing team metrics into zero-valued totals", () => {
    const players = [100, 200, 300, 400, null].map((towerDamage) => ({ side: "radiant", towerDamage })) as unknown as MatchDetail["players"];
    expect(aggregatePlayerMetric(players, "radiant", "towerDamage")).toEqual({
      eligibleCount: 5,
      observedCount: 4,
      value: null,
    });
  });

  it("aggregates team timelines only when both sides have five complete players", () => {
    expect(aggregateTeamTimelines(timelineMatch())).toEqual({
      excludedCount: 0,
      samples: [{
        direGold: 1800,
        direXp: 450,
        gameTimeSeconds: 60,
        radiantGold: 1800,
        radiantXp: 450,
      }],
    });
  });

  it("excludes every team sample when either roster has fewer than five players", () => {
    expect(aggregateTeamTimelines(timelineMatch({ radiantCount: 4 }))).toEqual({
      excludedCount: 1,
      samples: [],
    });
  });

  it("excludes a timepoint instead of replacing any player's null gold or xp with zero", () => {
    const match = timelineMatch({
      valueFor: (side, index, gameTimeSeconds) => ({
        gold: side === "dire" && index === 2 ? null : (index + 1) * 100 + gameTimeSeconds,
        xp: (index + 1) * 10 + gameTimeSeconds,
      }),
    });
    expect(aggregateTeamTimelines(match)).toEqual({ excludedCount: 1, samples: [] });
  });

  it("keeps valid partial timepoints and counts invalid timepoints exactly", () => {
    const result = aggregateTeamTimelines(timelineMatch({
      status: "partial",
      times: [60, 120],
      valueFor: (side, index, gameTimeSeconds) => ({
        gold: side === "radiant" && index === 0 && gameTimeSeconds === 120 ? null : (index + 1) * 100 + gameTimeSeconds,
        xp: (index + 1) * 10 + gameTimeSeconds,
      }),
    }));
    expect(result.excludedCount).toBe(1);
    expect(result.samples).toEqual([{
      direGold: 1800,
      direXp: 450,
      gameTimeSeconds: 60,
      radiantGold: 1800,
      radiantXp: 450,
    }]);
  });

  it.each([
    ["not_requested", "STRATZ 增强尚未请求", "neutral"],
    ["complete", "STRATZ 增强已完成", "positive"],
    ["retry_scheduled", "STRATZ 增强等待重试", "warning"],
    ["terminal_partial", "STRATZ 增强部分可用", "warning"],
    ["terminal_failed", "STRATZ 增强失败", "warning"],
    ["provider_blocked", "STRATZ 提供方暂不可用", "warning"],
  ] as const)("presents %s enrichment without promising replay completeness", (status, title, tone) => {
    const presentation = stratzEnrichmentPresentation({
      attemptCount: status === "not_requested" ? 0 : 1,
      lastAttemptAt: status === "not_requested" ? null : "2026-07-13T10:00:00.000Z",
      nextAttemptAt: status === "retry_scheduled" ? "2026-07-13T10:30:00.000Z" : null,
      providerRevision: "stratz-graphql-v1",
      reasonCode: status === "complete" || status === "not_requested" ? null : "unavailable",
      resultQuality: status === "complete" ? "complete" : status === "terminal_partial" ? "partial" : null,
      status,
    });

    expect(presentation).toMatchObject({ title, tone });
    expect(presentation.detail).not.toMatch(/完整回放数据|完整回放事件已/);
  });

  it("resolves ability IDs only inside the selected player's hero", () => {
    const abilitiesByHeroId = {
      axe: [{
        attributes: [],
        description: "",
        id: "shared-id",
        localizedName: "战斗饥渴",
        name: "axe_battle_hunger",
        slot: 1,
        type: "basic",
      }],
      bane: [{
        attributes: [],
        description: "",
        id: "shared-id",
        localizedName: "虚弱",
        name: "bane_enfeeble",
        slot: 0,
        type: "basic",
      }],
    } satisfies AbilitiesByHeroId;

    expect(resolveHeroAbility(abilitiesByHeroId, "axe", "shared-id")?.name).toBe("axe_battle_hunger");
    expect(resolveHeroAbility(abilitiesByHeroId, "bane", "shared-id")?.name).toBe("bane_enfeeble");
    expect(resolveHeroAbility(abilitiesByHeroId, "axe", "missing-id")).toBeUndefined();
    expect(resolveHeroAbility(abilitiesByHeroId, "missing-hero", "shared-id")).toBeUndefined();
  });

  it("renders all frozen scoreboard fields and gates complete-lineup language", () => {
    const page = source("../app/matches/[matchId]/page.tsx");
    const row = source("../components/match-player-row.tsx");
    const workbench = source("../components/match-detail-workbench.tsx");

    expect(workbench).toContain('match.detailStatus === "enriched"');
    expect(workbench).toContain("radiant.length === 5 && dire.length === 5");
    expect(workbench).toContain("双方完整阵容已载入");
    expect(page).toContain("<MatchDetailWorkbench");
    expect(workbench).toContain("<MatchEnrichmentStatus");
    expect(page).toContain("上游解析记录可用，不代表完整回放事件");
    expect(page).toContain("matchHeroIds.map");
    expect(page).toContain("abilitiesByHeroId={abilitiesByHeroId}");
    for (const field of [
      "level",
      "gpm",
      "xpm",
      "lastHits",
      "denies",
      "heroDamage",
      "towerDamage",
      "finalItemIds",
      "backpackItemIds",
      "neutralItemId",
      "neutralItemEnhancementId",
    ]) {
      expect(row).toContain(`player.${field}`);
    }
  });

  it("moves builds into one keyboard-accessible player analyzer", () => {
    const analyzer = source("../components/match-analyzer.tsx");
    const workbench = source("../components/match-detail-workbench.tsx");
    const row = source("../components/match-player-row.tsx");

    expect(workbench).toContain('aria-pressed={player.playerSlot === selectedSlot}');
    expect(workbench).toContain("selectedPlayerSlot");
    for (const label of ["概览", "发育", "战斗", "目标", "构筑"]) expect(workbench).toContain(`label: "${label}"`);
    expect(analyzer).toContain("selectedPlayerSlot: number");
    expect(analyzer).toContain('role="tablist"');
    expect(analyzer).toContain('aria-selected={view === "abilities"}');
    expect(analyzer).toContain('aria-selected={view === "items"}');
    expect(analyzer).toContain("abilityUpgradeContext");
    expect(analyzer).toContain("abilityBuildNotice");
    expect(analyzer).toContain("resolveHeroAbility(abilitiesByHeroId, player.heroId, event.abilityId)");
    expect(analyzer).toContain("ability?.localizedName");
    expect(analyzer).toContain("`技能 #${event.abilityId}`");
    expect(analyzer).toContain('kind="ability"');
    expect(analyzer).toContain("itemTimelineNotice");
    expect(analyzer).toContain("player.abilityBuildStatus");
    expect(analyzer).toContain("player.itemTimelineStatus");
    expect(analyzer).toContain('event.action === "purchase" ? "+ 购买" : "− 出售"');
    expect(row).not.toContain("participant-breakdown");
  });

  it("separates STRATZ workflow state from persisted enrichment sources", () => {
    const status = source("../components/match-enrichment-status.tsx");
    const css = source("../app/globals.css");

    for (const field of [
      "attemptCount",
      "lastAttemptAt",
      "nextAttemptAt",
      "resultQuality",
      "reasonCode",
    ]) {
      expect(status).toContain(`state.${field}`);
    }
    expect(status).toContain('match.enrichmentSources.includes("stratz")');
    expect(status).toContain("只表示字段已成功持久化");
    expect(status).toContain("不代表拥有完整回放数据");
    expect(css).toContain(".match-enrichment-status");
  });

  it("renders ability icons on hero details without changing the empty state", () => {
    const heroPage = source("../app/heroes/[heroId]/page.tsx");

    expect(heroPage).toContain('className="ability-list__icon"');
    expect(heroPage).toContain('kind="ability"');
    expect(heroPage).toContain("技能资料待补充");
  });
});
