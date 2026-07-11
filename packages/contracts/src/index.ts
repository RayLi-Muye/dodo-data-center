import { z } from "zod";

export const identifierSchema = z.string().min(1).max(32);
export const timestampSchema = z.iso.datetime().refine((value) => value.endsWith("Z"), {
  message: "Timestamp must use UTC with a Z suffix",
});

export const dataSourceSchema = z.enum([
  "opendota",
  "steam",
  "dotaconstants",
  "curated_map",
  "seed",
]);

export const dataQualitySchema = z.enum(["complete", "partial", "stale"]);

export const playerDataStatusSchema = z.enum([
  "syncing",
  "public_complete",
  "public_partial",
  "history_private",
  "profile_private",
  "not_found",
  "source_rate_limited",
  "source_unavailable",
  "parse_pending",
  "failed",
]);

export const metricWindowSchema = z.enum([
  "last_20",
  "last_50",
  "last_100",
  "all_imported",
]);

export const operationMetaSchema = z.object({
  updatedAt: timestampSchema,
  sources: z.array(dataSourceSchema).min(1),
  quality: dataQualitySchema,
});

export const responseMetaSchema = operationMetaSchema.extend({
  sampleSize: z.number().int().nonnegative(),
  eligibleCount: z.number().int().nonnegative(),
  coverageRate: z.number().min(0).max(1),
  excludedCount: z.number().int().nonnegative().default(0),
  exclusionReasons: z.array(z.string()).default([]),
  inputWatermark: timestampSchema.nullable(),
  metricVersion: z.string().min(1),
  filtersApplied: z.record(z.string(), z.unknown()).default({}),
});

export const errorMetaSchema = z.object({
  status: playerDataStatusSchema.optional(),
  updatedAt: timestampSchema,
  sources: z.array(dataSourceSchema).default([]),
  retryAfterSeconds: z.number().int().positive().nullable().default(null),
});

export const accountReferenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("account_id"), value: z.string().regex(/^\d{1,10}$/) }),
  z.object({ kind: z.literal("steam_id64"), value: z.string().regex(/^\d{17}$/) }),
  z.object({
    kind: z.literal("steam_profile_url"),
    value: z.string().url().max(256),
  }),
]);

export const accountResolutionSchema = z.object({
  accountId: identifierSchema,
  steamId64: z.string().regex(/^\d{17}$/).nullable(),
});

export const accountIdParamsSchema = z.object({ accountId: identifierSchema });
export const heroIdParamsSchema = z.object({ heroId: identifierSchema });
export const itemIdParamsSchema = z.object({ itemId: identifierSchema });
export const matchIdParamsSchema = z.object({ matchId: identifierSchema });
export const syncJobParamsSchema = z.object({ jobId: identifierSchema });

export const paginationQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const playerWindowQuerySchema = z.object({
  window: metricWindowSchema.default("last_100"),
});

export const playerMatchesQuerySchema = paginationQuerySchema.extend({
  heroId: identifierSchema.optional(),
});

export const playerHeroesQuerySchema = paginationQuerySchema.extend({
  window: metricWindowSchema.default("last_100"),
});

export const encyclopediaListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(80).optional(),
  patch: z.string().trim().max(32).optional(),
});

export const mapFeatureTypeSchema = z.enum([
  "lane",
  "tower",
  "outpost",
  "shop",
  "roshan",
  "rune",
  "lotus_pool",
  "neutral_camp",
  "landmark",
]);

export const mapFeaturesQuerySchema = paginationQuerySchema.extend({
  type: mapFeatureTypeSchema.optional(),
});

export const heroSummarySchema = z.object({
  id: identifierSchema,
  name: z.string().min(1),
  localizedName: z.string().min(1),
  primaryAttribute: z.enum(["strength", "agility", "intelligence", "universal"]),
  attackType: z.enum(["melee", "ranged"]),
  roles: z.array(z.string()),
  patch: z.string().min(1),
});

export const abilitySchema = z.object({
  id: identifierSchema,
  name: z.string().min(1),
  localizedName: z.string().min(1),
  description: z.string(),
  slot: z.number().int().nonnegative(),
  type: z.enum(["innate", "basic", "ultimate", "talent"]),
});

export const heroDetailSchema = heroSummarySchema.extend({
  facets: z.array(z.object({ name: z.string(), description: z.string() })),
  abilities: z.array(abilitySchema),
  sourceSnapshot: z.string().min(1),
});

export const itemSummarySchema = z.object({
  id: identifierSchema,
  name: z.string().min(1),
  localizedName: z.string().min(1),
  cost: z.number().int().nonnegative(),
  category: z.string().min(1),
  patch: z.string().min(1),
});

