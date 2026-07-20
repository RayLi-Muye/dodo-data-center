import { z } from "zod";

export const identifierSchema = z.string().min(1).max(32);
export const timestampSchema = z.iso.datetime().refine((value) => value.endsWith("Z"), {
  message: "Timestamp must use UTC with a Z suffix",
});

export const dataSourceSchema = z.enum([
  "dota2_official",
  "opendota",
  "stratz",
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

export const filteredOperationMetaSchema = operationMetaSchema.extend({
  filtersApplied: z.record(z.string(), z.unknown()).default({}),
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

export const playerSyncRequestSchema = z.object({
  trigger: z.enum(["automatic", "manual"]).default("manual"),
}).default({ trigger: "manual" });

export const paginationQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const playerWindowQuerySchema = z.object({
  window: metricWindowSchema.default("last_100"),
  patch: identifierSchema.optional(),
});

export const playerMatchesQuerySchema = paginationQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  heroId: identifierSchema.optional(),
  window: metricWindowSchema.default("all_imported"),
  patch: identifierSchema.optional(),
  outcome: z.enum(["win", "loss"]).optional(),
  gameMode: z.string().trim().min(1).max(64).optional(),
  lobbyType: z.string().trim().min(1).max(64).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine(
  ({ dateFrom, dateTo }) => !dateFrom || !dateTo || dateFrom <= dateTo,
  { message: "dateFrom must not be after dateTo", path: ["dateTo"] },
);

export const playerHeroesQuerySchema = paginationQuerySchema.extend({
  window: metricWindowSchema.default("last_100"),
  patch: identifierSchema.optional(),
});

export const encyclopediaListQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(80).optional(),
  patch: z.string().trim().max(32).optional(),
});

export const entityUpdatesQuerySchema = paginationQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

export const mapFeatureTypeSchema = z.enum([
  "lane",
  "tower",
  "tormentor",
  "twin_gate",
  "watcher",
  "wisdom_rune",
  "outpost",
  "shop",
  "roshan",
  "rune",
  "lotus_pool",
  "neutral_camp",
  "landmark",
]);

export const patchSummarySchema = z.object({
  id: identifierSchema,
  name: z.string().min(1).max(32),
  releasedAt: timestampSchema,
});

export const updateSectionKindSchema = z.enum([
  "general",
  "hero",
  "item",
  "neutral_item",
  "neutral_creep",
]);

export const updateSubsectionSchema = z.enum([
  "overview",
  "ability",
  "talent",
]);

export const updateNoteSchema = z.object({
  text: z.string().min(1).max(2_000),
  info: z.string().min(1).max(2_000).nullable(),
  indentLevel: z.number().int().min(1).max(8),
});

export const updateChangeGroupSchema = z.object({
  kind: updateSectionKindSchema,
  subsection: updateSubsectionSchema,
  entityId: identifierSchema.nullable(),
  entityName: z.string().min(1).max(160).nullable(),
  relatedAbilityId: identifierSchema.nullable(),
  title: z.string().min(1).max(160).nullable(),
  notes: z.array(updateNoteSchema).min(1),
});

export const updateReleaseSummarySchema = z.object({
  version: z.string().min(1).max(32),
  releasedAt: timestampSchema,
  sourceUrl: z.string().url().max(256),
  changeGroupCount: z.number().int().nonnegative(),
  contentStatus: z.enum(["complete", "partial"]),
  excludedNoteCount: z.number().int().nonnegative(),
});

export const updateReleaseDetailSchema = updateReleaseSummarySchema.extend({
  groups: z.array(updateChangeGroupSchema),
});

export const entityUpdateReleaseSchema = z.object({
  version: z.string().min(1).max(32),
  releasedAt: timestampSchema,
  sourceUrl: z.string().url().max(256),
  contentStatus: z.enum(["complete", "partial"]),
  excludedNoteCount: z.number().int().nonnegative(),
  matchedGroupCount: z.number().int().positive(),
  groups: z.array(updateChangeGroupSchema).min(1),
});

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
  officialVersion: z.string().min(1).nullable(),
});

