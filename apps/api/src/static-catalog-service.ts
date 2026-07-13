import type { DodoRepository } from "@dodo/db";

import type { PlayerDataProvider } from "./player-data-provider.js";
import {
  CATALOG_TTL_MS,
  UPDATE_TTL_MS,
  contentHash,
  nextSnapshot,
  snapshotIsFresh,
  toHeroDetail,
  toItemDetails,
} from "./player-sync-service.js";

const REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1_000;

const catalogUniverseIds = (
  entityType: "hero" | "item",
  successfulIds: string[],
  exclusions: Array<{ entityType: string; entityId: string | null; kind: string }>,
): string[] => [
  ...new Set([
    ...successfulIds,
    ...exclusions.flatMap((exclusion) =>
      exclusion.entityType === entityType &&
      exclusion.kind === "failed" &&
      exclusion.entityId !== null
        ? [exclusion.entityId]
        : [],
    ),
  ]),
].sort();

type StaticCatalogServiceOptions = {
  repository: DodoRepository;
  provider: PlayerDataProvider;
  clock?: () => Date;
};

export class StaticCatalogService {
  readonly #repository: DodoRepository;
  readonly #provider: PlayerDataProvider;
  readonly #clock: () => Date;
  #timer: ReturnType<typeof setInterval> | undefined;
  #inFlight: Promise<void> | undefined;

  constructor({ repository, provider, clock = () => new Date() }: StaticCatalogServiceOptions) {
    this.#repository = repository;
    this.#provider = provider;
    this.#clock = clock;
  }

  start(): void {
    if (this.#timer) return;
    this.#requestRefresh();
    this.#timer = setInterval(() => this.#requestRefresh(), REFRESH_INTERVAL_MS);
  }

  async refresh(): Promise<void> {
    const checkedAt = this.#clock().toISOString();
    const [heroSnapshot, itemSnapshot, patchSnapshot, updateSnapshot] = await Promise.all([
      this.#repository.getHeroSnapshot(),
      this.#repository.getItemSnapshot(),
      this.#repository.getPatchSnapshot(),
      this.#repository.getUpdateSnapshot(),
    ]);
    let officialVersion = patchSnapshot?.officialVersion ?? updateSnapshot?.officialVersion ?? null;

    if (
      patchSnapshot?.source !== "dota2_official" ||
      patchSnapshot.officialVersion === null ||
      !snapshotIsFresh(patchSnapshot, checkedAt, UPDATE_TTL_MS)
    ) {
      const patches = await this.#provider.getPatchConstants();
      const hash = contentHash(patches.items);
      const snapshot = nextSnapshot(
        patchSnapshot,
        "dota2_official",
        patches.quality,
        patches.source.fetchedAt,
        hash,
        checkedAt,
        patches.officialVersion,
      );
      if (patchSnapshot?.contentHash === hash) {
        await this.#repository.touchStaticSnapshot("patch", patchSnapshot.contentHash, snapshot);
      } else await this.#repository.replacePatches(patches.items, snapshot);
      officialVersion = patches.officialVersion;
    }

    if (officialVersion !== null) {
      await this.#repository.invalidateCurrentMapForOfficialPatch(officialVersion);
    }

    const updateRefresh = snapshotIsFresh(updateSnapshot, checkedAt, UPDATE_TTL_MS)
      ? Promise.resolve()
      : this.#provider.getRecentUpdateReleases(5).then(async (updates) => {
          const hash = contentHash(updates.items);
          const snapshot = nextSnapshot(
            updateSnapshot,
            "dota2_official",
            updates.excludedVersions.length === 0 ? "complete" : "partial",
            updates.source.fetchedAt,
            hash,
            checkedAt,
            updates.items[0]?.version ?? officialVersion,
          );
          if (updateSnapshot?.contentHash === hash) {
            await this.#repository.touchStaticSnapshot("update", updateSnapshot.contentHash, snapshot);
          } else await this.#repository.replaceUpdateReleases(updates.items, snapshot);
        });

