import { describe, expect, it } from "vitest";

import {
  encyclopediaVersionLabel,
  formatDuration,
  formatGameTime,
  formatPercent,
  formatStatGain,
  formatStatValue,
  gameModeLabel,
  heroRoleLabel,
  matchVersionLabel,
  officialDescription,
  windowLabel,
  winRatePresentation,
} from "../lib/format";

describe("data formatting", () => {
  it("formats match duration without locale ambiguity", () => {
    expect(formatDuration(1_841)).toBe("30:41");
    expect(formatGameTime(-15)).toBe("−0:15");
    expect(formatGameTime(125)).toBe("2:05");
  });

  it("keeps missing percentages explicit", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(0.534)).toBe("53.4%");
  });

  it("formats compact hero stats and signed growth values", () => {
    expect(formatStatValue(22.567)).toBe("22.57");
    expect(formatStatValue(300)).toBe("300");
    expect(formatStatGain(2.8)).toBe("+2.8");
    expect(formatStatGain(0)).toBe("0");
    expect(formatStatGain(-0.25)).toBe("-0.25");
  });

  it("does not describe all imported matches as a full career", () => {
    expect(windowLabel("all_imported")).toBe("全部已导入");
  });

  it("labels known modes while preserving unknown raw IDs", () => {
    expect(gameModeLabel("22")).toBe("天梯全英雄选择");
    expect(gameModeLabel("custom-mode")).toBe("custom-mode");
  });

  it("localizes official hero role tokens without changing unknown values", () => {
    expect([
      "Carry",
      "Support",
      "Nuker",
      "Disabler",
      "Jungler",
      "Durable",
      "Escape",
      "Pusher",
      "Initiator",
    ].map(heroRoleLabel)).toEqual([
      "核心",
      "辅助",
      "爆发",
      "控制",
      "打野",
      "耐久",
      "逃生",
      "推进",
      "先手",
    ]);
    expect(heroRoleLabel("UnknownRole")).toBe("UnknownRole");
  });

  it("keeps missing official descriptions explicit", () => {
    expect(officialDescription("")).toBe("当前官方快照说明不可用");
    expect(officialDescription("   ")).toBe("当前官方快照说明不可用");
    expect(officialDescription("官方说明")).toBe("官方说明");
  });

  it("keeps official, inferred, and unavailable version states explicit", () => {
    expect(encyclopediaVersionLabel("7.41d")).toBe("7.41d");
    expect(encyclopediaVersionLabel(null)).toBe("版本待确认");
    expect(matchVersionLabel({
      officialVersion: "7.41d",
      officialVersionSource: "start_time_inferred",
      openDotaPatchId: "60",
    })).toBe("7.41d · 按时间推定");
    expect(matchVersionLabel({
      officialVersion: null,
      officialVersionSource: "unavailable",
      openDotaPatchId: "60",
    })).toBe("OpenDota Patch #60");
    expect(matchVersionLabel({
      officialVersion: null,
      officialVersionSource: "unavailable",
      openDotaPatchId: null,
    })).toBe("版本待确认");
  });

  it("renders an unavailable hero win rate as neutral without a direction arrow", () => {
    expect(winRatePresentation(null)).toEqual({
      className: "trend--neutral",
      label: "—",
      symbol: "",
    });
  });
});
