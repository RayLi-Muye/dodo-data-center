import type {
  HeroDetail,
  ItemDetail,
  MatchDetail,
  PlayerProfile,
  SyncJob,
} from "@dodo/contracts";
import {
  OpenDotaProviderError,
  type CanonicalHeroConstant,
  type CanonicalItemConstant,
  type CanonicalMatchDetail,
  type CanonicalMatchPlayer,
  type CanonicalPlayerMatch,
  type CanonicalPlayerProfile,
} from "@dodo/dota-data";
import type {
  DataQuality,
  DodoRepository,
  PlayerSyncBatch,
  ProviderHealth,
  StoredMatch,
} from "@dodo/db";

import type { PlayerDataProvider } from "./player-data-provider.js";

const UNKNOWN_PATCH = "unknown";

type PlayerSyncServiceOptions = {
  repository: DodoRepository;
  provider: PlayerDataProvider;
  clock?: () => Date;
};

const toHeroDetail = (hero: CanonicalHeroConstant, fetchedAt: string): HeroDetail => ({
  ...hero,
  patch: UNKNOWN_PATCH,
  facets: [],
  abilities: [],
  sourceSnapshot: `opendota://constants/heroes@${fetchedAt}`,
});

const toItemDetails = (
  items: CanonicalItemConstant[],
  fetchedAt: string,
): ItemDetail[] => {
  const idByName = new Map(items.map((item) => [item.name, item.id]));
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    localizedName: item.localizedName,
    cost: item.cost ?? 0,
    category: item.category ?? "unknown",
    patch: UNKNOWN_PATCH,
    description: item.description,
    attributes: item.attributes,
    components: item.componentNames.flatMap((name) => {
      const id = idByName.get(name);
      return id === undefined ? [] : [id];
    }),
    sourceSnapshot: `opendota://constants/items@${fetchedAt}`,
  }));
};

const toMatchPlayer = (
  player: CanonicalMatchPlayer,
  itemIdByName: ReadonlyMap<string, string>,
): MatchDetail["players"][number] => {
  const { eligibleForPersonalAggregation: _eligible, itemTimeline, ...rest } = player;
  const knownTransactions = itemTimeline.flatMap((transaction) => {
    const itemId = itemIdByName.get(transaction.itemKey);
    return itemId === undefined ? [] : [{ ...transaction, itemId }];
  });
  return {
    ...rest,
    itemTimeline: knownTransactions.map(({ itemKey: _itemKey, ...transaction }) => transaction),
    itemTimelineStatus:
      knownTransactions.length === itemTimeline.length
        ? player.itemTimelineStatus
        : "partial",
  };
};

export const toMatchSummaryDetail = (
  match: CanonicalPlayerMatch,
  itemIdByName: ReadonlyMap<string, string>,
): MatchDetail => {
  return {
    id: match.id,
    startTime: match.startTime,
    durationSeconds: match.durationSeconds,
    patch: match.patchId ?? UNKNOWN_PATCH,
    gameMode: match.gameMode,
    region: match.region,
    radiantWin: match.radiantWin,
    players: [toMatchPlayer(match.player, itemIdByName)],
    detailStatus: "summary",
    parseStatus: "unparsed",
    lobbyType: null,
    cluster: null,
    radiantScore: null,
    direScore: null,
  };
};

const toEnrichedMatchDetail = (
  match: CanonicalMatchDetail,
  itemIdByName: ReadonlyMap<string, string>,
): MatchDetail => ({
  id: match.id,
  startTime: match.startTime,
  durationSeconds: match.durationSeconds,
  patch: match.patchId ?? UNKNOWN_PATCH,
  gameMode: match.gameMode,
  region: match.region,
  radiantWin: match.radiantWin,
  players: match.players.map((player) => toMatchPlayer(player, itemIdByName)),
  detailStatus: "enriched",
  parseStatus: match.parseStatus,
  lobbyType: match.lobbyType,
  cluster: match.cluster,
  radiantScore: match.radiantScore,
  direScore: match.direScore,
});

const statusForProviderError = (
  error: OpenDotaProviderError,
): PlayerProfile["status"] => {
  switch (error.code) {
    case "NOT_FOUND":
      return "not_found";
    case "PROFILE_PRIVATE":
      return "profile_private";
    case "HISTORY_PRIVATE":
      return "history_private";
    case "SOURCE_RATE_LIMITED":
      return "source_rate_limited";
    case "SOURCE_UNAVAILABLE":
      return "source_unavailable";
    case "PARSE_PENDING":
      return "parse_pending";
  }
};

const errorCodeForStatus = (status: PlayerProfile["status"]): string => {
  switch (status) {
    case "not_found":
      return "NOT_FOUND";
    case "profile_private":
      return "PROFILE_PRIVATE";
    case "history_private":
      return "HISTORY_PRIVATE";
    case "source_rate_limited":
      return "SOURCE_RATE_LIMITED";
    case "source_unavailable":
      return "SOURCE_UNAVAILABLE";
    case "parse_pending":
      return "PARSE_PENDING";
    default:
      return "INTERNAL_ERROR";
  }
};

