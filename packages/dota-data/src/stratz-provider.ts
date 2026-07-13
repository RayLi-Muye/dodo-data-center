import { StratzProviderError } from "./stratz-errors.js";
import type {
  StratzAbilityUpgradeEvent,
  StratzItemPurchaseEvent,
  StratzMatchDetail,
  StratzMatchPlayer,
  StratzPlayerSummary,
  StratzRecentMatch,
  StratzRecentMatches,
  StratzSourceMetadata,
} from "./types.js";

const DEFAULT_ENDPOINT = "https://api.stratz.com/graphql";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RECENT_MATCH_LIMIT = 20;
const MAX_RECENT_MATCH_LIMIT = 100;

const MATCH_QUERY = `
  query DodoStratzMatch($id: Long!) {
    match(id: $id) {
      id
      didRadiantWin
      durationSeconds
      startDateTime
      clusterId
      lobbyType
      gameMode
      gameVersionId
      regionId
      players {
        playerSlot
        steamAccountId
        isRadiant
        isVictory
        heroId
        kills
        deaths
        assists
        numLastHits
        numDenies
        goldPerMinute
        experiencePerMinute
        level
        networth
        heroDamage
        towerDamage
        heroHealing
        item0Id
        item1Id
        item2Id
        item3Id
        item4Id
        item5Id
        backpack0Id
        backpack1Id
        backpack2Id
        neutral0Id
        playbackData {
          abilityLearnEvents { time abilityId levelObtained level }
          purchaseEvents { time itemId }
        }
      }
    }
  }
`;

const PLAYER_SUMMARY_QUERY = `
  query DodoStratzPlayerSummary($steamAccountId: Long!) {
    player(steamAccountId: $steamAccountId) {
      steamAccountId
      matchCount
      winCount
      lastMatchDate
      steamAccount {
        id
        name
        avatar
        isAnonymous
      }
    }
  }
`;

const PLAYER_RECENT_MATCHES_QUERY = `
  query DodoStratzRecentMatches($steamAccountId: Long!, $take: Int!) {
    player(steamAccountId: $steamAccountId) {
      steamAccountId
      steamAccount { id isAnonymous }
      matches(request: { take: $take, playerList: SINGLE, orderBy: DESC }) {
        id
        didRadiantWin
        durationSeconds
        startDateTime
        clusterId
        lobbyType
        gameMode
        gameVersionId
        regionId
        players(steamAccountId: $steamAccountId) {
          playerSlot
          steamAccountId
          isRadiant
          isVictory
          heroId
          kills
          deaths
          assists
          numLastHits
          numDenies
          goldPerMinute
          experiencePerMinute
          level
          networth
          heroDamage
          towerDamage
          heroHealing
          item0Id
          item1Id
          item2Id
          item3Id
          item4Id
          item5Id
          backpack0Id
          backpack1Id
          backpack2Id
          neutral0Id
          playbackData {
            abilityLearnEvents { time abilityId levelObtained level }
            purchaseEvents { time itemId }
          }
        }
      }
    }
  }
`;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type JsonRecord = Record<string, unknown>;

export type StratzProviderConfig = {
  token: string;
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  clock?: () => Date;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function payloadError(message: string): never {
  throw new StratzProviderError("FAILED", "invalid_response", message, false);
}

function readRecord(value: unknown, field: string): JsonRecord {
  return isRecord(value) ? value : payloadError(`${field} must be an object`);
}

function readArray(value: unknown, field: string): unknown[] {
  return Array.isArray(value) ? value : payloadError(`${field} must be an array`);
}

function readBoolean(value: unknown, field: string): boolean {
  return typeof value === "boolean" ? value : payloadError(`${field} must be a boolean`);
}

function readInteger(value: unknown, field: string, minimum = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
    ? value
    : payloadError(`${field} must be an integer >= ${minimum}`);
}

function readSignedInteger(value: unknown, field: string): number {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : payloadError(`${field} must be an integer`);
}

function readOptionalInteger(value: unknown, field: string): number | null {
  return value === null || value === undefined ? null : readInteger(value, field);
}

function readId(value: unknown, field: string): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value.toString();
  }
  if (typeof value === "string" && /^\d+$/.test(value) && BigInt(value) > 0n) {
    return BigInt(value).toString();
  }
  return payloadError(`${field} must be a positive decimal ID`);
}

