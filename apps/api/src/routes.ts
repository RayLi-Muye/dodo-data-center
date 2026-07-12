import {
  accountIdParamsSchema,
  accountReferenceSchema,
  encyclopediaListQuerySchema,
  heroIdParamsSchema,
  identifierSchema,
  itemIdParamsSchema,
  mapFeaturesQuerySchema,
  matchIdParamsSchema,
  paginationQuerySchema,
  playerHeroesQuerySchema,
  playerMatchesQuerySchema,
  playerWindowQuerySchema,
  syncJobParamsSchema,
} from "@dodo/contracts";
import type {
  ApiError,
  ErrorMeta,
  ItemDetail,
  ItemSummary,
  MapFeature,
  OperationMeta,
  PlayerHeroStats,
  PlayerProfile,
  SyncJob,
} from "@dodo/contracts";
import {
  SEED_UPDATED_AT,
  type DodoRepository,
  type PlayerSyncBatch,
  type StaticDataSnapshot,
  type StoredMatch,
} from "@dodo/db";
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

const detailQuerySchema = z.object({ patch: z.string().trim().max(32).optional() });
const mapVersionParamsSchema = z.object({ mapVersionId: identifierSchema });

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

const qualityForProfile = (profile: PlayerProfile): "complete" | "partial" =>
  profile.status === "public_complete" ? "complete" : "partial";

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

const toItemSummary = (item: ItemDetail): ItemSummary => ({
  id: item.id,
  name: item.name,
  localizedName: item.localizedName,
  cost: item.cost,
  category: item.category,
  patch: item.patch,
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
  updatedAt: snapshot.fetchedAt,
  sources: [snapshot.source],
  quality: snapshot.quality,
});

