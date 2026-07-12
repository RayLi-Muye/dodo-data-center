import type {
  HeroDetail,
  ItemDetail,
  MatchDetail,
  PlayerProfile,
  SyncJob,
} from "@dodo/contracts";
import {
  Dota2OfficialProviderError,
  OpenDotaProviderError,
  type CanonicalHeroAbilitySet,
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
  StaticDataSnapshot,
  StoredMatch,
} from "@dodo/db";
import { createHash } from "node:crypto";

import type { PlayerDataProvider } from "./player-data-provider.js";

export const CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const UPDATE_TTL_MS = 2 * 60 * 60 * 1_000;

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
};

export const contentHash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");

const inferOfficialVersion = (
  startTime: string,
  releases: Array<{ version: string; releasedAt: string }>,
): string | null =>
  releases.find((release) => Date.parse(release.releasedAt) <= Date.parse(startTime))?.version ??
  null;

export const snapshotIsFresh = (
  snapshot: StaticDataSnapshot | undefined,
  now: string,
  ttlMs: number,
): boolean =>
  snapshot !== undefined &&
  Date.parse(now) - Date.parse(snapshot.checkedAt) >= 0 &&
  Date.parse(now) - Date.parse(snapshot.checkedAt) < ttlMs;

export const nextSnapshot = (
  previous: StaticDataSnapshot | undefined,
  source: StaticDataSnapshot["source"],
  quality: DataQuality,
  fetchedAt: string,
  hash: string,
  checkedAt: string,
  officialVersion: string | null,
): StaticDataSnapshot => ({
  source,
  quality,
  fetchedAt,
  checkedAt,
  changedAt: previous?.contentHash === hash ? previous.changedAt : checkedAt,
  contentHash: hash,
  officialVersion,
});

type PlayerSyncServiceOptions = {
  repository: DodoRepository;
  provider: PlayerDataProvider;
  clock?: () => Date;
};

export const toHeroDetail = (
  hero: CanonicalHeroConstant,
  abilitySet: CanonicalHeroAbilitySet | undefined,
  heroFetchedAt: string,
  abilityFetchedAt: string,
  officialVersion: string | null,
): HeroDetail => ({
  ...hero,
  officialVersion,
  facetsStatus: abilitySet?.facetsStatus ?? "unavailable",
  facets: abilitySet?.facets ?? [],
  abilities: abilitySet?.abilities ?? [],
  sourceSnapshot:
    `dota2-official://datafeed/herolist+herodata@${heroFetchedAt};` +
    `dota2-official://datafeed/herodata/abilities@${abilityFetchedAt}`,
});

export const toItemDetails = (
  items: CanonicalItemConstant[],
  fetchedAt: string,
  officialVersion: string | null,
): ItemDetail[] => {
  const idByName = new Map(items.map((item) => [item.name, item.id]));
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    localizedName: item.localizedName,
    cost: item.cost ?? 0,
    category: item.category ?? "unknown",
    kind: item.kind,
    availabilityStatus: item.availabilityStatus,
    officialVersion,
    description: item.description,
    attributes: item.attributes,
    components: item.componentNames.flatMap((name) => {
      const id = idByName.get(name);
      return id === undefined ? [] : [id];
    }),
    sourceSnapshot: `dota2-official://datafeed/itemlist+itemdata@${fetchedAt}`,
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
    neutralItemEnhancementId:
      (player as CanonicalMatchPlayer & { neutralItemEnhancementId?: string | null })
        .neutralItemEnhancementId ?? null,
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
  officialVersion: string | null = null,
): MatchDetail => {
  return {
    id: match.id,
    startTime: match.startTime,
    durationSeconds: match.durationSeconds,
    officialVersion,
    openDotaPatchId: match.patchId,
    officialVersionSource: officialVersion ? "start_time_inferred" : "unavailable",
    gameMode: match.gameMode,
    lobbyType:
      (match as CanonicalPlayerMatch & { lobbyType?: string | null }).lobbyType ?? null,
    region: match.region,
    radiantWin: match.radiantWin,
    players: [toMatchPlayer(match.player, itemIdByName)],
    detailStatus: "summary",
    parseStatus: "unparsed",
    cluster: null,
    radiantScore: null,
    direScore: null,
  };
};

const toEnrichedMatchDetail = (
  match: CanonicalMatchDetail,
  itemIdByName: ReadonlyMap<string, string>,
  officialVersion: string | null,
): MatchDetail => ({
  id: match.id,
  startTime: match.startTime,
  durationSeconds: match.durationSeconds,
  officialVersion,
  openDotaPatchId: match.patchId,
  officialVersionSource: officialVersion ? "start_time_inferred" : "unavailable",
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
      const [recent, itemDetails, patches] = await Promise.all([
        this.#provider.getRecentMatches(job.accountId, 100),
        this.#repository.listItems(),
        this.#repository.listPatches(),
      ]);
      const effectiveVersionReleases = patches.map((patch) => ({
        version: patch.name,
        releasedAt: patch.releasedAt,
      }));
      if (recent.accountId !== job.accountId) {
        throw new Error("Player data provider returned matches for a different account");
      }

      const quality: DataQuality =
        fetchedProfile.status === "public_partial" || recent.quality === "partial"
          ? "partial"
          : "complete";
      const itemIdByName = new Map(itemDetails.map((item) => [item.name, item.id]));
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
          detail: toMatchSummaryDetail(
            match,
            itemIdByName,
            inferOfficialVersion(match.startTime, effectiveVersionReleases),
          ),
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

      const changedMatches = storedMatches.filter((match) => {
        const previous = previousMatches.get(match.detail.id);
        return (
          !previous ||
          contentHash({ detail: previous.detail, source: previous.source, quality: previous.quality }) !==
            contentHash({ detail: match.detail, source: match.source, quality: match.quality })
        );
      });
      await this.#repository.upsertPlayerMatches(job.accountId, changedMatches);
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
            detail = toEnrichedMatchDetail(
              canonical,
              itemIdByName,
              inferOfficialVersion(canonical.startTime, effectiveVersionReleases),
            );
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
      if (error instanceof Dota2OfficialProviderError) {
        const status =
          error.code === "DOTA2_OFFICIAL_RATE_LIMITED"
            ? "source_rate_limited"
            : "source_unavailable";
        await this.#repository.upsertPlayer(
          asPlayerProfile(job.accountId, status, fetchedProfile ?? previousProfile),
        );
        await this.#repository.upsertPlayerSyncFailure({
          accountId: job.accountId,
          source: "dota2_official",
          checkedAt: completedAt,
          retryAfterSeconds: null,
        });
        await this.#repository.upsertSyncJob({
          ...job,
          status,
          completedAt,
          errorCode:
            status === "source_rate_limited"
              ? "SOURCE_RATE_LIMITED"
              : "SOURCE_UNAVAILABLE",
        });
        return;
      }
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
