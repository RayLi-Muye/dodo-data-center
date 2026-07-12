import { describe, expect, it } from "vitest";

import {
  createLiveRepository,
  createSeedRepository,
  seedRepository,
  SEED_ACCOUNT_ID,
  SEED_PATCH,
  SEED_UPDATED_AT,
} from "../src/index.js";

describe("MemoryDodoRepository", () => {
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

  it("atomically replaces the patch catalog with its snapshot", async () => {
    const repository = await createSeedRepository();
    const snapshot = {
      source: "opendota" as const,
      quality: "complete" as const,
      fetchedAt: "2026-07-12T01:00:00.000Z",
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

  it("keeps the live repository isolated from seed players and matches", async () => {
    const repository = await createLiveRepository();

    expect(await repository.getPlayer(SEED_ACCOUNT_ID)).toBeUndefined();
    expect(await repository.listPlayerMatches(SEED_ACCOUNT_ID)).toEqual([]);
    expect((await repository.getCurrentMap())?.sourceSnapshot).toBe("curated-map://maps/seed-map");
  });
});
