import {
  dataQualitySchema,
  dataSourceSchema,
  heroDetailSchema,
  itemDetailSchema,
  mapVersionSchema,
  matchDetailSchema,
  patchSummarySchema,
  playerHistorySyncSchema,
  playerProfileSchema,
  syncJobSchema,
  timestampSchema,
  updateReleaseDetailSchema,
  type HeroDetail,
  type ItemDetail,
  type MapVersion,
  type MatchDetail,
  type PatchSummary,
  type PlayerHistorySync,
  type PlayerProfile,
  type SyncJob,
  type UpdateReleaseDetail,
  type UpdateReleaseSummary,
} from "@dodo/contracts";
import postgres, { type Sql } from "postgres";

import type {
  DataQuality,
  DataSource,
  DodoRepository,
  PlayerSyncBatch,
  PlayerSyncFailure,
  ProviderHealth,
  StaticDataSnapshot,
  StoredMatch,
} from "./types.js";

type JsonRow = { payload: unknown };
type QuerySql = Sql | postgres.TransactionSql;

export type PostgresDodoRepositoryOptions = {
  databaseUrl?: string;
  sql?: Sql;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const withLegacyMatchDefaults = (value: unknown): unknown => {
  if (!isRecord(value)) return value;
  const players = Array.isArray(value.players)
    ? value.players.map((player) => {
        if (!isRecord(player)) return player;
        return {
          ...player,
          denies: player.denies ?? null,
          heroHealing: player.heroHealing ?? null,
          towerDamage: player.towerDamage ?? null,
          level: player.level ?? null,
          netWorth: player.netWorth ?? null,
          backpackItemIds: player.backpackItemIds ?? [],
          neutralItemId: player.neutralItemId ?? null,
          abilityBuild: player.abilityBuild ?? [],
          abilityBuildStatus: player.abilityBuildStatus ?? "unavailable",
          itemTimeline: player.itemTimeline ?? [],
          itemTimelineStatus: player.itemTimelineStatus ?? "unavailable",
        };
      })
    : value.players;
  return {
    ...value,
    players,
    detailStatus: value.detailStatus ?? "summary",
    lobbyType: value.lobbyType ?? null,
    cluster: value.cluster ?? null,
    radiantScore: value.radiantScore ?? null,
    direScore: value.direScore ?? null,
  };
};

const parseStoredMatchDetail = (value: unknown): MatchDetail =>
  matchDetailSchema.parse(withLegacyMatchDefaults(value));

const toJson = (value: unknown): postgres.JSONValue =>
  JSON.parse(JSON.stringify(value)) as postgres.JSONValue;

const asTimestamp = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return new Date(value).toISOString();
  throw new Error("Stored timestamp is invalid");
};

const compareDecimalIdDescending = (left: string, right: string): number => {
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const leftId = BigInt(left);
    const rightId = BigInt(right);
    return leftId === rightId ? 0 : rightId > leftId ? 1 : -1;
  }
  return right.localeCompare(left);
};

const compareMatch = (left: StoredMatch, right: StoredMatch): number =>
  Date.parse(right.detail.startTime) - Date.parse(left.detail.startTime) ||
  compareDecimalIdDescending(left.detail.id, right.detail.id);

const parseSnapshot = (value: unknown): StaticDataSnapshot => {
  if (!isRecord(value)) throw new Error("Stored static snapshot is invalid");
  return {
    source: dataSourceSchema.parse(value.source),
    quality: dataQualitySchema.parse(value.quality),
    fetchedAt: timestampSchema.parse(value.fetchedAt),
  };
};

