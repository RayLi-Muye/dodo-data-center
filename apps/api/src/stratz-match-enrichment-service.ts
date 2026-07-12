import type { StratzMatchDetail, StratzProvider } from "@dodo/dota-data";
import type { DodoRepository, StoredMatch } from "@dodo/db";

type MatchPlayer = StoredMatch["detail"]["players"][number];
type StratzMatchPlayer = StratzMatchDetail["players"][number];

export type StratzEnrichmentStatus =
  | "complete"
  | "partial"
  | "private"
  | "rate_limited"
  | "unavailable"
  | "failed"
  | "skipped";

export type StratzEnrichmentOutcome = {
  changed: boolean;
  status: StratzEnrichmentStatus;
};

type StratzMatchProvider = Pick<StratzProvider, "getMatchDetail">;

type StratzMatchEnrichmentServiceOptions = {
  repository: DodoRepository;
  provider: StratzMatchProvider;
  clock?: () => Date;
};

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

const mergeAbilityBuild = (
  existing: MatchPlayer,
  incoming: StratzMatchPlayer,
): Pick<MatchPlayer, "abilityBuild" | "abilityBuildStatus"> => {
  if (incoming.abilityBuildStatus !== "timed" || incoming.abilityBuild.length === 0) {
    return {
      abilityBuild: existing.abilityBuild,
      abilityBuildStatus: existing.abilityBuildStatus,
    };
  }
  if (existing.abilityBuildStatus === "unavailable" || existing.abilityBuild.length === 0) {
    return { abilityBuild: incoming.abilityBuild, abilityBuildStatus: "timed" };
  }
  const incomingBySequence = new Map(
    incoming.abilityBuild.map((event) => [event.sequence, event]),
  );
  const existingOrderIsPreserved = existing.abilityBuild.every((event) =>
    incomingBySequence.get(event.sequence)?.abilityId === event.abilityId
  );
  if (!existingOrderIsPreserved || incoming.abilityBuild.length < existing.abilityBuild.length) {
    return {
      abilityBuild: existing.abilityBuild,
      abilityBuildStatus: existing.abilityBuildStatus,
    };
  }
  return { abilityBuild: incoming.abilityBuild, abilityBuildStatus: "timed" };
};

const mergeItemTimeline = (
  existing: MatchPlayer,
  incoming: StratzMatchPlayer,
): Pick<MatchPlayer, "itemTimeline" | "itemTimelineStatus"> => {
  if (incoming.itemTimelineStatus === "unavailable" || incoming.itemTimeline.length === 0) {
    return {
      itemTimeline: existing.itemTimeline,
      itemTimelineStatus: existing.itemTimelineStatus,
    };
  }
  const events = new Map(existing.itemTimeline.map((event) => [itemEventKey(event), event]));
  for (const event of incoming.itemTimeline) events.set(itemEventKey(event), event);
  return {
    itemTimeline: [...events.values()].sort(itemEventOrder),
    itemTimelineStatus:
      existing.itemTimelineStatus === "complete" ? "complete" : "partial",
  };
};

const STRATZ_GAME_MODE_IDS: Readonly<Record<string, string>> = {
  ALL_PICK: "1",
  ALL_PICK_RANKED: "22",
  TURBO: "23",
};

const STRATZ_LOBBY_TYPE_IDS: Readonly<Record<string, string>> = {
  NORMAL: "0",
  RANKED: "7",
};

const equivalentProviderValue = (
  stored: string,
  incoming: string,
  stratzIds: Readonly<Record<string, string>>,
): boolean => stored === incoming || stored === stratzIds[incoming];

const coreMatchConflict = (stored: StoredMatch, incoming: StratzMatchDetail): boolean =>
  stored.detail.id !== incoming.id ||
  stored.detail.startTime !== incoming.startTime ||
  stored.detail.durationSeconds !== incoming.durationSeconds ||
  !equivalentProviderValue(stored.detail.gameMode, incoming.gameMode, STRATZ_GAME_MODE_IDS) ||
  stored.detail.radiantWin !== incoming.radiantWin ||
  (stored.detail.lobbyType !== null &&
    incoming.lobbyType !== null &&
    !equivalentProviderValue(
      stored.detail.lobbyType,
      incoming.lobbyType,
      STRATZ_LOBBY_TYPE_IDS,
    )) ||
  (stored.detail.region !== null &&
    incoming.region !== null &&
    stored.detail.region !== incoming.region) ||
  (stored.detail.cluster !== null &&
    incoming.cluster !== null &&
    stored.detail.cluster !== incoming.cluster);