function readOptionalId(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === 0 || value === "0") return null;
  return readId(value, field);
}

function readEnum(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value.toString();
  }
  return payloadError(`${field} must be a GraphQL enum or non-negative integer`);
}

function readOptionalEnum(value: unknown, field: string): string | null {
  return value === null || value === undefined ? null : readEnum(value, field);
}

function timestampFromSeconds(value: unknown, field: string): string {
  const seconds = readInteger(value, field, 1);
  const timestamp = new Date(seconds * 1_000);
  return Number.isNaN(timestamp.getTime())
    ? payloadError(`${field} is outside the supported timestamp range`)
    : timestamp.toISOString();
}

function optionalTimestampFromSeconds(value: unknown, field: string): string | null {
  return value === null || value === undefined ? null : timestampFromSeconds(value, field);
}

function sourceMetadata(fetchedAt: Date): StratzSourceMetadata {
  return { source: "stratz", fetchedAt: fetchedAt.toISOString() };
}

function parseRetryAfter(value: string | null, now: Date): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isInteger(seconds) && seconds > 0) return seconds;
  const retryAt = Date.parse(value);
  return Number.isNaN(retryAt)
    ? null
    : Math.max(1, Math.ceil((retryAt - now.getTime()) / 1_000));
}

function privacyStatus(rawSteamAccount: unknown): StratzPlayerSummary["privacyStatus"] {
  if (rawSteamAccount === null || rawSteamAccount === undefined) return "unknown";
  const account = readRecord(rawSteamAccount, "player.steamAccount");
  return readBoolean(account.isAnonymous, "player.steamAccount.isAnonymous")
    ? "anonymous"
    : "public";
}

function normalizeAbilityBuild(
  rawPlayback: unknown,
  exclusionReasons: Set<string>,
): Pick<StratzMatchPlayer, "abilityBuild" | "abilityBuildStatus"> {
  if (rawPlayback === null || rawPlayback === undefined) {
    return { abilityBuild: [], abilityBuildStatus: "unavailable" };
  }
  const playback = readRecord(rawPlayback, "player.playbackData");
  if (!Array.isArray(playback.abilityLearnEvents)) {
    return { abilityBuild: [], abilityBuildStatus: "unavailable" };
  }

  const candidates: Array<StratzAbilityUpgradeEvent & {
    abilityLevel: number;
    providerIndex: number;
  }> = [];
  playback.abilityLearnEvents.forEach((value, providerIndex) => {
    try {
      const event = readRecord(value, `player.abilityLearnEvents[${providerIndex}]`);
      candidates.push({
        abilityId: readId(event.abilityId, `player.abilityLearnEvents[${providerIndex}].abilityId`),
        sequence: 0,
        heroLevel: readInteger(
          event.levelObtained,
          `player.abilityLearnEvents[${providerIndex}].levelObtained`,
          1,
        ),
        gameTimeSeconds: readSignedInteger(
          event.time,
          `player.abilityLearnEvents[${providerIndex}].time`,
        ),
        abilityLevel: readInteger(
          event.level,
          `player.abilityLearnEvents[${providerIndex}].level`,
        ),
        providerIndex,
      });
    } catch (error) {
      if (!(error instanceof StratzProviderError) || error.reason !== "invalid_response") throw error;
      exclusionReasons.add("ability_event_invalid");
    }
  });
  candidates.sort((left, right) =>
    left.gameTimeSeconds - right.gameTimeSeconds || left.providerIndex - right.providerIndex,
  );
  const seen = new Set<string>();
  const abilityBuild = candidates.flatMap((event) => {
    const key = `${event.gameTimeSeconds}:${event.abilityId}:${event.heroLevel}:${event.abilityLevel}`;
    if (seen.has(key)) {
      exclusionReasons.add("ability_event_duplicate");
      return [];
    }
    seen.add(key);
    const {
      abilityLevel: _abilityLevel,
      providerIndex: _providerIndex,
      ...normalized
    } = event;
    normalized.sequence = seen.size;
    return [normalized];
  });
  return { abilityBuild, abilityBuildStatus: "timed" };
}