export const abilitySchema = z.object({
  id: identifierSchema,
  name: z.string().min(1),
  localizedName: z.string().min(1),
  description: z.string(),
  attributes: z.array(z.object({ label: z.string(), value: z.string() })).default([]),
  slot: z.number().int().nonnegative(),
  type: z.enum(["innate", "basic", "ultimate", "talent"]),
});

export const heroBaseStatsSchema = z.object({
  maxHealth: z.number().nonnegative(),
  healthRegen: z.number(),
  maxMana: z.number().nonnegative(),
  manaRegen: z.number(),
  armor: z.number(),
  magicResistance: z.number(),
  damageMin: z.number(),
  damageMax: z.number(),
  strength: z.object({ base: z.number(), gain: z.number() }),
  agility: z.object({ base: z.number(), gain: z.number() }),
  intelligence: z.object({ base: z.number(), gain: z.number() }),
  movementSpeed: z.number().nonnegative(),
  attackRange: z.number().nonnegative(),
  attackRate: z.number().nonnegative(),
  projectileSpeed: z.number().nonnegative(),
  turnRate: z.number(),
  sightRangeDay: z.number().nonnegative(),
  sightRangeNight: z.number().nonnegative(),
});

export const heroDetailSchema = heroSummarySchema.extend({
  hype: z.string().default(""),
  biography: z.string().default(""),
  complexity: z.number().int().min(1).max(3).nullable().default(null),
  baseStats: heroBaseStatsSchema.nullable().default(null),
  facetsStatus: z.enum(["active", "removed", "unavailable"]),
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
  kind: z.enum(["item", "recipe", "neutral_item", "neutral_enhancement"]),
  availabilityStatus: z.enum(["verified_current", "unverified"]),
  officialVersion: z.string().min(1).nullable(),
});

export const itemDetailSchema = itemSummarySchema.extend({
  description: z.string(),
  attributes: z.array(z.object({ label: z.string(), value: z.string() })),
  components: z.array(identifierSchema),
  sourceSnapshot: z.string().min(1),
});

export const abilityUpgradeEventSchema = z.object({
  abilityId: identifierSchema,
  sequence: z.number().int().positive(),
  heroLevel: z.number().int().positive().nullable(),
  gameTimeSeconds: z.number().int().nullable(),
});

export const itemTransactionSchema = z.object({
  itemId: identifierSchema,
  action: z.enum(["purchase", "sell"]),
  gameTimeSeconds: z.number().int(),
  charges: z.number().int().nonnegative().nullable(),
});

export const stratzEnrichmentStatusSchema = z.enum([
  "not_requested",
  "complete",
  "retry_scheduled",
  "terminal_partial",
  "terminal_failed",
  "provider_blocked",
]);

export const stratzEnrichmentReasonSchema = z.enum([
  "partial_response",
  "not_found",
  "core_conflict",
  "player_conflict",
  "rate_limited",
  "authentication",
  "unavailable",
  "invalid_response",
]);

export const stratzEnrichmentStateSchema = z.object({
  status: stratzEnrichmentStatusSchema,
  resultQuality: z.enum(["complete", "partial"]).nullable(),
  attemptCount: z.number().int().nonnegative(),
  lastAttemptAt: timestampSchema.nullable(),
  nextAttemptAt: timestampSchema.nullable(),
  reasonCode: stratzEnrichmentReasonSchema.nullable(),
  providerRevision: z.string().min(1).max(64),
}).default({
  status: "not_requested",
  resultQuality: null,
  attemptCount: 0,
  lastAttemptAt: null,
  nextAttemptAt: null,
  reasonCode: null,
  providerRevision: "stratz-graphql-v1",
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
  denies: z.number().int().nonnegative().nullable(),
  heroDamage: z.number().int().nonnegative().nullable(),
  heroHealing: z.number().int().nonnegative().nullable(),
  towerDamage: z.number().int().nonnegative().nullable(),
  level: z.number().int().nonnegative().nullable(),
  netWorth: z.number().int().nonnegative().nullable(),
  finalItemIds: z.array(identifierSchema),
  backpackItemIds: z.array(identifierSchema),
  neutralItemId: identifierSchema.nullable(),
  neutralItemEnhancementId: identifierSchema.nullable(),
  abilityBuild: z.array(abilityUpgradeEventSchema),
  abilityBuildStatus: z.enum(["unavailable", "ordered", "timed"]),
  itemTimeline: z.array(itemTransactionSchema),
  itemTimelineStatus: z.enum(["unavailable", "partial", "complete"]),
});

