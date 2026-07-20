import {
  matchAnalysisSchema,
  type MatchAnalysis,
} from "@dodo/contracts";

type SectionStatus = "unavailable" | "partial" | "complete";
type SectionBase = {
  status: SectionStatus;
  excludedCount: number;
  exclusionReasons: string[];
};

const statusRank: Record<SectionStatus, number> = {
  unavailable: 0,
  partial: 1,
  complete: 2,
};

const mergeReasons = (left: string[], right: string[]): string[] =>
  [...new Set([...left, ...right])].sort();

const mergeBase = <T extends SectionBase>(existing: T, incoming: T): T => ({
  ...incoming,
  excludedCount: Math.max(existing.excludedCount, incoming.excludedCount),
  exclusionReasons: mergeReasons(existing.exclusionReasons, incoming.exclusionReasons),
});

const chooseSection = <T extends SectionBase>(
  existing: T,
  incoming: T,
  mergePartial: (left: T, right: T) => T,
): T => {
  if (statusRank[incoming.status] < statusRank[existing.status]) return existing;
  if (incoming.status === "complete") return incoming;
  if (existing.status === "partial" && incoming.status === "partial") {
    return mergePartial(existing, incoming);
  }
  return incoming;
};

const mergeByKey = <T>(
  left: T[],
  right: T[],
  key: (value: T) => string,
  order: (a: T, b: T) => number,
): T[] => {
  const values = new Map(left.map((value) => [key(value), value]));
  for (const value of right) values.set(key(value), value);
  return [...values.values()].sort(order);
};

const numeric = (left: number, right: number): number => left - right;
const text = (left: string, right: string): number => left.localeCompare(right);

const mergePlayerTimelines = (
  existing: MatchAnalysis["playerTimelines"],
  incoming: MatchAnalysis["playerTimelines"],
): MatchAnalysis["playerTimelines"] => {
  const players = new Map(existing.players.map((player) => [player.playerSlot, player]));
  for (const player of incoming.players) {
    const previous = players.get(player.playerSlot);
    players.set(player.playerSlot, previous ? {
      playerSlot: player.playerSlot,
      samples: mergeByKey(
        previous.samples,
        player.samples,
        (sample) => String(sample.gameTimeSeconds),
        (left, right) => numeric(left.gameTimeSeconds, right.gameTimeSeconds),
      ),
    } : player);
  }
  return {
    ...mergeBase(existing, incoming),
    players: [...players.values()].sort((left, right) => numeric(left.playerSlot, right.playerSlot)),
  };
};

const mergeTeamAdvantages = (
  existing: MatchAnalysis["teamAdvantages"],
  incoming: MatchAnalysis["teamAdvantages"],
): MatchAnalysis["teamAdvantages"] => ({
  ...mergeBase(existing, incoming),
  samples: mergeByKey(
    existing.samples,
    incoming.samples,
    (sample) => String(sample.gameTimeSeconds),
    (left, right) => numeric(left.gameTimeSeconds, right.gameTimeSeconds),
  ),
});

const mergeKills = (
  existing: MatchAnalysis["kills"],
  incoming: MatchAnalysis["kills"],
): MatchAnalysis["kills"] => ({
  ...mergeBase(existing, incoming),
  events: mergeByKey(
    existing.events,
    incoming.events,
    (event) => `${event.gameTimeSeconds}:${event.killerPlayerSlot}:${event.victimEntityName}`,
    (left, right) => numeric(left.gameTimeSeconds, right.gameTimeSeconds) ||
      numeric(left.killerPlayerSlot, right.killerPlayerSlot) ||
      text(left.victimEntityName, right.victimEntityName),
  ),
});

const mergeDamageEntries = <T extends { entityName: string }>(left: T[], right: T[]): T[] =>
  mergeByKey(left, right, (entry) => entry.entityName, (a, b) => text(a.entityName, b.entityName));