const mergePlayers = (
  stored: StoredMatch,
  incoming: StratzMatchDetail,
): { changed: boolean; conflict: boolean; players: MatchPlayer[] } => {
  const storedBySlot = new Map(
    stored.detail.players.map((player) => [player.playerSlot, player]),
  );
  const seenSlots = new Set<number>();
  for (const player of incoming.players) {
    const existing = storedBySlot.get(player.playerSlot);
    if (
      seenSlots.has(player.playerSlot) ||
      !existing ||
      existing.heroId !== player.heroId ||
      existing.side !== player.side ||
      existing.isWin !== player.isWin ||
      existing.kills !== player.kills ||
      existing.deaths !== player.deaths ||
      existing.assists !== player.assists ||
      (existing.accountId !== null &&
        player.steamAccountId !== null &&
        existing.accountId !== player.steamAccountId)
    ) {
      return { changed: false, conflict: true, players: stored.detail.players };
    }
    seenSlots.add(player.playerSlot);
  }

  let changed = false;
  const incomingBySlot = new Map(incoming.players.map((player) => [player.playerSlot, player]));
  const players = stored.detail.players.map((existing) => {
    const player = incomingBySlot.get(existing.playerSlot);
    if (!player) return existing;
    const ability = mergeAbilityBuild(existing, player);
    const items = mergeItemTimeline(existing, player);
    const next = { ...existing, ...ability, ...items };
    if (JSON.stringify(next) !== JSON.stringify(existing)) changed = true;
    return next;
  });
  return { changed, conflict: false, players };
};

const errorStatus = (error: unknown): Exclude<StratzEnrichmentStatus, "complete" | "partial" | "skipped"> => {
  if (!error || typeof error !== "object") return "failed";
  const record = error as { code?: unknown; reason?: unknown };
  const code = typeof record.code === "string" ? record.code.toLowerCase() : "";
  const reason = typeof record.reason === "string" ? record.reason.toLowerCase() : "";
  if (code.includes("rate") || reason.includes("rate")) return "rate_limited";
  if (reason.includes("private") || reason.includes("anonymous")) return "private";
  if (
    code.includes("authentication") ||
    code.includes("unavailable") ||
    code.includes("not_found") ||
    reason.includes("network") ||
    reason.includes("timeout") ||
    reason.includes("upstream")
  ) return "unavailable";
  return "failed";
};

export class StratzMatchEnrichmentService {
  readonly #repository: DodoRepository;
  readonly #provider: StratzMatchProvider;
  readonly #clock: () => Date;

  constructor({ repository, provider, clock = () => new Date() }: StratzMatchEnrichmentServiceOptions) {
    this.#repository = repository;
    this.#provider = provider;
    this.#clock = clock;
  }

  async enrichMatch(matchId: string): Promise<StratzEnrichmentOutcome> {
    const stored = await this.#repository.getMatch(matchId);
    if (!stored || stored.detail.detailStatus !== "enriched") {
      return { changed: false, status: "skipped" };
    }
    try {
      const incoming = await this.#provider.getMatchDetail(matchId);
      if (coreMatchConflict(stored, incoming)) {
        await this.#recordHealth("degraded", "STRATZ match core fields conflicted with OpenDota.");
        return { changed: false, status: "failed" };
      }
      const merged = mergePlayers(stored, incoming);
      if (merged.conflict) {
        await this.#recordHealth("degraded", "STRATZ player identity conflicted with OpenDota.");
        return { changed: false, status: "failed" };
      }
      if (merged.changed) {
        await this.#repository.upsertMatch({
          ...stored,
          detail: {
            ...stored.detail,
            enrichmentSources: [...new Set([...stored.detail.enrichmentSources, "stratz" as const])],
            players: merged.players,
          },
          importedAt:
            incoming.source.fetchedAt > stored.importedAt
              ? incoming.source.fetchedAt
              : stored.importedAt,
        });
      }
      const status = incoming.quality === "complete" ? "complete" : "partial";
      await this.#recordHealth(
        status === "complete" ? "ready" : "degraded",
        status === "complete" ? null : "STRATZ returned partial match enrichment.",
      );
      return { changed: merged.changed, status };
    } catch (error) {
      const status = errorStatus(error);
      if (status !== "private") {
        await this.#recordHealth(
          status === "unavailable" ? "unavailable" : "degraded",
          status === "rate_limited"
            ? "STRATZ rate limit was reached."
            : status === "unavailable"
              ? "STRATZ is unavailable."
              : "STRATZ match enrichment failed.",
        );
      }
      return { changed: false, status };
    }
  }

  async #recordHealth(
    status: "ready" | "degraded" | "unavailable",
    message: string | null,
  ): Promise<void> {
    await this.#repository.upsertProviderHealth({
      source: "stratz",
      status,
      checkedAt: this.#clock().toISOString(),
      message,
    });
  }
}
