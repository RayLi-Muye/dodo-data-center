import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createSeedRepository,
  PostgresDodoRepository,
  SEED_ACCOUNT_ID,
  SEED_PARTIAL_ACCOUNT_ID,
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
        dodo.provider_health,
        dodo.static_snapshots,
        dodo.heroes,
        dodo.items,
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
    const map = await fixtures.getCurrentMap();
    const primaryPlayer = await fixtures.getPlayer(SEED_ACCOUNT_ID);
    const sharedPlayer = await fixtures.getPlayer(SEED_PARTIAL_ACCOUNT_ID);
    const matches = (await fixtures.listPlayerMatches(SEED_ACCOUNT_ID)).slice(0, 2);
    if (!hero || !item || !map || !primaryPlayer || !sharedPlayer || matches.length !== 2) {
      throw new Error("Seed fixtures are incomplete");
    }

    const snapshot = {
      source: "seed" as const,
      quality: "complete" as const,
      fetchedAt: SEED_UPDATED_AT,
    };
    await repository.replaceHeroes([hero], snapshot);
    await repository.replaceItems([item], snapshot);
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
    expect(await repository.getCurrentMap()).toEqual(map);
    expect(await repository.getPlayerSyncBatch(SEED_ACCOUNT_ID)).toMatchObject({ sampleSize: 1 });
    expect(await repository.getPlayerSyncFailure(SEED_ACCOUNT_ID)).toMatchObject({ source: "seed" });
    expect(await repository.getProviderHealth("seed")).toMatchObject({ status: "ready" });
    expect(await repository.getSyncJob(`job-${SEED_ACCOUNT_ID}`)).toMatchObject({
      status: "public_complete",
    });

    await repository.clearPlayerSyncFailure(SEED_ACCOUNT_ID);
    expect(await repository.getPlayerSyncFailure(SEED_ACCOUNT_ID)).toBeUndefined();
    expect(await repository.getLatestMatchAt()).toBe(matches[0]!.detail.startTime);
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

  it("serializes concurrent hero and item catalog replacement with matching snapshots", async () => {
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
    };
    const secondSnapshot = {
      source: "seed" as const,
      quality: "complete" as const,
      fetchedAt: "2025-01-02T02:00:00.000Z",
    };

    await Promise.all([
      repository.replaceHeroes([heroes[0]!], firstSnapshot),
      repository.replaceHeroes([heroes[1]!, heroes[2]!], secondSnapshot),
      repository.replaceItems([items[0]!], firstSnapshot),
      repository.replaceItems([items[1]!, items[2]!], secondSnapshot),
    ]);

    const heroResult = {
      ids: (await repository.listHeroes()).map((hero) => hero.id),
      snapshot: await repository.getHeroSnapshot(),
    };
    const itemResult = {
      ids: (await repository.listItems()).map((item) => item.id),
      snapshot: await repository.getItemSnapshot(),
    };
    expect([
      { ids: [heroes[0]!.id], snapshot: firstSnapshot },
      { ids: [heroes[1]!.id, heroes[2]!.id], snapshot: secondSnapshot },
    ]).toContainEqual(heroResult);
    expect([
      { ids: [items[0]!.id], snapshot: firstSnapshot },
      { ids: [items[1]!.id, items[2]!.id], snapshot: secondSnapshot },
    ]).toContainEqual(itemResult);
  });
});
