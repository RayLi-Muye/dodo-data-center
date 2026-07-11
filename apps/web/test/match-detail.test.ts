import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { abilityUpgradeContext, itemTimelineNotice } from "../lib/match-detail";

const source = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

describe("match detail presentation", () => {
  it("never invents hero level or game time for ordered-only ability builds", () => {
    const event = { abilityId: "axe_berserkers_call", gameTimeSeconds: 125, heroLevel: 3, sequence: 2 };

    expect(abilityUpgradeContext(event, "ordered")).toBe("第 2 次加点");
    expect(abilityUpgradeContext(event, "timed")).toBe("第 2 次加点 · 英雄等级 3 · 游戏时间 2:05");
  });

  it("makes unavailable and partial item timelines explicit", () => {
    expect(itemTimelineNotice("unavailable", 0)).toBe("上游未提供真实物品交易时间线。");
    expect(itemTimelineNotice("partial", 0)).toContain("没有真实交易事件");
    expect(itemTimelineNotice("partial", 2)).toContain("只展示上游实际提供的交易事件");
    expect(itemTimelineNotice("complete", 2)).toBeNull();
  });

  it("renders all frozen scoreboard fields and gates complete-lineup language", () => {
    const page = source("../app/matches/[matchId]/page.tsx");
    const row = source("../components/match-player-row.tsx");

    expect(page).toContain('match.data.detailStatus === "enriched"');
    expect(page).toContain("radiant.length === 5 && dire.length === 5");
    expect(page).toContain("完整详情后台补全中");
    expect(page).toContain("完整阵容已载入");
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
      "abilityBuildStatus",
      "itemTimelineStatus",
    ]) {
      expect(row).toContain(`player.${field}`);
    }
  });
});