const descriptorFromMatch = (match: StoredMatch): MetaDescriptor => ({
  updatedAt: match.importedAt,
  sources: [match.source],
  quality: match.quality,
});

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
    ? matches.filter((match) => match.detail.patch === patch)
    : matches;
  if (patch) return selectWindow(patchMatches, window);
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
  if (!batch || patch) {
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
  { dataMode, syncService }: RegisterRoutesOptions,
): Promise<void> => {
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
  const playerDescriptor = async (accountId: string): Promise<MetaDescriptor> => {
    const batch = await repository.getPlayerSyncBatch(accountId);
    return batch ? descriptorFromBatch(batch) : defaultDescriptor();
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

  app.post("/v1/account-resolutions", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const reference = parse(accountReferenceSchema, request.body, errorMeta);
    return {
      data: resolveAccountReference(reference, errorMeta),
      meta: createOperationMeta(await defaultDescriptor()),
    };
  });

  app.post("/v1/players/:accountId/sync", async (request, reply) => {
    const accountId = parseAccountId(request.params, await defaultErrorMeta());
    if (dataMode === "live") {
      if (!syncService) throw new Error("Live data mode requires a player sync service");
      const job = await syncService.requestSync(accountId);
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
    const matches = await repository.listPlayerMatches(accountId);
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
    const descriptor = batch ? descriptorFromBatch(batch) : await defaultDescriptor();
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
        quality: batch?.quality ?? qualityForProfile(profile),
        updatedAt: descriptor.updatedAt,
        sources: descriptor.sources,
        metricVersion: dataMode === "live" ? "player-v1" : "seed-v1",
      }),
    };
  });

  app.get("/v1/players/:accountId/matches", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const accountId = parseAccountId(request.params, errorMeta);
    const profile = await accessiblePlayer(accountId);
    const query = parse(playerMatchesQuerySchema, request.query, errorMeta);
    const batch = await repository.getPlayerSyncBatch(accountId);
    const matches = selectPlayerWindow(
      await repository.listPlayerMatches(accountId),
      batch,
      query.window,
      query.patch,
    )
      .filter(
        (match) =>
          !query.heroId ||
          match.detail.players.some(
            (player) => player.accountId === accountId && player.heroId === query.heroId,
          ),
      )
      .map((match) => toMatchSummary(match.detail, accountId));
    return {
      data: paginate(matches, query.limit, query.cursor, (match) => match.id, errorMeta),
      meta: {
        ...createOperationMeta({
          ...(await playerDescriptor(accountId)),
          quality: batch?.quality ?? qualityForProfile(profile),
        }),
        filtersApplied: {
          window: query.window,
          patch: query.patch ?? null,
          heroId: query.heroId ?? null,
        },
      },
    };
  });

  app.get("/v1/players/:accountId/heroes", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const accountId = parseAccountId(request.params, errorMeta);
    const profile = await accessiblePlayer(accountId);
    const query = parse(playerHeroesQuerySchema, request.query, errorMeta);
    const matches = await repository.listPlayerMatches(accountId);
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
    const descriptor = batch ? descriptorFromBatch(batch) : await defaultDescriptor();
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
        quality: batch?.quality ?? qualityForProfile(profile),
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
    const profile = await accessiblePlayer(accountId);
    const hero = await repository.getHero(heroId);
    if (!hero) {
      throw new ApiHttpError(404, "NOT_FOUND", "Hero was not found.", false, errorMeta);
    }
    const selectedMatches = selectPlayerWindow(
      await repository.listPlayerMatches(accountId),
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
    const descriptor = await playerDescriptor(accountId);
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
        quality:
          (await repository.getPlayerSyncBatch(accountId))?.quality ?? qualityForProfile(profile),
        updatedAt: descriptor.updatedAt,
        sources: descriptor.sources,
        metricVersion: dataMode === "live" ? "player-hero-v1" : "seed-v1",
      }),
    };
  });

  app.get("/v1/matches/:matchId", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const { matchId } = parse(matchIdParamsSchema, request.params, errorMeta);
    const match = await repository.getMatch(matchId);
    if (!match) {
      throw new ApiHttpError(404, "NOT_FOUND", "Match was not found.", false, errorMeta);
    }
    return { data: match.detail, meta: createOperationMeta(descriptorFromMatch(match)) };
  });

  app.get("/v1/patches", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const query = parse(paginationQuerySchema, request.query, errorMeta);
    const patches = await repository.listPatches();
    const snapshot = await repository.getPatchSnapshot();
    return {
      data: paginate(patches, query.limit, query.cursor, (patch) => patch.id, errorMeta),
      meta: createOperationMeta(
        snapshot ? descriptorFromSnapshot(snapshot) : await defaultDescriptor(),
      ),
    };
  });

  app.get("/v1/heroes", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const query = parse(encyclopediaListQuerySchema, request.query, errorMeta);
    const search = query.q?.toLocaleLowerCase();
    const heroes = (await repository.listHeroes())
      .filter(
        (hero) =>
          (!query.patch || hero.patch === query.patch) &&
          (!search ||
            hero.name.toLocaleLowerCase().includes(search) ||
            hero.localizedName.toLocaleLowerCase().includes(search)),
      )
      .map(toHeroSummary)
      .sort(itemNameOrder);
    const snapshot = await repository.getHeroSnapshot();
    return {
      data: paginate(heroes, query.limit, query.cursor, (hero) => hero.id, errorMeta),
      meta: createOperationMeta(
        snapshot ? descriptorFromSnapshot(snapshot) : await defaultDescriptor(),
      ),
    };
  });

  app.get("/v1/heroes/:heroId", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const { heroId } = parse(heroIdParamsSchema, request.params, errorMeta);
    const { patch } = parse(detailQuerySchema, request.query, errorMeta);
    const hero = await repository.getHero(heroId);
    if (!hero || (patch && hero.patch !== patch)) {
      throw new ApiHttpError(404, "NOT_FOUND", "Hero was not found.", false, errorMeta);
    }
    const snapshot = await repository.getHeroSnapshot();
    return {
      data: hero,
      meta: createOperationMeta(
        snapshot ? descriptorFromSnapshot(snapshot) : await defaultDescriptor(),
      ),
    };
  });

  app.get("/v1/items", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const query = parse(encyclopediaListQuerySchema, request.query, errorMeta);
    const search = query.q?.toLocaleLowerCase();
    const items = (await repository.listItems())
      .filter(
        (item) =>
          (!query.patch || item.patch === query.patch) &&
          (!search ||
            item.name.toLocaleLowerCase().includes(search) ||
            item.localizedName.toLocaleLowerCase().includes(search)),
      )
      .map(toItemSummary)
      .sort(itemNameOrder);
    const snapshot = await repository.getItemSnapshot();
    return {
      data: paginate(items, query.limit, query.cursor, (item) => item.id, errorMeta),
      meta: createOperationMeta(
        snapshot ? descriptorFromSnapshot(snapshot) : await defaultDescriptor(),
      ),
    };
  });

  app.get("/v1/items/:itemId", async (request) => {
    const errorMeta = await defaultErrorMeta();
    const { itemId } = parse(itemIdParamsSchema, request.params, errorMeta);
    const { patch } = parse(detailQuerySchema, request.query, errorMeta);
    const item = await repository.getItem(itemId);
    if (!item || (patch && item.patch !== patch)) {
      throw new ApiHttpError(404, "NOT_FOUND", "Item was not found.", false, errorMeta);
    }
    const snapshot = await repository.getItemSnapshot();
    return {
      data: item,
      meta: createOperationMeta(
        snapshot ? descriptorFromSnapshot(snapshot) : await defaultDescriptor(),
      ),
    };
  });

  app.get("/v1/maps/current", async () => {
    const map = await repository.getCurrentMap();
    if (!map) {
      throw new ApiHttpError(
        404,
        "NOT_FOUND",
        "Current map was not found.",
        false,
        await defaultErrorMeta(),
      );
    }
    return {
      data: map,
      meta: createOperationMeta({
        updatedAt: map.verifiedAt,
        sources: [dataMode === "live" ? "curated_map" : "seed"],
        quality: "complete",
      }),
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
        quality: "complete",
      }),
    };
  });

  app.get("/v1/data-status", async () => {
    if (dataMode === "live") {
      const health = await repository.getProviderHealth("opendota");
      if (!health) throw new Error("Live provider health was not initialized");
      return {
        data: {
          status: health.status,
          latestMatchAt: await repository.getLatestMatchAt(),
          providers: [health],
        },
        meta: createOperationMeta({
          updatedAt: health.checkedAt,
          sources: [health.source],
          quality: qualityForProviderStatus(health.status),
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
