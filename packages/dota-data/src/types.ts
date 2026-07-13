export type OpenDotaSourceMetadata = {
  source: "opendota";
  fetchedAt: string;
};

export type Dota2OfficialSourceMetadata = {
  source: "dota2_official";
  fetchedAt: string;
};

export type StratzSourceMetadata = {
  source: "stratz";
  fetchedAt: string;
};

export type DotaDataSourceMetadata =
  | OpenDotaSourceMetadata
  | Dota2OfficialSourceMetadata
  | StratzSourceMetadata;

export type CanonicalPlayerProfile = {
  accountId: string;
  steamId64: string | null;
  personaName: string | null;
  avatarUrl: string | null;
  status: "public_complete" | "public_partial";
  source: OpenDotaSourceMetadata;
};

export type CanonicalMatchPlayer = {
  accountId: string | null;
  eligibleForPersonalAggregation: boolean;
  playerSlot: number;
  heroId: string;
  side: "radiant" | "dire";
  isWin: boolean;
  kills: number;
  deaths: number;
  assists: number;
  gpm: number | null;
  xpm: number | null;
  lastHits: number | null;
  denies: number | null;
  heroDamage: number | null;
  heroHealing: number | null;
  towerDamage: number | null;
  level: number | null;
  netWorth: number | null;
  finalItemIds: string[];
  backpackItemIds: string[];
  neutralItemId: string | null;
  neutralItemEnhancementId: string | null;
  abilityBuild: Array<{
    abilityId: string;
    sequence: number;
    heroLevel: null;
    gameTimeSeconds: null;
  }>;
  abilityBuildStatus: "unavailable" | "ordered" | "timed";
  itemTimeline: Array<{
    itemKey: string;
    action: "purchase" | "sell";
    gameTimeSeconds: number;
    charges: number | null;
  }>;
  itemTimelineStatus: "unavailable" | "partial" | "complete";
};

export type CanonicalPlayerMatch = {
  id: string;
  startTime: string;
  durationSeconds: number;
  patchId: string | null;
  gameMode: string;
  region: string | null;
  lobbyType: string | null;
  radiantWin: boolean;
  player: CanonicalMatchPlayer;
};

export type CanonicalRecentMatchCandidateEntry =
  | {
      providerIndex: number;
      status: "included";
      matchId: string;
    }
  | {
      providerIndex: number;
      status: "excluded";
      exclusionReasons: string[];
    };

export type CanonicalRecentMatchQualityContext = {
  eligibleCount: number;
  excludedCount: number;
  exclusionReasons: string[];
  candidateLedger: CanonicalRecentMatchCandidateEntry[];
};

export type CanonicalRecentMatches = CanonicalRecentMatchQualityContext & {
  accountId: string;
  requestedLimit: number;
  quality: "complete" | "partial";
  matches: CanonicalPlayerMatch[];
  source: OpenDotaSourceMetadata;
};

export type CanonicalPlayerMatchesPage = CanonicalRecentMatches & {
  offset: number;
  rawCount: number;
  reachedEnd: boolean;
};

export type CanonicalMatchDetail = {
  id: string;
  startTime: string;
  durationSeconds: number;
  patchId: string | null;
  gameMode: string;
  region: string | null;
  lobbyType: string | null;
  cluster: string | null;
  radiantScore: number | null;
  direScore: number | null;
  radiantWin: boolean;
  eligiblePlayerCount: number;
  excludedPlayerCount: number;
  exclusionReasons: string[];
  quality: "complete" | "partial";
  players: CanonicalMatchPlayer[];
  parseStatus: "unparsed" | "parsed";
  source: OpenDotaSourceMetadata;
};

export type CanonicalHeroConstant = {
  id: string;
  name: string;
  localizedName: string;
  primaryAttribute: "strength" | "agility" | "intelligence" | "universal";
  attackType: "melee" | "ranged";
  roles: string[];
  officialVersion: string | null;
};

export type CanonicalItemConstant = {
  id: string;
  name: string;
  localizedName: string;
  cost: number | null;
  category: string | null;
  description: string;
  attributes: Array<{ label: string; value: string }>;
  componentNames: string[];
  kind: "item" | "recipe" | "neutral_item" | "neutral_enhancement";
  availabilityStatus: "verified_current" | "unverified";
  officialVersion: string | null;
  officialClassification?: {
    itemQuality: number;
    neutralItemTier: number | null;
    isPregameSuggested: boolean;
    isEarlygameSuggested: boolean;
    isLategameSuggested: boolean;
  };
  officialRecipes?: Array<{
    componentIds: string[];
    componentNames: string[];
  }>;
};

