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
import type { StratzMatchEnrichmentService } from "./stratz-match-enrichment-service.js";

export const CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const UPDATE_TTL_MS = 2 * 60 * 60 * 1_000;
export const PLAYER_SYNC_TTL_MS = 30 * 60 * 1_000;

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
  matchEnrichmentService?: StratzMatchEnrichmentService;
  clock?: () => Date;
};

type PlayerSyncRequestOptions = {
  force?: boolean;
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
  hype: hero.hype ?? "",
  biography: hero.biography ?? "",
  complexity: hero.complexity ?? null,
  baseStats: hero.baseStats ?? null,
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
    neutralItemEnhancementId: neutralItemEnhancementIdFor(player),
    itemTimeline: knownTransactions.map(({ itemKey: _itemKey, ...transaction }) => transaction),
    itemTimelineStatus:
      knownTransactions.length === itemTimeline.length
        ? player.itemTimelineStatus
        : "partial",
  };
};

const neutralItemEnhancementIdFor = (player: CanonicalMatchPlayer): string | null =>
  (player as CanonicalMatchPlayer & { neutralItemEnhancementId?: string | null })
    .neutralItemEnhancementId ?? null;

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
    enrichmentSources: [],
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
  enrichmentSources: [],
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

const hasReadableImportedProfile = (
  profile: PlayerProfile | undefined,
): profile is PlayerProfile =>
  profile !== undefined &&
  profile.importedMatchCount > 0 &&
  (profile.status === "public_complete" || profile.status === "public_partial");

export class PlayerSyncService {
  readonly #repository: DodoRepository;
  readonly #provider: PlayerDataProvider;
  readonly #matchEnrichmentService: StratzMatchEnrichmentService | undefined;
  readonly #clock: () => Date;
  readonly #inFlight = new Map<string, Promise<void>>();
  readonly #requests = new Map<
    string,
    { force: boolean; promise: Promise<SyncJob> }
  >();

  constructor({
    repository,
    provider,
    matchEnrichmentService,
    clock = () => new Date(),
  }: PlayerSyncServiceOptions) {
    this.#repository = repository;
    this.#provider = provider;
    this.#matchEnrichmentService = matchEnrichmentService;
    this.#clock = clock;
  }

