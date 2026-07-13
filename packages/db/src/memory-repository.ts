import type {
  HeroDetail,
  ItemDetail,
  MapVersion,
  MatchDetail,
  PatchSummary,
  PlayerHistorySync,
  PlayerProfile,
  SyncJob,
  UpdateReleaseDetail,
  UpdateReleaseSummary,
} from "@dodo/contracts";
import { heroDetailSchema, stratzEnrichmentStateSchema } from "@dodo/contracts";

import type { DodoRepository, StoredMatch } from "./types.js";
import type {
  DataSource,
  PlayerSyncBatch,
  PlayerSyncFailure,
  ProviderHealth,
  StaticDataSnapshot,
} from "./types.js";
import { mergeMatchDetails } from "./match-merge.js";
import {
  calculateMapContentHash,
  parseAuditedMapPayload,
  parseConsistentMapSnapshot,
} from "./map-snapshot.js";

const clone = <T>(value: T): T => structuredClone(value);
const normalizeSnapshot = (snapshot: StaticDataSnapshot): StaticDataSnapshot => ({
  ...snapshot,
  checkedAt: snapshot.checkedAt ?? snapshot.fetchedAt,
  changedAt: snapshot.changedAt ?? snapshot.fetchedAt,
  contentHash: snapshot.contentHash ?? null,
  officialVersion: snapshot.officialVersion ?? null,
});

const compareDecimalIdDescending = (left: string, right: string): number => {
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const leftId = BigInt(left);
    const rightId = BigInt(right);
    return leftId === rightId ? 0 : rightId > leftId ? 1 : -1;
  }
  return right.localeCompare(left);
};

const compareMatch = (left: StoredMatch, right: StoredMatch): number => {
  const byStartTime = Date.parse(right.detail.startTime) - Date.parse(left.detail.startTime);
  return byStartTime || compareDecimalIdDescending(left.detail.id, right.detail.id);
};

const includesAccount = (match: MatchDetail, accountId: string): boolean =>
  match.players.some((player) => player.accountId === accountId);

export class MemoryDodoRepository implements DodoRepository {
  readonly #heroes = new Map<string, HeroDetail>();
  readonly #items = new Map<string, ItemDetail>();
  readonly #maps = new Map<string, MapVersion>();
  readonly #patches = new Map<string, PatchSummary>();
  #updateReleases = new Map<string, UpdateReleaseDetail>();
  readonly #players = new Map<string, PlayerProfile>();
  readonly #matches = new Map<string, StoredMatch>();
  readonly #playerMatchIds = new Map<string, Set<string>>();
  readonly #syncJobs = new Map<string, SyncJob>();
  readonly #syncBatches = new Map<string, PlayerSyncBatch>();
  readonly #syncFailures = new Map<string, PlayerSyncFailure>();
  readonly #historySyncs = new Map<string, PlayerHistorySync>();
  readonly #providerHealth = new Map<DataSource, ProviderHealth>();
  #heroSnapshot: StaticDataSnapshot | undefined;
  #itemSnapshot: StaticDataSnapshot | undefined;
  #patchSnapshot: StaticDataSnapshot | undefined;
  #updateSnapshot: StaticDataSnapshot | undefined;
  #mapSnapshot: StaticDataSnapshot | undefined;
  #currentMapId: string | undefined;

  async upsertHero(hero: HeroDetail): Promise<void> {
    const parsed = heroDetailSchema.parse(hero);
    this.#heroes.set(parsed.id, clone(parsed));
  }

  async upsertItem(item: ItemDetail): Promise<void> {
    this.#items.set(item.id, clone(item));
  }

  async replaceMap(map: MapVersion, snapshot: StaticDataSnapshot): Promise<void> {
    const parsed = parseConsistentMapSnapshot(map, snapshot);
    const existing = this.#maps.get(parsed.id);
    if (existing && calculateMapContentHash(existing) !== snapshot.contentHash) {
      throw new Error(`Map version ${parsed.id} already exists with different content`);
    }

    if (this.#currentMapId !== parsed.id) {
      this.#maps.set(parsed.id, clone(parsed));
      this.#currentMapId = parsed.id;
    }
    this.#mapSnapshot = clone(normalizeSnapshot(snapshot));
  }

