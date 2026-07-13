import { describe, expect, it } from "vitest";
import {
  mapFeatureTypeSchema,
  type ItemDetail,
  type MapVersion,
} from "@dodo/contracts";

import {
  calculateMapContentHash,
  createLiveRepository,
  createSeedRepository,
  seedRepository,
  SEED_ACCOUNT_ID,
  SEED_PATCH,
  SEED_UPDATED_AT,
} from "../src/index.js";

const mapRevision = (
  base: MapVersion,
  changes: Partial<Omit<MapVersion, "sourceRevision">> = {},
): MapVersion => {
  const draft: MapVersion = {
    ...base,
    ...changes,
    sourceRevision: { ...base.sourceRevision, snapshotSha256: "0".repeat(64) },
  };
  return {
    ...draft,
    sourceRevision: {
      ...draft.sourceRevision,
      snapshotSha256: calculateMapContentHash(draft),
    },
  };
};

const mapSnapshot = (map: MapVersion, checkedAt = map.verifiedAt) => ({
  source: "seed" as const,
  quality: map.quality,
  fetchedAt: checkedAt,
  checkedAt,
  changedAt: map.verifiedAt,
  contentHash: calculateMapContentHash(map),
  officialVersion: map.patch,
});

describe("MemoryDodoRepository", () => {
  it("atomically versions maps and only touches the snapshot for an unchanged current map", async () => {
    const repository = await createSeedRepository();
    const first = await repository.getCurrentMap();
    if (!first) throw new Error("Seed map missing");
    expect(first.quality).toBe("partial");
    expect([
      ...first.coverage.includedTypes,
      ...first.coverage.exclusions.map((entry) => entry.type),
    ].sort()).toEqual([...mapFeatureTypeSchema.options].sort());
    expect(calculateMapContentHash({ ...first, features: [...first.features].reverse() })).toBe(
      calculateMapContentHash(first),
    );

    const touched = mapSnapshot(first, "2026-07-13T01:00:00.000Z");
    await repository.replaceMap(first, touched);
    expect(await repository.getCurrentMap()).toEqual(first);
    expect(await repository.getMapSnapshot()).toEqual(touched);

    const conflicting = mapRevision(first, {
      features: first.features.map((feature, index) =>
        index === 0 ? { ...feature, description: "Changed without a revision ID." } : feature,
      ),
    });
    await expect(repository.replaceMap(conflicting, mapSnapshot(conflicting))).rejects.toThrow(
      "already exists with different content",
    );
    expect(await repository.getCurrentMap()).toEqual(first);
    expect(await repository.getMapSnapshot()).toEqual(touched);

    const second = mapRevision(first, {
      id: "seed-map-r2",
      verifiedAt: "2026-07-13T02:00:00.000Z",
    });
    const secondSnapshot = mapSnapshot(second);
    await repository.replaceMap(second, secondSnapshot);
    expect(await repository.getCurrentMap()).toEqual(second);
    expect(await repository.getMap("seed-map")).toEqual(first);
    expect(await repository.getMapSnapshot()).toEqual(secondSnapshot);
  });

  it("rejects an invalid map before changing the current map or its snapshot", async () => {
    const repository = await createSeedRepository();
    const current = await repository.getCurrentMap();
    const snapshot = await repository.getMapSnapshot();
    if (!current || !snapshot) throw new Error("Seed map missing");
    const invalid = {
      ...current,
      id: "invalid-map",
      bounds: { minX: 10, minY: 0, maxX: 0, maxY: 100 },
    } as MapVersion;

    await expect(repository.replaceMap(invalid, snapshot)).rejects.toThrow();
    expect(await repository.getCurrentMap()).toEqual(current);
    expect(await repository.getMapSnapshot()).toEqual(snapshot);
  });

  it("invalidates only curated current maps when the official patch differs", async () => {
    const fixtures = await createSeedRepository();
    const map = await fixtures.getCurrentMap();
    const seedSnapshot = await fixtures.getMapSnapshot();
    if (!map || !seedSnapshot) throw new Error("Seed map missing");
    expect(await fixtures.invalidateCurrentMapForOfficialPatch("different-patch")).toBe(false);
    expect(await fixtures.getCurrentMap()).toEqual(map);

    const repository = await createLiveRepository();
    const curatedSnapshot = { ...seedSnapshot, source: "curated_map" as const };
    await repository.replaceMap(map, curatedSnapshot);
    expect(await repository.invalidateCurrentMapForOfficialPatch(map.patch)).toBe(false);
    expect(await repository.getCurrentMap()).toEqual(map);
    expect(await repository.invalidateCurrentMapForOfficialPatch("different-patch")).toBe(true);
    expect(await repository.getCurrentMap()).toBeUndefined();
    expect(await repository.getMap(map.id)).toEqual(map);
    expect(await repository.getMapSnapshot()).toEqual(curatedSnapshot);
    expect(await repository.invalidateCurrentMapForOfficialPatch("different-patch")).toBe(false);
  });

  it("upserts the deterministic seed without duplicating matches", async () => {
    const repository = await createSeedRepository();

    await seedRepository(repository);

    expect(await repository.listPlayerMatches(SEED_ACCOUNT_ID)).toHaveLength(105);
    expect((await repository.getPlayer(SEED_ACCOUNT_ID))?.importedMatchCount).toBe(105);
  });

  it("sorts by startTime DESC and then id DESC", async () => {
    const repository = await createSeedRepository();
    const base = await repository.getMatch("9000000000");
    if (!base) throw new Error("seed match missing");
    await repository.upsertMatch({ ...base, detail: { ...base.detail, id: "9" } });
    await repository.upsertMatch({ ...base, detail: { ...base.detail, id: "10" } });
    const matches = await repository.listPlayerMatches(SEED_ACCOUNT_ID);

    expect(matches.slice(0, 5).map((match) => match.detail.id)).toEqual([
      "9000000001",
      "9000000000",
      "10",
      "9",
      "9000000002",
    ]);
  });

  it("returns copies instead of exposing mutable repository state", async () => {
    const repository = await createSeedRepository();
    const player = await repository.getPlayer(SEED_ACCOUNT_ID);
    if (!player) throw new Error("seed player missing");

    player.personaName = "mutated";

    expect((await repository.getPlayer(SEED_ACCOUNT_ID))?.personaName).toBe("Seed Public Player");
  });

  it("applies conservative defaults to legacy heroes missing encyclopedia fields", async () => {
    const fixtures = await createSeedRepository();
    const hero = await fixtures.getHero("1");
    if (!hero) throw new Error("Hero fixture missing");
    const {
      hype: _hype,
      biography: _biography,
      complexity: _complexity,
      baseStats: _baseStats,
      ...legacyHero
    } = hero;
    const repository = await createLiveRepository();

    await repository.upsertHero(legacyHero as typeof hero);

    expect(await repository.getHero(hero.id)).toMatchObject({
      hype: "",
      biography: "",
      complexity: null,
      baseStats: null,
    });
  });

  it("atomically replaces the patch catalog with its snapshot", async () => {
    const repository = await createSeedRepository();
    const snapshot = {
      source: "opendota" as const,
      quality: "complete" as const,
      fetchedAt: "2026-07-12T01:00:00.000Z",
      checkedAt: "2026-07-12T01:00:00.000Z",
      changedAt: "2026-07-12T01:00:00.000Z",
      contentHash: null,
      officialVersion: null,
    };

    expect(await repository.getPatch(SEED_PATCH)).toMatchObject({ releasedAt: SEED_UPDATED_AT });
    await repository.replacePatches(
      [
        { id: "59", name: "7.38c", releasedAt: "2026-03-27T00:00:00.000Z" },
        { id: "60", name: "7.39", releasedAt: "2026-05-21T00:00:00.000Z" },
      ],
      snapshot,
    );

    expect((await repository.listPatches()).map((patch) => patch.id)).toEqual(["60", "59"]);
    expect(await repository.getPatch("60")).toMatchObject({ name: "7.39" });
    expect(await repository.getPatch(SEED_PATCH)).toBeUndefined();
    expect(await repository.getPatchSnapshot()).toEqual(snapshot);
  });

  it("touches a snapshot only when its expected content hash still wins", async () => {
    const repository = await createLiveRepository();
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
    expect((await repository.getPatchSnapshot())?.changedAt).toBe(changedAt);
  });

  it("idempotently replaces update details while listing summaries only", async () => {
    const repository = await createLiveRepository();
    const snapshot = {
      source: "dota2_official" as const,
      quality: "complete" as const,
      fetchedAt: "2026-07-12T02:00:00.000Z",
      checkedAt: "2026-07-12T02:00:00.000Z",
      changedAt: "2026-07-12T02:00:00.000Z",
      contentHash: "first",
      officialVersion: null,
    };
    const releases = [
      {
        version: "7.41b",
        releasedAt: "2026-07-12T01:00:00.000Z",
        sourceUrl: "https://www.dota2.com/patches/7.41b",
        changeGroupCount: 3,
        contentStatus: "complete" as const,
        excludedNoteCount: 0,
        groups: [
          {
            kind: "general" as const,
            subsection: "overview" as const,
            entityId: null,
            entityName: null,
            relatedAbilityId: null,
            title: null,
            notes: [{ text: "Updated matchmaking.", info: null, indentLevel: 1 }],
          },
          {
            kind: "hero" as const,
            subsection: "overview" as const,
            entityId: "107",
            entityName: "Earth Spirit",
            relatedAbilityId: null,
            title: null,
            notes: [{ text: "Agility increased.", info: null, indentLevel: 1 }],
          },
          {
            kind: "hero" as const,
            subsection: "ability" as const,
            entityId: "107",
            entityName: "Earth Spirit",
            relatedAbilityId: "5608",
            title: "Boulder Smash",
            notes: [{ text: "Damage increased.", info: null, indentLevel: 1 }],
          },
        ],
      },
      {
        version: "7.41a",
        releasedAt: "2026-07-11T01:00:00.000Z",
        sourceUrl: "https://www.dota2.com/patches/7.41a",
        changeGroupCount: 1,
        contentStatus: "partial" as const,
        excludedNoteCount: 2,
        groups: [
          {
            kind: "hero" as const,
            subsection: "overview" as const,
            entityId: "107",
            entityName: "Earth Spirit",
            relatedAbilityId: null,
            title: null,
            notes: [{ text: "Strength increased.", info: null, indentLevel: 1 }],
          },
        ],
      },
    ];

    await repository.replaceUpdateReleases(releases, snapshot);
    await repository.replaceUpdateReleases(releases, snapshot);

    const summaries = await repository.listUpdateReleases();
    expect(summaries.map((release) => release.version)).toEqual(["7.41b", "7.41a"]);
    expect(summaries[0]).not.toHaveProperty("groups");
    expect(await repository.getUpdateRelease("7.41a")).toEqual(releases[1]);
    expect(await repository.getUpdateSnapshot()).toEqual(snapshot);
    const entityReleases = await repository.listEntityUpdateReleases(["hero"], "107");
    expect(entityReleases.map((release) => release.version)).toEqual(["7.41b", "7.41a"]);
    expect(entityReleases[0]).toMatchObject({ matchedGroupCount: 2 });
    expect(entityReleases.flatMap((release) => release.groups)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "hero", entityId: "107" }),
      ]),
    );
    expect(entityReleases.flatMap((release) => release.groups)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "general" })]),
    );
    expect(await repository.listEntityUpdateReleases(["item", "neutral_item"], "107"))
      .toEqual([]);

    const partialSnapshot = {
      ...snapshot,
      quality: "partial" as const,
      fetchedAt: "2026-07-12T03:00:00.000Z",
      checkedAt: "2026-07-12T03:00:00.000Z",
    };
    await repository.replaceUpdateReleases([releases[0]!], partialSnapshot);
    expect((await repository.listUpdateReleases()).map((release) => release.version)).toEqual([
      "7.41b",
      "7.41a",
    ]);
    expect(await repository.getUpdateRelease("7.41a")).toEqual(releases[1]);
    expect(await repository.getUpdateSnapshot()).toEqual(partialSnapshot);
  });

  it("replaces one player's recent match window without duplicating stored facts", async () => {
    const repository = await createSeedRepository();
    const newest = (await repository.listPlayerMatches(SEED_ACCOUNT_ID)).slice(0, 2);

    await repository.replacePlayerMatches(SEED_ACCOUNT_ID, newest);
    await repository.replacePlayerMatches(SEED_ACCOUNT_ID, newest);

    expect(await repository.listPlayerMatches(SEED_ACCOUNT_ID)).toHaveLength(2);
    expect((await repository.getPlayer(SEED_ACCOUNT_ID))?.importedMatchCount).toBe(2);
  });

  it("appends player matches and persists a history checkpoint without deleting older facts", async () => {
    const repository = await createSeedRepository();
    const allMatches = await repository.listPlayerMatches(SEED_ACCOUNT_ID);
    const existing = allMatches[0]!;
    await repository.replacePlayerMatches(SEED_ACCOUNT_ID, [existing]);
    await repository.commitPlayerHistoryPage(SEED_ACCOUNT_ID, [allMatches[1]!], {
      accountId: SEED_ACCOUNT_ID,
      status: "partial",
      nextOffset: 100,
      pageSize: 100,
      pagesImported: 1,
      matchesImported: 1,
      oldestImportedAt: allMatches[1]!.detail.startTime,
      reachedEnd: false,
      requestedAt: SEED_UPDATED_AT,
      updatedAt: SEED_UPDATED_AT,
      errorCode: null,
    });
    await repository.upsertPlayerMatches(SEED_ACCOUNT_ID, [existing]);

    expect(await repository.listPlayerMatches(SEED_ACCOUNT_ID)).toHaveLength(2);
    expect(await repository.getPlayerHistorySync(SEED_ACCOUNT_ID)).toMatchObject({
      nextOffset: 100,
      matchesImported: 1,
    });
  });

  it("does not downgrade an enriched match when a history summary is appended", async () => {
    const repository = await createSeedRepository();
    const match = (await repository.listPlayerMatches(SEED_ACCOUNT_ID))[0]!;
    await repository.upsertMatch({
      ...match,
      detail: { ...match.detail, detailStatus: "enriched" },
    });
    await repository.upsertPlayerMatches(SEED_ACCOUNT_ID, [
      { ...match, detail: { ...match.detail, detailStatus: "summary", players: [match.detail.players[0]!] } },
    ]);

    expect((await repository.getMatch(match.detail.id))?.detail).toMatchObject({
      detailStatus: "enriched",
      players: expect.any(Array),
    });
    expect((await repository.getMatch(match.detail.id))?.detail.players).toHaveLength(10);
  });

  it("defaults missing legacy STRATZ enrichment state in memory", async () => {
    const fixtures = await createSeedRepository();
    const match = (await fixtures.listPlayerMatches(SEED_ACCOUNT_ID))[0]!;
    const { stratzEnrichment: _stratzEnrichment, ...legacyDetail } = match.detail;
    const repository = await createLiveRepository();

    await repository.upsertMatch({
      ...match,
      detail: legacyDetail as typeof match.detail,
    });

    expect((await repository.getMatch(match.detail.id))?.detail.stratzEnrichment).toEqual({
      status: "not_requested",
      resultQuality: null,
      attemptCount: 0,
      lastAttemptAt: null,
      nextAttemptAt: null,
      reasonCode: null,
      providerRevision: "stratz-graphql-v1",
    });
  });

  it("does not replace an unchanged match only to advance its import timestamp", async () => {
    const repository = await createSeedRepository();
    const match = (await repository.listPlayerMatches(SEED_ACCOUNT_ID))[0]!;

    await repository.upsertMatch({
      ...match,
      importedAt: "2026-07-13T12:00:00.000Z",
    });

    expect((await repository.getMatch(match.detail.id))?.importedAt).toBe(match.importedAt);
  });

  it("detects legacy match players by own neutral enhancement property", async () => {
    const repository = await createSeedRepository();
    const match = await repository.getMatch("9000000000");
    if (!match) throw new Error("seed match missing");
    const legacyPlayers = match.detail.players.map((player, index) => {
      if (index !== 0) return player;
      const legacyPlayer: Partial<typeof player> = { ...player };
      delete legacyPlayer.neutralItemEnhancementId;
      return legacyPlayer as typeof player;
    });
    await repository.upsertMatch({
      ...match,
      detail: { ...match.detail, players: legacyPlayers },
    });

    expect(
      await repository.listMatchIdsMissingNeutralItemEnhancement([
        "missing",
        match.detail.id,
        match.detail.id,
      ]),
    ).toEqual([match.detail.id]);

    await repository.upsertMatch(match);
    expect(
      await repository.listMatchIdsMissingNeutralItemEnhancement([match.detail.id]),
    ).toEqual([]);
  });

  it("merges enriched players by slot and preserves a known summary account", async () => {
    const repository = await createSeedRepository();
    const stored = await repository.getMatch("9000000000");
    if (!stored) throw new Error("seed match missing");
    const target = stored.detail.players[0]!;
    await repository.upsertMatch({
      ...stored,
      detail: {
        ...stored.detail,
        detailStatus: "summary",
        players: [target],
      },
    });
    await repository.upsertMatch({
      ...stored,
      detail: {
        ...stored.detail,
        players: stored.detail.players.map((player) =>
          player.playerSlot === target.playerSlot ? { ...player, accountId: null } : player,
        ),
      },
    });

    const merged = await repository.getMatch(stored.detail.id);
    expect(merged?.detail.players).toHaveLength(10);
    expect(merged?.detail.players.find((player) => player.playerSlot === target.playerSlot)?.accountId)
      .toBe(SEED_ACCOUNT_ID);
  });

  it("does not downgrade persisted STRATZ timelines during an OpenDota refresh", async () => {
    const repository = await createSeedRepository();
    const stored = await repository.getMatch("9000000000");
    if (!stored) throw new Error("seed match missing");
    const target = stored.detail.players[0]!;
    await repository.upsertMatch({
      ...stored,
      detail: {
        ...stored.detail,
        enrichmentSources: ["stratz"],
        players: stored.detail.players.map((player) =>
          player.playerSlot === target.playerSlot
            ? {
                ...player,
                abilityBuild: [
                  { abilityId: "5003", sequence: 1, heroLevel: 1, gameTimeSeconds: 0 },
                ],
                abilityBuildStatus: "timed" as const,
                itemTimeline: [
                  { itemId: "1", action: "purchase" as const, gameTimeSeconds: 10, charges: null },
                ],
                itemTimelineStatus: "partial" as const,
              }
            : player,
        ),
      },
    });
    await repository.upsertMatch(stored);

    const refreshed = await repository.getMatch(stored.detail.id);
    const refreshedTarget = refreshed?.detail.players.find(
      (player) => player.playerSlot === target.playerSlot,
    );
    expect(refreshed?.detail.enrichmentSources).toEqual(["stratz"]);
    expect(refreshedTarget?.abilityBuildStatus).toBe("timed");
    expect(refreshedTarget?.itemTimeline).toHaveLength(1);
  });

  it("keeps the live repository isolated from seed players and matches", async () => {
    const repository = await createLiveRepository();

    expect(await repository.getPlayer(SEED_ACCOUNT_ID)).toBeUndefined();
    expect(await repository.listPlayerMatches(SEED_ACCOUNT_ID)).toEqual([]);
    expect(await repository.getCurrentMap()).toBeUndefined();
  });

  it("prunes legacy catalog rows but keeps current failed entries during partial refresh", async () => {
    const repository = await createSeedRepository();
    const heroes = await repository.listHeroes();
    const items = await repository.listItems();
    const snapshot = {
      source: "dota2_official" as const,
      quality: "partial" as const,
      fetchedAt: "2026-07-13T00:00:00.000Z",
      checkedAt: "2026-07-13T00:00:01.000Z",
      changedAt: "2026-07-13T00:00:01.000Z",
      contentHash: "partial-current",
      officialVersion: "7.41d",
    };

    await repository.replaceHeroes(
      [{ ...heroes[0]!, officialVersion: "7.41d" }],
      snapshot,
      [heroes[0]!.id, heroes[1]!.id],
    );
    await repository.replaceItems(
      [{ ...items[0]!, officialVersion: "7.41d" }],
      snapshot,
      [items[0]!.id, items[1]!.id],
    );
    await repository.replaceHeroes(
      [{ ...heroes[0]!, officialVersion: "7.41d" }],
      snapshot,
      [heroes[0]!.id, heroes[1]!.id],
    );
    await repository.replaceItems(
      [{ ...items[0]!, officialVersion: "7.41d" }],
      snapshot,
      [items[0]!.id, items[1]!.id],
    );

    expect((await repository.listHeroes()).map((hero) => hero.id).sort()).toEqual(
      [heroes[0]!.id, heroes[1]!.id].sort(),
    );
    expect((await repository.getHero(heroes[0]!.id))?.officialVersion).toBe("7.41d");
    expect((await repository.getHero(heroes[1]!.id))?.officialVersion).toBe(SEED_PATCH);
    expect((await repository.listItems()).map((item) => item.id).sort()).toEqual(
      [items[0]!.id, items[1]!.id].sort(),
    );
    expect((await repository.getItem(items[0]!.id))?.officialVersion).toBe("7.41d");
    expect((await repository.getItem(items[1]!.id))?.officialVersion).toBe(SEED_PATCH);

    await repository.replaceHeroes([], snapshot, []);
    await repository.replaceItems([], snapshot, []);
    expect(await repository.listHeroes()).toEqual([]);
    expect(await repository.listItems()).toEqual([]);
  });

  it("atomically prunes legacy and recipe items outside the refreshed universe", async () => {
    const repository = await createSeedRepository();
    const template = await repository.getItem("1");
    const initialSnapshot = await repository.getItemSnapshot();
    if (!template || !initialSnapshot) throw new Error("Seed item fixture missing");
    const legacy = { ...template, id: "998", name: "legacy_item" };
    const recipe = {
      ...template,
      id: "999",
      name: "recipe_legacy_item",
      kind: "recipe" as const,
    };
    await repository.replaceItems(
      [template, legacy, recipe],
      initialSnapshot,
      [template.id, legacy.id, recipe.id],
    );
    const beforeFailure = await repository.listItems();
    const invalid = {
      ...template,
      id: "broken",
      sourceSnapshot: () => "not cloneable",
    } as unknown as ItemDetail;

    await expect(
      repository.replaceItems([invalid], { ...initialSnapshot, contentHash: "failed" }, [invalid.id]),
    ).rejects.toThrow();
    expect(await repository.listItems()).toEqual(beforeFailure);
    expect(await repository.getItemSnapshot()).toEqual(initialSnapshot);

    const refreshedSnapshot = {
      ...initialSnapshot,
      checkedAt: "2026-07-14T00:00:00.000Z",
      contentHash: "visible-items-v1",
    };
    await repository.replaceItems([template], refreshedSnapshot, [template.id]);
    await repository.replaceItems([template], refreshedSnapshot, [template.id]);
    expect((await repository.listItems()).map((item) => item.id)).toEqual([template.id]);
    expect(await repository.getItem(legacy.id)).toBeUndefined();
    expect(await repository.getItem(recipe.id)).toBeUndefined();
    expect(await repository.getItemSnapshot()).toEqual(refreshedSnapshot);
  });
});
