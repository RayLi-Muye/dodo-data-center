import {
  dataQualitySchema,
  dataSourceSchema,
  heroDetailSchema,
  itemDetailSchema,
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
import { mergeMatchDetails } from "./match-merge.js";
import {
  calculateMapContentHash,
  parseAuditedMapPayload,
  parseConsistentMapSnapshot,
} from "./map-snapshot.js";

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
          neutralItemEnhancementId: player.neutralItemEnhancementId ?? null,
          abilityBuild: player.abilityBuild ?? [],
          abilityBuildStatus: player.abilityBuildStatus ?? "unavailable",
          itemTimeline: player.itemTimeline ?? [],
          itemTimelineStatus: player.itemTimelineStatus ?? "unavailable",
        };
      })
    : value.players;
  return {
    ...value,
    officialVersion: value.officialVersion ?? null,
    openDotaPatchId:
      value.openDotaPatchId ??
      (typeof value.patch === "string" && /^\d+$/.test(value.patch) ? value.patch : null),
    officialVersionSource: value.officialVersionSource ?? "unavailable",
    players,
    detailStatus: value.detailStatus ?? "summary",
    enrichmentSources: value.enrichmentSources ?? [],
    lobbyType: value.lobbyType ?? null,
    cluster: value.cluster ?? null,
    radiantScore: value.radiantScore ?? null,
    direScore: value.direScore ?? null,
  };
};

const parseStoredMatchDetail = (value: unknown): MatchDetail =>
  matchDetailSchema.parse(withLegacyMatchDefaults(value));

const parseStoredHero = (value: unknown): HeroDetail => {
  if (!isRecord(value)) return heroDetailSchema.parse(value);
  return heroDetailSchema.parse({
    ...value,
    officialVersion: value.officialVersion ?? null,
    facetsStatus: value.facetsStatus ?? "unavailable",
  });
};

