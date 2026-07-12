import cors from "@fastify/cors";
import { Dota2OfficialProvider, OpenDotaProvider } from "@dodo/dota-data";
import {
  createLiveRepository,
  createSeedRepository,
  PostgresDodoRepository,
  type DodoRepository,
  type ProviderHealth,
} from "@dodo/db";
import Fastify, { LogController } from "fastify";

import { parseDataMode, type DataMode } from "./data-mode.js";
import { ApiHttpError } from "./errors.js";
import { createErrorMeta } from "./meta.js";
import type { PlayerDataProvider } from "./player-data-provider.js";
import { PlayerHistorySyncService } from "./player-history-sync-service.js";
import { PlayerSyncService } from "./player-sync-service.js";
import { parseRepositoryMode, type RepositoryMode } from "./repository-mode.js";
import { registerRoutes } from "./routes.js";
import { StaticCatalogService } from "./static-catalog-service.js";

export type BuildAppOptions = {
  environment?: string;
  logger?: boolean;
  repository?: DodoRepository;
  repositoryMode?: RepositoryMode;
  databaseUrl?: string;
  dataMode?: DataMode;
  playerDataProvider?: PlayerDataProvider;
  syncService?: PlayerSyncService;
  historySyncService?: PlayerHistorySyncService;
  staticCatalogService?: StaticCatalogService;
  clock?: () => Date;
};

export const buildApp = async (options: BuildAppOptions = {}) => {
  const environment = options.environment ?? process.env.NODE_ENV ?? "development";
  const logger = options.logger ?? false;
  const dataMode = options.dataMode ?? parseDataMode(process.env.DODO_DATA_MODE);
  const clock = options.clock ?? (() => new Date());
  const repositoryMode = options.repository
    ? undefined
    : options.repositoryMode ?? parseRepositoryMode(process.env.DODO_REPOSITORY);
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  const repository =
    options.repository ??
    (repositoryMode === "postgres"
      ? new PostgresDodoRepository({
          ...(databaseUrl ? { databaseUrl } : {}),
        })
      : dataMode === "live"
        ? await createLiveRepository()
        : await createSeedRepository());
  let syncService = options.syncService;
  let historySyncService = options.historySyncService;
  let staticCatalogService = options.staticCatalogService;
  if (dataMode === "live" && (!syncService || !historySyncService)) {
    const provider = options.playerDataProvider ?? (() => {
      const openDotaProvider = new OpenDotaProvider({
        ...(process.env.OPENDOTA_API_BASE_URL
          ? { baseUrl: process.env.OPENDOTA_API_BASE_URL }
          : {}),
        ...(process.env.OPENDOTA_API_KEY ? { apiKey: process.env.OPENDOTA_API_KEY } : {}),
      });
      const officialProvider = new Dota2OfficialProvider();
      return Object.assign(openDotaProvider, {
        getHeroConstants: () => officialProvider.getHeroConstants(),
        getHeroAbilityConstants: () => officialProvider.getHeroAbilityConstants(),
        getItemConstants: () => officialProvider.getItemConstants(),
        getPatchConstants: () => officialProvider.getPatchConstants(),
        getRecentUpdateReleases: (limit: number) =>
          officialProvider.getRecentUpdateReleases(limit),
      });
    })();
    syncService ??= new PlayerSyncService({ repository, provider, clock });
    historySyncService ??= new PlayerHistorySyncService({ repository, provider, clock });
    if (!options.playerDataProvider) {
      staticCatalogService ??= new StaticCatalogService({ repository, provider, clock });
    }
  }
  try {
    if (dataMode === "live" && !(await repository.getProviderHealth("opendota"))) {
      await repository.upsertProviderHealth({
        source: "opendota",
        status: "degraded",
        checkedAt: clock().toISOString(),
        message: "No live provider check has completed in this process.",
      });
    }
  } catch (error) {
    await repository.close();
    throw error;
  }

  const app = Fastify({
    logger,
    logController: new LogController({ disableRequestLogging: true }),
  });

  if (environment === "development") {
    await app.register(cors, {
      origin: /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
    });
  }

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    try {
      await repository.getLatestMatchAt();
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "not_ready" });
    }
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof ApiHttpError) {
      return reply.code(error.statusCode).send(error.toResponse());
    }

    request.log.error(
      { errorName: error instanceof Error ? error.name : "UnknownError" },
      "Unhandled API error",
    );
    let health: ProviderHealth | undefined;
    if (dataMode === "live") {
      try {
        health = await repository.getProviderHealth("opendota");
      } catch {
        health = undefined;
      }
    }
    return reply.code(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "An internal error occurred.",
        retryable: false,
      },
      meta: createErrorMeta(
        "failed",
        null,
        health
          ? { updatedAt: health.checkedAt, sources: [health.source], quality: "partial" }
          : {},
      ),
    });
  });

  await registerRoutes(app, repository, {
    dataMode,
    ...(syncService ? { syncService } : {}),
    ...(historySyncService ? { historySyncService } : {}),
  });
  staticCatalogService?.start();
  app.addHook("onClose", async () => {
    try {
      await staticCatalogService?.close();
      await syncService?.close();
      await historySyncService?.close();
    } finally {
      await repository.close();
    }
  });
  return app;
};
