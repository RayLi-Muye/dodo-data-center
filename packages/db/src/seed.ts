import type {
  HeroDetail,
  ItemDetail,
  MapVersion,
  MatchDetail,
  PatchSummary,
  PlayerProfile,
  UpdateReleaseDetail,
} from "@dodo/contracts";

import { MemoryDodoRepository } from "./memory-repository.js";
import type { DodoRepository } from "./types.js";

export const SEED_ACCOUNT_ID = "123456789";
export const SEED_HISTORY_PRIVATE_ACCOUNT_ID = "222222222";
export const SEED_PROFILE_PRIVATE_ACCOUNT_ID = "333333333";
export const SEED_PARTIAL_ACCOUNT_ID = "444444444";
export const SEED_PATCH = "seed-patch";
export const SEED_UPDATED_AT = "2025-01-02T00:00:00.000Z";

const heroSeed: HeroDetail[] = [
  {
    id: "1",
    name: "antimage",
    localizedName: "Seed Anti-Mage",
    primaryAttribute: "agility",
    attackType: "melee",
    roles: ["Carry", "Escape"],
    officialVersion: SEED_PATCH,
    facetsStatus: "active",
    facets: [{ name: "Seed Facet", description: "Deterministic test-only facet." }],
    abilities: [
      {
        id: "1001",
        name: "seed_mana_break",
        localizedName: "Seed Mana Break",
        description: "Deterministic test-only ability.",
        slot: 0,
        type: "basic",
      },
    ],
    sourceSnapshot: "seed://heroes/1",
  },
  {
    id: "2",
    name: "axe",
    localizedName: "Seed Axe",
    primaryAttribute: "strength",
    attackType: "melee",
    roles: ["Initiator", "Durable"],
    officialVersion: SEED_PATCH,
    facetsStatus: "active",
    facets: [{ name: "Seed Facet", description: "Deterministic test-only facet." }],
    abilities: [
      {
        id: "2001",
        name: "seed_berserkers_call",
        localizedName: "Seed Berserker's Call",
        description: "Deterministic test-only ability.",
        slot: 0,
        type: "basic",
      },
    ],
    sourceSnapshot: "seed://heroes/2",
  },
  {
    id: "3",
    name: "bane",
    localizedName: "Seed Bane",
    primaryAttribute: "universal",
    attackType: "ranged",
    roles: ["Support", "Disabler"],
    officialVersion: SEED_PATCH,
    facetsStatus: "active",
    facets: [{ name: "Seed Facet", description: "Deterministic test-only facet." }],
    abilities: [
      {
        id: "3001",
        name: "seed_enfeeble",
        localizedName: "Seed Enfeeble",
        description: "Deterministic test-only ability.",
        slot: 0,
        type: "basic",
      },
    ],
    sourceSnapshot: "seed://heroes/3",
  },
];

const itemSeed: ItemDetail[] = [
  {
    id: "1",
    name: "blink",
    localizedName: "Seed Blink Dagger",
    cost: 2250,
    category: "mobility",
    kind: "item",
    availabilityStatus: "unverified",
    officialVersion: SEED_PATCH,
    description: "Deterministic test-only item.",
    attributes: [{ label: "Active", value: "Seed Blink" }],
    components: [],
    sourceSnapshot: "seed://items/1",
  },
  {
    id: "2",
    name: "power_treads",
    localizedName: "Seed Power Treads",
    cost: 1400,
    category: "boots",
    kind: "item",
    availabilityStatus: "unverified",
    officialVersion: SEED_PATCH,
    description: "Deterministic test-only item.",
    attributes: [{ label: "Move speed", value: "+45" }],
    components: [],
    sourceSnapshot: "seed://items/2",
  },
  {
    id: "3",
    name: "black_king_bar",
    localizedName: "Seed Black King Bar",
    cost: 4050,
    category: "defense",
    kind: "item",
    availabilityStatus: "unverified",
    officialVersion: SEED_PATCH,
    description: "Deterministic test-only item.",
    attributes: [{ label: "Active", value: "Seed Avatar" }],
    components: [],
    sourceSnapshot: "seed://items/3",
  },
];

const mapSeed: MapVersion = {
  id: "seed-map",
  patch: SEED_PATCH,
  coordinateSystem: "seed-normalized-0-100",
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  features: [
    {
      id: "seed-mid-lane",
      type: "lane",
      localizedName: "Seed Middle Lane",
      description: "Deterministic test-only map feature.",
      geometry: { type: "LineString", coordinates: [[0, 0], [100, 100]] },
    },
    {
      id: "seed-roshan",
      type: "roshan",
      localizedName: "Seed Roshan Pit",
      description: "Deterministic test-only map feature.",
      geometry: { type: "Point", coordinates: [75, 25] },
    },
  ],
  sourceSnapshot: "curated-map://maps/seed-map",
  verifiedAt: SEED_UPDATED_AT,
};

const patchSeed: PatchSummary[] = [
  {
    id: SEED_PATCH,
    name: "Seed Patch",
    releasedAt: SEED_UPDATED_AT,
  },
];

const updateSeed: UpdateReleaseDetail = {
  version: "7.41",
  releasedAt: SEED_UPDATED_AT,
  sourceUrl: "https://www.dota2.com/patches/7.41",
  changeGroupCount: 1,
  contentStatus: "complete",
  excludedNoteCount: 0,
  groups: [
    {
      kind: "general",
      subsection: "overview",
      entityId: null,
      entityName: null,
      relatedAbilityId: null,
      title: "Seed gameplay update",
      notes: [{ text: "Deterministic test-only update note.", info: null, indentLevel: 1 }],
    },
  ],
};

