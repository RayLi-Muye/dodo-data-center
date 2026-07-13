import {
  accountIdParamsSchema,
  accountReferenceSchema,
  encyclopediaListQuerySchema,
  entityUpdatesQuerySchema,
  heroIdParamsSchema,
  identifierSchema,
  itemIdParamsSchema,
  mapFeaturesQuerySchema,
  matchIdParamsSchema,
  paginationQuerySchema,
  playerHeroesQuerySchema,
  playerEnrichmentQuerySchema,
  playerMatchesQuerySchema,
  playerSyncRequestSchema,
  playerWindowQuerySchema,
  syncJobParamsSchema,
} from "@dodo/contracts";
import type {
  ApiError,
  ErrorMeta,
  ItemDetail,
  ItemSummary,
  MapFeature,
  MapVersion,
  OperationMeta,
  PlayerHeroStats,
  MatchEnrichmentScope,
  PlayerHistorySync,
  PlayerProfile,
  SyncJob,
} from "@dodo/contracts";
import {
  SEED_UPDATED_AT,
  MapAuditError,
  mapSnapshotIsConsistent,
  parseAuditedMapPayload,
  type DodoRepository,
  type PlayerSyncBatch,
  type StaticDataSnapshot,
  type StoredMatch,
} from "@dodo/db";
import { OpenDotaProviderError } from "@dodo/dota-data";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import {
  canonicalizeAccountId,
  resolveAccountReference,
} from "./account-resolution.js";
import type { DataMode } from "./data-mode.js";
import { ApiHttpError } from "./errors.js";
import {
  calculateHeroList,
  calculateHeroStats,
  calculateOverview,
  selectWindow,
  toHeroSummary,
  toMatchSummary,
} from "./metrics.js";
import {
  createErrorMeta,
  createMetricMeta,
  createOperationMeta,
  type MetaDescriptor,
} from "./meta.js";
import type { PlayerSyncService } from "./player-sync-service.js";
import type { PlayerHistorySyncService } from "./player-history-sync-service.js";
import type { MatchEnrichmentOrchestrator } from "./match-enrichment-orchestrator.js";

const detailQuerySchema = z.object({ patch: z.string().trim().max(32).optional() });
const mapVersionParamsSchema = z.object({ mapVersionId: identifierSchema });
const updateVersionParamsSchema = z.object({ version: identifierSchema });

const parse = <T extends z.ZodType>(
  schema: T,
  input: unknown,
  errorMeta: ErrorMeta = createErrorMeta(),
): z.output<T> => {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ApiHttpError(
      400,
      "VALIDATION_ERROR",
      "Request validation failed.",
      false,
      errorMeta,
    );
  }
  return result.data;
};

const parseAccountId = (input: unknown, errorMeta: ErrorMeta = createErrorMeta()): string => {
  const result = accountIdParamsSchema.safeParse(input);
  if (!result.success) {
    throw new ApiHttpError(
      400,
      "INVALID_ACCOUNT_ID",
      "Dota account ID must contain 1 to 10 digits.",
      false,
      errorMeta,
    );
  }
  return canonicalizeAccountId(result.data.accountId, errorMeta);
};

const canonicalizeSyncJobId = (jobId: string, errorMeta: ErrorMeta): string => {
  const match = /^job-(\d+)$/.exec(jobId);
  return match?.[1] ? `job-${canonicalizeAccountId(match[1], errorMeta)}` : jobId;
};

const profileStatusError = async (
  profile: PlayerProfile,
  errorMeta: (
    status: PlayerProfile["status"],
    retryAfterSeconds: number | null,
  ) => Promise<ErrorMeta>,
  retryAfterSeconds: number | null,
): Promise<ApiHttpError | undefined> => {
  const { status } = profile;
  const common = async (
    statusCode: number,
    code: ApiError["error"]["code"],
    retryable = false,
  ) =>
    new ApiHttpError(
      statusCode,
      code,
      `Player data is unavailable: ${status}.`,
      retryable,
      await errorMeta(status, status === "source_rate_limited" ? retryAfterSeconds : null),
    );

  switch (status) {
    case "public_complete":
    case "public_partial":
      return undefined;
    case "history_private":
      return common(403, "HISTORY_PRIVATE");
    case "profile_private":
      return common(403, "PROFILE_PRIVATE");
    case "not_found":
      return common(404, "NOT_FOUND");
    case "source_rate_limited":
      return common(429, "SOURCE_RATE_LIMITED", true);
    case "source_unavailable":
      return common(503, "SOURCE_UNAVAILABLE", true);
    case "syncing":
      return common(409, "SYNC_IN_PROGRESS", true);
    case "parse_pending":
      return common(409, "PARSE_PENDING", true);
    case "failed":
      return common(500, "INTERNAL_ERROR");
  }
};

const getAccessiblePlayer = async (
  repository: DodoRepository,
  accountId: string,
  notFoundMeta: ErrorMeta,
  statusMeta: (
    status: PlayerProfile["status"],
    retryAfterSeconds: number | null,
  ) => Promise<ErrorMeta>,
  notFoundMessage = "Player was not found in the imported dataset.",
): Promise<PlayerProfile> => {
  const profile = await repository.getPlayer(accountId);
  if (!profile) {
    throw new ApiHttpError(
      404,
      "NOT_FOUND",
      notFoundMessage,
      false,
      notFoundMeta,
    );
  }
  const retryAfterSeconds =
    (await repository.getPlayerSyncFailure(accountId))?.retryAfterSeconds ?? null;
  const statusError = await profileStatusError(
    profile,
    statusMeta,
    retryAfterSeconds,
  );
  if (statusError) throw statusError;
  return profile;
};

