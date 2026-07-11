import { describe, expect, it } from "vitest";

import { formatDuration, formatGameTime, formatPercent, windowLabel, winRatePresentation } from "../lib/format";

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

  it("does not describe all imported matches as a full career", () => {
    expect(windowLabel("all_imported")).toBe("全部已导入");
  });

  it("renders an unavailable hero win rate as neutral without a direction arrow", () => {
    expect(winRatePresentation(null)).toEqual({
      className: "trend--neutral",
      label: "—",
      symbol: "",
    });
  });
});