export const itemDetailSchema = itemSummarySchema.extend({
  description: z.string(),
  attributes: z.array(z.object({ label: z.string(), value: z.string() })),
  components: z.array(identifierSchema),
  sourceSnapshot: z.string().min(1),
});

export const matchPlayerSchema = z.object({
  accountId: identifierSchema.nullable(),
  playerSlot: z.number().int().min(0).max(255),
  heroId: identifierSchema,
  side: z.enum(["radiant", "dire"]),
  isWin: z.boolean(),
  kills: z.number().int().nonnegative(),
  deaths: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  gpm: z.number().int().nonnegative().nullable(),
  xpm: z.number().int().nonnegative().nullable(),
  lastHits: z.number().int().nonnegative().nullable(),
  heroDamage: z.number().int().nonnegative().nullable(),
  finalItemIds: z.array(identifierSchema),
});

export const matchSummarySchema = z.object({
  id: identifierSchema,
  startTime: timestampSchema,
  durationSeconds: z.number().int().positive(),
  patch: z.string().min(1),
  gameMode: z.string().min(1),
  region: z.string().nullable(),
  radiantWin: z.boolean(),
  player: matchPlayerSchema,
});

export const matchDetailSchema = matchSummarySchema.omit({ player: true }).extend({
  players: z.array(matchPlayerSchema).min(1).max(10),
  parseStatus: z.enum(["unparsed", "parsed", "pending"]),
});

export const playerProfileSchema = z.object({
  accountId: identifierSchema,
  steamId64: z.string().min(1).nullable(),
  personaName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  status: playerDataStatusSchema,
  importedMatchCount: z.number().int().nonnegative(),
  earliestImportedAt: timestampSchema.nullable(),
  latestImportedAt: timestampSchema.nullable(),
});

export const playerHeroStatsSchema = z.object({
  hero: heroSummarySchema,
  window: metricWindowSchema,
  games: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  winRate: z.number().min(0).max(1).nullable(),
  usageShare: z.number().min(0).max(1),
  kdaRatio: z.number().nonnegative(),
  averageKills: z.number().nonnegative(),
  averageDeaths: z.number().nonnegative(),
  averageAssists: z.number().nonnegative(),
  averageGpm: z.number().nonnegative().nullable(),
  averageXpm: z.number().nonnegative().nullable(),
  averageLastHits: z.number().nonnegative().nullable(),
  averageHeroDamage: z.number().nonnegative().nullable(),
  fieldCoverage: z.object({
    gpm: z.object({ observedCount: z.number().int().nonnegative(), coverageRate: z.number().min(0).max(1) }),
    xpm: z.object({ observedCount: z.number().int().nonnegative(), coverageRate: z.number().min(0).max(1) }),
    lastHits: z.object({ observedCount: z.number().int().nonnegative(), coverageRate: z.number().min(0).max(1) }),
    heroDamage: z.object({ observedCount: z.number().int().nonnegative(), coverageRate: z.number().min(0).max(1) }),
  }),
  lastPlayedAt: timestampSchema.nullable(),
});

export const playerOverviewSchema = z.object({
  profile: playerProfileSchema,
  window: metricWindowSchema,
  games: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  winRate: z.number().min(0).max(1).nullable(),
  kdaRatio: z.number().nonnegative(),
  averageKills: z.number().nonnegative(),
  averageDeaths: z.number().nonnegative(),
  averageAssists: z.number().nonnegative(),
  averageGpm: z.number().nonnegative().nullable(),
  averageXpm: z.number().nonnegative().nullable(),
  averageLastHits: z.number().nonnegative().nullable(),
  averageHeroDamage: z.number().nonnegative().nullable(),
  fieldCoverage: z.object({
    gpm: z.object({ observedCount: z.number().int().nonnegative(), coverageRate: z.number().min(0).max(1) }),
    xpm: z.object({ observedCount: z.number().int().nonnegative(), coverageRate: z.number().min(0).max(1) }),
    lastHits: z.object({ observedCount: z.number().int().nonnegative(), coverageRate: z.number().min(0).max(1) }),
    heroDamage: z.object({ observedCount: z.number().int().nonnegative(), coverageRate: z.number().min(0).max(1) }),
  }),
  distinctHeroes: z.number().int().nonnegative(),
  favoriteHeroId: identifierSchema.nullable(),
  recentMatches: z.array(matchSummarySchema),
  heroes: z.array(playerHeroStatsSchema),
});

export const mapFeatureSchema = z.object({
  id: identifierSchema,
  type: mapFeatureTypeSchema,
  localizedName: z.string().min(1),
  description: z.string(),
  geometry: z.record(z.string(), z.unknown()),
});