function normalizePurchases(
  rawPlayback: unknown,
  exclusionReasons: Set<string>,
): Pick<StratzMatchPlayer, "itemTimeline" | "itemTimelineStatus"> {
  if (rawPlayback === null || rawPlayback === undefined) {
    return { itemTimeline: [], itemTimelineStatus: "unavailable" };
  }
  const playback = readRecord(rawPlayback, "player.playbackData");
  if (!Array.isArray(playback.purchaseEvents)) {
    return { itemTimeline: [], itemTimelineStatus: "unavailable" };
  }

  const candidates: Array<StratzItemPurchaseEvent & { providerIndex: number }> = [];
  playback.purchaseEvents.forEach((value, providerIndex) => {
    try {
      const event = readRecord(value, `player.purchaseEvents[${providerIndex}]`);
      candidates.push({
        itemId: readId(event.itemId, `player.purchaseEvents[${providerIndex}].itemId`),
        action: "purchase",
        gameTimeSeconds: readSignedInteger(
          event.time,
          `player.purchaseEvents[${providerIndex}].time`,
        ),
        charges: null,
        providerIndex,
      });
    } catch (error) {
      if (!(error instanceof StratzProviderError) || error.reason !== "invalid_response") throw error;
      exclusionReasons.add("purchase_event_invalid");
    }
  });
  candidates.sort((left, right) =>
    left.gameTimeSeconds - right.gameTimeSeconds || left.providerIndex - right.providerIndex,
  );
  const seen = new Set<string>();
  const itemTimeline = candidates.flatMap((event) => {
    const key = `${event.gameTimeSeconds}:${event.itemId}`;
    if (seen.has(key)) {
      exclusionReasons.add("purchase_event_duplicate");
      return [];
    }
    seen.add(key);
    const { providerIndex: _providerIndex, ...normalized } = event;
    return [normalized];
  });
  return { itemTimeline, itemTimelineStatus: "partial" };
}

