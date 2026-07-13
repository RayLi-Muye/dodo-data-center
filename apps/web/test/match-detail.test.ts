import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  abilityBuildNotice,
  abilityUpgradeContext,
  itemTimelineNotice,
  resolveHeroAbility,
  stratzEnrichmentPresentation,
  type AbilitiesByHeroId,
} from "../lib/match-detail";

const source = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

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
        description: "",
        id: "shared-id",
        localizedName: "战斗饥渴",
        name: "axe_battle_hunger",
        slot: 1,
        type: "basic",
      }],
      bane: [{
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

    expect(page).toContain('match.data.detailStatus === "enriched"');
    expect(page).toContain("radiant.length === 5 && dire.length === 5");
    expect(page).toContain("完整详情后台补全中");
    expect(page).toContain("完整阵容已载入");
    expect(page).toContain("<MatchAnalyzer");
    expect(page).toContain("<MatchEnrichmentStatus");
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
    const row = source("../components/match-player-row.tsx");

    expect(analyzer).toContain('aria-pressed={selected}');
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