const providerHealthForError = (
  error: OpenDotaProviderError,
  checkedAt: string,
): ProviderHealth => {
  const status =
    error.code === "SOURCE_UNAVAILABLE"
      ? "unavailable"
      : error.code === "SOURCE_RATE_LIMITED" || error.code === "PARSE_PENDING"
        ? "degraded"
        : "ready";
  return {
    source: "opendota",
    status,
    checkedAt,
    message: status === "ready" ? null : `${error.code}: ${error.reason}`,
  };
};

const asPlayerProfile = (
  accountId: string,
  status: PlayerProfile["status"],
  profile: CanonicalPlayerProfile | PlayerProfile | undefined,
): PlayerProfile => {
  const storedProfile = profile && "importedMatchCount" in profile ? profile : undefined;
  return {
    accountId,
    steamId64: profile?.steamId64 ?? null,
    personaName: profile?.personaName ?? null,
    avatarUrl: profile?.avatarUrl ?? null,
    status,
    importedMatchCount: storedProfile?.importedMatchCount ?? 0,
    earliestImportedAt: storedProfile?.earliestImportedAt ?? null,
    latestImportedAt: storedProfile?.latestImportedAt ?? null,
  };
};

export class PlayerSyncService {
  readonly #repository: DodoRepository;
  readonly #provider: PlayerDataProvider;
  readonly #clock: () => Date;
  readonly #inFlight = new Map<string, Promise<void>>();
  readonly #requests = new Map<string, Promise<SyncJob>>();

  constructor({ repository, provider, clock = () => new Date() }: PlayerSyncServiceOptions) {
    this.#repository = repository;
    this.#provider = provider;
    this.#clock = clock;
  }

  requestSync(accountId: string): Promise<SyncJob> {
    const jobId = `job-${accountId}`;
    const existingRequest = this.#requests.get(jobId);
    if (existingRequest) return existingRequest;
    const request = this.#requestSync(accountId).finally(() => this.#requests.delete(jobId));
    this.#requests.set(jobId, request);
    return request;
  }

  async #requestSync(accountId: string): Promise<SyncJob> {
    const jobId = `job-${accountId}`;
    if (this.#inFlight.has(jobId)) {
      const existing = await this.#repository.getSyncJob(jobId);
      if (!existing) throw new Error(`In-flight sync job ${jobId} is missing`);
      return existing;
    }

    const requestedAt = this.#clock().toISOString();
    const previousProfile = await this.#repository.getPlayer(accountId);
    const job: SyncJob = {
      jobId,
      accountId,
      status: "syncing",
      requestedAt,
      completedAt: null,
      errorCode: null,
    };
    await this.#repository.upsertSyncJob(job);
    const hasReadableImportedProfile =
      previousProfile !== undefined &&
      previousProfile.importedMatchCount > 0 &&
      (previousProfile.status === "public_complete" || previousProfile.status === "public_partial");
    if (!hasReadableImportedProfile) {
      await this.#repository.upsertPlayer(asPlayerProfile(accountId, "syncing", previousProfile));
    }