const parsePlayerSyncBatch = (value: unknown): PlayerSyncBatch => {
  if (!isRecord(value) || !Array.isArray(value.candidateLedger)) {
    throw new Error("Stored player sync batch is invalid");
  }
  const candidateLedger = value.candidateLedger.map((entry) => {
    if (!isRecord(entry) || !Number.isInteger(entry.providerIndex)) {
      throw new Error("Stored player sync candidate is invalid");
    }
    if (entry.status === "included" && typeof entry.matchId === "string") {
      return {
        providerIndex: entry.providerIndex as number,
        status: "included" as const,
        matchId: entry.matchId,
      };
    }
    if (
      entry.status === "excluded" &&
      Array.isArray(entry.exclusionReasons) &&
      entry.exclusionReasons.every((reason) => typeof reason === "string")
    ) {
      return {
        providerIndex: entry.providerIndex as number,
        status: "excluded" as const,
        exclusionReasons: entry.exclusionReasons as string[],
      };
    }
    throw new Error("Stored player sync candidate is invalid");
  });
  const integers = [value.eligibleCount, value.sampleSize, value.excludedCount];
  if (
    typeof value.accountId !== "string" ||
    !integers.every((number) => Number.isInteger(number) && (number as number) >= 0) ||
    !Array.isArray(value.exclusionReasons) ||
    !value.exclusionReasons.every((reason) => typeof reason === "string")
  ) {
    throw new Error("Stored player sync batch is invalid");
  }
  return {
    accountId: value.accountId,
    eligibleCount: value.eligibleCount as number,
    sampleSize: value.sampleSize as number,
    excludedCount: value.excludedCount as number,
    exclusionReasons: value.exclusionReasons as string[],
    quality: dataQualitySchema.parse(value.quality),
    source: dataSourceSchema.parse(value.source),
    fetchedAt: timestampSchema.parse(value.fetchedAt),
    candidateLedger,
  };
};

const parsePlayerSyncFailure = (value: unknown): PlayerSyncFailure => {
  if (
    !isRecord(value) ||
    typeof value.accountId !== "string" ||
    (value.retryAfterSeconds !== null &&
      (!Number.isInteger(value.retryAfterSeconds) || (value.retryAfterSeconds as number) <= 0))
  ) {
    throw new Error("Stored player sync failure is invalid");
  }
  return {
    accountId: value.accountId,
    source: dataSourceSchema.parse(value.source),
    checkedAt: timestampSchema.parse(value.checkedAt),
    retryAfterSeconds: value.retryAfterSeconds as number | null,
  };
};

const parseProviderHealth = (value: unknown): ProviderHealth => {
  if (
    !isRecord(value) ||
    !["ready", "degraded", "unavailable"].includes(String(value.status)) ||
    (value.message !== null && typeof value.message !== "string")
  ) {
    throw new Error("Stored provider health is invalid");
  }
  return {
    source: dataSourceSchema.parse(value.source),
    status: value.status as ProviderHealth["status"],
    checkedAt: timestampSchema.parse(value.checkedAt),
    message: value.message as string | null,
  };
};

const mergeMatchPlayers = (existing: MatchDetail | undefined, incoming: MatchDetail): MatchDetail => {
  if (existing?.detailStatus === "enriched" && incoming.detailStatus === "summary") {
    return existing;
  }
  const playersBySlot = new Map(
    existing?.players.map((player) => [player.playerSlot, player]) ?? [],
  );
  for (const player of incoming.players) {
    const previous = playersBySlot.get(player.playerSlot);
    playersBySlot.set(player.playerSlot, {
      ...player,
      accountId: player.accountId ?? previous?.accountId ?? null,
    });
  }
  return { ...incoming, players: [...playersBySlot.values()] };
};

export class PostgresDodoRepository implements DodoRepository {
  readonly #sql: Sql;
  readonly #ownsConnection: boolean;