  requestSync(
    accountId: string,
    { force = true }: PlayerSyncRequestOptions = {},
  ): Promise<SyncJob> {
    const jobId = `job-${accountId}`;
    const existingRequest = this.#requests.get(jobId);
    if (existingRequest && (!force || existingRequest.force)) {
      return existingRequest.promise;
    }
    const request = (existingRequest?.promise ?? Promise.resolve(undefined))
      .then((existingJob) =>
        existingJob?.status === "syncing"
          ? existingJob
          : this.#requestSync(accountId, force),
      )
      .finally(() => {
        if (this.#requests.get(jobId)?.promise === request) this.#requests.delete(jobId);
      });
    this.#requests.set(jobId, { force, promise: request });
    return request;
  }

  async #requestSync(accountId: string, force: boolean): Promise<SyncJob> {
    const jobId = `job-${accountId}`;
    if (this.#inFlight.has(jobId)) {
      const existing = await this.#repository.getSyncJob(jobId);
      if (!existing) throw new Error(`In-flight sync job ${jobId} is missing`);
      return existing;
    }

    const requestedAt = this.#clock().toISOString();
    const [previousProfile, previousBatch, previousJob] = await Promise.all([
      this.#repository.getPlayer(accountId),
      force ? Promise.resolve(undefined) : this.#repository.getPlayerSyncBatch(accountId),
      force ? Promise.resolve(undefined) : this.#repository.getSyncJob(jobId),
    ]);
    const hasFreshReadableData =
      !force &&
      previousProfile !== undefined &&
      (previousProfile.status === "public_complete" ||
        previousProfile.status === "public_partial") &&
      previousBatch !== undefined &&
      Date.parse(requestedAt) - Date.parse(previousBatch.fetchedAt) >= 0 &&
      Date.parse(requestedAt) - Date.parse(previousBatch.fetchedAt) < PLAYER_SYNC_TTL_MS;
    if (hasFreshReadableData) {
      if (
        previousJob?.status === "public_complete" ||
        previousJob?.status === "public_partial"
      ) {
        return previousJob;
      }
      return {
        jobId,
        accountId,
        status: previousProfile.status,
        requestedAt: previousBatch.fetchedAt,
        completedAt: previousBatch.fetchedAt,
        errorCode: null,
      };
    }
    const job: SyncJob = {
      jobId,
      accountId,
      status: "syncing",
      requestedAt,
      completedAt: null,
      errorCode: null,
    };
    await this.#repository.upsertSyncJob(job);
    if (!hasReadableImportedProfile(previousProfile)) {
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
    await Promise.all([...this.#requests.values()].map(({ promise }) => promise));
    await Promise.all(this.#inFlight.values());
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
      const latestMatches = storedMatches.slice(0, 20);
      const legacyEnrichedIds = new Set(
        await this.#repository.listMatchIdsMissingNeutralItemEnhancement(
          latestMatches.map((match) => match.detail.id),
        ),
      );
      const enrichmentCandidates = latestMatches.filter(
        (match) =>
          match.detail.detailStatus !== "enriched" || legacyEnrichedIds.has(match.detail.id),
      );
      let nextCandidateIndex = 0;
      const enrichNext = async (): Promise<void> => {
        while (nextCandidateIndex < enrichmentCandidates.length) {
          const candidate = enrichmentCandidates[nextCandidateIndex++];
          if (!candidate) return;
          let enrichedMatch: StoredMatch;
          try {
            const canonical = await this.#provider.getMatchDetail(candidate.detail.id);
            if (canonical.id !== candidate.detail.id) {
              throw new Error("Match detail provider returned a different match");
            }
            const isLegacyEnriched =
              candidate.detail.detailStatus === "enriched" &&
              legacyEnrichedIds.has(candidate.detail.id);
            if (isLegacyEnriched) {
              const refreshedPlayers = new Map(
                canonical.players.map((player) => [player.playerSlot, player]),
              );
              if (
                candidate.detail.players.some(
                  (player) => !refreshedPlayers.has(player.playerSlot),
                )
              ) {
                continue;
              }
              enrichedMatch = {
                ...candidate,
                detail: {
                  ...candidate.detail,
                  players: candidate.detail.players.map((player) => ({
                    ...player,
                    neutralItemEnhancementId:
                      player.neutralItemEnhancementId ??
                      neutralItemEnhancementIdFor(refreshedPlayers.get(player.playerSlot)!),
                  })),
                },
              };
            } else {
              enrichedMatch = {
                detail: toEnrichedMatchDetail(
                  canonical,
                  itemIdByName,
                  inferOfficialVersion(canonical.startTime, effectiveVersionReleases),
                ),
                importedAt: canonical.source.fetchedAt,
                source: "opendota",
                quality: canonical.quality,
              };
            }
          } catch {
            continue;
          }
          await this.#repository.upsertMatch(enrichedMatch);
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.min(2, enrichmentCandidates.length) },
          async () => enrichNext(),
        ),
      );
      if (this.#matchEnrichmentService) {
        const refreshedLatest = await Promise.all(
          latestMatches.map((match) => this.#repository.getMatch(match.detail.id)),
        );
        const stratzCandidates = refreshedLatest.flatMap((match) =>
          match?.detail.detailStatus === "enriched" &&
            !match.detail.enrichmentSources.includes("stratz") &&
            match.detail.players.some(
              (player) =>
                player.abilityBuildStatus === "unavailable" ||
                player.itemTimelineStatus !== "complete",
            )
            ? [match]
            : [],
        );
        for (let index = 0; index < stratzCandidates.length; index += 2) {
          const outcomes = await Promise.all(
            stratzCandidates.slice(index, index + 2).map(async (match) => {
              try {
                return await this.#matchEnrichmentService!.enrichMatch(match.detail.id);
              } catch {
                // STRATZ is optional enrichment; OpenDota data remains the readable fallback.
                return null;
              }
            }),
          );
          if (outcomes.some((outcome) => outcome?.stopBatch)) break;
        }
      }
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
        if (!hasReadableImportedProfile(previousProfile)) {
          await this.#repository.upsertPlayer(
            asPlayerProfile(job.accountId, status, fetchedProfile ?? previousProfile),
          );
        }
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
        if (error.qualityContext && !hasReadableImportedProfile(previousProfile)) {
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
        const transientFailure =
          status === "source_rate_limited" ||
          status === "source_unavailable" ||
          status === "parse_pending";
        if (!hasReadableImportedProfile(previousProfile) || !transientFailure) {
          await this.#repository.upsertPlayer(
            asPlayerProfile(job.accountId, status, fetchedProfile ?? previousProfile),
          );
        }
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

      if (!hasReadableImportedProfile(previousProfile)) {
        await this.#repository.upsertPlayer(
          asPlayerProfile(job.accountId, "failed", fetchedProfile ?? previousProfile),
        );
      }
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