export type CanonicalPatchSummary = {
  id: string;
  name: string;
  releasedAt: string;
};

export type CanonicalHeroAbilityConstant = {
  id: string;
  name: string;
  localizedName: string;
  description: string;
  slot: number;
  type: "innate" | "basic" | "ultimate" | "talent";
};

export type CanonicalHeroFacetConstant = {
  name: string;
  description: string;
};

export type CanonicalHeroAbilitySet = {
  heroName: string;
  abilities: CanonicalHeroAbilityConstant[];
  facetsStatus: "active" | "removed" | "unavailable";
  facets: CanonicalHeroFacetConstant[];
  excludedAbilityNames: string[];
};

export type CanonicalHeroAbilityConstants = {
  heroes: Record<string, CanonicalHeroAbilitySet>;
  source: DotaDataSourceMetadata;
};

export type CanonicalConstantsSnapshot<T> = {
  items: T[];
  source: DotaDataSourceMetadata;
};

export type CanonicalOfficialCatalogExclusion = {
  entityType: "patch" | "hero" | "item" | "ability" | "facet";
  entityId: string | null;
  entityName: string | null;
  kind: "filtered" | "failed";
  reason: string;
  retryable: boolean;
};

export type CanonicalOfficialConstantsSnapshot<T> = CanonicalConstantsSnapshot<T> & {
  officialVersion: string;
  quality: "complete" | "partial";
  exclusions: CanonicalOfficialCatalogExclusion[];
  source: Dota2OfficialSourceMetadata;
};

export type CanonicalOfficialHeroAbilityConstants = CanonicalHeroAbilityConstants & {
  officialVersion: string;
  quality: "complete" | "partial";
  exclusions: CanonicalOfficialCatalogExclusion[];
  source: Dota2OfficialSourceMetadata;
};

export type CanonicalOfficialHeroCatalog = {
  heroes: CanonicalOfficialConstantsSnapshot<CanonicalHeroConstant>;
  abilities: CanonicalOfficialHeroAbilityConstants;
};

export type StratzAbilityUpgradeEvent = {
  abilityId: string;
  sequence: number;
  heroLevel: number;
  gameTimeSeconds: number;
};

export type StratzItemPurchaseEvent = {
  itemId: string;
  action: "purchase";
  gameTimeSeconds: number;
  charges: null;
};

export type StratzMatchPlayer = {
  steamAccountId: string | null;
  playerSlot: number;
  heroId: string;
  side: "radiant" | "dire";
  isWin: boolean;
  kills: number;
  deaths: number;
  assists: number;
  gpm: number | null;
  xpm: number | null;
  lastHits: number | null;
  denies: number | null;
  heroDamage: number | null;
  heroHealing: number | null;
  towerDamage: number | null;
  level: number | null;
  netWorth: number | null;
  finalItemIds: string[];
  backpackItemIds: string[];
  neutralItemId: string | null;
  abilityBuild: StratzAbilityUpgradeEvent[];
  abilityBuildStatus: "unavailable" | "timed";
  itemTimeline: StratzItemPurchaseEvent[];
  itemTimelineStatus: "unavailable" | "partial";
};

export type StratzMatchDetail = {
  id: string;
  startTime: string;
  durationSeconds: number;
  gameVersionId: string | null;
  gameMode: string;
  lobbyType: string | null;
  region: string | null;
  cluster: string | null;
  radiantWin: boolean;
  eligiblePlayerCount: number;
  excludedPlayerCount: number;
  exclusionReasons: string[];
  quality: "complete" | "partial";
  players: StratzMatchPlayer[];
  source: StratzSourceMetadata;
};

export type StratzPlayerSummary = {
  steamAccountId: string;
  personaName: string | null;
  avatarUrl: string | null;
  matchCount: number | null;
  winCount: number | null;
  lastMatchAt: string | null;
  privacyStatus: "public" | "anonymous" | "unknown";
  quality: "complete" | "partial";
  source: StratzSourceMetadata;
};

export type StratzRecentMatch = Omit<StratzMatchDetail, "players"> & {
  player: StratzMatchPlayer;
};

export type StratzRecentMatches = {
  steamAccountId: string;
  requestedLimit: number;
  privacyStatus: StratzPlayerSummary["privacyStatus"];
  quality: "complete" | "partial";
  eligibleCount: number;
  excludedCount: number;
  exclusionReasons: string[];
  matches: StratzRecentMatch[];
  source: StratzSourceMetadata;
};