function normalizePlayer(
  value: unknown,
  radiantWin: boolean,
  exclusionReasons: Set<string>,
  targetSteamAccountId: string | null,
): StratzMatchPlayer {
  const raw = readRecord(value, "match.player");
  const playerSlot = readInteger(raw.playerSlot, "player.playerSlot");
  if (playerSlot > 255) payloadError("player.playerSlot must be <= 255");
  const steamAccountId = readOptionalId(raw.steamAccountId, "player.steamAccountId");
  if (targetSteamAccountId !== null && steamAccountId !== targetSteamAccountId) {
    payloadError("player.steamAccountId does not match the requested account");
  }
  const isRadiant = readBoolean(raw.isRadiant, "player.isRadiant");
  const slotIsRadiant = playerSlot < 128;
  if (isRadiant !== slotIsRadiant) payloadError("player side conflicts with playerSlot");
  const isWin = readBoolean(raw.isVictory, "player.isVictory");
  if (isWin !== (isRadiant ? radiantWin : !radiantWin)) {
    payloadError("player outcome conflicts with match outcome");
  }

  const finalItemIds = [raw.item0Id, raw.item1Id, raw.item2Id, raw.item3Id, raw.item4Id, raw.item5Id]
    .map((itemId, index) => readOptionalId(itemId, `player.item${index}Id`))
    .filter((itemId): itemId is string => itemId !== null);
  const backpackItemIds = [raw.backpack0Id, raw.backpack1Id, raw.backpack2Id]
    .map((itemId, index) => readOptionalId(itemId, `player.backpack${index}Id`))
    .filter((itemId): itemId is string => itemId !== null);

  return {
    steamAccountId,
    playerSlot,
    heroId: readId(raw.heroId, "player.heroId"),
    side: isRadiant ? "radiant" : "dire",
    isWin,
    kills: readInteger(raw.kills, "player.kills"),
    deaths: readInteger(raw.deaths, "player.deaths"),
    assists: readInteger(raw.assists, "player.assists"),
    gpm: readOptionalInteger(raw.goldPerMinute, "player.goldPerMinute"),
    xpm: readOptionalInteger(raw.experiencePerMinute, "player.experiencePerMinute"),
    lastHits: readOptionalInteger(raw.numLastHits, "player.numLastHits"),
    denies: readOptionalInteger(raw.numDenies, "player.numDenies"),
    heroDamage: readOptionalInteger(raw.heroDamage, "player.heroDamage"),
    heroHealing: readOptionalInteger(raw.heroHealing, "player.heroHealing"),
    towerDamage: readOptionalInteger(raw.towerDamage, "player.towerDamage"),
    level: readOptionalInteger(raw.level, "player.level"),
    netWorth: readOptionalInteger(raw.networth, "player.networth"),
    finalItemIds,
    backpackItemIds,
    neutralItemId: readOptionalId(raw.neutral0Id, "player.neutral0Id"),
    ...normalizeAbilityBuild(raw.playbackData, exclusionReasons),
    ...normalizePurchases(raw.playbackData, exclusionReasons),
  };
}

function normalizeMatch(
  value: unknown,
  fetchedAt: Date,
  expectedId: string | null,
  expectedPlayerCount: 1 | 10,
  targetSteamAccountId: string | null = null,
  graphqlPartial = false,
): StratzMatchDetail {
  const raw = readRecord(value, "match");
  const id = readId(raw.id, "match.id");
  if (expectedId !== null && id !== expectedId) payloadError("match.id does not match request");
  const radiantWin = readBoolean(raw.didRadiantWin, "match.didRadiantWin");
  const rawPlayers = readArray(raw.players, "match.players");
  const slots = rawPlayers.map((player, index) =>
    readInteger(readRecord(player, `match.players[${index}]`).playerSlot, `match.players[${index}].playerSlot`),
  );
  if (new Set(slots).size !== slots.length) payloadError("match.players contains duplicate playerSlot values");
  if (
    expectedPlayerCount === 10 &&
    (slots.filter((slot) => slot < 128).length !== 5 ||
      slots.filter((slot) => slot >= 128).length !== 5)
  ) {
    payloadError("match.players must contain five players per side");
  }

  const exclusionReasons = new Set<string>();
  if (graphqlPartial) exclusionReasons.add("graphql_partial");
  if (rawPlayers.length !== expectedPlayerCount) {
    exclusionReasons.add(`player_count_${rawPlayers.length}_expected_${expectedPlayerCount}`);
  }
  const players: StratzMatchPlayer[] = [];
  rawPlayers.forEach((player) => {
    try {
      players.push(normalizePlayer(player, radiantWin, exclusionReasons, targetSteamAccountId));
    } catch (error) {
      if (!(error instanceof StratzProviderError) || error.reason !== "invalid_response") throw error;
      exclusionReasons.add("player_invalid");
    }
  });
  if (players.length === 0) payloadError("match.players contains no usable player");

  return {
    id,
    startTime: timestampFromSeconds(raw.startDateTime, "match.startDateTime"),
    durationSeconds: readInteger(raw.durationSeconds, "match.durationSeconds", 1),
    gameVersionId: readOptionalId(raw.gameVersionId, "match.gameVersionId"),
    gameMode: readEnum(raw.gameMode, "match.gameMode"),
    lobbyType: readOptionalEnum(raw.lobbyType, "match.lobbyType"),
    region: readOptionalId(raw.regionId, "match.regionId"),
    cluster: readOptionalId(raw.clusterId, "match.clusterId"),
    radiantWin,
    eligiblePlayerCount: players.length,
    excludedPlayerCount: rawPlayers.length - players.length,
    exclusionReasons: [...exclusionReasons].sort(),
    quality: exclusionReasons.size === 0 ? "complete" : "partial",
    players,
    source: sourceMetadata(fetchedAt),
  };
}

