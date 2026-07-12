import type {
  DataStatus,
  HeroDetail,
  ItemDetail,
  MapVersion,
  MatchDetail,
  OperationMeta,
  PatchSummary,
  PlayerHistorySync,
  PlayerProfile,
  SyncJob,
} from "@dodo/contracts";

export type DataSource = OperationMeta["sources"][number];
export type DataQuality = OperationMeta["quality"];

export type StoredMatch = {
  detail: MatchDetail;
  importedAt: string;
  source: DataSource;
  quality: DataQuality;
};

export type PlayerSyncCandidateEntry =
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

export type PlayerSyncBatch = {
  accountId: string;
  eligibleCount: number;
  sampleSize: number;
  excludedCount: number;
  exclusionReasons: string[];
  quality: DataQuality;
  source: DataSource;
  fetchedAt: string;
  candidateLedger: PlayerSyncCandidateEntry[];
};

export type StaticDataSnapshot = {
  source: DataSource;
  quality: DataQuality;
  fetchedAt: string;
};

export type ProviderHealth = DataStatus["providers"][number];

export type PlayerSyncFailure = {
  accountId: string;
  source: DataSource;
  checkedAt: string;
  retryAfterSeconds: number | null;
};

export interface DodoRepository {
  upsertHero(hero: HeroDetail): Promise<void>;
  upsertItem(item: ItemDetail): Promise<void>;
  upsertMap(map: MapVersion): Promise<void>;
  upsertPlayer(profile: PlayerProfile): Promise<void>;
  upsertMatch(match: StoredMatch): Promise<void>;
  replacePlayerMatches(accountId: string, matches: StoredMatch[]): Promise<void>;
  upsertPlayerMatches(accountId: string, matches: StoredMatch[]): Promise<void>;
  commitPlayerHistoryPage(
    accountId: string,
    matches: StoredMatch[],
    state: PlayerHistorySync,
  ): Promise<void>;
  tryAcquirePlayerHistorySyncLease(
    state: PlayerHistorySync,
    leaseExpiresBefore: string,
  ): Promise<boolean>;
  upsertSyncJob(job: SyncJob): Promise<void>;
  upsertPlayerSyncBatch(batch: PlayerSyncBatch): Promise<void>;
  upsertPlayerSyncFailure(failure: PlayerSyncFailure): Promise<void>;
  clearPlayerSyncFailure(accountId: string): Promise<void>;
  replaceHeroes(heroes: HeroDetail[], snapshot: StaticDataSnapshot): Promise<void>;
  replaceItems(items: ItemDetail[], snapshot: StaticDataSnapshot): Promise<void>;
  replacePatches(patches: PatchSummary[], snapshot: StaticDataSnapshot): Promise<void>;
  upsertProviderHealth(health: ProviderHealth): Promise<void>;
  getHero(id: string): Promise<HeroDetail | undefined>;
  listHeroes(): Promise<HeroDetail[]>;
  getHeroSnapshot(): Promise<StaticDataSnapshot | undefined>;
  getItem(id: string): Promise<ItemDetail | undefined>;
  listItems(): Promise<ItemDetail[]>;
  getItemSnapshot(): Promise<StaticDataSnapshot | undefined>;
  getPatch(id: string): Promise<PatchSummary | undefined>;
  listPatches(): Promise<PatchSummary[]>;
  getPatchSnapshot(): Promise<StaticDataSnapshot | undefined>;
  getCurrentMap(): Promise<MapVersion | undefined>;
  getMap(id: string): Promise<MapVersion | undefined>;
  getPlayer(accountId: string): Promise<PlayerProfile | undefined>;
  getPlayerSyncBatch(accountId: string): Promise<PlayerSyncBatch | undefined>;
  getPlayerSyncFailure(accountId: string): Promise<PlayerSyncFailure | undefined>;
  getPlayerHistorySync(accountId: string): Promise<PlayerHistorySync | undefined>;
  getSyncJob(jobId: string): Promise<SyncJob | undefined>;
  getMatch(id: string): Promise<StoredMatch | undefined>;
  listPlayerMatches(accountId: string): Promise<StoredMatch[]>;
  getProviderHealth(source: DataSource): Promise<ProviderHealth | undefined>;
  getLatestMatchAt(): Promise<string | null>;
  close(): Promise<void>;
}
