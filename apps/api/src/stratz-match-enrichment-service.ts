import type { StratzEnrichmentState } from "@dodo/contracts";
import type { StratzMatchDetail, StratzProvider } from "@dodo/dota-data";
import type { DodoRepository, StoredMatch } from "@dodo/db";

type MatchPlayer = StoredMatch["detail"]["players"][number];
type StratzMatchPlayer = StratzMatchDetail["players"][number];

export const STRATZ_PROVIDER_REVISION = "stratz-graphql-v1";

export type StratzEnrichmentStatus = StratzEnrichmentState["status"] | "skipped";

export type StratzEnrichmentOutcome = {
  changed: boolean;
  status: StratzEnrichmentStatus;
  stopBatch?: boolean;
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

const RETRY_DELAYS_MS = [15 * 60_000, 2 * 60 * 60_000, 24 * 60 * 60_000] as const;
const MIN_PROVIDER_RETRY_MS = 60_000;
const MAX_PROVIDER_RETRY_MS = 24 * 60 * 60_000;

const stateForRevision = (state: StratzEnrichmentState): StratzEnrichmentState =>
  state.providerRevision === STRATZ_PROVIDER_REVISION
    ? state
    : {
        status: "not_requested",
        resultQuality: null,
        attemptCount: 0,
        lastAttemptAt: null,
        nextAttemptAt: null,
        reasonCode: null,
        providerRevision: STRATZ_PROVIDER_REVISION,
      };

export const stratzEnrichmentIsEligible = (
  state: StratzEnrichmentState,
  now: Date,
): boolean => {
  if (state.providerRevision !== STRATZ_PROVIDER_REVISION) return true;
  if (state.status === "not_requested") return true;
  if (state.status !== "retry_scheduled" && state.status !== "provider_blocked") return false;
  return state.nextAttemptAt !== null && Date.parse(state.nextAttemptAt) <= now.getTime();
};

const retryState = (
  previous: StratzEnrichmentState,
  now: Date,
  reasonCode: "partial_response" | "not_found" | "invalid_response",
  resultQuality: StratzEnrichmentState["resultQuality"],
  hasContribution: boolean,
): StratzEnrichmentState => {
  const attemptCount = previous.attemptCount + 1;
  const delay = RETRY_DELAYS_MS[attemptCount - 1];
  return {
    status: delay === undefined
      ? hasContribution ? "terminal_partial" : "terminal_failed"
      : "retry_scheduled",
    resultQuality: hasContribution ? "partial" : resultQuality,
    attemptCount,
    lastAttemptAt: now.toISOString(),
    nextAttemptAt: delay === undefined ? null : new Date(now.getTime() + delay).toISOString(),
    reasonCode,
    providerRevision: STRATZ_PROVIDER_REVISION,
  };
};

const providerBlockedState = (
  previous: StratzEnrichmentState,
  now: Date,
  reasonCode: "rate_limited" | "authentication" | "unavailable",
  retryAfterSeconds: number | null,
): StratzEnrichmentState => {
  const defaultDelay = reasonCode === "authentication" ? MAX_PROVIDER_RETRY_MS : RETRY_DELAYS_MS[0];
  const requestedDelay = retryAfterSeconds === null ? defaultDelay : retryAfterSeconds * 1_000;
  const delay = Math.min(MAX_PROVIDER_RETRY_MS, Math.max(MIN_PROVIDER_RETRY_MS, requestedDelay));
  return {
    ...previous,
    status: "provider_blocked",
    lastAttemptAt: now.toISOString(),
    nextAttemptAt: new Date(now.getTime() + delay).toISOString(),
    reasonCode,
    providerRevision: STRATZ_PROVIDER_REVISION,
  };
};

const providerFailure = (error: unknown): {
  reasonCode: "rate_limited" | "authentication" | "unavailable";
  retryAfterSeconds: number | null;
} | null => {
  if (!error || typeof error !== "object") return null;
  const record = error as { code?: unknown; retryAfterSeconds?: unknown };
  const code = typeof record.code === "string" ? record.code : "";
  const reasonCode = code === "AUTHENTICATION"
    ? "authentication"
    : code === "RATE_LIMITED"
      ? "rate_limited"
      : code === "UNAVAILABLE"
        ? "unavailable"
        : null;
  if (reasonCode === null) return null;
  return {
    reasonCode,
    retryAfterSeconds:
      typeof record.retryAfterSeconds === "number" && Number.isFinite(record.retryAfterSeconds)
        ? Math.max(0, record.retryAfterSeconds)
        : null,
  };
};

const attemptFailureReason = (error: unknown): "not_found" | "invalid_response" => {
  if (!error || typeof error !== "object") return "invalid_response";
  const record = error as { code?: unknown; reason?: unknown };
  return record.code === "NOT_FOUND" || record.reason === "not_found"
    ? "not_found"
    : "invalid_response";
};

const safeErrorReason = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return null;
  const record = error as { code?: unknown; reason?: unknown };
  const code = typeof record.code === "string" && /^[A-Z_]+$/.test(record.code)
    ? record.code
    : null;
  const reason = typeof record.reason === "string" && /^[a-z0-9_]+$/.test(record.reason)
    ? record.reason
    : null;
  return code && reason ? `${code}: ${reason}` : code ?? reason;
};

