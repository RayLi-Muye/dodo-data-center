import { describe, expect, it } from "vitest";

import {
  createLiveRepository,
  createSeedRepository,
  seedRepository,
  SEED_ACCOUNT_ID,
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

  it("replaces one player's recent match window without duplicating stored facts", async () => {
    const repository = await createSeedRepository();
    const newest = (await repository.listPlayerMatches(SEED_ACCOUNT_ID)).slice(0, 2);

    await repository.replacePlayerMatches(SEED_ACCOUNT_ID, newest);
    await repository.replacePlayerMatches(SEED_ACCOUNT_ID, newest);

    expect(await repository.listPlayerMatches(SEED_ACCOUNT_ID)).toHaveLength(2);
    expect((await repository.getPlayer(SEED_ACCOUNT_ID))?.importedMatchCount).toBe(2);
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
