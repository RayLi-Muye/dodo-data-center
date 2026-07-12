import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createSeedRepository,
  PostgresDodoRepository,
  SEED_ACCOUNT_ID,
  SEED_PARTIAL_ACCOUNT_ID,
  SEED_PATCH,
  SEED_UPDATED_AT,
  type DodoRepository,
} from "../src/index.js";

declare const process: { env: Record<string, string | undefined> };

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const requireSafeResetUrl = (value: string): string => {
  if (process.env.DODO_ALLOW_TEST_DB_RESET !== "1") {
    throw new Error(
      "Refusing destructive PostgreSQL tests: DODO_ALLOW_TEST_DB_RESET must equal 1",
    );
  }
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(new URL(value).pathname).split("/").filter(Boolean).at(-1) ?? "";
  } catch {
    throw new Error("Refusing destructive PostgreSQL tests: TEST_DATABASE_URL is invalid");
  }
  if (!databaseName.toLowerCase().includes("test")) {
    throw new Error(
      "Refusing destructive PostgreSQL tests: database name must explicitly contain test",
    );
  }
  return value;
};

describeWithDatabase("PostgresDodoRepository", () => {
  let admin: Sql;
  let repository: DodoRepository;
  let safeDatabaseUrl: string;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for this suite");
    safeDatabaseUrl = requireSafeResetUrl(databaseUrl);
    admin = postgres(safeDatabaseUrl, { max: 1 });
    repository = new PostgresDodoRepository({ databaseUrl: safeDatabaseUrl });
  });

  beforeEach(async () => {
    await admin`
      truncate table
        dodo.player_matches,
        dodo.matches,
        dodo.players,
        dodo.sync_jobs,
        dodo.player_sync_batches,
        dodo.player_sync_failures,
        dodo.player_history_sync,
        dodo.provider_health,
        dodo.static_snapshots,
        dodo.update_releases,
        dodo.heroes,
        dodo.items,
        dodo.patches,
        dodo.maps
      cascade
    `;
  });

  afterAll(async () => {
    await repository?.close();
    await admin?.end({ timeout: 5 });
  });

  it("persists MVP documents and transactionally replaces shared recent matches", async () => {
    const fixtures = await createSeedRepository();
    const hero = await fixtures.getHero("1");
    const item = await fixtures.getItem("1");
    const patch = await fixtures.getPatch(SEED_PATCH);
    const update = await fixtures.getUpdateRelease("7.41");
    const map = await fixtures.getCurrentMap();
    const primaryPlayer = await fixtures.getPlayer(SEED_ACCOUNT_ID);
    const sharedPlayer = await fixtures.getPlayer(SEED_PARTIAL_ACCOUNT_ID);
    const matches = (await fixtures.listPlayerMatches(SEED_ACCOUNT_ID)).slice(0, 2);
    if (
      !hero ||
      !item ||
      !patch ||
      !update ||
      !map ||
      !primaryPlayer ||
      !sharedPlayer ||
      matches.length !== 2
    ) {
      throw new Error("Seed fixtures are incomplete");
    }

    const snapshot = {
      source: "seed" as const,
      quality: "complete" as const,
      fetchedAt: SEED_UPDATED_AT,
      checkedAt: SEED_UPDATED_AT,
      changedAt: SEED_UPDATED_AT,
      contentHash: null,
      officialVersion: null,
    };
    await repository.replaceHeroes([hero], snapshot);
    await repository.replaceItems([item], snapshot);
    await repository.replacePatches([patch], snapshot);
    await repository.replaceUpdateReleases([update], snapshot);
    await repository.upsertMap(map);
    await repository.upsertPlayer(primaryPlayer);
    await repository.upsertPlayer(sharedPlayer);

    await Promise.all([
      repository.replacePlayerMatches(SEED_ACCOUNT_ID, [matches[0]!]),
      repository.replacePlayerMatches(SEED_PARTIAL_ACCOUNT_ID, [matches[0]!]),
    ]);
    await repository.replacePlayerMatches(SEED_ACCOUNT_ID, matches);
    await repository.replacePlayerMatches(SEED_ACCOUNT_ID, matches);
    expect(await repository.listPlayerMatches(SEED_ACCOUNT_ID)).toHaveLength(2);
    expect((await repository.getPlayer(SEED_ACCOUNT_ID))?.importedMatchCount).toBe(2);
    await repository.commitPlayerHistoryPage(SEED_ACCOUNT_ID, matches, {
      accountId: SEED_ACCOUNT_ID,
      status: "partial",
      nextOffset: 100,
      pageSize: 100,
      pagesImported: 1,
      matchesImported: 2,
      oldestImportedAt: matches[1]!.detail.startTime,
      reachedEnd: false,
      requestedAt: SEED_UPDATED_AT,
      updatedAt: SEED_UPDATED_AT,
      errorCode: null,
    });

    await repository.replacePlayerMatches(SEED_PARTIAL_ACCOUNT_ID, [matches[0]!]);
    await repository.replacePlayerMatches(SEED_ACCOUNT_ID, []);
    expect(await repository.listPlayerMatches(SEED_ACCOUNT_ID)).toEqual([]);
    expect(await repository.listPlayerMatches(SEED_PARTIAL_ACCOUNT_ID)).toHaveLength(1);
    expect(await repository.getMatch(matches[0]!.detail.id)).toBeDefined();
    expect(await repository.getMatch(matches[1]!.detail.id)).toBeUndefined();

    await repository.upsertPlayerSyncBatch({
      accountId: SEED_ACCOUNT_ID,
      eligibleCount: 1,
      sampleSize: 1,
      excludedCount: 0,
      exclusionReasons: [],
      quality: "complete",
      source: "seed",
      fetchedAt: SEED_UPDATED_AT,
      candidateLedger: [{ providerIndex: 0, status: "included", matchId: matches[0]!.detail.id }],
    });
    await repository.upsertPlayerSyncFailure({
      accountId: SEED_ACCOUNT_ID,
      source: "seed",
      checkedAt: SEED_UPDATED_AT,
      retryAfterSeconds: null,
    });
    await repository.upsertProviderHealth({
      source: "seed",
      status: "ready",
      checkedAt: SEED_UPDATED_AT,
      message: null,
    });
    await repository.upsertSyncJob({
      jobId: `job-${SEED_ACCOUNT_ID}`,
      accountId: SEED_ACCOUNT_ID,
      status: "public_complete",
      requestedAt: SEED_UPDATED_AT,
      completedAt: SEED_UPDATED_AT,
      errorCode: null,
    });

    await repository.close();
    repository = new PostgresDodoRepository({ databaseUrl: safeDatabaseUrl });

    expect(await repository.listHeroes()).toEqual([hero]);
    expect(await repository.getHeroSnapshot()).toEqual(snapshot);
    expect(await repository.listItems()).toEqual([item]);
    expect(await repository.getItemSnapshot()).toEqual(snapshot);
    expect(await repository.listPatches()).toEqual([patch]);
    expect(await repository.getPatchSnapshot()).toEqual(snapshot);
    expect(await repository.listUpdateReleases()).toEqual([
      {
        version: update.version,
        releasedAt: update.releasedAt,
        sourceUrl: update.sourceUrl,
        changeGroupCount: update.changeGroupCount,
        contentStatus: update.contentStatus,
        excludedNoteCount: update.excludedNoteCount,
      },
    ]);
    expect(await repository.getUpdateRelease(update.version)).toEqual(update);
    expect(await repository.getUpdateSnapshot()).toEqual(snapshot);
    expect(await repository.getCurrentMap()).toEqual(map);
    expect(await repository.getPlayerSyncBatch(SEED_ACCOUNT_ID)).toMatchObject({ sampleSize: 1 });
    expect(await repository.getPlayerSyncFailure(SEED_ACCOUNT_ID)).toMatchObject({ source: "seed" });
    expect(await repository.getPlayerHistorySync(SEED_ACCOUNT_ID)).toMatchObject({
      nextOffset: 100,
      matchesImported: 2,
    });
    expect(await repository.getProviderHealth("seed")).toMatchObject({ status: "ready" });
    expect(await repository.getSyncJob(`job-${SEED_ACCOUNT_ID}`)).toMatchObject({
      status: "public_complete",
    });

    await repository.clearPlayerSyncFailure(SEED_ACCOUNT_ID);
    expect(await repository.getPlayerSyncFailure(SEED_ACCOUNT_ID)).toBeUndefined();
    expect(await repository.getLatestMatchAt()).toBe(matches[0]!.detail.startTime);
  });

  it("persists official Dota provider health through the database source constraint", async () => {
    const health = {
      source: "dota2_official" as const,
      status: "degraded" as const,
      checkedAt: "2026-07-13T00:00:00.000Z",
      message: "Official catalog refresh completed with partial data.",
    };

    await repository.upsertProviderHealth(health);

    expect(await repository.getProviderHealth("dota2_official")).toEqual(health);
  });

  it("serializes concurrent complete-window replacement for one account", async () => {
    const fixtures = await createSeedRepository();
    const matches = (await fixtures.listPlayerMatches(SEED_ACCOUNT_ID)).slice(0, 6);
    if (matches.length !== 6) throw new Error("Seed match fixtures are incomplete");
    const firstWindow = matches.slice(0, 3);
    const secondWindow = matches.slice(3, 6);

    await Promise.all([
      repository.replacePlayerMatches(SEED_ACCOUNT_ID, firstWindow),
      repository.replacePlayerMatches(SEED_ACCOUNT_ID, secondWindow),
    ]);

    const storedIds = (await repository.listPlayerMatches(SEED_ACCOUNT_ID)).map(
      (match) => match.detail.id,
    );
    const validWindows = [firstWindow, secondWindow].map((window) =>
      window.map((match) => match.detail.id),
    );
    expect(validWindows).toContainEqual(storedIds);
    expect(storedIds).toHaveLength(3);
  });

  it("bulk-replaces shared matches in reverse order without deadlocking", async () => {
    const fixtures = await createSeedRepository();
    const primary = await fixtures.getPlayer(SEED_ACCOUNT_ID);
    const shared = await fixtures.getPlayer(SEED_PARTIAL_ACCOUNT_ID);
    const matches = (await fixtures.listPlayerMatches(SEED_PARTIAL_ACCOUNT_ID)).slice(0, 2);
    if (!primary || !shared || matches.length !== 2) throw new Error("Shared fixtures missing");
    await repository.upsertPlayer(primary);
    await repository.upsertPlayer(shared);

    await Promise.race([
      Promise.all([
        repository.replacePlayerMatches(SEED_ACCOUNT_ID, matches),
        repository.replacePlayerMatches(SEED_PARTIAL_ACCOUNT_ID, [...matches].reverse()),
      ]),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("reverse replacement deadlocked")), 5_000),
      ),
    ]);

    expect(await repository.listPlayerMatches(SEED_ACCOUNT_ID)).toHaveLength(2);
    expect(await repository.listPlayerMatches(SEED_PARTIAL_ACCOUNT_ID)).toHaveLength(2);
  });

  it("deduplicates enriched and summary copies in one bulk upsert", async () => {
    const fixtures = await createSeedRepository();
    const player = await fixtures.getPlayer(SEED_ACCOUNT_ID);
    const enriched = (await fixtures.listPlayerMatches(SEED_ACCOUNT_ID))[0];
    if (!player || !enriched) throw new Error("Match fixture missing");
    await repository.upsertPlayer(player);
    const target = enriched.detail.players.find((candidate) => candidate.accountId === SEED_ACCOUNT_ID)!;
    const summary = {
      ...enriched,
      detail: {
        ...enriched.detail,
        detailStatus: "summary" as const,
        players: [{ ...target, accountId: null }],
      },
    };

    await repository.upsertPlayerMatches(SEED_ACCOUNT_ID, [enriched, summary]);

    const stored = await repository.getMatch(enriched.detail.id);
    expect(stored?.detail.detailStatus).toBe("enriched");
    expect(stored?.detail.players).toHaveLength(10);
    expect(stored?.detail.players.some((candidate) => candidate.accountId === SEED_ACCOUNT_ID)).toBe(true);
  });

  it("reads legacy match JSON into separated version and neutral fields", async () => {
    const fixtures = await createSeedRepository();
    const stored = (await fixtures.listPlayerMatches(SEED_ACCOUNT_ID))[0]!;
    const {
      officialVersion: _officialVersion,
      openDotaPatchId: _openDotaPatchId,
      officialVersionSource: _officialVersionSource,
      ...legacyDetail
    } = stored.detail;
    const legacyPlayers = legacyDetail.players.map((player) => {
      const { neutralItemEnhancementId: _enhancement, ...legacyPlayer } = player;
      return legacyPlayer;
    });
    const legacyPayload = { ...legacyDetail, patch: "60", players: legacyPlayers };
    await admin`
      insert into dodo.matches
        (id, payload, start_time, imported_at, source, quality, updated_at)
      values (
        ${stored.detail.id}, ${admin.json(legacyPayload)}, ${stored.detail.startTime},
        ${stored.importedAt}, ${stored.source}, ${stored.quality}, now()
      )
    `;

    const restored = await repository.getMatch(stored.detail.id);
    expect(restored?.detail).toMatchObject({
      officialVersion: null,
      openDotaPatchId: "60",
      officialVersionSource: "unavailable",
    });
    expect(restored?.detail.players[0]?.neutralItemEnhancementId).toBeNull();

    for (const legacyPatch of ["unknown", "seed-patch"]) {
      await admin`
        update dodo.matches
        set payload = ${admin.json({ ...legacyPayload, patch: legacyPatch })}
        where id = ${stored.detail.id}
      `;
      expect((await repository.getMatch(stored.detail.id))?.detail.openDotaPatchId).toBeNull();
    }
  });

  it("marks legacy non-empty facets unavailable instead of active", async () => {
    const fixtures = await createSeedRepository();
    const hero = await fixtures.getHero("1");
    if (!hero) throw new Error("Hero fixture missing");
    const { facetsStatus: _facetsStatus, ...legacyHero } = hero;
    await admin`
      insert into dodo.heroes (id, payload, updated_at)
      values (${hero.id}, ${admin.json(legacyHero)}, now())
    `;

    const restored = await repository.getHero(hero.id);
    expect(restored?.facets).not.toEqual([]);
    expect(restored?.facetsStatus).toBe("unavailable");
  });

  it("reads legacy items with conservative kind and availability defaults", async () => {
    const fixtures = await createSeedRepository();
    const item = await fixtures.getItem("1");
    if (!item) throw new Error("Item fixture missing");
    const {
      kind: _kind,
      availabilityStatus: _availabilityStatus,
      ...legacyItem
    } = item;
    await admin`
      insert into dodo.items (id, payload, updated_at)
      values (${item.id}, ${admin.json(legacyItem)}, now())
    `;

    expect(await repository.getItem(item.id)).toMatchObject({
      kind: "item",
      availabilityStatus: "unverified",
    });
  });

  it("serializes concurrent static catalog replacement with matching snapshots", async () => {
    const fixtures = await createSeedRepository();
    const heroes = await fixtures.listHeroes();
    const items = await fixtures.listItems();
    if (heroes.length < 3 || items.length < 3) {
      throw new Error("Seed catalog fixtures are incomplete");
    }
    const firstSnapshot = {
      source: "seed" as const,
      quality: "complete" as const,
      fetchedAt: "2025-01-02T01:00:00.000Z",
      checkedAt: "2025-01-02T01:00:00.000Z",
      changedAt: "2025-01-02T01:00:00.000Z",
      contentHash: "first",
      officialVersion: null,
    };
    const secondSnapshot = {
      source: "seed" as const,
      quality: "complete" as const,
      fetchedAt: "2025-01-02T02:00:00.000Z",
      checkedAt: "2025-01-02T02:00:00.000Z",
      changedAt: "2025-01-02T02:00:00.000Z",
      contentHash: "second",
      officialVersion: null,
    };

    await Promise.all([
      repository.replaceHeroes([heroes[0]!], firstSnapshot),
      repository.replaceHeroes([heroes[1]!, heroes[2]!], secondSnapshot),
      repository.replaceItems([items[0]!], firstSnapshot),
      repository.replaceItems([items[1]!, items[2]!], secondSnapshot),
      repository.replacePatches(
        [{ id: "59", name: "7.38c", releasedAt: "2026-03-27T00:00:00.000Z" }],
        firstSnapshot,
      ),
      repository.replacePatches(
        [{ id: "60", name: "7.39", releasedAt: "2026-05-21T00:00:00.000Z" }],
        secondSnapshot,
      ),
    ]);

    const heroResult = {
      ids: (await repository.listHeroes()).map((hero) => hero.id),
      snapshot: await repository.getHeroSnapshot(),
    };
    const itemResult = {
      ids: (await repository.listItems()).map((item) => item.id),
      snapshot: await repository.getItemSnapshot(),
    };
    const patchResult = {
      ids: (await repository.listPatches()).map((patch) => patch.id),
      snapshot: await repository.getPatchSnapshot(),
    };
    expect([
      { ids: [heroes[0]!.id], snapshot: firstSnapshot },
      { ids: [heroes[1]!.id, heroes[2]!.id], snapshot: secondSnapshot },
    ]).toContainEqual(heroResult);
    expect([
      { ids: [items[0]!.id], snapshot: firstSnapshot },
      { ids: [items[1]!.id, items[2]!.id], snapshot: secondSnapshot },
    ]).toContainEqual(itemResult);
    expect([
      { ids: ["59"], snapshot: firstSnapshot },
      { ids: ["60"], snapshot: secondSnapshot },
    ]).toContainEqual(patchResult);
  });

  it("compare-and-set touches snapshots without overwriting a concurrent winner", async () => {
    const changedAt = "2026-07-12T01:00:00.000Z";
    const current = {
      source: "opendota" as const,
      quality: "complete" as const,
      fetchedAt: changedAt,
      checkedAt: changedAt,
      changedAt,
      contentHash: "new",
      officialVersion: null,
    };
    await repository.replacePatches(
      [{ id: "60", name: "7.39", releasedAt: changedAt }],
      current,
    );
    const touched = {
      ...current,
      fetchedAt: "2026-07-12T02:00:00.000Z",
      checkedAt: "2026-07-12T02:00:01.000Z",
    };

    expect(await repository.touchStaticSnapshot("patch", "old", touched)).toBe(false);
    expect(await repository.getPatchSnapshot()).toEqual(current);
    expect(await repository.touchStaticSnapshot("patch", "new", touched)).toBe(true);
    expect(await repository.getPatchSnapshot()).toEqual(touched);
  });
});