const encodeCursor = (id: string): string =>
  Buffer.from(`v1:${id}`, "utf8").toString("base64url");

const decodeCursor = (cursor: string, errorMeta: ErrorMeta): string => {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  if (!decoded.startsWith("v1:") || encodeCursor(decoded.slice(3)) !== cursor) {
    throw new ApiHttpError(
      400,
      "VALIDATION_ERROR",
      "Cursor is invalid for this collection.",
      false,
      errorMeta,
    );
  }
  return decoded.slice(3);
};

const paginate = <T>(
  items: T[],
  limit: number,
  cursor: string | undefined,
  getId: (item: T) => string,
  errorMeta: ErrorMeta = createErrorMeta(),
): { items: T[]; nextCursor: string | null } => {
  let start = 0;
  if (cursor) {
    const cursorId = decodeCursor(cursor, errorMeta);
    const cursorIndex = items.findIndex((item) => getId(item) === cursorId);
    if (cursorIndex < 0) {
      throw new ApiHttpError(
        400,
        "VALIDATION_ERROR",
        "Cursor is invalid for this collection.",
        false,
        errorMeta,
      );
    }
    start = cursorIndex + 1;
  }

  const pageItems = items.slice(start, start + limit);
  const last = pageItems.at(-1);
  const nextCursor =
    last && start + pageItems.length < items.length ? encodeCursor(getId(last)) : null;
  return { items: pageItems, nextCursor };
};

