export type OpenDotaSourceMetadata = {
  source: "opendota";
  fetchedAt: string;
};

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
  heroDamage: number | null;
  finalItemIds: string[];
};

export type CanonicalPlayerMatch = {
  id: string;
  startTime: string;
  durationSeconds: number;
  patchId: string | null;
  gameMode: string;
  region: string | null;
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

export type CanonicalMatchDetail = {
  id: string;
  startTime: string;
  durationSeconds: number;
  patchId: string | null;
  gameMode: string;
  region: string | null;
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
};

export type CanonicalConstantsSnapshot<T> = {
  items: T[];
  source: OpenDotaSourceMetadata;
};
