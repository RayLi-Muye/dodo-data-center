import { emptyMatchAnalysis, type MatchAnalysis } from "@dodo/contracts";
import { describe, expect, it } from "vitest";

import { mergeMatchAnalyses } from "../src/index.js";

const partialAnalysis = (
  updatedAt: string,
  samples: MatchAnalysis["playerTimelines"]["players"][number]["samples"],
): MatchAnalysis => ({
  ...emptyMatchAnalysis(updatedAt),
  playerTimelines: {
    status: "partial",
    excludedCount: 1,
    exclusionReasons: ["incomplete_player_timeline"],
    players: [{ playerSlot: 0, samples }],
  },
});

describe("mergeMatchAnalyses", () => {
  it("preserves richer sections when an unavailable refresh arrives", () => {
    const existing = partialAnalysis("2026-07-20T01:00:00.000Z", [
      { gameTimeSeconds: 60, gold: 500, xp: 300, lastHits: 5, denies: 1 },
    ]);

    const merged = mergeMatchAnalyses(
      existing,
      emptyMatchAnalysis("2026-07-20T02:00:00.000Z"),
    );

    expect(merged.playerTimelines).toEqual(existing.playerTimelines);
    expect(merged.updatedAt).toBe("2026-07-20T02:00:00.000Z");
  });

  it("stably deduplicates same-level partial sections", () => {
    const existing = partialAnalysis("2026-07-20T01:00:00.000Z", [
      { gameTimeSeconds: 60, gold: 500, xp: 300, lastHits: 5, denies: 1 },
    ]);
    const incoming = partialAnalysis("2026-07-20T02:00:00.000Z", [
      { gameTimeSeconds: 60, gold: 550, xp: 320, lastHits: 6, denies: 1 },
      { gameTimeSeconds: 120, gold: 900, xp: 700, lastHits: 12, denies: 2 },
    ]);

    const merged = mergeMatchAnalyses(existing, incoming);
    const repeated = mergeMatchAnalyses(merged, incoming);

    expect(merged.playerTimelines.players[0]?.samples).toEqual(incoming.playerTimelines.players[0]?.samples);
    expect(repeated).toEqual(merged);
  });

  it("treats a complete section as an authoritative replacement", () => {
    const existing = partialAnalysis("2026-07-20T01:00:00.000Z", [
      { gameTimeSeconds: 60, gold: 500, xp: 300, lastHits: 5, denies: 1 },
    ]);
    const incoming: MatchAnalysis = {
      ...emptyMatchAnalysis("2026-07-20T02:00:00.000Z"),
      playerTimelines: {
        status: "complete",
        excludedCount: 0,
        exclusionReasons: [],
        players: [{
          playerSlot: 0,
          samples: [{ gameTimeSeconds: 120, gold: 900, xp: 700, lastHits: 12, denies: 2 }],
        }],
      },
    };

    expect(mergeMatchAnalyses(existing, incoming).playerTimelines).toEqual(
      incoming.playerTimelines,
    );
  });
});