export const matchAdvancedSectionStatusSchema = z.enum([
  "unavailable",
  "partial",
  "complete",
]);

const matchAdvancedSectionFields = {
  status: matchAdvancedSectionStatusSchema,
  excludedCount: z.number().int().nonnegative(),
  exclusionReasons: z.array(z.string().min(1)),
};

export const matchTimelineSampleSchema = z.object({
  gameTimeSeconds: z.number().int(),
  gold: z.number().int().nonnegative().nullable(),
  xp: z.number().int().nonnegative().nullable(),
  lastHits: z.number().int().nonnegative().nullable(),
  denies: z.number().int().nonnegative().nullable(),
});

export const matchKillEventSchema = z.object({
  killerPlayerSlot: z.number().int().min(0).max(255),
  gameTimeSeconds: z.number().int(),
  victimEntityName: z.string().min(1).max(256),
});

export const matchDamageBreakdownEntrySchema = z.object({
  entityName: z.string().min(1).max(256),
  amount: z.number().finite().nonnegative(),
});

export const matchObjectiveEventSchema = z.object({
  gameTimeSeconds: z.number().int(),
  type: z.string().min(1).max(128),
  key: z.string().min(1).max(256).nullable(),
  unit: z.string().min(1).max(256).nullable(),
  playerSlot: z.number().int().min(0).max(255).nullable(),
  team: z.enum(["radiant", "dire"]).nullable(),
});

export const matchTeamfightPlayerSchema = z.object({
  playerIndex: z.number().int().nonnegative(),
  playerSlot: z.number().int().min(0).max(255).nullable(),
  deaths: z.number().int().nonnegative(),
  buybacks: z.number().int().nonnegative(),
  damage: z.number().finite().nonnegative(),
  healing: z.number().finite().nonnegative(),
  goldDelta: z.number().finite(),
  xpDelta: z.number().finite(),
  xpStart: z.number().finite().nonnegative().nullable(),
  xpEnd: z.number().finite().nonnegative().nullable(),
});

export const matchAnalysisSchema = z.object({
  source: z.literal("opendota"),
  providerRevision: z.string().min(1).max(64),
  updatedAt: timestampSchema.nullable(),
  playerTimelines: z.object({
    ...matchAdvancedSectionFields,
    players: z.array(z.object({
      playerSlot: z.number().int().min(0).max(255),
      samples: z.array(matchTimelineSampleSchema),
    })),
  }),
  teamAdvantages: z.object({
    ...matchAdvancedSectionFields,
    axis: z.literal("inferred_60s"),
    samples: z.array(z.object({
      gameTimeSeconds: z.number().int().nonnegative(),
      radiantGoldAdvantage: z.number().int().nullable(),
      radiantXpAdvantage: z.number().int().nullable(),
    })),
  }),
  kills: z.object({
    ...matchAdvancedSectionFields,
    events: z.array(matchKillEventSchema),
  }),
  damage: z.object({
    ...matchAdvancedSectionFields,
    players: z.array(z.object({
      playerSlot: z.number().int().min(0).max(255),
      dealtToEntities: z.array(matchDamageBreakdownEntrySchema),
      receivedFromEntities: z.array(matchDamageBreakdownEntrySchema),
      dealtBySources: z.array(matchDamageBreakdownEntrySchema),
      receivedBySources: z.array(matchDamageBreakdownEntrySchema),
    })),
  }),
  objectives: z.object({
    ...matchAdvancedSectionFields,
    events: z.array(matchObjectiveEventSchema),
  }),
  teamfights: z.object({
    ...matchAdvancedSectionFields,
    fights: z.array(z.object({
      startTimeSeconds: z.number().int(),
      endTimeSeconds: z.number().int(),
      lastDeathTimeSeconds: z.number().int().nullable(),
      deathCount: z.number().int().nonnegative(),
      players: z.array(matchTeamfightPlayerSchema),
    })),
  }),
});

