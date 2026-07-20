import type { MatchDetail } from "@dodo/contracts";

export type AdvancedSectionStatus = MatchDetail["analysis"]["kills"]["status"];

export type AdvancedSectionPresentation = {
  detail: string;
  showData: boolean;
  tone: "complete" | "partial" | "unavailable";
};

export function advancedSectionPresentation({
  completeEmptyDetail,
  count,
  excludedCount,
  label,
  status,
}: {
  completeEmptyDetail: string;
  count: number;
  excludedCount: number;
  label: string;
  status: AdvancedSectionStatus;
}): AdvancedSectionPresentation {
  if (status === "unavailable") {
    return {
      detail: `${label}未由当前上游响应提供，不能据此判断本场没有相关记录。`,
      showData: false,
      tone: "unavailable",
    };
  }
  if (status === "partial") {
    const excluded = excludedCount > 0 ? `；另有 ${excludedCount} 条记录未纳入` : "";
    return {
      detail: `${label}仅部分可用${excluded}，当前列表不代表完整事件集。`,
      showData: count > 0,
      tone: "partial",
    };
  }
  return {
    detail: count === 0 ? completeEmptyDetail : `${label}已完整载入。`,
    showData: count > 0,
    tone: "complete",
  };
}

export function comparisonWidth(value: number | null, values: Array<number | null>): number {
  if (value === null) return 0;
  let maximum = 0;
  for (const candidate of values) {
    if (candidate !== null) maximum = Math.max(maximum, candidate);
  }
  return maximum <= 0 ? 0 : Math.round((value / maximum) * 1000) / 10;
}

export function chartPolyline<T>(
  samples: T[],
  getTime: (sample: T) => number,
  getValue: (sample: T) => number | null,
): string[] | null {
  const points = samples.flatMap((sample) => {
    const value = getValue(sample);
    return value === null ? [] : [{ time: getTime(sample), value }];
  });
  if (points.length < 2) return null;

  let minTime = points[0]!.time;
  let maxTime = points[0]!.time;
  let minValue = points[0]!.value;
  let maxValue = points[0]!.value;
  for (const point of points.slice(1)) {
    minTime = Math.min(minTime, point.time);
    maxTime = Math.max(maxTime, point.time);
    minValue = Math.min(minValue, point.value);
    maxValue = Math.max(maxValue, point.value);
  }
  minValue = Math.min(0, minValue);
  maxValue = Math.max(0, maxValue);
  const timeSpan = Math.max(1, maxTime - minTime);
  const valueSpan = Math.max(1, maxValue - minValue);

  const segments: string[][] = [];
  let current: string[] = [];
  for (const sample of samples) {
    const value = getValue(sample);
    if (value === null) {
      if (current.length >= 2) segments.push(current);
      current = [];
      continue;
    }
    const x = ((getTime(sample) - minTime) / timeSpan) * 100;
    const y = 40 - ((value - minValue) / valueSpan) * 40;
    current.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  if (current.length >= 2) segments.push(current);
  return segments.length > 0 ? segments.map((segment) => segment.join(" ")) : null;
}

export function aggregatePlayerMetric(
  players: MatchDetail["players"],
  side: "radiant" | "dire",
  field: "heroDamage" | "heroHealing" | "towerDamage",
): { eligibleCount: number; observedCount: number; value: number | null } {
  const eligible = players.filter((player) => player.side === side);
  const observed = eligible.map((player) => player[field]).filter((value): value is number => value !== null);
  return {
    eligibleCount: 5,
    observedCount: observed.length,
    value: eligible.length === 5 && observed.length === 5
      ? observed.reduce((total, value) => total + value, 0)
      : null,
  };
}

export function aggregateTeamTimelines(match: MatchDetail): {
  excludedCount: number;
  samples: Array<{ gameTimeSeconds: number; radiantGold: number; radiantXp: number; direGold: number; direXp: number }>;
} {
  const rosterBySide = {
    radiant: match.players.filter((player) => player.side === "radiant").map((player) => player.playerSlot),
    dire: match.players.filter((player) => player.side === "dire").map((player) => player.playerSlot),
  };
  const timelineBySlot = new Map(match.analysis.playerTimelines.players.map((timeline) => [timeline.playerSlot, timeline.samples]));
  const times = [...new Set(match.analysis.playerTimelines.players.flatMap((timeline) => timeline.samples.map((sample) => sample.gameTimeSeconds)))].sort((a, b) => a - b);
  const samples = times.flatMap((gameTimeSeconds) => {
    if (rosterBySide.radiant.length !== 5 || rosterBySide.dire.length !== 5) return [];
    const sumSide = (slots: number[]) => {
      const values = slots.map((slot) => timelineBySlot.get(slot)?.find((sample) => sample.gameTimeSeconds === gameTimeSeconds));
      if (values.some((sample) => !sample || sample.gold === null || sample.xp === null)) return null;
      return values.reduce((total, sample) => ({ gold: total.gold + sample!.gold!, xp: total.xp + sample!.xp! }), { gold: 0, xp: 0 });
    };
    const radiant = sumSide(rosterBySide.radiant);
    const dire = sumSide(rosterBySide.dire);
    return radiant && dire ? [{ gameTimeSeconds, radiantGold: radiant.gold, radiantXp: radiant.xp, direGold: dire.gold, direXp: dire.xp }] : [];
  });
  return { excludedCount: times.length - samples.length, samples };
}
