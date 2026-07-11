import type {
  HeroDetail,
  ItemDetail,
  MapVersion,
  MatchDetail,
  PlayerProfile,
  SyncJob,
} from "@dodo/contracts";

import type { DodoRepository, StoredMatch } from "./types.js";
import type {
  DataSource,
  PlayerSyncBatch,
  PlayerSyncFailure,
  ProviderHealth,
  StaticDataSnapshot,
} from "./types.js";

const clone = <T>(value: T): T => structuredClone(value);

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
  readonly #players = new Map<string, PlayerProfile>();
  readonly #matches = new Map<string, StoredMatch>();
  readonly #playerMatchIds = new Map<string, Set<string>>();
  readonly #syncJobs = new Map<string, SyncJob>();
  readonly #syncBatches = new Map<string, PlayerSyncBatch>();
  readonly #syncFailures = new Map<string, PlayerSyncFailure>();
  readonly #providerHealth = new Map<DataSource, ProviderHealth>();
  #heroSnapshot: StaticDataSnapshot | undefined;
  #itemSnapshot: StaticDataSnapshot | undefined;
  #currentMapId: string | undefined;

  async upsertHero(hero: HeroDetail): Promise<void> {
    this.#heroes.set(hero.id, clone(hero));
  }

  async upsertItem(item: ItemDetail): Promise<void> {
    this.#items.set(item.id, clone(item));
  }

  async upsertMap(map: MapVersion): Promise<void> {
    this.#maps.set(map.id, clone(map));
    this.#currentMapId = map.id;
  }

  async upsertPlayer(profile: PlayerProfile): Promise<void> {
    this.#players.set(profile.accountId, clone(profile));
  }

  async upsertMatch(match: StoredMatch): Promise<void> {
    const existing = this.#matches.get(match.detail.id);
    const playersBySlot = new Map(
      existing?.detail.players.map((player) => [player.playerSlot, player]) ?? [],
    );
    for (const player of match.detail.players) {
      const previous = playersBySlot.get(player.playerSlot);
      playersBySlot.set(player.playerSlot, {
        ...player,
        accountId: player.accountId ?? previous?.accountId ?? null,
      });
    }
    const stored = clone({
      ...match,
      detail: { ...match.detail, players: [...playersBySlot.values()] },
    });
    this.#matches.set(match.detail.id, stored);
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

  async replaceHeroes(heroes: HeroDetail[], snapshot: StaticDataSnapshot): Promise<void> {
    this.#heroes.clear();
    for (const hero of heroes) await this.upsertHero(hero);
    this.#heroSnapshot = clone(snapshot);
  }

  async replaceItems(items: ItemDetail[], snapshot: StaticDataSnapshot): Promise<void> {
    this.#items.clear();
    for (const item of items) await this.upsertItem(item);
    this.#itemSnapshot = clone(snapshot);
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

  async getCurrentMap(): Promise<MapVersion | undefined> {
    if (!this.#currentMapId) return undefined;
    return this.getMap(this.#currentMapId);
  }

  async getMap(id: string): Promise<MapVersion | undefined> {
    const map = this.#maps.get(id);
    return map ? clone(map) : undefined;
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

  async getSyncJob(jobId: string): Promise<SyncJob | undefined> {
    const job = this.#syncJobs.get(jobId);
    return job ? clone(job) : undefined;
  }

  async getMatch(id: string): Promise<StoredMatch | undefined> {
    const match = this.#matches.get(id);
    return match ? clone(match) : undefined;
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