const utcDateBoundary = (
  date: string,
  endOfDay: boolean,
  errorMeta: ErrorMeta,
): number => {
  const timestamp = Date.parse(`${date}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) {
    throw new ApiHttpError(
      400,
      "VALIDATION_ERROR",
      "Date filters must be valid UTC calendar dates.",
      false,
      errorMeta,
    );
  }
  return timestamp;
};

const targetMatchPlayer = (match: StoredMatch, accountId: string) => {
  const player = match.detail.players.find((candidate) => candidate.accountId === accountId);
  if (!player) throw new Error(`Repository invariant failed for match ${match.detail.id}`);
  return player;
};

const filterPlayerMatches = (
  matches: StoredMatch[],
  accountId: string,
  query: z.output<typeof playerMatchesQuerySchema>,
  errorMeta: ErrorMeta,
): StoredMatch[] => {
  const dateFrom = query.dateFrom
    ? utcDateBoundary(query.dateFrom, false, errorMeta)
    : undefined;
  const dateTo = query.dateTo ? utcDateBoundary(query.dateTo, true, errorMeta) : undefined;

  return matches
    .filter((match) => {
      const player = targetMatchPlayer(match, accountId);
      const startedAt = Date.parse(match.detail.startTime);
      return (
        (!query.heroId || player.heroId === query.heroId) &&
        (!query.patch || match.detail.officialVersion === query.patch) &&
        (!query.outcome || (query.outcome === "win" ? player.isWin : !player.isWin)) &&
        (!query.gameMode || match.detail.gameMode === query.gameMode) &&
        (!query.lobbyType || match.detail.lobbyType === query.lobbyType) &&
        (dateFrom === undefined || startedAt >= dateFrom) &&
        (dateTo === undefined || startedAt <= dateTo)
      );
    })
    .sort(
      (left, right) =>
        Date.parse(right.detail.startTime) - Date.parse(left.detail.startTime) ||
        right.detail.id.localeCompare(left.detail.id),
    );
};

const toItemSummary = (item: ItemDetail): ItemSummary => ({
  id: item.id,
  name: item.name,
  localizedName: item.localizedName,
  cost: item.cost,
  category: item.category,
  kind: item.kind,
  availabilityStatus: item.availabilityStatus,
  officialVersion: item.officialVersion,
});

const itemNameOrder = <T extends { localizedName: string; id: string }>(left: T, right: T) =>
  left.localizedName.localeCompare(right.localizedName) || left.id.localeCompare(right.id);

const syncErrorCode = (status: PlayerProfile["status"]): string | null => {
  const codeByStatus: Partial<Record<PlayerProfile["status"], ApiError["error"]["code"]>> = {
    history_private: "HISTORY_PRIVATE",
    profile_private: "PROFILE_PRIVATE",
    not_found: "NOT_FOUND",
    source_rate_limited: "SOURCE_RATE_LIMITED",
    source_unavailable: "SOURCE_UNAVAILABLE",
    parse_pending: "PARSE_PENDING",
    failed: "INTERNAL_ERROR",
  };
  return codeByStatus[status] ?? null;
};

type RegisterRoutesOptions = {
  dataMode: DataMode;
  syncService?: PlayerSyncService;
  historySyncService?: PlayerHistorySyncService;
  matchEnrichmentOrchestrator?: MatchEnrichmentOrchestrator;
};

const qualityForProviderStatus = (
  status: "ready" | "degraded" | "unavailable",
): OperationMeta["quality"] =>
  status === "ready" ? "complete" : status === "degraded" ? "partial" : "stale";

const descriptorFromBatch = (batch: PlayerSyncBatch): MetaDescriptor => ({
  updatedAt: batch.fetchedAt,
  sources: [batch.source],
  quality: batch.quality,
});

const descriptorFromSnapshot = (snapshot: StaticDataSnapshot): MetaDescriptor => ({
  updatedAt: snapshot.checkedAt,
  sources: [snapshot.source],
  quality: snapshot.quality,
});

const descriptorFromMatch = (match: StoredMatch): MetaDescriptor => ({
  updatedAt: match.importedAt,
  sources: [...new Set([match.source, ...match.detail.enrichmentSources])],
  quality: match.quality,
});

const descriptorWithMatchSources = (
  descriptor: MetaDescriptor,
  matches: StoredMatch[],
): MetaDescriptor => ({
  ...descriptor,
  updatedAt: matches.reduce(
    (latest, match) => match.importedAt > latest ? match.importedAt : latest,
    descriptor.updatedAt,
  ),
  sources: [
    ...new Set([
      ...descriptor.sources,
      ...matches.flatMap((match) => match.detail.enrichmentSources),
    ]),
  ],
});

const inferStoredMatchVersion = (
  match: StoredMatch,
  releases: Array<{ version: string; releasedAt: string }>,
): StoredMatch => {
  if (match.detail.officialVersion !== null) return match;
  const release = releases.find(
    (candidate) => Date.parse(candidate.releasedAt) <= Date.parse(match.detail.startTime),
  );
  if (!release) return match;
  return {
    ...match,
    detail: {
      ...match.detail,
      officialVersion: release.version,
      officialVersionSource: "start_time_inferred",
    },
  };
};

type MetricWindow = PlayerHeroStats["window"];

const batchWindow = (batch: PlayerSyncBatch, window: MetricWindow) => {
  const limit =
    window === "last_20" ? 20 : window === "last_50" ? 50 : window === "last_100" ? 100 : undefined;
  const ledger = limit === undefined ? batch.candidateLedger : batch.candidateLedger.slice(0, limit);
  const includedMatchIds = ledger.flatMap((entry) =>
    entry.status === "included" ? [entry.matchId] : [],
  );
  const excludedEntries = ledger.filter((entry) => entry.status === "excluded");
  return {
    includedMatchIds,
    eligibleCount: ledger.length,
    sampleSize: includedMatchIds.length,
    excludedCount: excludedEntries.length,
    exclusionReasons: [
      ...new Set(excludedEntries.flatMap((entry) => entry.exclusionReasons)),
    ].sort(),
  };
};

const selectPlayerWindow = (
  matches: StoredMatch[],
  batch: PlayerSyncBatch | undefined,
  window: MetricWindow,
  patch?: string,
): StoredMatch[] => {
  const patchMatches = patch
    ? matches.filter((match) => match.detail.officialVersion === patch)
    : matches;
  if (patch || window === "all_imported") return selectWindow(patchMatches, window);
  if (!batch) return selectWindow(matches, window);
  const includedMatchIds = new Set(batchWindow(batch, window).includedMatchIds);
  return matches.filter((match) => includedMatchIds.has(match.detail.id));
};

const selectionQuality = (
  selectedMatches: StoredMatch[],
  batch: PlayerSyncBatch | undefined,
  window: MetricWindow,
  patch?: string,
) => {
  if (!batch || patch || window === "all_imported") {
    return {
      sampleSize: selectedMatches.length,
      eligibleCount: selectedMatches.length,
      excludedCount: 0,
      exclusionReasons: [] as string[],
    };
  }
  return batchWindow(batch, window);
};

export const registerRoutes = async (
  app: FastifyInstance,
  repository: DodoRepository,
  {
    dataMode,
    syncService,
    historySyncService,
    matchEnrichmentOrchestrator,
  }: RegisterRoutesOptions,
): Promise<void> => {
  const listVersionedMatches = async (accountId: string): Promise<StoredMatch[]> => {
    const [matches, patches] = await Promise.all([
      repository.listPlayerMatches(accountId),
      repository.listPatches(),
    ]);
    const releases = patches.map((patch) => ({
      version: patch.name,
      releasedAt: patch.releasedAt,
    }));
    return matches.map((match) => inferStoredMatchVersion(match, releases));
  };
  const defaultDescriptor = async (): Promise<MetaDescriptor> => {
    if (dataMode === "seed") {
      return { updatedAt: SEED_UPDATED_AT, sources: ["seed"], quality: "complete" };
    }
    const health = await repository.getProviderHealth("opendota");
    return health
      ? {
          updatedAt: health.checkedAt,
          sources: [health.source],
          quality: qualityForProviderStatus(health.status),
        }
      : { updatedAt: new Date(0).toISOString(), sources: ["opendota"], quality: "partial" };
  };
  const defaultErrorMeta = async (
    status?: PlayerProfile["status"],
    retryAfterSeconds: number | null = null,
  ) => createErrorMeta(status, retryAfterSeconds, await defaultDescriptor());
  const staticUnavailableError = (resource: string, snapshot?: StaticDataSnapshot) =>
    new ApiHttpError(
      503,
      "SOURCE_UNAVAILABLE",
      snapshot
        ? `${resource} catalog snapshot is partial and cannot confirm absence.`
        : `${resource} catalog has not completed an official snapshot yet.`,
      true,
      createErrorMeta(
        "source_unavailable",
        null,
        snapshot
          ? descriptorFromSnapshot(snapshot)
          : {
              updatedAt: new Date(0).toISOString(),
              sources: ["dota2_official"],
              quality: "partial",
            },
      ),
    );
  const entityUpdatesResponse = async (
    resource: "Hero" | "Item",
    entityExists: boolean,
    entitySnapshot: StaticDataSnapshot | undefined,
    entityId: string,
    kinds: Array<"hero" | "item" | "neutral_item">,
    query: z.output<typeof entityUpdatesQuerySchema>,
    errorMeta: ErrorMeta,
  ) => {
    if (!entitySnapshot) throw staticUnavailableError(resource);
    if (!entityExists) {
      if (entitySnapshot.quality === "partial") {
        throw staticUnavailableError(resource, entitySnapshot);
      }
      throw new ApiHttpError(
        404,
        "NOT_FOUND",
        `${resource} was not found.`,
        false,
        createErrorMeta("not_found", null, descriptorFromSnapshot(entitySnapshot)),
      );
    }

    const [releases, updateSnapshot, allReleases] = await Promise.all([
      repository.listEntityUpdateReleases(kinds, entityId),
      repository.getUpdateSnapshot(),
      repository.listUpdateReleases(),
    ]);
    if (!updateSnapshot || (updateSnapshot.quality === "partial" && allReleases.length === 0)) {
      throw staticUnavailableError("Update", updateSnapshot);
    }
    return {
      data: paginate(
        releases,
        query.limit,
        query.cursor,
        (release) => release.version,
        errorMeta,
      ),
      meta: createOperationMeta(descriptorFromSnapshot(updateSnapshot)),
    };
  };
  const playerDescriptor = async (accountId: string): Promise<MetaDescriptor> => {
    const [batch, failure, job, profile] = await Promise.all([
      repository.getPlayerSyncBatch(accountId),
      repository.getPlayerSyncFailure(accountId),
      repository.getSyncJob(`job-${accountId}`),
      repository.getPlayer(accountId),
    ]);
    if (!batch) {
      const descriptor = await defaultDescriptor();
      return profile?.status === "public_partial"
        ? { ...descriptor, quality: "partial" }
        : descriptor;
    }
    const failedAfterBatch =
      failure !== undefined &&
      Date.parse(failure.checkedAt) >= Date.parse(batch.fetchedAt) &&
      job !== undefined &&
      job.status !== "syncing" &&
      job.status !== "public_complete" &&
      job.status !== "public_partial";
    if (!failedAfterBatch) return descriptorFromBatch(batch);
    return {
      updatedAt: failure.checkedAt,
      sources: [failure.source],
      quality:
        job.status === "source_unavailable" || job.status === "failed"
          ? "stale"
          : "partial",
    };
  };
  const playerErrorMeta = async (
    accountId: string,
    status: PlayerProfile["status"],
    retryAfterSeconds: number | null,
  ) => {
    const failure = await repository.getPlayerSyncFailure(accountId);
    return createErrorMeta(
      status,
      retryAfterSeconds,
      failure
        ? {
            updatedAt: failure.checkedAt,
            sources: [failure.source],
            quality: status === "source_unavailable" ? "stale" : "partial",
          }
        : await playerDescriptor(accountId),
    );
  };
  const accessiblePlayer = async (accountId: string): Promise<PlayerProfile> =>
    getAccessiblePlayer(
      repository,
      accountId,
      await defaultErrorMeta("not_found"),
      (status, retryAfterSeconds) => playerErrorMeta(accountId, status, retryAfterSeconds),
    );
  const historyAccessiblePlayer = async (accountId: string): Promise<PlayerProfile> => {
    const profile = await repository.getPlayer(accountId);
    if (profile?.status === "syncing" && profile.importedMatchCount > 0) return profile;
    return accessiblePlayer(accountId);
  };
  const requireMatchEnrichment = async (): Promise<MatchEnrichmentOrchestrator> => {
    if (matchEnrichmentOrchestrator) return matchEnrichmentOrchestrator;
    throw new ApiHttpError(
      503,
      "SOURCE_UNAVAILABLE",
      "Match enrichment is unavailable in this data mode.",
      true,
      await defaultErrorMeta("source_unavailable"),
    );
  };
  const enrichmentResponse = async (
    accountId: string,
    scope: MatchEnrichmentScope,
    snapshot: Awaited<ReturnType<MatchEnrichmentOrchestrator["getProgress"]>>,
  ) => {
    const total = snapshot.progress.totalMatches;
    const descriptor = await playerDescriptor(accountId);
    return {
      data: snapshot.progress,
      meta: createMetricMeta({
        sampleSize: total,
        eligibleCount: total,
        coverageRate: total === 0 ? 1 : snapshot.progress.completeCount / total,
        filtersApplied: { scope },
        inputWatermark: null,
        quality: total === snapshot.progress.completeCount ? "complete" : "partial",
        updatedAt: snapshot.progress.updatedAt ?? descriptor.updatedAt,
        sources: snapshot.sources,
        metricVersion: "match-enrichment-v1",
      }),
    };
  };

  app.post("/v1/account-resolutions", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const reference = parse(accountReferenceSchema, request.body, errorMeta);
    return {
      data: resolveAccountReference(reference, errorMeta),
      meta: createOperationMeta(await defaultDescriptor()),
    };
  });

  app.post("/v1/players/:accountId/sync", async (request, reply) => {
    const errorMeta = await defaultErrorMeta();
    const accountId = parseAccountId(request.params, errorMeta);
    const { trigger } = parse(playerSyncRequestSchema, request.body, errorMeta);
    if (dataMode === "live") {
      if (!syncService) throw new Error("Live data mode requires a player sync service");
      const job = await syncService.requestSync(accountId, {
        force: trigger === "manual",
      });
      return reply.code(202).send({
        data: job,
        meta: createOperationMeta({
          updatedAt: job.requestedAt,
          sources: ["opendota"],
          quality: "partial",
        }),
      });
    }

    const profile = await repository.getPlayer(accountId);
    const status = profile?.status ?? "not_found";
    const job: SyncJob = {
      jobId: `job-${accountId}`,
      accountId,
      status,
      requestedAt: SEED_UPDATED_AT,
      completedAt: status === "syncing" ? null : SEED_UPDATED_AT,
      errorCode: syncErrorCode(status),
    };
    await repository.upsertSyncJob(job);
    return reply.code(202).send({
      data: job,
      meta: createOperationMeta(await defaultDescriptor()),
    });
  });

  app.get("/v1/players/:accountId/history-sync", async (request) => {
    const accountId = parseAccountId(request.params, await defaultErrorMeta());
    const profile = await historyAccessiblePlayer(accountId);
    const state = historySyncService
      ? await historySyncService.getState(accountId)
      : ((await repository.getPlayerHistorySync(accountId)) ?? {
          accountId,
          status: "idle",
          nextOffset: 0,
          pageSize: 100,
          pagesImported: 0,
          matchesImported: 0,
          oldestImportedAt: null,
          reachedEnd: false,
          requestedAt: null,
          updatedAt: profile.latestImportedAt ?? new Date(0).toISOString(),
          errorCode: null,
        } satisfies PlayerHistorySync);
    return {
      data: state,
      meta: createOperationMeta({
        updatedAt: state.updatedAt,
        sources: ["opendota"],
        quality: state.status === "complete" ? "complete" : "partial",
      }),
    };
  });

  app.post("/v1/players/:accountId/history-sync", async (request, reply) => {
    const accountId = parseAccountId(request.params, await defaultErrorMeta());
    await historyAccessiblePlayer(accountId);
    if (!historySyncService) {
      throw new ApiHttpError(
        503,
        "SOURCE_UNAVAILABLE",
        "History import is unavailable in this data mode.",
        true,
        await defaultErrorMeta("source_unavailable"),
      );
    }
    const state = await historySyncService.requestSync(accountId);
    return reply.code(202).send({
      data: state,
      meta: createOperationMeta({
        updatedAt: state.updatedAt,
        sources: ["opendota"],
        quality: "partial",
      }),
    });
  });

  app.get("/v1/players/:accountId/enrichment", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const accountId = parseAccountId(request.params, errorMeta);
    await accessiblePlayer(accountId);
    const { scope } = parse(playerEnrichmentQuerySchema, request.query, errorMeta);
    const service = await requireMatchEnrichment();
    return enrichmentResponse(accountId, scope, await service.getProgress(accountId, scope));
  });

  app.post("/v1/players/:accountId/enrichment", async (request, reply) => {
    const errorMeta = await defaultErrorMeta();
    const accountId = parseAccountId(request.params, errorMeta);
    await accessiblePlayer(accountId);
    const { scope } = parse(playerEnrichmentQuerySchema, request.query, errorMeta);
    const service = await requireMatchEnrichment();
    const response = await enrichmentResponse(
      accountId,
      scope,
      await service.requestPlayerEnrichment(accountId, scope),
    );
    return reply.code(202).send(response);
  });

  app.get("/v1/sync-jobs/:jobId", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const { jobId } = parse(syncJobParamsSchema, request.params, errorMeta);
    const job = await repository.getSyncJob(canonicalizeSyncJobId(jobId, errorMeta));
    if (!job) {
      throw new ApiHttpError(
        404,
        "NOT_FOUND",
        "Sync job was not found.",
        false,
        await defaultErrorMeta("not_found"),
      );
    }
    const descriptor: Partial<MetaDescriptor> =
      dataMode === "seed"
        ? {}
        : {
            updatedAt: job.completedAt ?? job.requestedAt,
            sources: ["opendota"],
            quality:
              job.status === "public_complete"
                ? "complete"
                : job.status === "source_unavailable"
                  ? "stale"
                  : "partial",
          };
    return { data: job, meta: createOperationMeta(descriptor) };
  });

  app.get("/v1/players/:accountId", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const accountId = parseAccountId(request.params, errorMeta);
    const query = parse(playerWindowQuerySchema, request.query, errorMeta);
    const profile = await accessiblePlayer(accountId);
    const matches = await listVersionedMatches(accountId);
    const batch = await repository.getPlayerSyncBatch(accountId);
    const selectedMatches = selectPlayerWindow(matches, batch, query.window, query.patch);
    const data = calculateOverview(
      profile,
      selectedMatches,
      await repository.listHeroes(),
      query.window,
    );
    const qualityWindow = selectionQuality(
      selectedMatches,
      batch,
      query.window,
      query.patch,
    );
    const descriptor = descriptorWithMatchSources(
      await playerDescriptor(accountId),
      selectedMatches,
    );
    return {
      data,
      meta: createMetricMeta({
        sampleSize: qualityWindow.sampleSize,
        eligibleCount: qualityWindow.eligibleCount,
        coverageRate:
          qualityWindow.eligibleCount === 0
            ? 1
            : qualityWindow.sampleSize / qualityWindow.eligibleCount,
        excludedCount: qualityWindow.excludedCount,
        exclusionReasons: qualityWindow.exclusionReasons,
        filtersApplied: { window: query.window, patch: query.patch ?? null },
        inputWatermark: selectedMatches[0]?.detail.startTime ?? null,
        quality: descriptor.quality,
        updatedAt: descriptor.updatedAt,
        sources: descriptor.sources,
        metricVersion: dataMode === "live" ? "player-v1" : "seed-v1",
      }),
    };
  });

  app.get("/v1/players/:accountId/matches", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const accountId = parseAccountId(request.params, errorMeta);
    await accessiblePlayer(accountId);
    const query = parse(playerMatchesQuerySchema, request.query, errorMeta);
    const batch = await repository.getPlayerSyncBatch(accountId);
    const selectedMatches = selectWindow(
      filterPlayerMatches(
        await listVersionedMatches(accountId),
        accountId,
        query,
        errorMeta,
      ),
      query.window,
    );
    const page = paginate(
      selectedMatches,
      query.limit,
      query.cursor,
      (match) => match.detail.id,
      errorMeta,
    );
    const descriptor = descriptorWithMatchSources(
      await playerDescriptor(accountId),
      page.items,
    );
    return {
      data: {
        items: page.items.map((match) => toMatchSummary(match.detail, accountId)),
        nextCursor: page.nextCursor,
      },
      meta: {
        ...createOperationMeta({
          ...descriptor,
        }),
        filtersApplied: {
          window: query.window,
          patch: query.patch ?? null,
          heroId: query.heroId ?? null,
          outcome: query.outcome ?? null,
          gameMode: query.gameMode ?? null,
          lobbyType: query.lobbyType ?? null,
          dateFrom: query.dateFrom ?? null,
          dateTo: query.dateTo ?? null,
        },
      },
    };
  });

  app.get("/v1/players/:accountId/heroes", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const accountId = parseAccountId(request.params, errorMeta);
    await accessiblePlayer(accountId);
    const query = parse(playerHeroesQuerySchema, request.query, errorMeta);
    const matches = await listVersionedMatches(accountId);
    const batch = await repository.getPlayerSyncBatch(accountId);
    const selectedMatches = selectPlayerWindow(matches, batch, query.window, query.patch);
    const heroStats = calculateHeroList(
      accountId,
      selectedMatches,
      await repository.listHeroes(),
      query.window,
    );
    const qualityWindow = selectionQuality(
      selectedMatches,
      batch,
      query.window,
      query.patch,
    );
    const descriptor = descriptorWithMatchSources(
      await playerDescriptor(accountId),
      selectedMatches,
    );
    const sampleSize = qualityWindow.sampleSize;
    const eligibleCount = qualityWindow.eligibleCount;
    return {
      data: paginate(heroStats, query.limit, query.cursor, (stats) => stats.hero.id, errorMeta),
      meta: createMetricMeta({
        sampleSize,
        eligibleCount,
        coverageRate: eligibleCount === 0 ? 1 : sampleSize / eligibleCount,
        excludedCount: qualityWindow.excludedCount,
        exclusionReasons: qualityWindow.exclusionReasons,
        filtersApplied: { window: query.window, patch: query.patch ?? null },
        inputWatermark: selectedMatches[0]?.detail.startTime ?? null,
        quality: descriptor.quality,
        updatedAt: descriptor.updatedAt,
        sources: descriptor.sources,
        metricVersion: dataMode === "live" ? "player-hero-v1" : "seed-v1",
      }),
    };
  });

  app.get("/v1/players/:accountId/heroes/:heroId", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const accountId = parseAccountId(request.params, errorMeta);
    const { heroId } = parse(heroIdParamsSchema, request.params, errorMeta);
    const { window, patch } = parse(playerWindowQuerySchema, request.query, errorMeta);
    await accessiblePlayer(accountId);
    const hero = await repository.getHero(heroId);
    if (!hero) {
      throw new ApiHttpError(404, "NOT_FOUND", "Hero was not found.", false, errorMeta);
    }
    const selectedMatches = selectPlayerWindow(
      await listVersionedMatches(accountId),
      await repository.getPlayerSyncBatch(accountId),
      window,
      patch,
    );
    const stats = calculateHeroStats(
      accountId,
      selectedMatches,
      hero,
      window,
      selectedMatches.length,
    );
    if (stats.games === 0) {
      throw new ApiHttpError(
        404,
        "NOT_FOUND",
        "Player has no eligible imported matches for this hero and window.",
        false,
        errorMeta,
      );
    }
    const descriptor = descriptorWithMatchSources(
      await playerDescriptor(accountId),
      selectedMatches,
    );
    return {
      data: stats,
      meta: createMetricMeta({
        sampleSize: stats.games,
        inputWatermark:
          selectedMatches.find((match) =>
            match.detail.players.some(
              (player) => player.accountId === accountId && player.heroId === heroId,
            ),
          )?.detail.startTime ?? null,
        filtersApplied: { window, patch: patch ?? null, heroId },
        quality: descriptor.quality,
        updatedAt: descriptor.updatedAt,
        sources: descriptor.sources,
        metricVersion: dataMode === "live" ? "player-hero-v1" : "seed-v1",
      }),
    };
  });

  app.get("/v1/matches/:matchId", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const { matchId } = parse(matchIdParamsSchema, request.params, errorMeta);
    const storedMatch = await repository.getMatch(matchId);
    const patches = storedMatch ? await repository.listPatches() : [];
    const match = storedMatch
      ? inferStoredMatchVersion(
          storedMatch,
          patches.map((patch) => ({ version: patch.name, releasedAt: patch.releasedAt })),
        )
      : undefined;
    if (!match) {
      throw new ApiHttpError(404, "NOT_FOUND", "Match was not found.", false, errorMeta);
    }
    return { data: match.detail, meta: createOperationMeta(descriptorFromMatch(match)) };
  });

  app.post("/v1/matches/:matchId/enrichment", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const { matchId } = parse(matchIdParamsSchema, request.params, errorMeta);
    const existing = await repository.getMatch(matchId);
    if (!existing) {
      throw new ApiHttpError(404, "NOT_FOUND", "Match was not found.", false, errorMeta);
    }
    const service = await requireMatchEnrichment();
    let match: StoredMatch;
    try {
      const enriched = await service.enrichMatch(matchId);
      if (!enriched) throw new Error("Stored match disappeared during enrichment");
      match = enriched;
    } catch (error) {
      if (!(error instanceof OpenDotaProviderError)) throw error;
      const statusCode = error.code === "SOURCE_RATE_LIMITED"
        ? 429
        : error.code === "SOURCE_UNAVAILABLE"
          ? 503
          : error.code === "PROFILE_PRIVATE" || error.code === "HISTORY_PRIVATE"
            ? 403
            : error.code === "PARSE_PENDING"
              ? 409
              : 404;
      throw new ApiHttpError(
        statusCode,
        error.code,
        "OpenDota match detail enrichment failed.",
        error.retryable,
        createErrorMeta(
          error.code === "SOURCE_RATE_LIMITED"
            ? "source_rate_limited"
            : error.code === "SOURCE_UNAVAILABLE"
              ? "source_unavailable"
              : error.code === "PARSE_PENDING"
                ? "parse_pending"
                : error.code === "PROFILE_PRIVATE"
                  ? "profile_private"
                  : error.code === "HISTORY_PRIVATE"
                    ? "history_private"
                    : "not_found",
          error.retryAfterSeconds,
          { updatedAt: existing.importedAt, sources: ["opendota"], quality: "partial" },
        ),
      );
    }
    return { data: match.detail, meta: createOperationMeta(descriptorFromMatch(match)) };
  });

  app.get("/v1/patches", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const query = parse(paginationQuerySchema, request.query, errorMeta);
    const patches = await repository.listPatches();
    const snapshot = await repository.getPatchSnapshot();
    if (!snapshot) throw staticUnavailableError("Patch");
    return {
      data: paginate(patches, query.limit, query.cursor, (patch) => patch.id, errorMeta),
      meta: createOperationMeta(
        descriptorFromSnapshot(snapshot),
      ),
    };
  });

  app.get("/v1/updates", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const query = parse(paginationQuerySchema, request.query, errorMeta);
    const [releases, snapshot] = await Promise.all([
      repository.listUpdateReleases(),
      repository.getUpdateSnapshot(),
    ]);
    if (!snapshot || (snapshot.quality === "partial" && releases.length === 0)) {
      throw staticUnavailableError("Update", snapshot);
    }
    return {
      data: paginate(
        releases,
        query.limit,
        query.cursor,
        (release) => release.version,
        errorMeta,
      ),
      meta: createOperationMeta(descriptorFromSnapshot(snapshot)),
    };
  });

  app.get("/v1/updates/:version", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const { version } = parse(updateVersionParamsSchema, request.params, errorMeta);
    const [release, snapshot] = await Promise.all([
      repository.getUpdateRelease(version),
      repository.getUpdateSnapshot(),
    ]);
    if (!snapshot) throw staticUnavailableError("Update");
    const descriptor = descriptorFromSnapshot(snapshot);
    if (!release) {
      if (snapshot.quality === "partial") throw staticUnavailableError("Update", snapshot);
      throw new ApiHttpError(
        404,
        "NOT_FOUND",
        "Official update release was not found.",
        false,
        createErrorMeta("not_found", null, descriptor),
      );
    }
    return { data: release, meta: createOperationMeta(descriptor) };
  });

  app.get("/v1/heroes", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const query = parse(encyclopediaListQuerySchema, request.query, errorMeta);
    const search = query.q?.toLocaleLowerCase();
    const snapshot = await repository.getHeroSnapshot();
    if (!snapshot) throw staticUnavailableError("Hero");
    const heroes = (await repository.listHeroes())
      .filter(
        (hero) =>
          (!query.patch || hero.officialVersion === query.patch) &&
          (!search ||
            hero.name.toLocaleLowerCase().includes(search) ||
            hero.localizedName.toLocaleLowerCase().includes(search)),
      )
      .map(toHeroSummary)
      .sort(itemNameOrder);
    return {
      data: paginate(heroes, query.limit, query.cursor, (hero) => hero.id, errorMeta),
      meta: createOperationMeta(
        descriptorFromSnapshot(snapshot),
      ),
    };
  });

  app.get("/v1/heroes/:heroId", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const { heroId } = parse(heroIdParamsSchema, request.params, errorMeta);
    const { patch } = parse(detailQuerySchema, request.query, errorMeta);
    const [hero, snapshot] = await Promise.all([
      repository.getHero(heroId),
      repository.getHeroSnapshot(),
    ]);
    if (!snapshot) throw staticUnavailableError("Hero");
    if (!hero || (patch && hero.officialVersion !== patch)) {
      if (snapshot.quality === "partial") throw staticUnavailableError("Hero", snapshot);
      throw new ApiHttpError(
        404,
        "NOT_FOUND",
        "Hero was not found.",
        false,
        createErrorMeta("not_found", null, descriptorFromSnapshot(snapshot)),
      );
    }
    return {
      data: hero,
      meta: createOperationMeta(
        descriptorFromSnapshot(snapshot),
      ),
    };
  });

  app.get("/v1/heroes/:heroId/updates", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const { heroId } = parse(heroIdParamsSchema, request.params, errorMeta);
    const query = parse(entityUpdatesQuerySchema, request.query, errorMeta);
    const [hero, heroSnapshot] = await Promise.all([
      repository.getHero(heroId),
      repository.getHeroSnapshot(),
    ]);
    return entityUpdatesResponse(
      "Hero",
      hero !== undefined,
      heroSnapshot,
      heroId,
      ["hero"],
      query,
      errorMeta,
    );
  });

  app.get("/v1/items", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const query = parse(encyclopediaListQuerySchema, request.query, errorMeta);
    const search = query.q?.toLocaleLowerCase();
    const snapshot = await repository.getItemSnapshot();
    if (!snapshot) throw staticUnavailableError("Item");
    const items = (await repository.listItems())
      .filter(
        (item) =>
          (!query.patch || item.officialVersion === query.patch) &&
          (!search ||
            item.name.toLocaleLowerCase().includes(search) ||
            item.localizedName.toLocaleLowerCase().includes(search)),
      )
      .map(toItemSummary)
      .sort(itemNameOrder);
    return {
      data: paginate(items, query.limit, query.cursor, (item) => item.id, errorMeta),
      meta: createOperationMeta(
        descriptorFromSnapshot(snapshot),
      ),
    };
  });

  app.get("/v1/items/:itemId", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const { itemId } = parse(itemIdParamsSchema, request.params, errorMeta);
    const { patch } = parse(detailQuerySchema, request.query, errorMeta);
    const [item, snapshot] = await Promise.all([
      repository.getItem(itemId),
      repository.getItemSnapshot(),
    ]);
    if (!snapshot) throw staticUnavailableError("Item");
    if (!item || (patch && item.officialVersion !== patch)) {
      if (snapshot.quality === "partial") throw staticUnavailableError("Item", snapshot);
      throw new ApiHttpError(
        404,
        "NOT_FOUND",
        "Item was not found.",
        false,
        createErrorMeta("not_found", null, descriptorFromSnapshot(snapshot)),
      );
    }
    return {
      data: item,
      meta: createOperationMeta(
        descriptorFromSnapshot(snapshot),
      ),
    };
  });

  app.get("/v1/items/:itemId/updates", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const { itemId } = parse(itemIdParamsSchema, request.params, errorMeta);
    const query = parse(entityUpdatesQuerySchema, request.query, errorMeta);
    const [item, itemSnapshot] = await Promise.all([
      repository.getItem(itemId),
      repository.getItemSnapshot(),
    ]);
    return entityUpdatesResponse(
      "Item",
      item !== undefined,
      itemSnapshot,
      itemId,
      ["item", "neutral_item"],
      query,
      errorMeta,
    );
  });

  app.get("/v1/maps/current", async () => {
    const snapshot = await repository.getMapSnapshot();
    let map: MapVersion | undefined;
    try {
      map = await repository.getCurrentMap();
    } catch (error) {
      if (!(error instanceof MapAuditError)) throw error;
      map = undefined;
    }
    const expectedSource = dataMode === "live" ? "curated_map" : "seed";
    if (
      !map ||
      !snapshot ||
      snapshot.source !== expectedSource ||
      !mapSnapshotIsConsistent(map, snapshot)
    ) {
      throw new ApiHttpError(
        503,
        "MAP_UNAVAILABLE",
        "No verified current map is available.",
        true,
        createErrorMeta(
          "source_unavailable",
          null,
          snapshot
            ? { ...descriptorFromSnapshot(snapshot), quality: "partial" }
            : {
                updatedAt: new Date(0).toISOString(),
                sources: [expectedSource],
                quality: "partial",
              },
        ),
      );
    }
    return {
      data: map,
      meta: createOperationMeta(descriptorFromSnapshot(snapshot)),
    };
  });

  app.get("/v1/maps/:mapVersionId/features", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const { mapVersionId } = parse(mapVersionParamsSchema, request.params, errorMeta);
    const query = parse(mapFeaturesQuerySchema, request.query, errorMeta);
    const map = await repository.getMap(mapVersionId);
    if (!map) {
      throw new ApiHttpError(404, "NOT_FOUND", "Map was not found.", false, errorMeta);
    }
    parseAuditedMapPayload(map);
    const features = map.features
      .filter((feature) => !query.type || feature.type === query.type)
      .sort(
        (left: MapFeature, right: MapFeature) =>
          left.type.localeCompare(right.type) || itemNameOrder(left, right),
      );
    return {
      data: paginate(features, query.limit, query.cursor, (feature) => feature.id, errorMeta),
      meta: createOperationMeta({
        updatedAt: map.verifiedAt,
        sources: [dataMode === "live" ? "curated_map" : "seed"],
        quality: map.quality,
      }),
    };
  });

  app.get("/v1/data-status", async () => {
    if (dataMode === "live") {
      const health = await repository.getProviderHealth("opendota");
      if (!health) throw new Error("Live provider health was not initialized");
      const officialHealth =
        (await repository.getProviderHealth("dota2_official")) ??
        {
          source: "dota2_official" as const,
          status: "unavailable" as const,
          checkedAt: new Date(0).toISOString(),
          message: "The first official catalog check has not completed yet.",
        };
      const stratzHealth = await repository.getProviderHealth("stratz");
      const coreProviders = [health, officialHealth];
      const providers = [...coreProviders, ...(stratzHealth ? [stratzHealth] : [])];
      const status = coreProviders.some((provider) => provider.status === "unavailable")
        ? "unavailable"
        : providers.some((provider) => provider.status !== "ready")
          ? "degraded"
          : "ready";
      const latestHealth = providers.reduce((latest, provider) =>
        provider.checkedAt > latest.checkedAt ? provider : latest,
      );
      return {
        data: {
          status,
          latestMatchAt: await repository.getLatestMatchAt(),
          providers,
        },
        meta: createOperationMeta({
          updatedAt: latestHealth.checkedAt,
          sources: providers.map((provider) => provider.source),
          quality: qualityForProviderStatus(status),
        }),
      };
    }

    return {
      data: {
        status: "ready" as const,
        latestMatchAt: await repository.getLatestMatchAt(),
        providers: [
          {
            source: "seed" as const,
            status: "ready" as const,
            checkedAt: SEED_UPDATED_AT,
            message: "Deterministic in-memory seed; no upstream provider is connected.",
          },
        ],
      },
      meta: createOperationMeta(await defaultDescriptor()),
    };
  });
};
