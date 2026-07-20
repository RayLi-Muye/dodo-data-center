import {
  emptyMatchAnalysis,
  MATCH_ANALYSIS_PROVIDER_REVISION,
} from "@dodo/contracts";
import type { MatchAnalysis } from "@dodo/contracts";
import { OpenDotaProviderError } from "./errors.js";
import type {
  CanonicalConstantsSnapshot,
  CanonicalHeroAbilityConstant,
  CanonicalHeroAbilityConstants,
  CanonicalHeroConstant,
  CanonicalItemConstant,
  CanonicalMatchDetail,
  CanonicalMatchPlayer,
  CanonicalPatchSummary,
  CanonicalPlayerMatchesPage,
  CanonicalPlayerMatch,
  CanonicalPlayerProfile,
  CanonicalRecentMatchCandidateEntry,
  CanonicalRecentMatchQualityContext,
  CanonicalRecentMatches,
  OpenDotaSourceMetadata,
} from "./types.js";

const DEFAULT_BASE_URL = "https://api.opendota.com/api/";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 10_000;
const DEFAULT_RECENT_MATCH_LIMIT = 100;
const REQUIRED_RECENT_MATCH_FIELDS = [
  "match_id",
  "player_slot",
  "radiant_win",
  "duration",
  "game_mode",
  "hero_id",
  "start_time",
  "kills",
  "deaths",
  "assists",
] as const;
const REQUIRED_MATCH_DETAIL_FIELDS = [
  "match_id",
  "radiant_win",
  "duration",
  "game_mode",
  "start_time",
  "players",
] as const;
const REQUIRED_MATCH_PLAYER_FIELDS = [
  "player_slot",
  "hero_id",
  "kills",
  "deaths",
  "assists",
] as const;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Sleep = (delayMs: number) => Promise<void>;
type JsonRecord = Record<string, unknown>;

export type OpenDotaProviderConfig = {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  clock?: () => Date;
  sleep?: Sleep;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function payloadError(message: string): never {
  throw new OpenDotaProviderError(
    "SOURCE_UNAVAILABLE",
    "invalid_response",
    message,
    false,
  );
}

function readRecord(value: unknown, field: string): JsonRecord {
  return isRecord(value) ? value : payloadError(`${field} must be an object`);
}

function readNonEmptyRecord(value: unknown, field: string): JsonRecord {
  const record = readRecord(value, field);
  return Object.keys(record).length > 0 ? record : payloadError(`${field} must not be empty`);
}

function readArray(value: unknown, field: string): unknown[] {
  return Array.isArray(value) ? value : payloadError(`${field} must be an array`);
}

function readString(value: unknown, field: string): string {
  return typeof value === "string" && value.length > 0
    ? value
    : payloadError(`${field} must be a non-empty string`);
}

function readNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
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

function readOptionalInteger(value: unknown): number | null {
  return value === null || value === undefined ? null : readInteger(value, "optional integer");
}

function readBoolean(value: unknown, field: string): boolean {
  return typeof value === "boolean" ? value : payloadError(`${field} must be a boolean`);
}

function readId(value: unknown, field: string): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value.toString();
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value).toString();
  }
  return payloadError(`${field} must be a non-negative decimal ID`);
}

function readOptionalId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return readId(value, "optional ID");
}

function readOptionalAccountId(value: unknown): string | null {
  const accountId = readOptionalId(value);
  return accountId === "0" ? null : accountId;
}

function unavailableFieldReasons(
  record: JsonRecord,
  fields: readonly string[],
  prefix = "",
): string[] {
  return fields
    .filter((field) => record[field] === null || record[field] === undefined)
    .map((field) => `${prefix}${field}_unavailable`);
}

function timestampFromSeconds(value: unknown, field: string): string {
  const seconds = readInteger(value, field);
  const timestamp = new Date(seconds * 1_000);
  return Number.isNaN(timestamp.getTime())
    ? payloadError(`${field} is outside the supported timestamp range`)
    : timestamp.toISOString();
}

function timestampFromIsoString(value: unknown, field: string): string {
  const rawTimestamp = readString(value, field);
  const match = rawTimestamp.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/,
  );
  if (match === null) {
    return payloadError(`${field} must be an ISO 8601 UTC timestamp`);
  }
  const timestamp = new Date(rawTimestamp);
  const normalizedInput = `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z`;
  if (Number.isNaN(timestamp.getTime()) || timestamp.toISOString() !== normalizedInput) {
    return payloadError(`${field} must be a valid timestamp`);
  }
  return timestamp.toISOString();
}

function sourceMetadata(fetchedAt: Date): OpenDotaSourceMetadata {
  return { source: "opendota", fetchedAt: fetchedAt.toISOString() };
}

function normalizePrimaryAttribute(
  value: unknown,
): CanonicalHeroConstant["primaryAttribute"] {
  switch (value) {
    case "str":
      return "strength";
    case "agi":
      return "agility";
    case "int":
      return "intelligence";
    case "all":
      return "universal";
    default:
      return payloadError("hero.primary_attr is not recognized");
  }
}

function normalizeAttackType(value: unknown): CanonicalHeroConstant["attackType"] {
  if (value === "Melee") return "melee";
  if (value === "Ranged") return "ranged";
  return payloadError("hero.attack_type is not recognized");
}

type AnalysisSection<T> = {
  rawPresent: boolean;
  excludedCount: number;
  reasons: Set<string>;
  value: T;
};

const hasOwn = (record: JsonRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);

const newAnalysisSection = <T>(value: T): AnalysisSection<T> => ({
  rawPresent: false,
  excludedCount: 0,
  reasons: new Set<string>(),
  value,
});

const excludeAnalysisValue = <T>(section: AnalysisSection<T>, reason: string): void => {
  section.excludedCount += 1;
  section.reasons.add(reason);
};

const analysisStatus = <T>(section: AnalysisSection<T>): "unavailable" | "partial" | "complete" =>
  !section.rawPresent
    ? "unavailable"
    : section.excludedCount === 0
      ? "complete"
      : "partial";