export const MATCH_ANALYSIS_PROVIDER_REVISION = "opendota-match-analysis-v1";

export const emptyMatchAnalysis = (
  updatedAt: string | null = null,
): z.infer<typeof matchAnalysisSchema> => ({
  source: "opendota",
  providerRevision: MATCH_ANALYSIS_PROVIDER_REVISION,
  updatedAt,
  playerTimelines: {
    status: "unavailable",
    excludedCount: 0,
    exclusionReasons: [],
    players: [],
  },
  teamAdvantages: {
    status: "unavailable",
    excludedCount: 0,
    exclusionReasons: [],
    axis: "inferred_60s",
    samples: [],
  },
  kills: {
    status: "unavailable",
    excludedCount: 0,
    exclusionReasons: [],
    events: [],
  },
  damage: {
    status: "unavailable",
    excludedCount: 0,
    exclusionReasons: [],
    players: [],
  },
  objectives: {
    status: "unavailable",
    excludedCount: 0,
    exclusionReasons: [],
    events: [],
  },
  teamfights: {
    status: "unavailable",
    excludedCount: 0,
    exclusionReasons: [],
    fights: [],
  },
});

export const matchSummarySchema = z.object({
  id: identifierSchema,
  startTime: timestampSchema,
  durationSeconds: z.number().int().positive(),
  officialVersion: z.string().min(1).nullable(),
  openDotaPatchId: identifierSchema.nullable(),
  officialVersionSource: z.enum(["start_time_inferred", "unavailable"]),
  gameMode: z.string().min(1),
  lobbyType: z.string().nullable(),
  region: z.string().nullable(),
  radiantWin: z.boolean(),
  player: matchPlayerSchema,
});

export const matchCoreDetailSchema = matchSummarySchema.omit({ player: true }).extend({
  players: z.array(matchPlayerSchema).min(1).max(10),
  detailStatus: z.enum(["summary", "enriched"]),
  enrichmentSources: z.array(z.enum(["stratz"])).default([]),
  stratzEnrichment: stratzEnrichmentStateSchema,
  parseStatus: z.enum(["unparsed", "parsed", "pending"]),
  cluster: z.string().nullable(),
  radiantScore: z.number().int().nonnegative().nullable(),
  direScore: z.number().int().nonnegative().nullable(),
});

export const matchDetailSchema = matchCoreDetailSchema.extend({
  analysis: matchAnalysisSchema,
});

export const matchEnrichmentScopeSchema = z.enum(["recent", "all_imported"]);

export const playerEnrichmentQuerySchema = z.object({
  scope: matchEnrichmentScopeSchema.default("recent"),
});