function graphQlErrorCategory(errors: unknown[]): Pick<StratzProviderError, "code" | "reason" | "retryable"> {
  const signals = errors.flatMap((value) => {
    if (!isRecord(value)) return [];
    const extensionCode = isRecord(value.extensions) ? value.extensions.code : null;
    return [value.message, extensionCode]
      .filter((part): part is string => typeof part === "string")
      .map((part) => part.toLowerCase());
  }).join(" ");
  if (/unauth|invalid.?token|forbidden|not.?authorized/.test(signals)) {
    return { code: "AUTHENTICATION", reason: "invalid_token", retryable: false };
  }
  if (/rate.?limit|too.?many/.test(signals)) {
    return { code: "RATE_LIMITED", reason: "rate_limited", retryable: true };
  }
  if (/internal.?server|service.?unavailable|timeout/.test(signals)) {
    return { code: "UNAVAILABLE", reason: "graphql_error", retryable: true };
  }
  return { code: "FAILED", reason: "graphql_error", retryable: false };
}

type GraphQlErrorCategory = ReturnType<typeof graphQlErrorCategory>;

function throwGraphQlError(category: GraphQlErrorCategory): never {
  throw new StratzProviderError(
    category.code,
    category.reason,
    "STRATZ GraphQL request failed",
    category.retryable,
    200,
  );
}

export class StratzProvider {
  private readonly endpoint: URL;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly clock: () => Date;