const analysisMeta = <T>(section: AnalysisSection<T>) => ({
  status: analysisStatus(section),
  excludedCount: section.excludedCount,
  exclusionReasons: [...section.reasons].sort(),
});

const safePlayerSlot = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 255
    ? value
    : null;

const safeSignedInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : null;

const safeNonNegativeInteger = (value: unknown): number | null => {
  const number = safeSignedInteger(value);
  return number !== null && number >= 0 ? number : null;
};

const safeNonNegativeNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

const safeFiniteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const safeString = (value: unknown, maximum = 256): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= maximum ? value : null;

const optionalEntityKey = (value: unknown): string | null => {
  const string = safeString(value);
  if (string !== null) return string;
  return typeof value === "number" && Number.isFinite(value) ? String(value) : null;
};

const normalizePlayerTimelines = (rawPlayers: unknown[]): MatchAnalysis["playerTimelines"] => {
  const section = newAnalysisSection<MatchAnalysis["playerTimelines"]["players"]>([]);
  const timelineKeys = ["times", "gold_t", "xp_t", "lh_t", "dn_t"] as const;
  const metricKeys = [
    ["gold_t", "gold"],
    ["xp_t", "xp"],
    ["lh_t", "lastHits"],
    ["dn_t", "denies"],
  ] as const;

  const rawPresent = rawPlayers.some(
    (value) => isRecord(value) && timelineKeys.some((key) => hasOwn(value, key)),
  );
  if (!rawPresent) return { ...analysisMeta(section), players: [] };
  section.rawPresent = true;
  rawPlayers.forEach((value) => {
    if (!isRecord(value)) {
      excludeAnalysisValue(section, "timeline_player_invalid");
      return;
    }
    const hasTimelineData = timelineKeys.some((key) => hasOwn(value, key));
    const playerSlot = safePlayerSlot(value.player_slot);
    if (playerSlot === null) {
      excludeAnalysisValue(section, "player_slot_invalid");
      return;
    }
    if (!hasTimelineData) {
      excludeAnalysisValue(section, "timeline_player_unavailable");
      return;
    }
    if (!Array.isArray(value.times)) {
      excludeAnalysisValue(section, "timeline_times_unavailable");
      return;
    }
    const metricArrays = new Map<string, unknown[]>();
    for (const [rawKey] of metricKeys) {
      const metric = value[rawKey];
      if (!Array.isArray(metric)) {
        excludeAnalysisValue(section, `timeline_${rawKey}_unavailable`);
        continue;
      }
      metricArrays.set(rawKey, metric);
      if (metric.length !== value.times.length) {
        excludeAnalysisValue(section, `timeline_${rawKey}_length_mismatch`);
      }
    }
    const samples: MatchAnalysis["playerTimelines"]["players"][number]["samples"] = [];
    value.times.forEach((time, sampleIndex) => {
      const gameTimeSeconds = safeNonNegativeInteger(time);
      if (gameTimeSeconds === null) {
        excludeAnalysisValue(section, "timeline_time_invalid");
        return;
      }
      const metrics = metricKeys.map(([rawKey]) => {
        const candidate = metricArrays.get(rawKey)?.[sampleIndex];
        if (candidate === undefined || candidate === null) return null;
        const metric = safeNonNegativeInteger(candidate);
        if (metric === null) excludeAnalysisValue(section, `timeline_${rawKey}_invalid`);
        return metric;
      });
      samples.push({
        gameTimeSeconds,
        gold: metrics[0] ?? null,
        xp: metrics[1] ?? null,
        lastHits: metrics[2] ?? null,
        denies: metrics[3] ?? null,
      });
    });
    section.value.push({ playerSlot, samples });
  });
  return { ...analysisMeta(section), players: section.value };
};

const normalizeTeamAdvantages = (raw: JsonRecord): MatchAnalysis["teamAdvantages"] => {
  const section = newAnalysisSection<MatchAnalysis["teamAdvantages"]["samples"]>([]);
  const keys = ["radiant_gold_adv", "radiant_xp_adv"] as const;
  if (keys.some((key) => hasOwn(raw, key))) section.rawPresent = true;
  if (!section.rawPresent) return { ...analysisMeta(section), axis: "inferred_60s", samples: [] };

  const arrays = new Map<string, unknown[]>();
  for (const key of keys) {
    const value = raw[key];
    if (!Array.isArray(value)) {
      excludeAnalysisValue(section, `${key}_unavailable`);
      continue;
    }
    arrays.set(key, value);
  }
  const count = Math.max(...[...arrays.values()].map((value) => value.length), 0);
  if (arrays.size === 2 && arrays.get(keys[0])?.length !== arrays.get(keys[1])?.length) {
    excludeAnalysisValue(section, "advantage_length_mismatch");
  }
  for (let index = 0; index < count; index += 1) {
    const goldRaw = arrays.get("radiant_gold_adv")?.[index];
    const xpRaw = arrays.get("radiant_xp_adv")?.[index];
    const radiantGoldAdvantage = goldRaw === undefined || goldRaw === null
      ? null
      : safeSignedInteger(goldRaw);
    const radiantXpAdvantage = xpRaw === undefined || xpRaw === null
      ? null
      : safeSignedInteger(xpRaw);
    if (goldRaw !== undefined && goldRaw !== null && radiantGoldAdvantage === null) {
      excludeAnalysisValue(section, "radiant_gold_adv_invalid");
    }
    if (xpRaw !== undefined && xpRaw !== null && radiantXpAdvantage === null) {
      excludeAnalysisValue(section, "radiant_xp_adv_invalid");
    }
    section.value.push({
      gameTimeSeconds: index * 60,
      radiantGoldAdvantage,
      radiantXpAdvantage,
    });
  }
  return { ...analysisMeta(section), axis: "inferred_60s", samples: section.value };
};