  constructor({ databaseUrl, sql }: PostgresDodoRepositoryOptions) {
    if (sql) {
      this.#sql = sql;
      this.#ownsConnection = false;
      return;
    }
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required when DODO_REPOSITORY=postgres");
    }
    this.#sql = postgres(databaseUrl);
    this.#ownsConnection = true;
  }

  async upsertHero(hero: HeroDetail): Promise<void> {
    await this.#upsertDocument("heroes", hero.id, hero);
  }

  async upsertItem(item: ItemDetail): Promise<void> {
    await this.#upsertDocument("items", item.id, item);
  }

  async upsertMap(map: MapVersion): Promise<void> {
    await this.#sql.begin(async (sql) => {
      await sql`update dodo.maps set is_current = false, updated_at = now() where is_current`;
      await sql`
        insert into dodo.maps (id, payload, is_current, updated_at)
        values (${map.id}, ${sql.json(toJson(map))}, true, now())
        on conflict (id) do update
        set payload = excluded.payload, is_current = true, updated_at = now()
      `;
    });
  }

  async upsertPlayer(profile: PlayerProfile): Promise<void> {
    await this.#sql`
      insert into dodo.players (account_id, payload, updated_at)
      values (${profile.accountId}, ${this.#sql.json(toJson(profile))}, now())
      on conflict (account_id) do update set payload = excluded.payload, updated_at = now()
    `;
  }

  async upsertMatch(match: StoredMatch): Promise<void> {
    await this.#sql.begin(async (sql) => this.#upsertMatch(sql, match, true));
  }

  async replacePlayerMatches(accountId: string, matches: StoredMatch[]): Promise<void> {
    await this.#sql.begin(async (sql) => {
      await sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`player-matches:${accountId}`}, 0)
        )
      `;
      const previousRows = await sql<{ match_id: string }[]>`
        select match_id from dodo.player_matches where account_id = ${accountId}
      `;
      for (const match of matches) {
        await this.#upsertMatch(sql, match, true);
        await sql`
          insert into dodo.player_matches (account_id, match_id, start_time)
          values (${accountId}, ${match.detail.id}, ${match.detail.startTime})
          on conflict (account_id, match_id) do update set start_time = excluded.start_time
        `;
      }

      const matchIds = [...new Set(matches.map((match) => match.detail.id))];
      if (matchIds.length === 0) {
        await sql`delete from dodo.player_matches where account_id = ${accountId}`;
      } else {
        await sql`
          delete from dodo.player_matches
          where account_id = ${accountId} and match_id not in ${sql(matchIds)}
        `;
      }

      const removedIds = previousRows
        .map((row) => row.match_id)
        .filter((matchId) => !matchIds.includes(matchId));
      if (removedIds.length > 0) {
        await sql`
          delete from dodo.matches m
          where m.id in ${sql(removedIds)}
            and not exists (
              select 1 from dodo.player_matches pm where pm.match_id = m.id
            )
        `;
      }
    });
  }

  async upsertPlayerMatches(accountId: string, matches: StoredMatch[]): Promise<void> {
    await this.#sql.begin(async (sql) => {
      await this.#upsertPlayerMatches(sql, accountId, matches);
    });
  }

  async commitPlayerHistoryPage(
    accountId: string,
    matches: StoredMatch[],
    state: PlayerHistorySync,
  ): Promise<void> {
    await this.#sql.begin(async (sql) => {
      await this.#upsertPlayerMatches(sql, accountId, matches);
      await sql`
        insert into dodo.player_history_sync (account_id, payload, updated_at)
        values (${accountId}, ${sql.json(toJson(state))}, now())
        on conflict (account_id) do update set payload = excluded.payload, updated_at = now()
      `;
    });
  }

  async tryAcquirePlayerHistorySyncLease(
    state: PlayerHistorySync,
    leaseExpiresBefore: string,
  ): Promise<boolean> {
    return this.#sql.begin(async (sql) => {
      await sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`player-history:${state.accountId}`}, 0)
        )
      `;
      const [row] = await sql<JsonRow[]>`
        select payload from dodo.player_history_sync
        where account_id = ${state.accountId}
        for update
      `;
      if (row) {
        const existing = playerHistorySyncSchema.parse(row.payload);
        const leaseIsFresh =
          existing.status === "syncing" &&
          existing.requestedAt !== null &&
          Date.parse(existing.requestedAt) > Date.parse(leaseExpiresBefore);
        if (existing.reachedEnd || leaseIsFresh) return false;
      }
      await sql`
        insert into dodo.player_history_sync (account_id, payload, updated_at)
        values (${state.accountId}, ${sql.json(toJson(state))}, now())
        on conflict (account_id) do update set payload = excluded.payload, updated_at = now()
      `;
      return true;
    });
  }

  async upsertSyncJob(job: SyncJob): Promise<void> {
    await this.#sql`
      insert into dodo.sync_jobs (job_id, payload, updated_at)
      values (${job.jobId}, ${this.#sql.json(toJson(job))}, now())
      on conflict (job_id) do update set payload = excluded.payload, updated_at = now()
    `;
  }

  async upsertPlayerSyncBatch(batch: PlayerSyncBatch): Promise<void> {
    await this.#sql`
      insert into dodo.player_sync_batches (account_id, payload, updated_at)
      values (${batch.accountId}, ${this.#sql.json(toJson(batch))}, now())
      on conflict (account_id) do update set payload = excluded.payload, updated_at = now()
    `;
  }

  async upsertPlayerSyncFailure(failure: PlayerSyncFailure): Promise<void> {
    await this.#sql`
      insert into dodo.player_sync_failures (account_id, payload, checked_at, updated_at)
      values (${failure.accountId}, ${this.#sql.json(toJson(failure))}, ${failure.checkedAt}, now())
      on conflict (account_id) do update
      set payload = excluded.payload, checked_at = excluded.checked_at, updated_at = now()
    `;
  }

  async clearPlayerSyncFailure(accountId: string): Promise<void> {
    await this.#sql`delete from dodo.player_sync_failures where account_id = ${accountId}`;
  }

  async replaceHeroes(heroes: HeroDetail[], snapshot: StaticDataSnapshot): Promise<void> {
    await this.#sql.begin(async (sql) => {
      await sql`
        select pg_advisory_xact_lock(hashtextextended('catalog:heroes', 0))
      `;
      await sql`delete from dodo.heroes`;
      for (const hero of heroes) {
        await sql`
          insert into dodo.heroes (id, payload, updated_at)
          values (${hero.id}, ${sql.json(toJson(hero))}, now())
        `;
      }
      await this.#upsertSnapshot(sql, "hero", snapshot);
    });
  }

  async replaceItems(items: ItemDetail[], snapshot: StaticDataSnapshot): Promise<void> {
    await this.#sql.begin(async (sql) => {
      await sql`
        select pg_advisory_xact_lock(hashtextextended('catalog:items', 0))
      `;
      await sql`delete from dodo.items`;
      for (const item of items) {
        await sql`
          insert into dodo.items (id, payload, updated_at)
          values (${item.id}, ${sql.json(toJson(item))}, now())
        `;
      }
      await this.#upsertSnapshot(sql, "item", snapshot);
    });
  }

  async replacePatches(patches: PatchSummary[], snapshot: StaticDataSnapshot): Promise<void> {
    await this.#sql.begin(async (sql) => {
      await sql`
        select pg_advisory_xact_lock(hashtextextended('catalog:patches', 0))
      `;
      await sql`delete from dodo.patches`;
      for (const patch of patches) {
        await sql`
          insert into dodo.patches (id, payload, released_at, updated_at)
          values (${patch.id}, ${sql.json(toJson(patch))}, ${patch.releasedAt}, now())
        `;
      }
      await this.#upsertSnapshot(sql, "patch", snapshot);
    });
  }

  async replaceUpdateReleases(
    releases: UpdateReleaseDetail[],
    snapshot: StaticDataSnapshot,
  ): Promise<void> {
    await this.#sql.begin(async (sql) => {
      await sql`
        select pg_advisory_xact_lock(hashtextextended('catalog:updates', 0))
      `;
      if (snapshot.quality === "complete") await sql`delete from dodo.update_releases`;
      for (const release of releases) {
        await sql`
          insert into dodo.update_releases (version, payload, released_at, updated_at)
          values (
            ${release.version}, ${sql.json(toJson(release))}, ${release.releasedAt}, now()
          )
          on conflict (version) do update set
            payload = excluded.payload,
            released_at = excluded.released_at,
            updated_at = now()
        `;
      }
      await this.#upsertSnapshot(sql, "update", snapshot);
    });
  }

  async upsertProviderHealth(health: ProviderHealth): Promise<void> {
    await this.#sql`
      insert into dodo.provider_health (source, payload, checked_at, updated_at)
      values (${health.source}, ${this.#sql.json(toJson(health))}, ${health.checkedAt}, now())
      on conflict (source) do update
      set payload = excluded.payload, checked_at = excluded.checked_at, updated_at = now()
    `;
  }

  async getHero(id: string): Promise<HeroDetail | undefined> {
    return this.#getDocument("heroes", id, heroDetailSchema.parse);
  }

  async listHeroes(): Promise<HeroDetail[]> {
    const rows = await this.#sql<JsonRow[]>`select payload from dodo.heroes order by id`;
    return rows.map((row) => heroDetailSchema.parse(row.payload));
  }

  async getHeroSnapshot(): Promise<StaticDataSnapshot | undefined> {
    return this.#getSnapshot("hero");
  }

  async getItem(id: string): Promise<ItemDetail | undefined> {
    return this.#getDocument("items", id, itemDetailSchema.parse);
  }

  async listItems(): Promise<ItemDetail[]> {
    const rows = await this.#sql<JsonRow[]>`select payload from dodo.items order by id`;
    return rows.map((row) => itemDetailSchema.parse(row.payload));
  }

  async getItemSnapshot(): Promise<StaticDataSnapshot | undefined> {
    return this.#getSnapshot("item");
  }

  async getPatch(id: string): Promise<PatchSummary | undefined> {
    return this.#getDocument("patches", id, patchSummarySchema.parse);
  }

  async listPatches(): Promise<PatchSummary[]> {
    const rows = await this.#sql<JsonRow[]>`
      select payload from dodo.patches order by released_at desc, id desc
    `;
    return rows.map((row) => patchSummarySchema.parse(row.payload));
  }

  async getPatchSnapshot(): Promise<StaticDataSnapshot | undefined> {
    return this.#getSnapshot("patch");
  }

  async listUpdateReleases(): Promise<UpdateReleaseSummary[]> {
    const rows = await this.#sql<JsonRow[]>`
      select payload from dodo.update_releases order by released_at desc, version desc
    `;
    return rows.map((row) => {
      const { groups: _groups, ...summary } = updateReleaseDetailSchema.parse(row.payload);
      return summary;
    });
  }

  async getUpdateRelease(version: string): Promise<UpdateReleaseDetail | undefined> {
    const [row] = await this.#sql<JsonRow[]>`
      select payload from dodo.update_releases where version = ${version}
    `;
    return row ? updateReleaseDetailSchema.parse(row.payload) : undefined;
  }

  async getUpdateSnapshot(): Promise<StaticDataSnapshot | undefined> {
    return this.#getSnapshot("update");
  }

  async getCurrentMap(): Promise<MapVersion | undefined> {
    const [row] = await this.#sql<JsonRow[]>`
      select payload from dodo.maps where is_current order by updated_at desc limit 1
    `;
    return row ? mapVersionSchema.parse(row.payload) : undefined;
  }

  async getMap(id: string): Promise<MapVersion | undefined> {
    return this.#getDocument("maps", id, mapVersionSchema.parse);
  }

  async getPlayer(accountId: string): Promise<PlayerProfile | undefined> {
    const [row] = await this.#sql<JsonRow[]>`
      select p.payload,
        count(pm.match_id)::int as imported_match_count,
        min(m.imported_at) as earliest_imported_at,
        max(m.imported_at) as latest_imported_at
      from dodo.players p
      left join dodo.player_matches pm on pm.account_id = p.account_id
      left join dodo.matches m on m.id = pm.match_id
      where p.account_id = ${accountId}
      group by p.account_id, p.payload
    `;
    if (!row) return undefined;
    const profile = playerProfileSchema.parse(row.payload);
    const metadata = row as JsonRow & {
      imported_match_count: number;
      earliest_imported_at: unknown;
      latest_imported_at: unknown;
    };
    return {
      ...profile,
      importedMatchCount: metadata.imported_match_count,
      earliestImportedAt: asTimestamp(metadata.earliest_imported_at) ?? profile.earliestImportedAt,
      latestImportedAt: asTimestamp(metadata.latest_imported_at) ?? profile.latestImportedAt,
    };
  }

  async getPlayerSyncBatch(accountId: string): Promise<PlayerSyncBatch | undefined> {
    return this.#getPayload(
      this.#sql`select payload from dodo.player_sync_batches where account_id = ${accountId}`,
      parsePlayerSyncBatch,
    );
  }

  async getPlayerSyncFailure(accountId: string): Promise<PlayerSyncFailure | undefined> {
    return this.#getPayload(
      this.#sql`select payload from dodo.player_sync_failures where account_id = ${accountId}`,
      parsePlayerSyncFailure,
    );
  }

  async getPlayerHistorySync(accountId: string): Promise<PlayerHistorySync | undefined> {
    return this.#getPayload(
      this.#sql`select payload from dodo.player_history_sync where account_id = ${accountId}`,
      playerHistorySyncSchema.parse,
    );
  }

  async getSyncJob(jobId: string): Promise<SyncJob | undefined> {
    return this.#getPayload(
      this.#sql`select payload from dodo.sync_jobs where job_id = ${jobId}`,
      syncJobSchema.parse,
    );
  }

  async getMatch(id: string): Promise<StoredMatch | undefined> {
    const [row] = await this.#sql<
      (JsonRow & { imported_at: unknown; source: string; quality: string })[]
    >`
      select payload, imported_at, source, quality from dodo.matches where id = ${id}
    `;
    return row ? this.#parseStoredMatch(row) : undefined;
  }

  async listPlayerMatches(accountId: string): Promise<StoredMatch[]> {
    const rows = await this.#sql<
      (JsonRow & { imported_at: unknown; source: string; quality: string })[]
    >`
      select m.payload, m.imported_at, m.source, m.quality
      from dodo.player_matches pm
      join dodo.matches m on m.id = pm.match_id
      where pm.account_id = ${accountId}
      order by pm.start_time desc, pm.match_id desc
    `;
    return rows.map((row) => this.#parseStoredMatch(row)).sort(compareMatch);
  }

  async getProviderHealth(source: DataSource): Promise<ProviderHealth | undefined> {
    return this.#getPayload(
      this.#sql`select payload from dodo.provider_health where source = ${source}`,
      parseProviderHealth,
    );
  }

  async getLatestMatchAt(): Promise<string | null> {
    const [row] = await this.#sql<{ start_time: unknown }[]>`
      select max(start_time) as start_time from dodo.matches
    `;
    return asTimestamp(row?.start_time);
  }

  async close(): Promise<void> {
    if (this.#ownsConnection) await this.#sql.end({ timeout: 5 });
  }

  async #upsertDocument(
    table: "heroes" | "items",
    id: string,
    payload: HeroDetail | ItemDetail,
  ): Promise<void> {
    await this.#sql`
      insert into dodo.${this.#sql(table)} (id, payload, updated_at)
      values (${id}, ${this.#sql.json(toJson(payload))}, now())
      on conflict (id) do update set payload = excluded.payload, updated_at = now()
    `;
  }

  async #getDocument<T>(
    table: "heroes" | "items" | "maps" | "patches",
    id: string,
    parse: (value: unknown) => T,
  ): Promise<T | undefined> {
    const [row] = await this.#sql<JsonRow[]>`
      select payload from dodo.${this.#sql(table)} where id = ${id}
    `;
    return row ? parse(row.payload) : undefined;
  }

  async #getSnapshot(
    kind: "hero" | "item" | "patch" | "update",
  ): Promise<StaticDataSnapshot | undefined> {
    return this.#getPayload(
      this.#sql`select payload from dodo.static_snapshots where kind = ${kind}`,
      parseSnapshot,
    );
  }

  async #getPayload<T>(
    query: PromiseLike<JsonRow[]>,
    parse: (value: unknown) => T,
  ): Promise<T | undefined> {
    const [row] = await query;
    return row ? parse(row.payload) : undefined;
  }

  #parseStoredMatch(
    row: JsonRow & { imported_at: unknown; source: string; quality: string },
  ): StoredMatch {
    const importedAt = asTimestamp(row.imported_at);
    if (!importedAt) throw new Error("Stored match timestamp is missing");
    return {
      detail: parseStoredMatchDetail(row.payload),
      importedAt,
      source: dataSourceSchema.parse(row.source),
      quality: dataQualitySchema.parse(row.quality),
    };
  }

  async #upsertSnapshot(
    sql: QuerySql,
    kind: "hero" | "item" | "patch" | "update",
    snapshot: StaticDataSnapshot,
  ): Promise<void> {
    await sql`
      insert into dodo.static_snapshots (kind, payload, updated_at)
      values (${kind}, ${sql.json(toJson(snapshot))}, now())
      on conflict (kind) do update set payload = excluded.payload, updated_at = now()
    `;
  }

  async #upsertPlayerMatches(
    sql: QuerySql,
    accountId: string,
    matches: StoredMatch[],
  ): Promise<void> {
    await sql`
      select pg_advisory_xact_lock(hashtextextended(${`player-matches:${accountId}`}, 0))
    `;
    for (const match of matches) {
      await this.#upsertMatch(sql, match, true);
      await sql`
        insert into dodo.player_matches (account_id, match_id, start_time)
        values (${accountId}, ${match.detail.id}, ${match.detail.startTime})
        on conflict (account_id, match_id) do update set start_time = excluded.start_time
      `;
    }
  }

  async #upsertMatch(sql: QuerySql, match: StoredMatch, indexPlayers: boolean): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtextextended(${match.detail.id}, 0))`;
    const [existing] = await sql<JsonRow[]>`
      select payload from dodo.matches where id = ${match.detail.id} for update
    `;
    const detail = mergeMatchPlayers(
      existing ? parseStoredMatchDetail(existing.payload) : undefined,
      match.detail,
    );
    await sql`
      insert into dodo.matches
        (id, payload, start_time, imported_at, source, quality, updated_at)
      values (
        ${detail.id}, ${sql.json(toJson(detail))}, ${detail.startTime}, ${match.importedAt},
        ${match.source}, ${match.quality}, now()
      )
      on conflict (id) do update set
        payload = excluded.payload,
        start_time = excluded.start_time,
        imported_at = excluded.imported_at,
        source = excluded.source,
        quality = excluded.quality,
        updated_at = now()
    `;
    if (!indexPlayers) return;
    const accountIds = [...new Set(detail.players.flatMap((player) => player.accountId ?? []))];
    for (const accountId of accountIds) {
      await sql`
        insert into dodo.player_matches (account_id, match_id, start_time)
        values (${accountId}, ${detail.id}, ${detail.startTime})
        on conflict (account_id, match_id) do update set start_time = excluded.start_time
      `;
    }
  }
}