export const mapVersionSchema = z.object({
  id: identifierSchema,
  patch: z.string().min(1),
  coordinateSystem: z.string().min(1),
  bounds: z.object({ minX: z.number(), minY: z.number(), maxX: z.number(), maxY: z.number() }),
  features: z.array(mapFeatureSchema),
  sourceSnapshot: z.string().min(1),
  verifiedAt: timestampSchema,
});

export const syncJobSchema = z.object({
  jobId: identifierSchema,
  accountId: identifierSchema,
  status: playerDataStatusSchema,
  requestedAt: timestampSchema,
  completedAt: timestampSchema.nullable().default(null),
  errorCode: z.string().nullable().default(null),
});

export const apiErrorCodeSchema = z.enum([
  "INVALID_ACCOUNT_ID",
  "UNSUPPORTED_ACCOUNT_REFERENCE",
  "NOT_FOUND",
  "PROFILE_PRIVATE",
  "HISTORY_PRIVATE",
  "SOURCE_RATE_LIMITED",
  "SOURCE_UNAVAILABLE",
  "PARSE_PENDING",
  "SYNC_IN_PROGRESS",
  "VALIDATION_ERROR",
  "INTERNAL_ERROR",
]);

export const apiErrorSchema = z.object({
  error: z.object({ code: apiErrorCodeSchema, message: z.string(), retryable: z.boolean() }),
  meta: errorMetaSchema.optional(),
});

export const createMetricResponseSchema = <T extends z.ZodType>(data: T) =>
  z.object({ data, meta: responseMetaSchema });

export const createOperationResponseSchema = <T extends z.ZodType>(data: T) =>
  z.object({ data, meta: operationMetaSchema });

export const createApiResponseSchema = createMetricResponseSchema;

export const createPaginatedDataSchema = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export const accountResolutionResponseSchema = createOperationResponseSchema(accountResolutionSchema);
export const syncJobResponseSchema = createOperationResponseSchema(syncJobSchema);
export const playerOverviewResponseSchema = createMetricResponseSchema(playerOverviewSchema);
export const playerMatchesResponseSchema = createOperationResponseSchema(createPaginatedDataSchema(matchSummarySchema));
export const playerHeroesResponseSchema = createMetricResponseSchema(createPaginatedDataSchema(playerHeroStatsSchema));
export const playerHeroResponseSchema = createMetricResponseSchema(playerHeroStatsSchema);
export const matchDetailResponseSchema = createOperationResponseSchema(matchDetailSchema);
export const heroesResponseSchema = createOperationResponseSchema(createPaginatedDataSchema(heroSummarySchema));
export const heroDetailResponseSchema = createOperationResponseSchema(heroDetailSchema);
export const itemsResponseSchema = createOperationResponseSchema(createPaginatedDataSchema(itemSummarySchema));
export const itemDetailResponseSchema = createOperationResponseSchema(itemDetailSchema);
export const mapVersionResponseSchema = createOperationResponseSchema(mapVersionSchema);
export const mapFeaturesResponseSchema = createOperationResponseSchema(createPaginatedDataSchema(mapFeatureSchema));

export const dataStatusSchema = z.object({
  status: z.enum(["ready", "degraded", "unavailable"]),
  latestMatchAt: timestampSchema.nullable(),
  providers: z.array(
    z.object({
      source: dataSourceSchema,
      status: z.enum(["ready", "degraded", "unavailable"]),
      checkedAt: timestampSchema,
      message: z.string().nullable(),
    }),
  ),
});

export const dataStatusResponseSchema = createOperationResponseSchema(dataStatusSchema);

export type ResponseMeta = z.infer<typeof responseMetaSchema>;
export type OperationMeta = z.infer<typeof operationMetaSchema>;
export type ErrorMeta = z.infer<typeof errorMetaSchema>;
export type AccountReference = z.infer<typeof accountReferenceSchema>;
export type AccountResolution = z.infer<typeof accountResolutionSchema>;
export type HeroSummary = z.infer<typeof heroSummarySchema>;
export type HeroDetail = z.infer<typeof heroDetailSchema>;
export type ItemSummary = z.infer<typeof itemSummarySchema>;
export type ItemDetail = z.infer<typeof itemDetailSchema>;
export type MatchSummary = z.infer<typeof matchSummarySchema>;
export type MatchDetail = z.infer<typeof matchDetailSchema>;
export type PlayerProfile = z.infer<typeof playerProfileSchema>;
export type PlayerHeroStats = z.infer<typeof playerHeroStatsSchema>;
export type PlayerOverview = z.infer<typeof playerOverviewSchema>;
export type MapFeature = z.infer<typeof mapFeatureSchema>;
export type MapVersion = z.infer<typeof mapVersionSchema>;
export type SyncJob = z.infer<typeof syncJobSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type DataStatus = z.infer<typeof dataStatusSchema>;