export const playerEnrichmentProgressSchema = z.object({
  accountId: identifierSchema,
  scope: matchEnrichmentScopeSchema,
  running: z.boolean(),
  batchSize: z.number().int().min(1).max(20),
  totalMatches: z.number().int().nonnegative(),
  detailReadyCount: z.number().int().nonnegative(),
  completeCount: z.number().int().nonnegative(),
  retryScheduledCount: z.number().int().nonnegative(),
  terminalPartialCount: z.number().int().nonnegative(),
  terminalFailedCount: z.number().int().nonnegative(),
  providerBlockedCount: z.number().int().nonnegative(),
  notRequestedCount: z.number().int().nonnegative(),
  retryEligibleCount: z.number().int().nonnegative(),
  updatedAt: timestampSchema.nullable(),
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

const mapCoordinateSchema = z.tuple([z.number().finite(), z.number().finite()]);
const mapLinearRingSchema = z.array(mapCoordinateSchema).min(4).refine(
  (ring) => {
    const first = ring[0];
    const last = ring.at(-1);
    return first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1];
  },
  { message: "Map polygon rings must be closed." },
);

export const mapGeometrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Point"), coordinates: mapCoordinateSchema }).strict(),
  z.object({
    type: z.literal("LineString"),
    coordinates: z.array(mapCoordinateSchema).min(2),
  }).strict(),
  z.object({
    type: z.literal("Polygon"),
    coordinates: z.array(mapLinearRingSchema).min(1),
  }).strict(),
]);

export const mapSourceRefSchema = z.object({
  resourcePath: z.string().trim().min(1).max(512),
  entityClassname: z.string().trim().min(1).max(128),
  entityTargetName: z.string().trim().min(1).max(256).nullable(),
  entityIndex: z.number().int().nonnegative().nullable(),
}).strict();

export const mapFeatureSchema = z.object({
  id: identifierSchema,
  type: mapFeatureTypeSchema,
  localizedName: z.string().min(1),
  description: z.string(),
  geometry: mapGeometrySchema,
  sourceRefs: z.array(mapSourceRefSchema).min(1),
}).strict().superRefine((feature, context) => {
  if (feature.type === "lane" && feature.geometry.type !== "LineString") {
    context.addIssue({ code: "custom", message: "Lane features require LineString geometry." });
  }
  if (
    feature.type !== "lane" &&
    feature.type !== "landmark" &&
    feature.geometry.type !== "Point"
  ) {
    context.addIssue({ code: "custom", message: `${feature.type} features require Point geometry.` });
  }
});