const normalizeKills = (rawPlayers: unknown[]): MatchAnalysis["kills"] => {
  const section = newAnalysisSection<MatchAnalysis["kills"]["events"]>([]);
  const rawPresent = rawPlayers.some((value) => isRecord(value) && hasOwn(value, "kills_log"));
  if (!rawPresent) return { ...analysisMeta(section), events: [] };
  section.rawPresent = true;
  rawPlayers.forEach((value) => {
    if (!isRecord(value)) {
      excludeAnalysisValue(section, "kill_player_invalid");
      return;
    }
    const playerSlot = safePlayerSlot(value.player_slot);
    if (playerSlot === null) {
      excludeAnalysisValue(section, "player_slot_invalid");
      return;
    }
    if (!hasOwn(value, "kills_log")) {
      excludeAnalysisValue(section, "kills_log_unavailable");
      return;
    }
    if (!Array.isArray(value.kills_log)) {
      excludeAnalysisValue(section, "kills_log_invalid");
      return;
    }
    value.kills_log.forEach((event) => {
      if (!isRecord(event)) {
        excludeAnalysisValue(section, "kill_event_invalid");
        return;
      }
      const gameTimeSeconds = safeSignedInteger(event.time);
      const victimEntityName = safeString(event.key);
      if (gameTimeSeconds === null || victimEntityName === null) {
        excludeAnalysisValue(section, "kill_event_invalid");
        return;
      }
      section.value.push({ killerPlayerSlot: playerSlot, gameTimeSeconds, victimEntityName });
    });
  });
  section.value.sort((left, right) =>
    left.gameTimeSeconds - right.gameTimeSeconds ||
    left.killerPlayerSlot - right.killerPlayerSlot ||
    left.victimEntityName.localeCompare(right.victimEntityName),
  );
  return { ...analysisMeta(section), events: section.value };
};

const normalizeBreakdown = (
  value: unknown,
  section: AnalysisSection<unknown>,
  reason: string,
): MatchAnalysis["damage"]["players"][number]["dealtToEntities"] | null => {
  if (!isRecord(value)) {
    excludeAnalysisValue(section, reason);
    return null;
  }
  const entries: MatchAnalysis["damage"]["players"][number]["dealtToEntities"] = [];
  for (const [entityName, amountValue] of Object.entries(value)) {
    const amount = safeNonNegativeNumber(amountValue);
    if (safeString(entityName) === null || amount === null) {
      excludeAnalysisValue(section, `${reason}_entry_invalid`);
      continue;
    }
    entries.push({ entityName, amount });
  }
  return entries.sort((left, right) => left.entityName.localeCompare(right.entityName));
};

const normalizeDamage = (rawPlayers: unknown[]): MatchAnalysis["damage"] => {
  const section = newAnalysisSection<MatchAnalysis["damage"]["players"]>([]);
  const maps = [
    ["damage", "dealtToEntities"],
    ["damage_taken", "receivedFromEntities"],
    ["damage_inflictor", "dealtBySources"],
    ["damage_inflictor_received", "receivedBySources"],
  ] as const;
  const rawPresent = rawPlayers.some(
    (value) => isRecord(value) && maps.some(([rawKey]) => hasOwn(value, rawKey)),
  );
  if (!rawPresent) return { ...analysisMeta(section), players: [] };
  section.rawPresent = true;
  rawPlayers.forEach((value) => {
    if (!isRecord(value)) {
      excludeAnalysisValue(section, "damage_player_invalid");
      return;
    }
    const playerSlot = safePlayerSlot(value.player_slot);
    if (playerSlot === null) {
      excludeAnalysisValue(section, "player_slot_invalid");
      return;
    }
    if (!maps.some(([rawKey]) => hasOwn(value, rawKey))) {
      excludeAnalysisValue(section, "damage_player_unavailable");
      return;
    }
    const normalized = maps.map(([rawKey, canonicalKey]) => [
      canonicalKey,
      normalizeBreakdown(value[rawKey], section, `${rawKey}_unavailable`),
    ] as const);
    section.value.push({
      playerSlot,
      dealtToEntities: normalized[0]?.[1] ?? [],
      receivedFromEntities: normalized[1]?.[1] ?? [],
      dealtBySources: normalized[2]?.[1] ?? [],
      receivedBySources: normalized[3]?.[1] ?? [],
    });
  });
  return { ...analysisMeta(section), players: section.value };
};

const normalizeObjectives = (raw: JsonRecord): MatchAnalysis["objectives"] => {
  const section = newAnalysisSection<MatchAnalysis["objectives"]["events"]>([]);
  if (!hasOwn(raw, "objectives")) return { ...analysisMeta(section), events: [] };
  section.rawPresent = true;
  if (!Array.isArray(raw.objectives)) {
    excludeAnalysisValue(section, "objectives_invalid");
    return { ...analysisMeta(section), events: [] };
  }
  raw.objectives.forEach((value) => {
    if (!isRecord(value)) {
      excludeAnalysisValue(section, "objective_invalid");
      return;
    }
    const gameTimeSeconds = safeSignedInteger(value.time);
    const type = safeString(value.type, 128);
    if (gameTimeSeconds === null || type === null) {
      excludeAnalysisValue(section, "objective_invalid");
      return;
    }
    let team: "radiant" | "dire" | null = null;
    if (value.team !== undefined && value.team !== null) {
      if (value.team === 2 || value.team === "radiant") team = "radiant";
      else if (value.team === 3 || value.team === "dire") team = "dire";
      else excludeAnalysisValue(section, "objective_team_invalid");
    }
    const rawPlayerSlot = value.player_slot;
    const playerSlot = rawPlayerSlot === undefined || rawPlayerSlot === null
      ? null
      : safePlayerSlot(rawPlayerSlot);
    if (rawPlayerSlot !== undefined && rawPlayerSlot !== null && playerSlot === null) {
      excludeAnalysisValue(section, "objective_player_slot_invalid");
    }
    const unit = value.unit === undefined || value.unit === null ? null : safeString(value.unit);
    if (value.unit !== undefined && value.unit !== null && unit === null) {
      excludeAnalysisValue(section, "objective_unit_invalid");
    }
    const key = value.key === undefined || value.key === null ? null : optionalEntityKey(value.key);
    if (value.key !== undefined && value.key !== null && key === null) {
      excludeAnalysisValue(section, "objective_key_invalid");
    }
    section.value.push({ gameTimeSeconds, type, key, unit, playerSlot, team });
  });
  section.value.sort((left, right) =>
    left.gameTimeSeconds - right.gameTimeSeconds ||
    left.type.localeCompare(right.type) ||
    (left.key ?? "").localeCompare(right.key ?? ""),
  );
  return { ...analysisMeta(section), events: section.value };
};