  constructor(config: StratzProviderConfig) {
    const token = config.token.trim();
    if (token.length === 0 || /[\r\n]/.test(token)) {
      throw new TypeError("STRATZ token must be a non-empty single-line value");
    }
    const endpoint = new URL(config.endpoint ?? DEFAULT_ENDPOINT);
    if (!/^https?:$/.test(endpoint.protocol) || endpoint.username || endpoint.password) {
      throw new TypeError("STRATZ endpoint must be an HTTP(S) URL without credentials");
    }
    const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError("STRATZ timeoutMs must be a positive integer");
    }
    this.endpoint = endpoint;
    this.token = token;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.clock = config.clock ?? (() => new Date());
  }

  async getMatchDetail(matchId: string): Promise<StratzMatchDetail> {
    const validatedMatchId = this.validateId(matchId, "match");
    const {
      data,
      fetchedAt,
      graphqlPartial,
      graphqlErrorCategory,
    } = await this.request(MATCH_QUERY, {
      id: Number(validatedMatchId),
    });
    const match = readRecord(data, "STRATZ data").match;
    if (match === null || match === undefined) {
      if (graphqlErrorCategory !== null) throwGraphQlError(graphqlErrorCategory);
      throw new StratzProviderError("NOT_FOUND", "not_found", "STRATZ match was not found", false, 404);
    }
    return normalizeMatch(match, fetchedAt, validatedMatchId, 10, null, graphqlPartial);
  }

  async getPlayerSummary(steamAccountId: string): Promise<StratzPlayerSummary> {
    const validatedId = this.validateId(steamAccountId, "Steam account");
    const {
      data,
      fetchedAt,
      graphqlPartial,
      graphqlErrorCategory,
    } = await this.request(PLAYER_SUMMARY_QUERY, {
      steamAccountId: Number(validatedId),
    });
    const playerValue = readRecord(data, "STRATZ data").player;
    if (playerValue === null || playerValue === undefined) {
      if (graphqlErrorCategory !== null) throwGraphQlError(graphqlErrorCategory);
      throw new StratzProviderError("NOT_FOUND", "not_found", "STRATZ player was not found", false, 404);
    }
    const player = readRecord(playerValue, "player");
    const returnedId = readId(player.steamAccountId, "player.steamAccountId");
    if (returnedId !== validatedId) payloadError("player.steamAccountId does not match request");
    const account = player.steamAccount === null || player.steamAccount === undefined
      ? null
      : readRecord(player.steamAccount, "player.steamAccount");
    if (account !== null && readId(account.id, "player.steamAccount.id") !== validatedId) {
      payloadError("player.steamAccount.id does not match request");
    }
    const matchCount = readOptionalInteger(player.matchCount, "player.matchCount");
    const winCount = readOptionalInteger(player.winCount, "player.winCount");
    if (matchCount !== null && winCount !== null && winCount > matchCount) {
      payloadError("player.winCount must not exceed matchCount");
    }
    const quality = !graphqlPartial && account !== null && matchCount !== null && winCount !== null
      ? "complete"
      : "partial";
    return {
      steamAccountId: validatedId,
      personaName: typeof account?.name === "string" && account.name.length > 0 ? account.name : null,
      avatarUrl: typeof account?.avatar === "string" && account.avatar.length > 0 ? account.avatar : null,
      matchCount,
      winCount,
      lastMatchAt: optionalTimestampFromSeconds(player.lastMatchDate, "player.lastMatchDate"),
      privacyStatus: privacyStatus(player.steamAccount),
      quality,
      source: sourceMetadata(fetchedAt),
    };
  }

  async getRecentMatches(
    steamAccountId: string,
    limit = DEFAULT_RECENT_MATCH_LIMIT,
  ): Promise<StratzRecentMatches> {
    const validatedId = this.validateId(steamAccountId, "Steam account");
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECENT_MATCH_LIMIT) {
      throw new RangeError(`STRATZ recent match limit must be between 1 and ${MAX_RECENT_MATCH_LIMIT}`);
    }
    const {
      data,
      fetchedAt,
      graphqlPartial,
      graphqlErrorCategory,
    } = await this.request(PLAYER_RECENT_MATCHES_QUERY, {
      steamAccountId: Number(validatedId),
      take: limit,
    });
    const playerValue = readRecord(data, "STRATZ data").player;
    if (playerValue === null || playerValue === undefined) {
      if (graphqlErrorCategory !== null) throwGraphQlError(graphqlErrorCategory);
      throw new StratzProviderError("NOT_FOUND", "not_found", "STRATZ player was not found", false, 404);
    }
    const player = readRecord(playerValue, "player");
    if (readId(player.steamAccountId, "player.steamAccountId") !== validatedId) {
      payloadError("player.steamAccountId does not match request");
    }
    const privacy = privacyStatus(player.steamAccount);
    if (player.steamAccount !== null && player.steamAccount !== undefined) {
      const account = readRecord(player.steamAccount, "player.steamAccount");
      if (readId(account.id, "player.steamAccount.id") !== validatedId) {
        payloadError("player.steamAccount.id does not match request");
      }
    }
    const rawMatches = readArray(player.matches, "player.matches");
    const exclusions = new Set<string>();
    if (graphqlPartial) exclusions.add("graphql_partial");
    const normalized: Array<StratzRecentMatch & { providerIndex: number }> = [];
    rawMatches.forEach((match, providerIndex) => {
      try {
        const detail = normalizeMatch(
          match,
          fetchedAt,
          null,
          1,
          validatedId,
          graphqlPartial,
        );
        if (detail.quality === "partial") exclusions.add("match_partial");
        const [targetPlayer] = detail.players;
        if (targetPlayer === undefined) payloadError("recent match target player is unavailable");
        const { players: _players, ...rest } = detail;
        normalized.push({ ...rest, player: targetPlayer, providerIndex });
      } catch (error) {
        if (!(error instanceof StratzProviderError) || error.reason !== "invalid_response") throw error;
        exclusions.add("candidate_invalid");
      }
    });
    normalized.sort((left, right) => {
      const startDifference = Date.parse(right.startTime) - Date.parse(left.startTime);
      if (startDifference !== 0) return startDifference;
      const idDifference = BigInt(right.id) - BigInt(left.id);
      return idDifference === 0n ? left.providerIndex - right.providerIndex : idDifference > 0n ? 1 : -1;
    });
    const seenMatchIds = new Set<string>();
    const matches = normalized.flatMap(({ providerIndex: _providerIndex, ...match }) => {
      if (seenMatchIds.has(match.id)) {
        exclusions.add("duplicate_match");
        return [];
      }
      seenMatchIds.add(match.id);
      return [match];
    });
    const excludedCount = rawMatches.length - matches.length;
    return {
      steamAccountId: validatedId,
      requestedLimit: limit,
      privacyStatus: privacy,
      quality: excludedCount === 0 && exclusions.size === 0 ? "complete" : "partial",
      eligibleCount: rawMatches.length,
      excludedCount,
      exclusionReasons: [...exclusions].sort(),
      matches,
      source: sourceMetadata(fetchedAt),
    };
  }

  private validateId(value: string, label: string): string {
    if (!/^\d+$/.test(value) || BigInt(value) <= 0n || BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new TypeError(`STRATZ ${label} IDs must be positive safe decimal strings`);
    }
    return BigInt(value).toString();
  }

  private async request(
    query: string,
    variables: Record<string, number>,
  ): Promise<{
    data: unknown;
    fetchedAt: Date;
    graphqlPartial: boolean;
    graphqlErrorCategory: GraphQlErrorCategory | null;
  }> {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          "User-Agent": "STRATZ_API",
        },
        body: JSON.stringify({ query, variables }),
        redirect: "error",
        signal: controller.signal,
      });
      const now = this.clock();
      if (response.status === 401) {
        throw new StratzProviderError("AUTHENTICATION", "invalid_token", "STRATZ authentication failed", false, 401);
      }
      if (response.status === 403) {
        if (response.headers.get("cf-mitigated") === "challenge") {
          throw new StratzProviderError("UNAVAILABLE", "cloudflare_challenge", "STRATZ request was blocked by an upstream challenge", true, 403);
        }
        throw new StratzProviderError("AUTHENTICATION", "forbidden", "STRATZ access was forbidden", false, 403);
      }
      if (response.status === 429) {
        throw new StratzProviderError(
          "RATE_LIMITED",
          "rate_limited",
          "STRATZ rate limit was reached",
          true,
          429,
          parseRetryAfter(response.headers.get("retry-after"), now),
        );
      }
      if (response.status >= 500) {
        throw new StratzProviderError("UNAVAILABLE", "upstream_5xx", `STRATZ returned HTTP ${response.status}`, true, response.status);
      }
      if (!response.ok) {
        throw new StratzProviderError("FAILED", "upstream_http", `STRATZ returned HTTP ${response.status}`, false, response.status);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payloadError("STRATZ response is not valid JSON");
      }
      const root = readRecord(payload, "STRATZ response");
      if (Array.isArray(root.errors) && root.errors.length > 0) {
        const category = graphQlErrorCategory(root.errors);
        if (isRecord(root.data)) {
          return {
            data: root.data,
            fetchedAt: now,
            graphqlPartial: true,
            graphqlErrorCategory: category,
          };
        }
        throwGraphQlError(category);
      }
      if (!("data" in root)) payloadError("STRATZ response does not contain data");
      return {
        data: root.data,
        fetchedAt: now,
        graphqlPartial: false,
        graphqlErrorCategory: null,
      };
    } catch (error) {
      if (error instanceof StratzProviderError) throw error;
      if (timedOut) {
        throw new StratzProviderError("UNAVAILABLE", "timeout", `STRATZ request timed out after ${this.timeoutMs}ms`, true);
      }
      throw new StratzProviderError("UNAVAILABLE", "network", "STRATZ network request failed", true);
    } finally {
      clearTimeout(timeout);
    }
  }
}