    const heroRefresh =
      snapshotIsFresh(
        heroSnapshot,
        checkedAt,
        heroSnapshot?.quality === "partial" ? UPDATE_TTL_MS : CATALOG_TTL_MS,
      ) && heroSnapshot?.officialVersion === officialVersion
        ? Promise.resolve()
        : Promise.all([
            this.#provider.getHeroConstants(),
            this.#provider.getHeroAbilityConstants(),
          ]).then(async ([heroes, abilities]) => {
            const universeIds = catalogUniverseIds(
              "hero",
              heroes.items.map((hero) => hero.id),
              [...heroes.exclusions, ...abilities.exclusions],
            );
            const quality =
              heroes.quality === "complete" && abilities.quality === "complete"
                ? "complete"
                : "partial";
            const hash = contentHash([heroes.items, abilities.heroes, universeIds]);
            const fetchedAt =
              heroes.source.fetchedAt > abilities.source.fetchedAt
                ? heroes.source.fetchedAt
                : abilities.source.fetchedAt;
            const snapshot = nextSnapshot(
              heroSnapshot,
              "dota2_official",
              quality,
              fetchedAt,
              hash,
              checkedAt,
              heroes.officialVersion,
            );
            if (heroSnapshot?.contentHash === hash) {
              await this.#repository.touchStaticSnapshot("hero", heroSnapshot.contentHash, snapshot);
            } else {
              await this.#repository.replaceHeroes(
                heroes.items.map((hero) =>
                  toHeroDetail(
                    hero,
                    abilities.heroes[`npc_dota_hero_${hero.name}`],
                    heroes.source.fetchedAt,
                    abilities.source.fetchedAt,
                    heroes.officialVersion,
                  ),
                ),
                snapshot,
                universeIds,
              );
            }
          });

    const itemRefresh =
      snapshotIsFresh(
        itemSnapshot,
        checkedAt,
        itemSnapshot?.quality === "partial" ? UPDATE_TTL_MS : CATALOG_TTL_MS,
      ) && itemSnapshot?.officialVersion === officialVersion
        ? Promise.resolve()
        : this.#provider.getItemConstants().then(async (items) => {
            const universeIds = catalogUniverseIds(
              "item",
              items.items.map((item) => item.id),
              items.exclusions,
            );
            const details = toItemDetails(
              items.items,
              items.source.fetchedAt,
              items.officialVersion,
            );
            const hash = contentHash([items.items, universeIds]);
            const snapshot = nextSnapshot(
              itemSnapshot,
              "dota2_official",
              items.quality,
              items.source.fetchedAt,
              hash,
              checkedAt,
              items.officialVersion,
            );
            if (itemSnapshot?.contentHash === hash) {
              await this.#repository.touchStaticSnapshot("item", itemSnapshot.contentHash, snapshot);
            } else await this.#repository.replaceItems(details, snapshot, universeIds);
          });

    await Promise.all([updateRefresh, heroRefresh, itemRefresh]);
    const finalSnapshots = await Promise.all([
      this.#repository.getHeroSnapshot(),
      this.#repository.getItemSnapshot(),
      this.#repository.getPatchSnapshot(),
      this.#repository.getUpdateSnapshot(),
    ]);
    const finalPartial = finalSnapshots.some((snapshot) => snapshot?.quality === "partial");
    await this.#repository.upsertProviderHealth({
      source: "dota2_official",
      status: finalPartial ? "degraded" : "ready",
      checkedAt,
      message: finalPartial ? "Official catalog refresh completed with partial data." : null,
    });
  }

  async close(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#inFlight;
  }

  #requestRefresh(): void {
    if (this.#inFlight) return;
    this.#inFlight = this.refresh()
      .catch(async (error) => {
        await this.#repository.upsertProviderHealth({
          source: "dota2_official",
          status: "unavailable",
          checkedAt: this.#clock().toISOString(),
          message: error instanceof Error ? error.name : "Official catalog refresh failed.",
        });
      })
      .catch(() => undefined)
      .finally(() => {
        this.#inFlight = undefined;
      });
  }
}
