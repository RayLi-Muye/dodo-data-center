import type { PlayerHistorySync } from "@dodo/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  loadPlayerHistorySync,
  PlayerHistorySyncRequestError,
  playerHistorySyncPresentation,
  startAndPollPlayerHistorySync,
} from "../lib/player-history-sync";

const historyResponse = (status: PlayerHistorySync["status"]): Response =>
  new Response(JSON.stringify({
    data: {
      accountId: "123456789",
      errorCode: status === "source_rate_limited" ? "SOURCE_RATE_LIMITED" : null,
      matchesImported: 240,
      nextOffset: 300,
      oldestImportedAt: "2025-01-01T08:00:00.000Z",
      pageSize: 100,
      pagesImported: 3,
      reachedEnd: status === "complete",
      requestedAt: "2026-07-12T08:00:00.000Z",
      status,
      updatedAt: "2026-07-12T08:00:01.000Z",
    },
    meta: {
      quality: status === "complete" ? "complete" : "partial",
      sources: ["opendota"],
      updatedAt: "2026-07-12T08:00:01.000Z",
    },
  }), { status: status === "syncing" ? 202 : 200 });

describe("player history sync workflow", () => {
  it("loads current counters with GET, then starts with POST and polls GET until terminal", async () => {
    const loadFetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      historyResponse("idle"));
    const initial = await loadPlayerHistorySync("123456789", { fetcher: loadFetcher });
    expect(initial).toMatchObject({ matchesImported: 240, pagesImported: 3, status: "idle" });
    expect(loadFetcher).toHaveBeenCalledWith(
      "/api/players/123456789/history-sync",
      expect.objectContaining({ method: "GET" }),
    );

    const responses = [
      historyResponse("syncing"),
      historyResponse("syncing"),
      historyResponse("partial"),
    ];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      responses.shift()!);
    const terminal = await startAndPollPlayerHistorySync("123456789", {
      fetcher,
      maxPollAttempts: 3,
      wait: async () => undefined,
    });

    expect(terminal.status).toBe("partial");
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "GET", "GET"]);
  });

  it("does not poll again when POST reports complete", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      historyResponse("complete"));

    const terminal = await startAndPollPlayerHistorySync("123456789", { fetcher });

    expect(terminal.status).toBe("complete");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(playerHistorySyncPresentation(terminal)).toMatchObject({ tone: "positive" });
  });

  it("surfaces terminal error states and bounded polling failures", async () => {
    const limited = await historyResponse("source_rate_limited").json() as { data: PlayerHistorySync };
    expect(playerHistorySyncPresentation(limited.data)).toMatchObject({ tone: "warning" });

    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      historyResponse("syncing"));
    await expect(startAndPollPlayerHistorySync("123456789", {
      fetcher,
      maxPollAttempts: 2,
      wait: async () => undefined,
    })).rejects.toEqual(new PlayerHistorySyncRequestError(
      "历史导入等待超过轮询上限，请稍后重试。",
    ));
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