  async upsertPlayer(profile: PlayerProfile): Promise<void> {
    this.#players.set(profile.accountId, clone(profile));
  }

  async upsertMatch(match: StoredMatch): Promise<void> {
    const existing = this.#matches.get(match.detail.id);
    const incomingDetail = {
      ...match.detail,
      stratzEnrichment: stratzEnrichmentStateSchema.parse(
        (match.detail as MatchDetail & { stratzEnrichment?: unknown }).stratzEnrichment,
      ),
    };
    const stored = clone({
      ...match,
      detail: mergeMatchDetails(existing?.detail, incomingDetail),
    });
    const contentChanged =
      !existing ||
      existing.source !== stored.source ||
      existing.quality !== stored.quality ||
      JSON.stringify(existing.detail) !== JSON.stringify(stored.detail);
    if (contentChanged) this.#matches.set(match.detail.id, stored);
    for (const player of stored.detail.players) {
      if (player.accountId === null) continue;
      const matchIds = this.#playerMatchIds.get(player.accountId) ?? new Set<string>();
      matchIds.add(stored.detail.id);
      this.#playerMatchIds.set(player.accountId, matchIds);
    }
  }

  async replacePlayerMatches(accountId: string, matches: StoredMatch[]): Promise<void> {
    const previousMatchIds = this.#playerMatchIds.get(accountId) ?? new Set<string>();
    const matchIds = new Set<string>();
    for (const match of matches) {
      await this.upsertMatch(match);
      matchIds.add(match.detail.id);
    }
    this.#playerMatchIds.set(accountId, matchIds);
    for (const previousMatchId of previousMatchIds) {
      if (matchIds.has(previousMatchId)) continue;
      const stillReferenced = [...this.#playerMatchIds.values()].some((ids) =>
        ids.has(previousMatchId),
      );
      if (!stillReferenced) this.#matches.delete(previousMatchId);
    }
  }

  async upsertPlayerMatches(accountId: string, matches: StoredMatch[]): Promise<void> {
    const matchIds = this.#playerMatchIds.get(accountId) ?? new Set<string>();
    for (const match of matches) {
      await this.upsertMatch(match);
      matchIds.add(match.detail.id);
    }
    this.#playerMatchIds.set(accountId, matchIds);
  }

  async commitPlayerHistoryPage(
    accountId: string,
    matches: StoredMatch[],
    state: PlayerHistorySync,
  ): Promise<void> {
    await this.upsertPlayerMatches(accountId, matches);
    this.#historySyncs.set(accountId, clone(state));
  }

  async tryAcquirePlayerHistorySyncLease(
    state: PlayerHistorySync,
    leaseExpiresBefore: string,
  ): Promise<boolean> {
    const existing = this.#historySyncs.get(state.accountId);
    if (
      existing?.reachedEnd ||
      (existing?.status === "syncing" &&
        existing.requestedAt !== null &&
        Date.parse(existing.requestedAt) > Date.parse(leaseExpiresBefore))
    ) {
      return false;
    }
    this.#historySyncs.set(state.accountId, clone(state));
    return true;
  }

  async upsertSyncJob(job: SyncJob): Promise<void> {
    this.#syncJobs.set(job.jobId, clone(job));
  }

  async upsertPlayerSyncBatch(batch: PlayerSyncBatch): Promise<void> {
    this.#syncBatches.set(batch.accountId, clone(batch));
  }

  async upsertPlayerSyncFailure(failure: PlayerSyncFailure): Promise<void> {
    this.#syncFailures.set(failure.accountId, clone(failure));
  }

  async clearPlayerSyncFailure(accountId: string): Promise<void> {
    this.#syncFailures.delete(accountId);
  }

  async replaceHeroes(
    heroes: HeroDetail[],
    snapshot: StaticDataSnapshot,
    universeIds: string[],
  ): Promise<void> {
    const universe = new Set(universeIds);
    for (const id of this.#heroes.keys()) {
      if (!universe.has(id)) this.#heroes.delete(id);
    }
    for (const hero of heroes) await this.upsertHero(hero);
    this.#heroSnapshot = clone(normalizeSnapshot(snapshot));
  }