export class StratzMatchEnrichmentService {
  readonly #repository: DodoRepository;
  readonly #provider: StratzMatchProvider;
  readonly #clock: () => Date;
  #providerBlockedUntil = 0;

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
    const now = this.#clock();
    if (this.#providerBlockedUntil > now.getTime()) {
      return { changed: false, status: "skipped", stopBatch: true };
    }
    const previousState = stateForRevision(stored.detail.stratzEnrichment);
    if (!stratzEnrichmentIsEligible(stored.detail.stratzEnrichment, now)) {
      return { changed: false, status: "skipped" };
    }
    let incoming: StratzMatchDetail;
    try {
      incoming = await this.#provider.getMatchDetail(matchId);
    } catch (error) {
      return this.#handleProviderFailure(stored, previousState, now, error);
    }
      if (coreMatchConflict(stored, incoming)) {
        const state: StratzEnrichmentState = {
          ...previousState,
          status: "terminal_failed",
          attemptCount: previousState.attemptCount + 1,
          lastAttemptAt: now.toISOString(),
          nextAttemptAt: null,
          reasonCode: "core_conflict",
          providerRevision: STRATZ_PROVIDER_REVISION,
        };
        await this.#repository.upsertMatch({
          ...stored,
          detail: { ...stored.detail, stratzEnrichment: state },
        });
        await this.#recordHealth("degraded", "STRATZ match core fields conflicted with OpenDota.");
        return { changed: false, status: state.status };
      }
      const merged = mergePlayers(stored, incoming);
      if (merged.conflict) {
        const state: StratzEnrichmentState = {
          ...previousState,
          status: "terminal_failed",
          attemptCount: previousState.attemptCount + 1,
          lastAttemptAt: now.toISOString(),
          nextAttemptAt: null,
          reasonCode: "player_conflict",
          providerRevision: STRATZ_PROVIDER_REVISION,
        };
        await this.#repository.upsertMatch({
          ...stored,
          detail: { ...stored.detail, stratzEnrichment: state },
        });
        await this.#recordHealth("degraded", "STRATZ player identity conflicted with OpenDota.");
        return { changed: false, status: state.status };
      }
      const hasContribution = stored.detail.enrichmentSources.includes("stratz") || merged.changed;
      const state: StratzEnrichmentState = incoming.quality === "complete"
        ? {
            status: "complete",
            resultQuality: "complete",
            attemptCount: previousState.attemptCount + 1,
            lastAttemptAt: now.toISOString(),
            nextAttemptAt: null,
            reasonCode: null,
            providerRevision: STRATZ_PROVIDER_REVISION,
          }
        : retryState(
            previousState,
            now,
            "partial_response",
            "partial",
            hasContribution,
          );
      await this.#repository.upsertMatch({
        ...stored,
        detail: {
          ...stored.detail,
          enrichmentSources: merged.changed
            ? [...new Set([...stored.detail.enrichmentSources, "stratz" as const])]
            : stored.detail.enrichmentSources,
          stratzEnrichment: state,
          players: merged.players,
        },
        importedAt:
          merged.changed && incoming.source.fetchedAt > stored.importedAt
            ? incoming.source.fetchedAt
            : stored.importedAt,
      });
      await this.#recordHealth(
        incoming.quality === "complete" ? "ready" : "degraded",
        incoming.quality === "complete" ? null : "STRATZ returned partial match enrichment.",
      );
      return { changed: merged.changed, status: state.status };
  }

  async #handleProviderFailure(
    stored: StoredMatch,
    previousState: StratzEnrichmentState,
    now: Date,
    error: unknown,
  ): Promise<StratzEnrichmentOutcome> {
    const providerBlock = providerFailure(error);
    const reason = safeErrorReason(error);
    const hasContribution = stored.detail.enrichmentSources.includes("stratz");
    const state = providerBlock
      ? providerBlockedState(
          previousState,
          now,
          providerBlock.reasonCode,
          providerBlock.retryAfterSeconds,
        )
      : retryState(
          previousState,
          now,
          attemptFailureReason(error),
          previousState.resultQuality,
          hasContribution,
        );
    if (providerBlock && state.nextAttemptAt !== null) {
      this.#providerBlockedUntil = Math.max(
        this.#providerBlockedUntil,
        Date.parse(state.nextAttemptAt),
      );
    }
    await this.#repository.upsertMatch({
      ...stored,
      detail: { ...stored.detail, stratzEnrichment: state },
    });
    await this.#recordHealth(
      providerBlock?.reasonCode === "unavailable" ||
        providerBlock?.reasonCode === "authentication"
        ? "unavailable"
        : "degraded",
      providerBlock?.reasonCode === "rate_limited"
        ? `STRATZ rate limit was reached${reason ? ` (${reason})` : ""}.`
        : providerBlock
          ? `STRATZ is unavailable${reason ? ` (${reason})` : ""}.`
          : `STRATZ match enrichment failed${reason ? ` (${reason})` : ""}.`,
    );
    return {
      changed: false,
      status: state.status,
      ...(providerBlock ? { stopBatch: true } : {}),
    };
  }

  async #recordHealth(
    status: "ready" | "degraded" | "unavailable",
    message: string | null,
  ): Promise<void> {
    try {
      await this.#repository.upsertProviderHealth({
        source: "stratz",
        status,
        checkedAt: this.#clock().toISOString(),
        message,
      });
    } catch {
      // Match enrichment is durable even when optional provider health reporting fails.
    }
  }
}