const parseStoredItem = (value: unknown): ItemDetail => {
  if (!isRecord(value)) return itemDetailSchema.parse(value);
  return itemDetailSchema.parse({
    ...value,
    kind: value.kind ?? "item",
    availabilityStatus: value.availabilityStatus ?? "unverified",
    officialVersion: value.officialVersion ?? null,
  });
};

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
  const fetchedAt = timestampSchema.parse(value.fetchedAt);
  return {
    source: dataSourceSchema.parse(value.source),
    quality: dataQualitySchema.parse(value.quality),
    fetchedAt,
    checkedAt: timestampSchema.parse(value.checkedAt ?? fetchedAt),
    changedAt: timestampSchema.parse(value.changedAt ?? fetchedAt),
    contentHash:
      value.contentHash === null || typeof value.contentHash === "string"
        ? value.contentHash
        : null,
    officialVersion:
      typeof value.officialVersion === "string" ? value.officialVersion : null,
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

  async replaceMap(map: MapVersion, snapshot: StaticDataSnapshot): Promise<void> {
    const parsed = parseConsistentMapSnapshot(map, snapshot);
    await this.#sql.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtextextended('catalog:maps', 0))`;
      const [existing] = await sql<JsonRow[]>`
        select payload from dodo.maps where id = ${parsed.id} for update
      `;
      if (existing) {
        const stored = parseAuditedMapPayload(existing.payload);
        if (calculateMapContentHash(stored) !== snapshot.contentHash) {
          throw new Error(`Map version ${parsed.id} already exists with different content`);
        }
      }

      const [current] = await sql<{ id: string }[]>`
        select id from dodo.maps where is_current for update
      `;
      if (current?.id !== parsed.id) {
        await sql`update dodo.maps set is_current = false where is_current`;
        if (existing) {
          await sql`update dodo.maps set is_current = true where id = ${parsed.id}`;
        } else {
          await sql`
            insert into dodo.maps (id, payload, is_current, updated_at)
            values (${parsed.id}, ${sql.json(toJson(parsed))}, true, now())
          `;
        }
      }
      await this.#upsertSnapshot(sql, "map", snapshot);
    });
  }

  async invalidateCurrentMapForOfficialPatch(officialVersion: string): Promise<boolean> {
    return this.#sql.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtextextended('catalog:maps', 0))`;
      const [snapshotRow] = await sql<JsonRow[]>`
        select payload from dodo.static_snapshots where kind = 'map' for update
      `;
      if (!snapshotRow || parseSnapshot(snapshotRow.payload).source !== "curated_map") return false;
      const [current] = await sql<{ id: string; patch: string | null }[]>`
        select id, payload ->> 'patch' as patch from dodo.maps where is_current for update
      `;
      if (!current) return false;
      if (current.patch === officialVersion) return false;
      await sql`update dodo.maps set is_current = false where id = ${current.id}`;
      return true;
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
      await this.#upsertPlayerMatches(sql, accountId, matches, true);

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
    if (matches.length === 0) return;
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

  async replaceHeroes(
    heroes: HeroDetail[],
    snapshot: StaticDataSnapshot,
    universeIds: string[],
  ): Promise<void> {
    await this.#sql.begin(async (sql) => {
      await sql`
        select pg_advisory_xact_lock(hashtextextended('catalog:heroes', 0))
      `;
      if (universeIds.length === 0) await sql`delete from dodo.heroes`;
      else await sql`delete from dodo.heroes where id not in ${sql(universeIds)}`;
      await sql`
        insert into dodo.heroes (id, payload, updated_at)
        select id, payload, now()
        from jsonb_to_recordset(${sql.json(toJson(heroes.map((hero) => ({ id: hero.id, payload: hero }))))}::jsonb)
          as records(id text, payload jsonb)
        on conflict (id) do update set payload = excluded.payload, updated_at = now()
      `;
      await this.#upsertSnapshot(sql, "hero", snapshot);
    });
  }

  async replaceItems(
    items: ItemDetail[],
    snapshot: StaticDataSnapshot,
    universeIds: string[],
  ): Promise<void> {
    await this.#sql.begin(async (sql) => {
      await sql`
        select pg_advisory_xact_lock(hashtextextended('catalog:items', 0))
      `;
      if (universeIds.length === 0) await sql`delete from dodo.items`;
      else await sql`delete from dodo.items where id not in ${sql(universeIds)}`;
      await sql`
        insert into dodo.items (id, payload, updated_at)
        select id, payload, now()
        from jsonb_to_recordset(${sql.json(toJson(items.map((item) => ({ id: item.id, payload: item }))))}::jsonb)
          as records(id text, payload jsonb)
        on conflict (id) do update set payload = excluded.payload, updated_at = now()
      `;
      await this.#upsertSnapshot(sql, "item", snapshot);
    });
  }

  async replacePatches(patches: PatchSummary[], snapshot: StaticDataSnapshot): Promise<void> {
    await this.#sql.begin(async (sql) => {
      await sql`
        select pg_advisory_xact_lock(hashtextextended('catalog:patches', 0))
      `;
      await sql`delete from dodo.patches`;
      await sql`
        insert into dodo.patches (id, payload, released_at, updated_at)
        select id, payload, released_at, now()
        from jsonb_to_recordset(${sql.json(toJson(patches.map((patch) => ({ id: patch.id, payload: patch, released_at: patch.releasedAt }))))}::jsonb)
          as records(id text, payload jsonb, released_at timestamptz)
      `;
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
      await sql`
        insert into dodo.update_releases (version, payload, released_at, updated_at)
        select version, payload, released_at, now()
        from jsonb_to_recordset(${sql.json(toJson(releases.map((release) => ({ version: release.version, payload: release, released_at: release.releasedAt }))))}::jsonb)
          as records(version text, payload jsonb, released_at timestamptz)
        on conflict (version) do update set
          payload = excluded.payload,
          released_at = excluded.released_at,
          updated_at = now()
      `;
      await this.#upsertSnapshot(sql, "update", snapshot);
    });
  }

  async touchStaticSnapshot(
    kind: "hero" | "item" | "patch" | "update" | "map",
    expectedContentHash: string | null,
    snapshot: StaticDataSnapshot,
  ): Promise<boolean> {
    const lockKind =
      kind === "hero"
        ? "heroes"
        : kind === "item"
          ? "items"
          : kind === "patch"
            ? "patches"
            : kind === "update"
              ? "updates"
              : "maps";
    return this.#sql.begin(async (sql) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${`catalog:${lockKind}`}, 0))`;
      const [row] = await sql<JsonRow[]>`
        select payload from dodo.static_snapshots where kind = ${kind} for update
      `;
      if (!row || parseSnapshot(row.payload).contentHash !== expectedContentHash) return false;
      if (kind === "map") {
        const [mapRow] = await sql<JsonRow[]>`
          select payload from dodo.maps where is_current for update
        `;
        if (!mapRow) return false;
        parseConsistentMapSnapshot(mapRow.payload, snapshot);
      }
      await this.#upsertSnapshot(sql, kind, snapshot);
      return true;
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
    return this.#getDocument("heroes", id, parseStoredHero);
  }

  async listHeroes(): Promise<HeroDetail[]> {
    const rows = await this.#sql<JsonRow[]>`select payload from dodo.heroes order by id`;
    return rows.map((row) => parseStoredHero(row.payload));
  }

  async getHeroSnapshot(): Promise<StaticDataSnapshot | undefined> {
    return this.#getSnapshot("hero");
  }

  async getItem(id: string): Promise<ItemDetail | undefined> {
    return this.#getDocument("items", id, parseStoredItem);
  }

  async listItems(): Promise<ItemDetail[]> {
    const rows = await this.#sql<JsonRow[]>`select payload from dodo.items order by id`;
    return rows.map((row) => parseStoredItem(row.payload));
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

  async getMapSnapshot(): Promise<StaticDataSnapshot | undefined> {
    return this.#getSnapshot("map");
  }

  async getCurrentMap(): Promise<MapVersion | undefined> {
    const [row] = await this.#sql<JsonRow[]>`
      select payload from dodo.maps where is_current order by updated_at desc limit 1
    `;
    return row ? parseAuditedMapPayload(row.payload) : undefined;
  }

  async getMap(id: string): Promise<MapVersion | undefined> {
    return this.#getDocument("maps", id, parseAuditedMapPayload);
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

  async listMatchIdsMissingNeutralItemEnhancement(matchIds: string[]): Promise<string[]> {
    const requestedIds = [...new Set(matchIds)].slice(0, 20);
    if (requestedIds.length === 0) return [];
    const rows = await this.#sql<{ id: string }[]>`
      select m.id
      from dodo.matches m
      where m.id in ${this.#sql(requestedIds)}
        and exists (
          select 1
          from jsonb_array_elements(
            case
              when jsonb_typeof(m.payload -> 'players') = 'array'
                then m.payload -> 'players'
              else '[]'::jsonb
            end
          ) as entries(player)
          where not (player ? 'neutralItemEnhancementId')
        )
    `;
    const found = new Set(rows.map((row) => row.id));
    return requestedIds.filter((matchId) => found.has(matchId));
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
    kind: "hero" | "item" | "patch" | "update" | "map",
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
    kind: "hero" | "item" | "patch" | "update" | "map",
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
    accountLockHeld = false,
  ): Promise<void> {
    if (matches.length === 0) return;
    if (!accountLockHeld) {
      await sql`
        select pg_advisory_xact_lock(hashtextextended(${`player-matches:${accountId}`}, 0))
      `;
    }
    const deduplicated = [...matches.reduce((byId, match) => {
      const previous = byId.get(match.detail.id);
      byId.set(
        match.detail.id,
        previous
          ? { ...match, detail: mergeMatchDetails(previous.detail, match.detail) }
          : match,
      );
      return byId;
    }, new Map<string, StoredMatch>()).values()];
    const orderedIds = deduplicated.map((match) => match.detail.id).sort();
    await sql`
      select pg_advisory_xact_lock(hashtextextended(id, 0))
      from unnest(${orderedIds}::text[]) as ids(id)
      order by id
    `;
    const existingRows = await sql<Array<JsonRow & { id: string }>>`
      select id, payload from dodo.matches where id in ${sql(orderedIds)} for update
    `;
    const existingById = new Map(
      existingRows.map((row) => [row.id, parseStoredMatchDetail(row.payload)]),
    );
    const merged = deduplicated.map((match) => ({
      ...match,
      detail: mergeMatchDetails(existingById.get(match.detail.id), match.detail),
    }));
    const matchRows = merged.map((match) => ({
      id: match.detail.id,
      payload: match.detail,
      start_time: match.detail.startTime,
      imported_at: match.importedAt,
      source: match.source,
      quality: match.quality,
    }));
    await sql`
      insert into dodo.matches as stored_match
        (id, payload, start_time, imported_at, source, quality, updated_at)
      select id, payload, start_time, imported_at, source, quality, now()
      from jsonb_to_recordset(${sql.json(toJson(matchRows))}::jsonb)
        as records(
          id text, payload jsonb, start_time timestamptz, imported_at timestamptz,
          source text, quality text
        )
      on conflict (id) do update set
        payload = excluded.payload, start_time = excluded.start_time,
        imported_at = excluded.imported_at, source = excluded.source,
        quality = excluded.quality, updated_at = now()
      where stored_match.payload is distinct from excluded.payload
        or stored_match.start_time is distinct from excluded.start_time
        or stored_match.source is distinct from excluded.source
        or stored_match.quality is distinct from excluded.quality
    `;
    const associationByKey = new Map<string, { account_id: string; match_id: string; start_time: string }>();
    for (const entry of merged.flatMap((match) => {
      const accounts = new Set([
        accountId,
        ...match.detail.players.flatMap((player) => player.accountId ?? []),
      ]);
      return [...accounts].map((associatedAccountId) => ({
        account_id: associatedAccountId,
        match_id: match.detail.id,
        start_time: match.detail.startTime,
      }));
    })) associationByKey.set(`${entry.account_id}:${entry.match_id}`, entry);
    await sql`
      insert into dodo.player_matches (account_id, match_id, start_time)
      select account_id, match_id, start_time
      from jsonb_to_recordset(${sql.json(toJson([...associationByKey.values()]))}::jsonb)
        as records(account_id text, match_id text, start_time timestamptz)
      on conflict (account_id, match_id) do update set start_time = excluded.start_time
    `;
  }

  async #upsertMatch(sql: QuerySql, match: StoredMatch, indexPlayers: boolean): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtextextended(${match.detail.id}, 0))`;
    const [existing] = await sql<JsonRow[]>`
      select payload from dodo.matches where id = ${match.detail.id} for update
    `;
    const detail = mergeMatchDetails(
      existing ? parseStoredMatchDetail(existing.payload) : undefined,
      match.detail,
    );
    await sql`
      insert into dodo.matches as stored_match
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
      where stored_match.payload is distinct from excluded.payload
        or stored_match.start_time is distinct from excluded.start_time
        or stored_match.source is distinct from excluded.source
        or stored_match.quality is distinct from excluded.quality
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