export const mapSourceRevisionSchema = z.object({
  appId: z.literal("570"),
  buildId: z.string().regex(/^\d+$/),
  depotManifestId: z.string().regex(/^\d+$/),
  resourcePath: z.string().trim().min(1).max(512),
  resourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  extractor: z.string().trim().min(1).max(128),
  extractorVersion: z.string().trim().min(1).max(64),
  snapshotSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const mapCoverageSchema = z.object({
  includedTypes: z.array(mapFeatureTypeSchema),
  exclusions: z.array(z.object({
    type: mapFeatureTypeSchema,
    reason: z.string().trim().min(1).max(500),
  }).strict()),
}).strict();

export const mapVersionSchema = z.object({
  id: identifierSchema,
  patch: z.string().min(1),
  quality: z.enum(["complete", "partial"]),
  coordinateSystem: z.literal("source2-world-units"),
  bounds: z.object({
    minX: z.number().finite(),
    minY: z.number().finite(),
    maxX: z.number().finite(),
    maxY: z.number().finite(),
  }).strict().refine(
    (bounds) => bounds.maxX > bounds.minX && bounds.maxY > bounds.minY,
    { message: "Map bounds must have positive width and height." },
  ),
  features: z.array(mapFeatureSchema).min(1),
  sourceSnapshot: z.string().url().max(2_048),
  sourceUrls: z.array(z.string().url().max(2_048)).min(1),
  sourceRevision: mapSourceRevisionSchema,
  coverage: mapCoverageSchema,
  verifiedAt: timestampSchema,
}).strict().superRefine((map, context) => {
  const featureIds = new Set<string>();
  const includedTypes = new Set(map.coverage.includedTypes);
  const excludedTypes = new Set(map.coverage.exclusions.map((entry) => entry.type));
  if (includedTypes.size !== map.coverage.includedTypes.length) {
    context.addIssue({ code: "custom", message: "Map included feature types must be unique." });
  }
  if (excludedTypes.size !== map.coverage.exclusions.length) {
    context.addIssue({ code: "custom", message: "Map excluded feature types must be unique." });
  }
  if (map.quality === "complete" && map.coverage.exclusions.length > 0) {
    context.addIssue({ code: "custom", message: "Complete map snapshots cannot declare exclusions." });
  }
  if (map.quality === "partial" && map.coverage.exclusions.length === 0) {
    context.addIssue({ code: "custom", message: "Partial map snapshots require exclusions." });
  }
  for (const type of includedTypes) {
    if (excludedTypes.has(type)) {
      context.addIssue({ code: "custom", message: `Map feature type ${type} cannot be included and excluded.` });
    }
  }
  for (const type of mapFeatureTypeSchema.options) {
    if (!includedTypes.has(type) && !excludedTypes.has(type)) {
      context.addIssue({
        code: "custom",
        message: `Map feature type ${type} must be included or explicitly excluded.`,
      });
    }
  }
  const coordinatesFor = (geometry: z.infer<typeof mapGeometrySchema>): Array<[number, number]> => {
    if (geometry.type === "Point") return [geometry.coordinates];
    if (geometry.type === "LineString") return geometry.coordinates;
    return geometry.coordinates.flat();
  };
  for (const feature of map.features) {
    if (featureIds.has(feature.id)) {
      context.addIssue({ code: "custom", message: `Duplicate map feature id: ${feature.id}.` });
    }
    featureIds.add(feature.id);
    if (!includedTypes.has(feature.type)) {
      context.addIssue({ code: "custom", message: `Map feature type ${feature.type} is missing from coverage.` });
    }
    for (const [x, y] of coordinatesFor(feature.geometry)) {
      if (x < map.bounds.minX || x > map.bounds.maxX || y < map.bounds.minY || y > map.bounds.maxY) {
        context.addIssue({ code: "custom", message: `Map feature ${feature.id} lies outside bounds.` });
        break;
      }
    }
  }
  for (const type of includedTypes) {
    if (!map.features.some((feature) => feature.type === type)) {
      context.addIssue({ code: "custom", message: `Included map feature type ${type} has no features.` });
    }
  }
});

const stableJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableJsonValue(child)]),
    );
  }
  return value;
};

export const canonicalMapSnapshotPayload = (
  map: z.infer<typeof mapVersionSchema>,
): string => {
  const parsed = mapVersionSchema.parse(map);
  const { snapshotSha256: _snapshotSha256, ...sourceRevision } = parsed.sourceRevision;
  return JSON.stringify(stableJsonValue({
    ...parsed,
    features: [...parsed.features].sort((left, right) => left.id.localeCompare(right.id)),
    sourceRevision,
  }));
};

export const syncJobSchema = z.object({
  jobId: identifierSchema,
  accountId: identifierSchema,
  status: playerDataStatusSchema,
  requestedAt: timestampSchema,
  completedAt: timestampSchema.nullable().default(null),
  errorCode: z.string().nullable().default(null),
});