const playerSeeds: PlayerProfile[] = [
  {
    accountId: SEED_ACCOUNT_ID,
    steamId64: "76561198083722517",
    personaName: "Seed Public Player",
    avatarUrl: null,
    status: "public_complete",
    importedMatchCount: 0,
    earliestImportedAt: SEED_UPDATED_AT,
    latestImportedAt: SEED_UPDATED_AT,
  },
  {
    accountId: SEED_HISTORY_PRIVATE_ACCOUNT_ID,
    steamId64: null,
    personaName: "Seed History Private Player",
    avatarUrl: null,
    status: "history_private",
    importedMatchCount: 0,
    earliestImportedAt: null,
    latestImportedAt: null,
  },
  {
    accountId: SEED_PROFILE_PRIVATE_ACCOUNT_ID,
    steamId64: null,
    personaName: null,
    avatarUrl: null,
    status: "profile_private",
    importedMatchCount: 0,
    earliestImportedAt: null,
    latestImportedAt: null,
  },
  {
    accountId: SEED_PARTIAL_ACCOUNT_ID,
    steamId64: "76561198404710172",
    personaName: "Seed Partial Player",
    avatarUrl: null,
    status: "public_partial",
    importedMatchCount: 0,
    earliestImportedAt: null,
    latestImportedAt: null,
  },
];

const slots = [0, 1, 2, 3, 4, 128, 129, 130, 131, 132] as const;

const createMatch = (index: number): MatchDetail => {
  const id = String(9_000_000_000 + index);
  const startOffsetHours = index < 2 ? 0 : index - 1;
  const startTime = new Date(
    Date.parse("2025-01-01T23:00:00.000Z") - startOffsetHours * 60 * 60 * 1000,
  ).toISOString();
  const radiantWin = index % 2 === 0;
  const targetHeroId = String((index % 3) + 1);

  return {
    id,
    startTime,
    durationSeconds: 1800 + index,
    officialVersion: SEED_PATCH,
    openDotaPatchId: null,
    officialVersionSource: "start_time_inferred",
    gameMode: "seed-ranked-all-pick",
    region: "seed-region",
    radiantWin,
    detailStatus: "enriched",
    enrichmentSources: [],
    parseStatus: "unparsed",
    lobbyType: "seed-lobby",
    cluster: "seed-cluster",
    radiantScore: 30 + index,
    direScore: 25 + index,
    players: slots.map((playerSlot, playerIndex) => {
      const side = playerSlot < 128 ? "radiant" : "dire";
      const isTarget = playerIndex === 0;
      return {
        accountId:
          isTarget
            ? SEED_ACCOUNT_ID
            : playerIndex === 1 && index < 3
              ? SEED_PARTIAL_ACCOUNT_ID
              : null,
        playerSlot,
        heroId: isTarget ? targetHeroId : String((playerIndex % 3) + 1),
        side,
        isWin: side === "radiant" ? radiantWin : !radiantWin,
        kills: isTarget ? index % 10 : playerIndex,
        deaths: isTarget ? index % 7 : playerIndex % 5,
        assists: isTarget ? index % 13 : playerIndex + 1,
        gpm: isTarget && index % 5 === 0 ? null : 400 + index,
        xpm: isTarget && index % 7 === 0 ? null : 500 + index,
        lastHits: 100 + index,
        denies: playerIndex,
        heroDamage: 10_000 + index * 100,
        heroHealing: 0,
        towerDamage: 1_000 + index,
        level: 20,
        netWorth: 15_000 + index,
        finalItemIds: [String((index % 3) + 1)],
        backpackItemIds: [],
        neutralItemId: null,
        neutralItemEnhancementId: null,
        abilityBuild: [],
        abilityBuildStatus: "unavailable",
        itemTimeline: [],
        itemTimelineStatus: "unavailable",
      };
    }),
  };
};

export const seedCuratedMap = async (repository: DodoRepository): Promise<DodoRepository> => {
  await repository.upsertMap(mapSeed);
  return repository;
};

export const seedRepository = async (repository: DodoRepository): Promise<DodoRepository> => {
  const staticSnapshot = {
    source: "seed" as const,
    quality: "complete" as const,
    fetchedAt: SEED_UPDATED_AT,
    checkedAt: SEED_UPDATED_AT,
    changedAt: SEED_UPDATED_AT,
    contentHash: null,
    officialVersion: SEED_PATCH,
  };
  await repository.replaceHeroes(heroSeed, staticSnapshot);
  await repository.replaceItems(itemSeed, staticSnapshot);
  await repository.replacePatches(patchSeed, {
    source: "seed",
    quality: "complete",
    fetchedAt: SEED_UPDATED_AT,
    checkedAt: SEED_UPDATED_AT,
    changedAt: SEED_UPDATED_AT,
    contentHash: null,
    officialVersion: SEED_PATCH,
  });
  await repository.replaceUpdateReleases([updateSeed], {
    source: "seed",
    quality: "complete",
    fetchedAt: SEED_UPDATED_AT,
    checkedAt: SEED_UPDATED_AT,
    changedAt: SEED_UPDATED_AT,
    contentHash: null,
    officialVersion: SEED_PATCH,
  });
  await seedCuratedMap(repository);
  for (const player of playerSeeds) await repository.upsertPlayer(player);
  for (let index = 0; index < 105; index += 1) {
    await repository.upsertMatch({
      detail: createMatch(index),
      importedAt: SEED_UPDATED_AT,
      source: "seed",
      quality: "complete",
    });
  }
  return repository;
};

export const createSeedRepository = async (): Promise<MemoryDodoRepository> =>
  (await seedRepository(new MemoryDodoRepository())) as MemoryDodoRepository;

export const createLiveRepository = async (): Promise<MemoryDodoRepository> =>
  new MemoryDodoRepository();