const normalizeTeamfights = (
  raw: JsonRecord,
  rawPlayers: unknown[],
): MatchAnalysis["teamfights"] => {
  const section = newAnalysisSection<MatchAnalysis["teamfights"]["fights"]>([]);
  if (!hasOwn(raw, "teamfights")) return { ...analysisMeta(section), fights: [] };
  section.rawPresent = true;
  if (!Array.isArray(raw.teamfights)) {
    excludeAnalysisValue(section, "teamfights_invalid");
    return { ...analysisMeta(section), fights: [] };
  }
  raw.teamfights.forEach((value) => {
    if (!isRecord(value) || !Array.isArray(value.players)) {
      excludeAnalysisValue(section, "teamfight_invalid");
      return;
    }
    if (value.players.length !== rawPlayers.length) {
      excludeAnalysisValue(section, "teamfight_player_count_mismatch");
    }
    const startTimeSeconds = safeSignedInteger(value.start);
    const endTimeSeconds = safeSignedInteger(value.end);
    const deathCount = safeNonNegativeInteger(value.deaths);
    if (startTimeSeconds === null || endTimeSeconds === null || deathCount === null) {
      excludeAnalysisValue(section, "teamfight_invalid");
      return;
    }
    const lastDeathTimeSeconds = value.last_death === undefined || value.last_death === null
      ? null
      : safeSignedInteger(value.last_death);
    if (value.last_death !== undefined && value.last_death !== null && lastDeathTimeSeconds === null) {
      excludeAnalysisValue(section, "teamfight_last_death_invalid");
    }
    const players: MatchAnalysis["teamfights"]["fights"][number]["players"] = [];
    value.players.forEach((playerValue, playerIndex) => {
      if (!isRecord(playerValue)) {
        excludeAnalysisValue(section, "teamfight_player_invalid");
        return;
      }
      const deaths = safeNonNegativeInteger(playerValue.deaths);
      const buybacks = safeNonNegativeInteger(playerValue.buybacks);
      const damage = safeNonNegativeNumber(playerValue.damage);
      const healing = safeNonNegativeNumber(playerValue.healing);
      const goldDelta = safeFiniteNumber(playerValue.gold_delta);
      const xpDelta = safeFiniteNumber(playerValue.xp_delta);
      if (
        deaths === null || buybacks === null || damage === null || healing === null ||
        goldDelta === null || xpDelta === null
      ) {
        excludeAnalysisValue(section, "teamfight_player_invalid");
        return;
      }
      const rawSlot = isRecord(rawPlayers[playerIndex]) ? rawPlayers[playerIndex].player_slot : undefined;
      const playerSlot = rawSlot === undefined ? null : safePlayerSlot(rawSlot);
      if (rawSlot !== undefined && playerSlot === null) {
        excludeAnalysisValue(section, "teamfight_player_slot_invalid");
      }
      const xpStart = playerValue.xp_start === undefined || playerValue.xp_start === null
        ? null
        : safeNonNegativeNumber(playerValue.xp_start);
      const xpEnd = playerValue.xp_end === undefined || playerValue.xp_end === null
        ? null
        : safeNonNegativeNumber(playerValue.xp_end);
      if (xpStart === null && playerValue.xp_start !== undefined && playerValue.xp_start !== null) {
        excludeAnalysisValue(section, "teamfight_xp_start_invalid");
      }
      if (xpEnd === null && playerValue.xp_end !== undefined && playerValue.xp_end !== null) {
        excludeAnalysisValue(section, "teamfight_xp_end_invalid");
      }
      players.push({
        playerIndex,
        playerSlot,
        deaths,
        buybacks,
        damage,
        healing,
        goldDelta,
        xpDelta,
        xpStart,
        xpEnd,
      });
    });
    section.value.push({
      startTimeSeconds,
      endTimeSeconds,
      lastDeathTimeSeconds,
      deathCount,
      players,
    });
  });
  section.value.sort((left, right) => left.startTimeSeconds - right.startTimeSeconds);
  return { ...analysisMeta(section), fights: section.value };
};

const normalizeMatchAnalysis = (
  raw: JsonRecord,
  rawPlayers: unknown[],
  fetchedAt: Date,
): MatchAnalysis => ({
  ...emptyMatchAnalysis(fetchedAt.toISOString()),
  source: "opendota",
  providerRevision: MATCH_ANALYSIS_PROVIDER_REVISION,
  updatedAt: fetchedAt.toISOString(),
  playerTimelines: normalizePlayerTimelines(rawPlayers),
  teamAdvantages: normalizeTeamAdvantages(raw),
  kills: normalizeKills(rawPlayers),
  damage: normalizeDamage(rawPlayers),
  objectives: normalizeObjectives(raw),
  teamfights: normalizeTeamfights(raw, rawPlayers),
});