const mergeDamage = (
  existing: MatchAnalysis["damage"],
  incoming: MatchAnalysis["damage"],
): MatchAnalysis["damage"] => {
  const players = new Map(existing.players.map((player) => [player.playerSlot, player]));
  for (const player of incoming.players) {
    const previous = players.get(player.playerSlot);
    players.set(player.playerSlot, previous ? {
      playerSlot: player.playerSlot,
      dealtToEntities: mergeDamageEntries(previous.dealtToEntities, player.dealtToEntities),
      receivedFromEntities: mergeDamageEntries(previous.receivedFromEntities, player.receivedFromEntities),
      dealtBySources: mergeDamageEntries(previous.dealtBySources, player.dealtBySources),
      receivedBySources: mergeDamageEntries(previous.receivedBySources, player.receivedBySources),
    } : player);
  }
  return {
    ...mergeBase(existing, incoming),
    players: [...players.values()].sort((left, right) => numeric(left.playerSlot, right.playerSlot)),
  };
};

const mergeObjectives = (
  existing: MatchAnalysis["objectives"],
  incoming: MatchAnalysis["objectives"],
): MatchAnalysis["objectives"] => ({
  ...mergeBase(existing, incoming),
  events: mergeByKey(
    existing.events,
    incoming.events,
    (event) => [event.gameTimeSeconds, event.type, event.key, event.unit, event.playerSlot, event.team].join(":"),
    (left, right) => numeric(left.gameTimeSeconds, right.gameTimeSeconds) ||
      text(left.type, right.type) || text(left.key ?? "", right.key ?? ""),
  ),
});

const mergeTeamfights = (
  existing: MatchAnalysis["teamfights"],
  incoming: MatchAnalysis["teamfights"],
): MatchAnalysis["teamfights"] => ({
  ...mergeBase(existing, incoming),
  fights: mergeByKey(
    existing.fights,
    incoming.fights,
    (fight) => `${fight.startTimeSeconds}:${fight.endTimeSeconds}:${fight.lastDeathTimeSeconds ?? ""}`,
    (left, right) => numeric(left.startTimeSeconds, right.startTimeSeconds) ||
      numeric(left.endTimeSeconds, right.endTimeSeconds),
  ),
});

export const mergeMatchAnalyses = (
  existing: MatchAnalysis | undefined,
  incoming: MatchAnalysis,
): MatchAnalysis => {
  const parsedIncoming = matchAnalysisSchema.parse(incoming);
  if (!existing) return parsedIncoming;
  const parsedExisting = matchAnalysisSchema.parse(existing);
  return matchAnalysisSchema.parse({
    ...parsedIncoming,
    updatedAt:
      parsedExisting.updatedAt && parsedIncoming.updatedAt
        ? parsedExisting.updatedAt > parsedIncoming.updatedAt
          ? parsedExisting.updatedAt
          : parsedIncoming.updatedAt
        : parsedIncoming.updatedAt ?? parsedExisting.updatedAt,
    playerTimelines: chooseSection(parsedExisting.playerTimelines, parsedIncoming.playerTimelines, mergePlayerTimelines),
    teamAdvantages: chooseSection(parsedExisting.teamAdvantages, parsedIncoming.teamAdvantages, mergeTeamAdvantages),
    kills: chooseSection(parsedExisting.kills, parsedIncoming.kills, mergeKills),
    damage: chooseSection(parsedExisting.damage, parsedIncoming.damage, mergeDamage),
    objectives: chooseSection(parsedExisting.objectives, parsedIncoming.objectives, mergeObjectives),
    teamfights: chooseSection(parsedExisting.teamfights, parsedIncoming.teamfights, mergeTeamfights),
  });
};

export const matchAnalysisQuality = (
  analysis: MatchAnalysis,
): "complete" | "partial" => [
  analysis.playerTimelines.status,
  analysis.teamAdvantages.status,
  analysis.kills.status,
  analysis.damage.status,
  analysis.objectives.status,
  analysis.teamfights.status,
].every((status) => status === "complete") ? "complete" : "partial";