    const execution = Promise.resolve()
      .then(() => this.#execute(job, previousProfile))
      .finally(() => this.#inFlight.delete(jobId));
    this.#inFlight.set(jobId, execution);
    return job;
  }

  async waitForJob(jobId: string): Promise<SyncJob | undefined> {
    await this.#inFlight.get(jobId);
    return this.#repository.getSyncJob(jobId);
  }

  async close(): Promise<void> {
    await Promise.all([...this.#requests.values(), ...this.#inFlight.values()]);
  }

  async #execute(job: SyncJob, previousProfile: PlayerProfile | undefined): Promise<void> {
    let fetchedProfile: CanonicalPlayerProfile | undefined;
    try {
      fetchedProfile = await this.#provider.getPlayerProfile(job.accountId);
      const [recent, heroes, items, patches] = await Promise.all([
        this.#provider.getRecentMatches(job.accountId, 100),
        this.#provider.getHeroConstants(),
        this.#provider.getItemConstants(),
        this.#provider.getPatchConstants(),
      ]);
      if (recent.accountId !== job.accountId) {
        throw new Error("Player data provider returned matches for a different account");
      }

      const quality: DataQuality =
        fetchedProfile.status === "public_partial" || recent.quality === "partial"
          ? "partial"
          : "complete";
      const itemIdByName = new Map(items.items.map((item) => [item.name, item.id]));
      const previousMatches = new Map(
        (await this.#repository.listPlayerMatches(job.accountId)).map((match) => [
          match.detail.id,
          match,
        ]),
      );
      const storedMatches: StoredMatch[] = recent.matches.map((match) => {
        const previous = previousMatches.get(match.id);
        if (previous?.detail.detailStatus === "enriched") return previous;
        return {
          detail: toMatchSummaryDetail(match, itemIdByName),
          importedAt: recent.source.fetchedAt,
          source: "opendota",
          quality,
        };
      });
      const batch: PlayerSyncBatch = {
        accountId: job.accountId,
        eligibleCount: recent.eligibleCount,
        sampleSize: storedMatches.length,
        excludedCount: recent.excludedCount,
        exclusionReasons: recent.exclusionReasons,
        quality,
        source: "opendota",
        fetchedAt: recent.source.fetchedAt,
        candidateLedger: recent.candidateLedger,
      };

      await this.#repository.replaceHeroes(
        heroes.items.map((hero) => toHeroDetail(hero, heroes.source.fetchedAt)),
        {
          source: "opendota",
          quality: "complete",
          fetchedAt: heroes.source.fetchedAt,
        },
      );
      await this.#repository.replaceItems(toItemDetails(items.items, items.source.fetchedAt), {
        source: "opendota",
        quality: "complete",
        fetchedAt: items.source.fetchedAt,
      });
      await this.#repository.replacePatches(patches.items, {
        source: "opendota",
        quality: "complete",
        fetchedAt: patches.source.fetchedAt,
      });
      await this.#repository.upsertPlayerMatches(job.accountId, storedMatches);
      const enrichmentCandidates = storedMatches
        .slice(0, 20)
        .filter((match) => match.detail.detailStatus !== "enriched");
      let nextCandidateIndex = 0;
      const enrichNext = async (): Promise<void> => {
        while (nextCandidateIndex < enrichmentCandidates.length) {
          const candidate = enrichmentCandidates[nextCandidateIndex++];
          if (!candidate) return;
          let detail: MatchDetail;
          let canonical: CanonicalMatchDetail;
          try {
            canonical = await this.#provider.getMatchDetail(candidate.detail.id);
            if (canonical.id !== candidate.detail.id) {
              throw new Error("Match detail provider returned a different match");
            }
            detail = toEnrichedMatchDetail(canonical, itemIdByName);
          } catch {
            continue;
          }
          await this.#repository.upsertMatch({
            detail,
            importedAt: canonical.source.fetchedAt,
            source: "opendota",
            quality: canonical.quality,
          });
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.min(2, enrichmentCandidates.length) },
          async () => enrichNext(),
        ),
      );
      await this.#repository.upsertPlayerSyncBatch(batch);
      await this.#repository.clearPlayerSyncFailure(job.accountId);
      await this.#repository.upsertPlayer(
        asPlayerProfile(
          job.accountId,
          quality === "complete" ? "public_complete" : "public_partial",
          fetchedProfile,
        ),
      );
      await this.#repository.upsertProviderHealth({
        source: "opendota",
        status: quality === "complete" ? "ready" : "degraded",
        checkedAt: this.#clock().toISOString(),
        message: quality === "complete" ? null : "Latest player sync completed with partial data.",
      });
      await this.#repository.upsertSyncJob({
        ...job,
        status: quality === "complete" ? "public_complete" : "public_partial",
        completedAt: this.#clock().toISOString(),
        errorCode: null,
      });
    } catch (error) {
      const completedAt = this.#clock().toISOString();
      if (error instanceof OpenDotaProviderError) {
        const status = statusForProviderError(error);
        if (error.qualityContext) {
          await this.#repository.upsertPlayerSyncBatch({
            accountId: job.accountId,
            eligibleCount: error.qualityContext.eligibleCount,
            sampleSize:
              error.qualityContext.eligibleCount - error.qualityContext.excludedCount,
            excludedCount: error.qualityContext.excludedCount,
            exclusionReasons: error.qualityContext.exclusionReasons,
            quality: "partial",
            source: "opendota",
            fetchedAt: completedAt,
            candidateLedger: error.qualityContext.candidateLedger,
          });
        }
        await this.#repository.upsertPlayer(
          asPlayerProfile(job.accountId, status, fetchedProfile ?? previousProfile),
        );
        await this.#repository.upsertPlayerSyncFailure({
          accountId: job.accountId,
          source: "opendota",
          checkedAt: completedAt,
          retryAfterSeconds: error.retryAfterSeconds,
        });
        await this.#repository.upsertProviderHealth(providerHealthForError(error, completedAt));
        await this.#repository.upsertSyncJob({
          ...job,
          status,
          completedAt,
          errorCode: errorCodeForStatus(status),
        });
        return;
      }

      await this.#repository.upsertPlayer(
        asPlayerProfile(job.accountId, "failed", fetchedProfile ?? previousProfile),
      );
      await this.#repository.upsertPlayerSyncFailure({
        accountId: job.accountId,
        source: "opendota",
        checkedAt: completedAt,
        retryAfterSeconds: null,
      });
      await this.#repository.upsertProviderHealth({
        source: "opendota",
        status: "degraded",
        checkedAt: completedAt,
        message: "Latest live sync failed inside the API.",
      });
      await this.#repository.upsertSyncJob({
        ...job,
        status: "failed",
        completedAt,
        errorCode: "INTERNAL_ERROR",
      });
    }
  }
}