function normalizePlayer(
  rawValue: unknown,
  radiantWin: boolean,
  knownAccountId: string | null = null,
): CanonicalMatchPlayer {
  const raw = readRecord(rawValue, "player");
  const playerSlot = readInteger(raw.player_slot, "player.player_slot");
  if (playerSlot > 255) payloadError("player.player_slot must be <= 255");

  const side = playerSlot < 128 ? "radiant" : "dire";
  const upstreamAccountId = readOptionalAccountId(raw.account_id);
  if (
    upstreamAccountId !== null &&
    knownAccountId !== null &&
    upstreamAccountId !== knownAccountId
  ) {
    payloadError("player.account_id does not match the requested account");
  }
  const accountId = upstreamAccountId ?? knownAccountId;
  const finalItemIds = [raw.item_0, raw.item_1, raw.item_2, raw.item_3, raw.item_4, raw.item_5]
    .map(readOptionalId)
    .filter((itemId): itemId is string => itemId !== null && itemId !== "0");
  const backpackItemIds = [raw.backpack_0, raw.backpack_1, raw.backpack_2]
    .map(readOptionalId)
    .filter((itemId): itemId is string => itemId !== null && itemId !== "0");
  const neutralItemId = readOptionalId(raw.item_neutral);
  const neutralItemEnhancementId = readOptionalId(raw.item_neutral2);

  const abilityBuild = Array.isArray(raw.ability_upgrades_arr)
    ? raw.ability_upgrades_arr.map((abilityId, index) => ({
        abilityId: readId(abilityId, `player.ability_upgrades_arr[${index}]`),
        sequence: index + 1,
        heroLevel: null,
        gameTimeSeconds: null,
      }))
    : [];
  const abilityBuildStatus = Array.isArray(raw.ability_upgrades_arr)
    ? "ordered"
    : "unavailable";

  const itemTimeline = Array.isArray(raw.purchase_log)
    ? raw.purchase_log.map((purchaseValue, index) => {
        const purchase = readRecord(purchaseValue, `player.purchase_log[${index}]`);
        return {
          itemKey: readString(purchase.key, `player.purchase_log[${index}].key`),
          action: "purchase" as const,
          gameTimeSeconds: readSignedInteger(
            purchase.time,
            `player.purchase_log[${index}].time`,
          ),
          charges: null,
        };
      })
    : [];
  const itemTimelineStatus = Array.isArray(raw.purchase_log) ? "partial" : "unavailable";

  return {
    accountId,
    eligibleForPersonalAggregation: accountId !== null,
    playerSlot,
    heroId: readId(raw.hero_id, "player.hero_id"),
    side,
    isWin: side === "radiant" ? radiantWin : !radiantWin,
    kills: readInteger(raw.kills, "player.kills"),
    deaths: readInteger(raw.deaths, "player.deaths"),
    assists: readInteger(raw.assists, "player.assists"),
    gpm: readOptionalInteger(raw.gold_per_min),
    xpm: readOptionalInteger(raw.xp_per_min),
    lastHits: readOptionalInteger(raw.last_hits),
    denies: readOptionalInteger(raw.denies),
    heroDamage: readOptionalInteger(raw.hero_damage),
    heroHealing: readOptionalInteger(raw.hero_healing),
    towerDamage: readOptionalInteger(raw.tower_damage),
    level: readOptionalInteger(raw.level),
    netWorth: readOptionalInteger(raw.net_worth),
    finalItemIds,
    backpackItemIds,
    neutralItemId: neutralItemId === "0" ? null : neutralItemId,
    neutralItemEnhancementId:
      neutralItemEnhancementId === "0" ? null : neutralItemEnhancementId,
    abilityBuild,
    abilityBuildStatus,
    itemTimeline,
    itemTimelineStatus,
  };
}

function normalizePlayerMatch(rawValue: unknown, accountId: string): CanonicalPlayerMatch {
  const raw = readRecord(rawValue, "match");
  const radiantWin = readBoolean(raw.radiant_win, "match.radiant_win");
  return {
    id: readId(raw.match_id, "match.match_id"),
    startTime: timestampFromSeconds(raw.start_time, "match.start_time"),
    durationSeconds: readInteger(raw.duration, "match.duration", 1),
    patchId: readOptionalId(raw.patch),
    gameMode: readId(raw.game_mode, "match.game_mode"),
    region: readOptionalId(raw.region),
    lobbyType: readOptionalId(raw.lobby_type),
    radiantWin,
    player: normalizePlayer(raw, radiantWin, accountId),
  };
}

function compareMatchesNewestFirst(a: CanonicalPlayerMatch, b: CanonicalPlayerMatch): number {
  const startDifference = Date.parse(b.startTime) - Date.parse(a.startTime);
  if (startDifference !== 0) return startDifference;
  const aId = BigInt(a.id);
  const bId = BigInt(b.id);
  return aId === bId ? 0 : aId > bId ? -1 : 1;
}

function parseRetryAfter(value: string | null, now: Date): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isInteger(seconds) && seconds > 0) return seconds;
  const retryAt = Date.parse(value);
  if (Number.isNaN(retryAt)) return null;
  return Math.max(1, Math.ceil((retryAt - now.getTime()) / 1_000));
}

function isRetryableRequestError(error: OpenDotaProviderError): boolean {
  return (
    error.reason === "network" ||
    error.reason === "timeout" ||
    error.reason === "rate_limited" ||
    error.reason === "upstream_5xx"
  );
}

function retryDelayMs(error: OpenDotaProviderError, failedAttempt: number): number {
  const backoffMs = Math.min(
    DEFAULT_RETRY_DELAY_MS * 2 ** failedAttempt,
    MAX_RETRY_DELAY_MS,
  );
  const requestedDelayMs = error.retryAfterSeconds === null
    ? backoffMs
    : error.retryAfterSeconds * 1_000;
  return Math.min(requestedDelayMs, MAX_RETRY_DELAY_MS);
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function formatAttributeValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(String).join(" / ");
  return "";
}

export class OpenDotaProvider {
  private readonly baseUrl: URL;
  private readonly apiKey: string | null;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly clock: () => Date;
  private readonly sleep: Sleep;

