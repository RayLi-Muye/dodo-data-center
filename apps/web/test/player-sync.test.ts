import type { SyncJob } from "@dodo/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  PLAYER_SYNC_FRESHNESS_MS,
  PlayerSyncRequestError,
  playerSyncPresentation,
  shouldStartPlayerSync,
  startAndPollPlayerSync,
} from "../lib/player-sync";

const NOW = Date.parse("2026-07-11T08:00:00.000Z");

const jobResponse = (status: SyncJob["status"]): Response =>
  new Response(JSON.stringify({
    data: {
      accountId: "123456789",
      completedAt: status === "syncing" ? null : "2026-07-11T08:00:00.000Z",
      errorCode: null,
      jobId: "job-123456789",
      requestedAt: "2026-07-11T07:59:00.000Z",
      status,
    },
    meta: {
      quality: status === "public_complete" ? "complete" : "partial",
      sources: ["opendota"],
      updatedAt: "2026-07-11T08:00:00.000Z",
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });

describe("player sync workflow", () => {
  it("skips fresh automatic sync, starts stale automatic sync, and always allows manual sync", () => {
    expect(shouldStartPlayerSync(new Date(NOW - PLAYER_SYNC_FRESHNESS_MS + 1).toISOString(), false, NOW)).toBe(false);
    expect(shouldStartPlayerSync(new Date(NOW - PLAYER_SYNC_FRESHNESS_MS).toISOString(), false, NOW)).toBe(true);
    expect(shouldStartPlayerSync(new Date(NOW).toISOString(), true, NOW)).toBe(true);
  });

  it("waits for a terminal job before reporting first-query success", async () => {
    const responses = [jobResponse("syncing"), jobResponse("syncing"), jobResponse("public_complete")];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => responses.shift()!);

    const job = await startAndPollPlayerSync("123456789", {
      fetcher,
      maxPollAttempts: 3,
      wait: async () => undefined,
    });

    expect(job.status).toBe("public_complete");
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/players/123456789/sync",
      "/api/sync-jobs/job-123456789",
      "/api/sync-jobs/job-123456789",
    ]);
  });

  it("keeps privacy, rate-limit, unavailable, and failed outcomes non-navigable", () => {
    for (const status of [
      "history_private",
      "profile_private",
      "source_rate_limited",
      "source_unavailable",
      "failed",
    ] as const) {
      expect(playerSyncPresentation(status).successful).toBe(false);
      expect(playerSyncPresentation(status).message).not.toContain("记录不存在");
    }
    expect(playerSyncPresentation("public_complete").successful).toBe(true);
    expect(playerSyncPresentation("public_partial").successful).toBe(true);
  });

  it("stops after the configured polling limit", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jobResponse("syncing"));

    await expect(startAndPollPlayerSync("123456789", {
      fetcher,
      maxPollAttempts: 2,
      wait: async () => undefined,
    })).rejects.toEqual(new PlayerSyncRequestError("同步等待超过轮询上限，请稍后重新刷新。"));
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
