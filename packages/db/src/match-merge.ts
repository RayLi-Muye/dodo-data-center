import type { MatchCoreDetail } from "@dodo/contracts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const withLegacyMatchDefaults = (value: unknown): unknown => {
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

type MatchPlayer = MatchCoreDetail["players"][number];

const abilityStatusRank = {
  unavailable: 0,
  ordered: 1,
  timed: 2,
} as const;

const itemTimelineStatusRank = {
  unavailable: 0,
  partial: 1,
  complete: 2,
} as const;

const itemEventKey = (event: MatchPlayer["itemTimeline"][number]): string =>
  `${event.gameTimeSeconds}:${event.itemId}:${event.action}:${event.charges ?? ""}`;

const itemEventOrder = (
  left: MatchPlayer["itemTimeline"][number],
  right: MatchPlayer["itemTimeline"][number],
): number =>
  left.gameTimeSeconds - right.gameTimeSeconds ||
  left.itemId.localeCompare(right.itemId) ||
  left.action.localeCompare(right.action) ||
  (left.charges ?? -1) - (right.charges ?? -1);

const preserveRicherEnrichment = (
  previous: MatchPlayer | undefined,
  incoming: MatchPlayer,
  preserveStratzTimeline: boolean,
): MatchPlayer => {
  if (!previous) return incoming;
  const keepPreviousAbilityBuild =
    abilityStatusRank[previous.abilityBuildStatus] > abilityStatusRank[incoming.abilityBuildStatus] ||
    (
      previous.abilityBuildStatus === incoming.abilityBuildStatus &&
      previous.abilityBuild.length > incoming.abilityBuild.length
    );
  const keepPreviousItemTimeline =
    itemTimelineStatusRank[previous.itemTimelineStatus] >
      itemTimelineStatusRank[incoming.itemTimelineStatus] ||
    (
      previous.itemTimelineStatus === incoming.itemTimelineStatus &&
      previous.itemTimeline.length > incoming.itemTimeline.length
    );
  const itemTimeline = preserveStratzTimeline
    ? new Map(previous.itemTimeline.map((event) => [itemEventKey(event), event]))
    : null;
  if (itemTimeline) {
    for (const event of incoming.itemTimeline) itemTimeline.set(itemEventKey(event), event);
  }
  const mergedItemTimeline = itemTimeline
    ? [...itemTimeline.values()].sort(itemEventOrder)
    : keepPreviousItemTimeline
      ? previous.itemTimeline
      : incoming.itemTimeline;
  const mergedItemTimelineStatus = itemTimeline
    ? itemTimelineStatusRank[previous.itemTimelineStatus] >
      itemTimelineStatusRank[incoming.itemTimelineStatus]
      ? previous.itemTimelineStatus
      : incoming.itemTimelineStatus
    : keepPreviousItemTimeline
      ? previous.itemTimelineStatus
      : incoming.itemTimelineStatus;
  return {
    ...incoming,
    accountId: incoming.accountId ?? previous.accountId,
    abilityBuild: keepPreviousAbilityBuild ? previous.abilityBuild : incoming.abilityBuild,
    abilityBuildStatus: keepPreviousAbilityBuild
      ? previous.abilityBuildStatus
      : incoming.abilityBuildStatus,
    itemTimeline: mergedItemTimeline,
    itemTimelineStatus: mergedItemTimelineStatus,
  };
};

export const mergeMatchDetails = (
  existing: MatchCoreDetail | undefined,
  incoming: MatchCoreDetail,
): MatchCoreDetail => {
  if (existing?.detailStatus === "enriched" && incoming.detailStatus === "summary") {
    return existing;
  }
  const playersBySlot = new Map(
    existing?.players.map((player) => [player.playerSlot, player]) ?? [],
  );
  const preserveStratzTimeline = existing?.enrichmentSources.includes("stratz") ?? false;
  for (const player of incoming.players) {
    playersBySlot.set(
      player.playerSlot,
      preserveRicherEnrichment(
        playersBySlot.get(player.playerSlot),
        player,
        preserveStratzTimeline,
      ),
    );
  }
  return {
    ...incoming,
    enrichmentSources: [
      ...new Set([...(existing?.enrichmentSources ?? []), ...incoming.enrichmentSources]),
    ],
    stratzEnrichment:
      existing && incoming.stratzEnrichment.status === "not_requested"
        ? existing.stratzEnrichment
        : incoming.stratzEnrichment,
    players: [...playersBySlot.values()],
  };
};