  constructor(config: OpenDotaProviderConfig = {}) {
    const baseUrl = new URL(config.baseUrl ?? DEFAULT_BASE_URL);
    if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";
    this.baseUrl = baseUrl;
    this.apiKey = config.apiKey?.trim() || null;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new TypeError("OpenDota timeoutMs must be a positive integer");
    }
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.clock = config.clock ?? (() => new Date());
    this.sleep = config.sleep ?? defaultSleep;
  }

  async getPlayerProfile(accountId: string): Promise<CanonicalPlayerProfile> {
    const validatedAccountId = this.validateId(accountId);
    const { payload, fetchedAt } = await this.requestJson(`players/${validatedAccountId}`);
    const root = readRecord(payload, "profile response");
    if (root.profile === null || root.profile === undefined) {
      throw new OpenDotaProviderError(
        "PROFILE_PRIVATE",
        "profile_unavailable",
        "OpenDota did not expose a public profile",
        false,
        403,
      );
    }

    const profile = readRecord(root.profile, "profile");
    const upstreamAccountId = readOptionalId(profile.account_id);
    if (upstreamAccountId !== null && upstreamAccountId !== validatedAccountId) {
      throw new OpenDotaProviderError(
        "SOURCE_UNAVAILABLE",
        "invalid_response",
        "OpenDota returned a profile for a different account",
        false,
      );
    }

    const steamId64 = readNullableString(profile.steamid);
    const personaName = readNullableString(profile.personaname);
    const avatarUrl =
      readNullableString(profile.avatarfull) ??
      readNullableString(profile.avatarmedium) ??
      readNullableString(profile.avatar);
    const complete = steamId64 !== null && personaName !== null && avatarUrl !== null;

    return {
      accountId: validatedAccountId,
      steamId64,
      personaName,
      avatarUrl,
      status: complete ? "public_complete" : "public_partial",
      source: sourceMetadata(fetchedAt),
    };
  }

  async getRecentMatches(
    accountId: string,
    limit = DEFAULT_RECENT_MATCH_LIMIT,
  ): Promise<CanonicalRecentMatches> {
    const page = await this.getPlayerMatchesPage(accountId, limit, 0);
    if (page.rawCount > 0 && page.matches.length === 0) {
      const qualityContext: CanonicalRecentMatchQualityContext = {
        eligibleCount: page.eligibleCount,
        excludedCount: page.excludedCount,
        exclusionReasons: page.exclusionReasons,
        candidateLedger: page.candidateLedger,
      };
      throw new OpenDotaProviderError(
        "PARSE_PENDING",
        "player_data_unavailable",
        "OpenDota returned recent matches, but none contain enough data to import",
        true,
        null,
        null,
        qualityContext,
      );
    }
    const { offset: _offset, rawCount: _rawCount, reachedEnd: _reachedEnd, ...recent } = page;
    return recent;
  }

  async getPlayerMatchesPage(
    accountId: string,
    limit = DEFAULT_RECENT_MATCH_LIMIT,
    offset = 0,
  ): Promise<CanonicalPlayerMatchesPage> {
    const validatedAccountId = this.validateId(accountId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError("Player match page limit must be an integer from 1 to 100");
    }
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new RangeError("Player match page offset must be a non-negative safe integer");
    }

    const { payload, fetchedAt } = await this.requestJson(
      `players/${validatedAccountId}/matches?limit=${limit}&offset=${offset}`,
    );
    const rawMatches = readArray(payload, "recent matches");
    if (rawMatches.length === 0 && offset === 0) {
      throw new OpenDotaProviderError(
        "HISTORY_PRIVATE",
        "history_unavailable",
        "OpenDota cannot distinguish an empty history from a private history",
        false,
        403,
      );
    }

    const matches: CanonicalPlayerMatch[] = [];
    let excludedCount = 0;
    const exclusionReasons = new Set<string>();
    const candidateLedger: CanonicalRecentMatchCandidateEntry[] = [];
    const recordExclusion = (providerIndex: number, reasons: string[]) => {
      excludedCount += 1;
      reasons.forEach((reason) => exclusionReasons.add(reason));
      candidateLedger.push({
        providerIndex,
        status: "excluded",
        exclusionReasons: [...reasons].sort(),
      });
    };
    for (const [providerIndex, rawMatch] of rawMatches.entries()) {
      try {
        const raw = readRecord(rawMatch, "match");
        const unavailableReasons = unavailableFieldReasons(raw, REQUIRED_RECENT_MATCH_FIELDS);
        if (unavailableReasons.length > 0) {
          recordExclusion(providerIndex, unavailableReasons);
          continue;
        }
        const match = normalizePlayerMatch(raw, validatedAccountId);
        matches.push(match);
        candidateLedger.push({ providerIndex, status: "included", matchId: match.id });
      } catch (error) {
        if (
          error instanceof OpenDotaProviderError &&
          error.code === "SOURCE_UNAVAILABLE" &&
          error.reason === "invalid_response"
        ) {
          recordExclusion(providerIndex, ["candidate_invalid"]);
          continue;
        }
        throw error;
      }
    }
    const qualityContext: CanonicalRecentMatchQualityContext = {
      eligibleCount: rawMatches.length,
      excludedCount,
      exclusionReasons: [...exclusionReasons].sort(),
      candidateLedger,
    };
    return {
      accountId: validatedAccountId,
      requestedLimit: limit,
      offset,
      rawCount: rawMatches.length,
      reachedEnd: rawMatches.length < limit,
      ...qualityContext,
      quality: excludedCount === 0 ? "complete" : "partial",
      matches: matches.sort(compareMatchesNewestFirst),
      source: sourceMetadata(fetchedAt),
    };
  }

  async getMatchDetail(matchId: string): Promise<CanonicalMatchDetail> {
    const { payload, fetchedAt } = await this.requestJson(`matches/${this.validateId(matchId)}`);
    const raw = readRecord(payload, "match detail");
    const unavailableMatchFields = unavailableFieldReasons(raw, REQUIRED_MATCH_DETAIL_FIELDS);
    if (unavailableMatchFields.length > 0) {
      throw new OpenDotaProviderError(
        "PARSE_PENDING",
        "match_data_unavailable",
        `OpenDota match data is not yet complete: ${unavailableMatchFields.join(", ")}`,
        true,
      );
    }
    const radiantWin = readBoolean(raw.radiant_win, "match.radiant_win");
    const players = readArray(raw.players, "match.players");
    if (players.length < 1 || players.length > 10) {
      throw new OpenDotaProviderError(
        "PARSE_PENDING",
        "player_data_unavailable",
        "OpenDota match data does not yet contain a usable player list",
        true,
      );
    }

    const normalizedPlayers: CanonicalMatchPlayer[] = [];
    let excludedPlayerCount = 0;
    const exclusionReasons = new Set<string>();
    for (const rawPlayer of players) {
      const player = readRecord(rawPlayer, "match.player");
      const unavailableReasons = unavailableFieldReasons(
        player,
        REQUIRED_MATCH_PLAYER_FIELDS,
      );
      if (unavailableReasons.length > 0) {
        excludedPlayerCount += 1;
        unavailableReasons.forEach((reason) => exclusionReasons.add(reason));
        continue;
      }
      normalizedPlayers.push(normalizePlayer(player, radiantWin));
    }
    if (normalizedPlayers.length === 0) {
      throw new OpenDotaProviderError(
        "PARSE_PENDING",
        "player_data_unavailable",
        "OpenDota match data does not yet contain a usable player",
        true,
      );
    }

    return {
      id: readId(raw.match_id, "match.match_id"),
      startTime: timestampFromSeconds(raw.start_time, "match.start_time"),
      durationSeconds: readInteger(raw.duration, "match.duration", 1),
      patchId: readOptionalId(raw.patch),
      gameMode: readId(raw.game_mode, "match.game_mode"),
      region: readOptionalId(raw.region),
      lobbyType: readOptionalId(raw.lobby_type),
      cluster: readOptionalId(raw.cluster),
      radiantScore: readOptionalInteger(raw.radiant_score),
      direScore: readOptionalInteger(raw.dire_score),
      radiantWin,
      eligiblePlayerCount: normalizedPlayers.length,
      excludedPlayerCount,
      exclusionReasons: [...exclusionReasons].sort(),
      quality: excludedPlayerCount === 0 ? "complete" : "partial",
      players: normalizedPlayers,
      parseStatus: raw.version === null || raw.version === undefined ? "unparsed" : "parsed",
      analysis: normalizeMatchAnalysis(raw, players, fetchedAt),
      source: sourceMetadata(fetchedAt),
    };
  }

  async getHeroConstants(): Promise<CanonicalConstantsSnapshot<CanonicalHeroConstant>> {
    const { payload, fetchedAt } = await this.requestJson("constants/heroes");
    const root = readRecord(payload, "hero constants");
    const items = Object.values(root)
      .map((value) => {
        const hero = readRecord(value, "hero");
        const roles = readArray(hero.roles, "hero.roles").map((role) => readString(role, "hero.role"));
        return {
          id: readId(hero.id, "hero.id"),
          name: readString(hero.name, "hero.name").replace(/^npc_dota_hero_/, ""),
          localizedName: readString(hero.localized_name, "hero.localized_name"),
          primaryAttribute: normalizePrimaryAttribute(hero.primary_attr),
          attackType: normalizeAttackType(hero.attack_type),
          roles,
          officialVersion: null,
        } satisfies CanonicalHeroConstant;
      })
      .sort((a, b) => Number(a.id) - Number(b.id));

    return { items, source: sourceMetadata(fetchedAt) };
  }

  async getItemConstants(): Promise<CanonicalConstantsSnapshot<CanonicalItemConstant>> {
    const { payload, fetchedAt } = await this.requestJson("constants/items");
    const root = readRecord(payload, "item constants");
    const items = Object.entries(root)
      .map(([name, value]): CanonicalItemConstant | null => {
        const item = readRecord(value, `item.${name}`);
        const id = readOptionalId(item.id);
        if (id === null) return null;
        const attributes = Array.isArray(item.attrib)
          ? item.attrib.map((attributeValue) => {
              const attribute = readRecord(attributeValue, `item.${name}.attrib`);
              return {
                label:
                  readNullableString(attribute.header) ??
                  readNullableString(attribute.key) ??
                  "",
                value: formatAttributeValue(attribute.value),
              };
            })
          : [];
        const componentNames = Array.isArray(item.components)
          ? item.components.filter((component): component is string => typeof component === "string")
          : [];

        return {
          id,
          name,
          localizedName: readNullableString(item.dname) ?? name,
          cost: readOptionalInteger(item.cost),
          category: readNullableString(item.qual),
          description: readNullableString(item.desc) ?? "",
          attributes,
          componentNames,
          kind: "item",
          availabilityStatus: "unverified",
          officialVersion: null,
        } satisfies CanonicalItemConstant;
      })
      .filter((item): item is CanonicalItemConstant => item !== null)
      .sort((a, b) => Number(a.id) - Number(b.id));

    return { items, source: sourceMetadata(fetchedAt) };
  }

  async getHeroAbilityConstants(): Promise<CanonicalHeroAbilityConstants> {
    const [abilityIdsResponse, abilitiesResponse, heroAbilitiesResponse] = await Promise.all([
      this.requestJson("constants/ability_ids"),
      this.requestJson("constants/abilities"),
      this.requestJson("constants/hero_abilities"),
    ]);
    const abilityIds = readNonEmptyRecord(abilityIdsResponse.payload, "ability ID constants");
    const abilities = readNonEmptyRecord(abilitiesResponse.payload, "ability constants");
    const heroAbilities = readNonEmptyRecord(
      heroAbilitiesResponse.payload,
      "hero ability constants",
    );
    const idByName = new Map<string, string>();

    for (const [rawId, rawName] of Object.entries(abilityIds)) {
      if (!/^\d+$/.test(rawId)) continue;
      const id = readId(rawId, "ability ID key");
      const name = readString(rawName, `ability ID ${id}`);
      if (idByName.has(name)) payloadError(`ability name ${name} maps to multiple IDs`);
      idByName.set(name, id);
    }
    if (idByName.size === 0) payloadError("ability ID constants contain no numeric IDs");

    const heroes = Object.fromEntries(Object.entries(heroAbilities).map(([heroName, rawHero]) => {
      const hero = readRecord(rawHero, `hero abilities.${heroName}`);
      const ordinaryNames = readArray(hero.abilities, `hero abilities.${heroName}.abilities`)
        .flatMap((name) => Array.isArray(name) ? name : [name])
        .map((name) => readString(name, `hero abilities.${heroName}.ability`));
      const rawTalents = readArray(hero.talents, `hero abilities.${heroName}.talents`)
        .map((rawTalent, index) => {
          const talent = readRecord(rawTalent, `hero abilities.${heroName}.talents[${index}]`);
          return {
            name: readString(talent.name, `hero abilities.${heroName}.talents[${index}].name`),
            level: readInteger(talent.level, `hero abilities.${heroName}.talents[${index}].level`, 1),
            index,
          };
        })
        .sort((left, right) => left.level - right.level || left.index - right.index);
      const excludedAbilityNames: string[] = [];
      const normalizedAbilities: CanonicalHeroAbilityConstant[] = [];
      const orderedAbilities = [
        ...ordinaryNames.map((name, slot) => ({ name, slot, type: "ability" as const })),
        ...rawTalents.map(({ name }, index) => ({
          name,
          slot: ordinaryNames.length + index,
          type: "talent" as const,
        })),
      ];

      for (const candidate of orderedAbilities) {
        const id = idByName.get(candidate.name);
        if (id === undefined) {
          excludedAbilityNames.push(candidate.name);
          continue;
        }
        const rawAbility = abilities[candidate.name];
        const ability = isRecord(rawAbility) ? rawAbility : null;
        if (ability === null) excludedAbilityNames.push(candidate.name);
        const type = candidate.type === "talent"
          ? "talent"
          : ability?.is_innate === true
            ? "innate"
            : candidate.slot === 5
              ? "ultimate"
              : "basic";
        normalizedAbilities.push({
          id,
          name: candidate.name,
          localizedName: readNullableString(ability?.dname) ?? candidate.name,
          description: readNullableString(ability?.desc) ?? "",
          attributes: [],
          slot: candidate.slot,
          type,
        });
      }

      const facets = hero.facets === undefined
        ? []
        : readArray(hero.facets, `hero abilities.${heroName}.facets`).map((rawFacet, index) => {
            const facet = readRecord(rawFacet, `hero abilities.${heroName}.facets[${index}]`);
            return {
              name:
                readNullableString(facet.title) ??
                readString(facet.name, `hero abilities.${heroName}.facets[${index}].name`),
              description: readNullableString(facet.description) ?? "",
            };
          });

      return [heroName, {
        heroName,
        abilities: normalizedAbilities,
        facetsStatus: "unavailable" as const,
        facets,
        excludedAbilityNames,
      }];
    }));
    const fetchedAt = [
      abilityIdsResponse.fetchedAt,
      abilitiesResponse.fetchedAt,
      heroAbilitiesResponse.fetchedAt,
    ].reduce((latest, current) => current > latest ? current : latest);

    return { heroes, source: sourceMetadata(fetchedAt) };
  }

  async getPatchConstants(): Promise<CanonicalConstantsSnapshot<CanonicalPatchSummary>> {
    const { payload, fetchedAt } = await this.requestJson("constants/patch");
    const rawPatches = readArray(payload, "patch constants");
    if (rawPatches.length === 0) payloadError("patch constants must not be empty");

    const items = rawPatches
      .map((value, index) => {
        const patch = readRecord(value, `patch[${index}]`);
        return {
          id: readId(patch.id, `patch[${index}].id`),
          name: readString(patch.name, `patch[${index}].name`),
          releasedAt: timestampFromIsoString(patch.date, `patch[${index}].date`),
        } satisfies CanonicalPatchSummary;
      })
      .sort((a, b) => {
        const releasedAtDifference = Date.parse(a.releasedAt) - Date.parse(b.releasedAt);
        if (releasedAtDifference !== 0) return releasedAtDifference;
        const aId = BigInt(a.id);
        const bId = BigInt(b.id);
        return aId === bId ? 0 : aId < bId ? -1 : 1;
      });

    return { items, source: sourceMetadata(fetchedAt) };
  }

  private validateId(value: string): string {
    if (!/^\d+$/.test(value) || BigInt(value) <= 0n) {
      throw new TypeError("OpenDota IDs must be positive decimal strings");
    }
    return BigInt(value).toString();
  }

  private async requestJson(path: string): Promise<{ payload: unknown; fetchedAt: Date }> {
    const url = new URL(path, this.baseUrl);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.apiKey !== null) headers.Authorization = `Bearer ${this.apiKey}`;

    for (let attempt = 0; attempt < DEFAULT_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.requestJsonAttempt(url, headers);
      } catch (error) {
        if (
          !(error instanceof OpenDotaProviderError) ||
          !isRetryableRequestError(error) ||
          attempt === DEFAULT_MAX_ATTEMPTS - 1
        ) {
          throw error;
        }
        await this.sleep(retryDelayMs(error, attempt));
      }
    }

    throw new Error("OpenDota retry attempts were unexpectedly exhausted");
  }

  private async requestJsonAttempt(
    url: URL,
    headers: Record<string, string>,
  ): Promise<{ payload: unknown; fetchedAt: Date }> {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers,
        redirect: "error",
        signal: controller.signal,
      });
      const now = this.clock();
      if (response.status === 404) {
        throw new OpenDotaProviderError(
          "NOT_FOUND",
          "not_found",
          "OpenDota resource was not found",
          false,
          404,
        );
      }
      if (response.status === 429) {
        throw new OpenDotaProviderError(
          "SOURCE_RATE_LIMITED",
          "rate_limited",
          "OpenDota rate limit was reached",
          true,
          429,
          parseRetryAfter(response.headers.get("retry-after"), now),
        );
      }
      if (response.status >= 500) {
        throw new OpenDotaProviderError(
          "SOURCE_UNAVAILABLE",
          "upstream_5xx",
          `OpenDota returned HTTP ${response.status}`,
          true,
          response.status,
        );
      }
      if (!response.ok) {
        throw new OpenDotaProviderError(
          "SOURCE_UNAVAILABLE",
          "upstream_http",
          `OpenDota returned HTTP ${response.status}`,
          false,
          response.status,
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payloadError("OpenDota response is not valid JSON");
      }
      return { payload, fetchedAt: now };
    } catch (error) {
      if (error instanceof OpenDotaProviderError) throw error;
      if (timedOut) {
        throw new OpenDotaProviderError(
          "SOURCE_UNAVAILABLE",
          "timeout",
          `OpenDota request timed out after ${this.timeoutMs}ms`,
          true,
        );
      }
      throw new OpenDotaProviderError(
        "SOURCE_UNAVAILABLE",
        "network",
        "OpenDota network request failed",
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
