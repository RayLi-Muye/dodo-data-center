import type { PatchSummary, PlayerHistorySync } from "@dodo/contracts";
import {
  OpenDotaProviderError,
  type CanonicalPlayerMatch,
} from "@dodo/dota-data";
import type { DodoRepository, StoredMatch } from "@dodo/db";

import type { PlayerDataProvider } from "./player-data-provider.js";
import { toMatchSummaryDetail } from "./player-sync-service.js";

const PAGE_SIZE = 100;
const SYNC_LEASE_MS = 5 * 60 * 1000;
const UNKNOWN_PATCH = "unknown";

type PlayerHistorySyncServiceOptions = {
  repository: DodoRepository;
  provider: PlayerDataProvider;
  clock?: () => Date;
};

const idleState = (accountId: string, updatedAt: string): PlayerHistorySync => ({
  accountId,
  status: "idle",
  nextOffset: 0,
  pageSize: PAGE_SIZE,
  pagesImported: 0,
  matchesImported: 0,
  oldestImportedAt: null,
  reachedEnd: false,
  requestedAt: null,
  updatedAt,
  errorCode: null,
});

const inferPatchId = (match: CanonicalPlayerMatch, patches: PatchSummary[]): string => {
  if (match.patchId !== null) return match.patchId;
  const startedAt = Date.parse(match.startTime);
  return (
    patches.find((patch) => Date.parse(patch.releasedAt) <= startedAt)?.id ?? UNKNOWN_PATCH
  );
};

const oldestOf = (current: string | null, matches: CanonicalPlayerMatch[]): string | null => {
  const candidates = [...matches.map((match) => match.startTime), ...(current ? [current] : [])];
  return candidates.sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null;
};

const failureFor = (
  current: PlayerHistorySync,
  error: unknown,
  updatedAt: string,
): PlayerHistorySync => {
  if (error instanceof OpenDotaProviderError) {
    const status =
      error.code === "SOURCE_RATE_LIMITED"
        ? "source_rate_limited"
        : error.code === "SOURCE_UNAVAILABLE"
          ? "source_unavailable"
          : "failed";
    return { ...current, status, updatedAt, errorCode: error.code };
  }
  return { ...current, status: "failed", updatedAt, errorCode: "INTERNAL_ERROR" };
};

export class PlayerHistorySyncService {
  readonly #repository: DodoRepository;
  readonly #provider: PlayerDataProvider;
  readonly #clock: () => Date;
  readonly #inFlight = new Map<string, Promise<void>>();

  constructor({ repository, provider, clock = () => new Date() }: PlayerHistorySyncServiceOptions) {
    this.#repository = repository;
    this.#provider = provider;
    this.#clock = clock;
  }

  async getState(accountId: string): Promise<PlayerHistorySync> {
    return (
      (await this.#repository.getPlayerHistorySync(accountId)) ??
      idleState(accountId, new Date(0).toISOString())
    );
  }

  async requestSync(accountId: string): Promise<PlayerHistorySync> {
    if (this.#inFlight.has(accountId)) return this.getState(accountId);

    const current = await this.getState(accountId);
    if (current.reachedEnd) return current;
    if (
      current.status === "syncing" &&
      current.requestedAt !== null &&
      this.#clock().getTime() - Date.parse(current.requestedAt) < SYNC_LEASE_MS
    ) {
      return current;
    }
    const requestedAt = this.#clock().toISOString();
    const syncing: PlayerHistorySync = {
      ...current,
      status: "syncing",
      requestedAt,
      updatedAt: requestedAt,
      errorCode: null,
    };
    const acquired = await this.#repository.tryAcquirePlayerHistorySyncLease(
      syncing,
      new Date(this.#clock().getTime() - SYNC_LEASE_MS).toISOString(),
    );
    if (!acquired) return this.getState(accountId);
    const execution = this.#execute(syncing).finally(() => this.#inFlight.delete(accountId));
    this.#inFlight.set(accountId, execution);
    return syncing;
  }

  async waitForAccount(accountId: string): Promise<PlayerHistorySync> {
    await this.#inFlight.get(accountId);
    return this.getState(accountId);
  }

  async close(): Promise<void> {
    await Promise.all(this.#inFlight.values());
  }

  async #execute(current: PlayerHistorySync): Promise<void> {
    try {
      const [page, items] = await Promise.all([
        this.#provider.getPlayerMatchesPage(
          current.accountId,
          current.pageSize,
          current.nextOffset,
        ),
        this.#provider.getItemConstants(),
      ]);
      if (page.accountId !== current.accountId || page.offset !== current.nextOffset) {
        throw new Error("Player data provider returned a different history page");
      }
      const patches = await this.#repository.listPatches();
      const itemIdByName = new Map(items.items.map((item) => [item.name, item.id]));
      const existing = new Map(
        (await this.#repository.listPlayerMatches(current.accountId)).map((match) => [
          match.detail.id,
          match,
        ]),
      );
      const storedMatches: StoredMatch[] = page.matches.map((match) => {
        const previous = existing.get(match.id);
        if (previous?.detail.detailStatus === "enriched") return previous;
        const attributed = { ...match, patchId: inferPatchId(match, patches) };
        return {
          detail: toMatchSummaryDetail(attributed, itemIdByName),
          importedAt: page.source.fetchedAt,
          source: "opendota",
          quality: page.quality,
        };
      });
      const newMatchCount = new Set(
        page.matches.flatMap((match) => (existing.has(match.id) ? [] : [match.id])),
      ).size;
      const completedAt = this.#clock().toISOString();
      const next: PlayerHistorySync = {
        ...current,
        status: page.reachedEnd ? "complete" : "partial",
        nextOffset: current.nextOffset + page.rawCount,
        pagesImported: current.pagesImported + 1,
        matchesImported: current.matchesImported + newMatchCount,
        oldestImportedAt: oldestOf(current.oldestImportedAt, page.matches),
        reachedEnd: page.reachedEnd,
        updatedAt: completedAt,
        errorCode: null,
      };
      await this.#repository.commitPlayerHistoryPage(current.accountId, storedMatches, next);
    } catch (error) {
      const failed = failureFor(current, error, this.#clock().toISOString());
      await this.#repository.commitPlayerHistoryPage(current.accountId, [], failed);
    }
  }
}