  async replaceItems(
    items: ItemDetail[],
    snapshot: StaticDataSnapshot,
    universeIds: string[],
  ): Promise<void> {
    const universe = new Set(universeIds);
    for (const id of this.#items.keys()) {
      if (!universe.has(id)) this.#items.delete(id);
    }
    for (const item of items) await this.upsertItem(item);
    this.#itemSnapshot = clone(normalizeSnapshot(snapshot));
  }

  async replacePatches(patches: PatchSummary[], snapshot: StaticDataSnapshot): Promise<void> {
    this.#patches.clear();
    for (const patch of patches) this.#patches.set(patch.id, clone(patch));
    this.#patchSnapshot = clone(normalizeSnapshot(snapshot));
  }

  async replaceUpdateReleases(
    releases: UpdateReleaseDetail[],
    snapshot: StaticDataSnapshot,
  ): Promise<void> {
    const next =
      snapshot.quality === "partial"
        ? new Map([...this.#updateReleases].map(([version, release]) => [version, clone(release)]))
        : new Map<string, UpdateReleaseDetail>();
    for (const release of releases) next.set(release.version, clone(release));
    this.#updateReleases = next;
    this.#updateSnapshot = clone(normalizeSnapshot(snapshot));
  }

  async touchStaticSnapshot(
    kind: "hero" | "item" | "patch" | "update" | "map",
    expectedContentHash: string | null,
    snapshot: StaticDataSnapshot,
  ): Promise<boolean> {
    const current =
      kind === "hero"
        ? this.#heroSnapshot
        : kind === "item"
          ? this.#itemSnapshot
          : kind === "patch"
            ? this.#patchSnapshot
            : kind === "update"
              ? this.#updateSnapshot
              : this.#mapSnapshot;
    if (!current || current.contentHash !== expectedContentHash) return false;
    const normalized = clone(normalizeSnapshot(snapshot));
    if (kind === "map") {
      const map = this.#currentMapId ? this.#maps.get(this.#currentMapId) : undefined;
      if (!map) return false;
      parseConsistentMapSnapshot(map, normalized);
    }
    if (kind === "hero") this.#heroSnapshot = normalized;
    else if (kind === "item") this.#itemSnapshot = normalized;
    else if (kind === "patch") this.#patchSnapshot = normalized;
    else if (kind === "update") this.#updateSnapshot = normalized;
    else this.#mapSnapshot = normalized;
    return true;
  }

  async upsertProviderHealth(health: ProviderHealth): Promise<void> {
    this.#providerHealth.set(health.source, clone(health));
  }

  async getHero(id: string): Promise<HeroDetail | undefined> {
    const hero = this.#heroes.get(id);
    return hero ? clone(hero) : undefined;
  }

  async listHeroes(): Promise<HeroDetail[]> {
    return [...this.#heroes.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(clone);
  }

  async getHeroSnapshot(): Promise<StaticDataSnapshot | undefined> {
    return this.#heroSnapshot ? clone(this.#heroSnapshot) : undefined;
  }

  async getItem(id: string): Promise<ItemDetail | undefined> {
    const item = this.#items.get(id);
    return item ? clone(item) : undefined;
  }

  async listItems(): Promise<ItemDetail[]> {
    return [...this.#items.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(clone);
  }

  async getItemSnapshot(): Promise<StaticDataSnapshot | undefined> {
    return this.#itemSnapshot ? clone(this.#itemSnapshot) : undefined;
  }

  async getPatch(id: string): Promise<PatchSummary | undefined> {
    const patch = this.#patches.get(id);
    return patch ? clone(patch) : undefined;
  }

  async listPatches(): Promise<PatchSummary[]> {
    return [...this.#patches.values()]
      .sort(
        (left, right) =>
          Date.parse(right.releasedAt) - Date.parse(left.releasedAt) ||
          right.id.localeCompare(left.id),
      )
      .map(clone);
  }

  async getPatchSnapshot(): Promise<StaticDataSnapshot | undefined> {
    return this.#patchSnapshot ? clone(this.#patchSnapshot) : undefined;
  }

  async listUpdateReleases(): Promise<UpdateReleaseSummary[]> {
    return [...this.#updateReleases.values()]
      .sort(
        (left, right) =>
          Date.parse(right.releasedAt) - Date.parse(left.releasedAt) ||
          right.version.localeCompare(left.version),
      )
      .map(({ groups: _groups, ...summary }) => clone(summary));
  }

  async getUpdateRelease(version: string): Promise<UpdateReleaseDetail | undefined> {
    const release = this.#updateReleases.get(version);
    return release ? clone(release) : undefined;
  }

  async getUpdateSnapshot(): Promise<StaticDataSnapshot | undefined> {
    return this.#updateSnapshot ? clone(this.#updateSnapshot) : undefined;
  }

  async getMapSnapshot(): Promise<StaticDataSnapshot | undefined> {
    return this.#mapSnapshot ? clone(this.#mapSnapshot) : undefined;
  }

  async getCurrentMap(): Promise<MapVersion | undefined> {
    if (!this.#currentMapId) return undefined;
    return this.getMap(this.#currentMapId);
  }

  async getMap(id: string): Promise<MapVersion | undefined> {
    const map = this.#maps.get(id);
    return map ? clone(parseAuditedMapPayload(map)) : undefined;
  }

  async getPlayer(accountId: string): Promise<PlayerProfile | undefined> {
    const profile = this.#players.get(accountId);
    if (!profile) return undefined;

    const matches = await this.listPlayerMatches(accountId);
    const importedAt = matches
      .map((match) => match.importedAt)
      .sort((left, right) => Date.parse(left) - Date.parse(right));
    return clone({
      ...profile,
      importedMatchCount: matches.length,
      earliestImportedAt: importedAt[0] ?? profile.earliestImportedAt,
      latestImportedAt: importedAt.at(-1) ?? profile.latestImportedAt,
    });
  }

  async getPlayerSyncBatch(accountId: string): Promise<PlayerSyncBatch | undefined> {
    const batch = this.#syncBatches.get(accountId);
    return batch ? clone(batch) : undefined;
  }

  async getPlayerSyncFailure(accountId: string): Promise<PlayerSyncFailure | undefined> {
    const failure = this.#syncFailures.get(accountId);
    return failure ? clone(failure) : undefined;
  }

  async getPlayerHistorySync(accountId: string): Promise<PlayerHistorySync | undefined> {
    const state = this.#historySyncs.get(accountId);
    return state ? clone(state) : undefined;
  }

  async getSyncJob(jobId: string): Promise<SyncJob | undefined> {
    const job = this.#syncJobs.get(jobId);
    return job ? clone(job) : undefined;
  }

  async getMatch(id: string): Promise<StoredMatch | undefined> {
    const match = this.#matches.get(id);
    return match ? clone(match) : undefined;
  }

  async listMatchIdsMissingNeutralItemEnhancement(matchIds: string[]): Promise<string[]> {
    return [...new Set(matchIds)].slice(0, 20).filter((matchId) =>
      this.#matches.get(matchId)?.detail.players.some(
        (player) =>
          !Object.prototype.hasOwnProperty.call(player, "neutralItemEnhancementId"),
      ),
    );
  }

  async listPlayerMatches(accountId: string): Promise<StoredMatch[]> {
    const indexedMatchIds = this.#playerMatchIds.get(accountId);
    const matches = indexedMatchIds
      ? [...indexedMatchIds].flatMap((matchId) => {
          const match = this.#matches.get(matchId);
          return match ? [match] : [];
        })
      : [...this.#matches.values()].filter((match) => includesAccount(match.detail, accountId));
    return matches
      .sort(compareMatch)
      .map(clone);
  }

  async getProviderHealth(source: DataSource): Promise<ProviderHealth | undefined> {
    const health = this.#providerHealth.get(source);
    return health ? clone(health) : undefined;
  }

  async getLatestMatchAt(): Promise<string | null> {
    const startTimes = [...this.#matches.values()].map((match) => match.detail.startTime);
    return startTimes.sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
  }

  async close(): Promise<void> {}
}