export const playerHistorySyncSchema = z.object({
  accountId: identifierSchema,
  status: z.enum([
    "idle",
    "syncing",
    "partial",
    "complete",
    "source_rate_limited",
    "source_unavailable",
    "failed",
  ]),
  nextOffset: z.number().int().nonnegative(),
  pageSize: z.number().int().min(1).max(100),
  pagesImported: z.number().int().nonnegative(),
  matchesImported: z.number().int().nonnegative(),
  oldestImportedAt: timestampSchema.nullable(),
  reachedEnd: z.boolean(),
  requestedAt: timestampSchema.nullable(),
  updatedAt: timestampSchema,
  errorCode: z.string().nullable(),
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
  "MAP_UNAVAILABLE",
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
export const playerHistorySyncResponseSchema = createOperationResponseSchema(playerHistorySyncSchema);
export const playerOverviewResponseSchema = createMetricResponseSchema(playerOverviewSchema);
export const playerMatchesResponseSchema = z.object({
  data: createPaginatedDataSchema(matchSummarySchema),
  meta: filteredOperationMetaSchema,
});
export const playerHeroesResponseSchema = createMetricResponseSchema(createPaginatedDataSchema(playerHeroStatsSchema));
export const playerHeroResponseSchema = createMetricResponseSchema(playerHeroStatsSchema);
export const matchDetailResponseSchema = createOperationResponseSchema(matchDetailSchema);
export const playerEnrichmentProgressResponseSchema = createMetricResponseSchema(
  playerEnrichmentProgressSchema,
);
export const heroesResponseSchema = createOperationResponseSchema(createPaginatedDataSchema(heroSummarySchema));
export const heroDetailResponseSchema = createOperationResponseSchema(heroDetailSchema);
export const itemsResponseSchema = createOperationResponseSchema(createPaginatedDataSchema(itemSummarySchema));
export const itemDetailsResponseSchema = createOperationResponseSchema(createPaginatedDataSchema(itemDetailSchema));
export const itemDetailResponseSchema = createOperationResponseSchema(itemDetailSchema);
export const mapVersionResponseSchema = createOperationResponseSchema(mapVersionSchema);
export const mapFeaturesResponseSchema = createOperationResponseSchema(createPaginatedDataSchema(mapFeatureSchema));
export const patchesResponseSchema = createOperationResponseSchema(
  createPaginatedDataSchema(patchSummarySchema),
);
export const updatesResponseSchema = createOperationResponseSchema(
  createPaginatedDataSchema(updateReleaseSummarySchema),
);
export const updateDetailResponseSchema = createOperationResponseSchema(updateReleaseDetailSchema);
export const entityUpdatesResponseSchema = createOperationResponseSchema(
  createPaginatedDataSchema(entityUpdateReleaseSchema),
);

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
export type HeroBaseStats = z.infer<typeof heroBaseStatsSchema>;
export type HeroDetail = z.infer<typeof heroDetailSchema>;
export type ItemSummary = z.infer<typeof itemSummarySchema>;
export type ItemDetail = z.infer<typeof itemDetailSchema>;
export type MatchSummary = z.infer<typeof matchSummarySchema>;
export type MatchCoreDetail = z.infer<typeof matchCoreDetailSchema>;
export type MatchAnalysis = z.infer<typeof matchAnalysisSchema>;
export type MatchDetail = z.infer<typeof matchDetailSchema>;
export type StratzEnrichmentState = z.infer<typeof stratzEnrichmentStateSchema>;
export type MatchEnrichmentScope = z.infer<typeof matchEnrichmentScopeSchema>;
export type PlayerEnrichmentProgress = z.infer<typeof playerEnrichmentProgressSchema>;
export type PlayerProfile = z.infer<typeof playerProfileSchema>;
export type PlayerHeroStats = z.infer<typeof playerHeroStatsSchema>;
export type PlayerOverview = z.infer<typeof playerOverviewSchema>;
export type MapGeometry = z.infer<typeof mapGeometrySchema>;
export type MapSourceRef = z.infer<typeof mapSourceRefSchema>;
export type MapSourceRevision = z.infer<typeof mapSourceRevisionSchema>;
export type MapCoverage = z.infer<typeof mapCoverageSchema>;
export type MapFeature = z.infer<typeof mapFeatureSchema>;
export type MapVersion = z.infer<typeof mapVersionSchema>;
export type PatchSummary = z.infer<typeof patchSummarySchema>;
export type UpdateReleaseSummary = z.infer<typeof updateReleaseSummarySchema>;
export type UpdateReleaseDetail = z.infer<typeof updateReleaseDetailSchema>;
export type EntityUpdateRelease = z.infer<typeof entityUpdateReleaseSchema>;
export type SyncJob = z.infer<typeof syncJobSchema>;
export type PlayerHistorySync = z.infer<typeof playerHistorySyncSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
export type DataStatus = z.infer<typeof dataStatusSchema>;
