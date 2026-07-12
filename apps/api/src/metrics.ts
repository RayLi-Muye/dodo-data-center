import type {
  HeroDetail,
  HeroSummary,
  MatchDetail,
  MatchPlayer,
  MatchSummary,
  MetricWindow,
  PlayerHeroStats,
  PlayerOverview,
  PlayerProfile,
} from "./route-types.js";

import type { StoredMatch } from "@dodo/db";

const WINDOW_SIZE: Record<Exclude<MetricWindow, "all_imported">, number> = {
  last_20: 20,
  last_50: 50,
  last_100: 100,
};

export const toHeroSummary = (hero: HeroDetail): HeroSummary => ({
  id: hero.id,
  name: hero.name,
  localizedName: hero.localizedName,
  primaryAttribute: hero.primaryAttribute,
  attackType: hero.attackType,
  roles: hero.roles,
  officialVersion: hero.officialVersion,
});

const targetPlayer = (match: MatchDetail, accountId: string): MatchPlayer => {
  const player = match.players.find((candidate) => candidate.accountId === accountId);
  if (!player) throw new Error(`Repository invariant failed for match ${match.id}`);
  return player;
};

export const toMatchSummary = (match: MatchDetail, accountId: string): MatchSummary => ({
  id: match.id,
  startTime: match.startTime,
  durationSeconds: match.durationSeconds,
  officialVersion: match.officialVersion,
  openDotaPatchId: match.openDotaPatchId,
  officialVersionSource: match.officialVersionSource,
  gameMode: match.gameMode,
  lobbyType: match.lobbyType,
  region: match.region,
  radiantWin: match.radiantWin,
  player: targetPlayer(match, accountId),
});

export const selectWindow = (matches: StoredMatch[], window: MetricWindow): StoredMatch[] => {
  if (window === "all_imported") return matches;
  return matches.slice(0, WINDOW_SIZE[window]);
};

const average = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

export const calculateHeroStats = (
  accountId: string,
  matches: StoredMatch[],
  hero: HeroDetail,
  window: MetricWindow,
  totalWindowGames: number,
): PlayerHeroStats => {
  const players = matches
    .map((match) => ({ match, player: targetPlayer(match.detail, accountId) }))
    .filter(({ player }) => player.heroId === hero.id);
  const games = players.length;
  const wins = players.filter(({ player }) => player.isWin).length;
  const kills = players.map(({ player }) => player.kills);
  const deaths = players.map(({ player }) => player.deaths);
  const assists = players.map(({ player }) => player.assists);
  const gpm = players.flatMap(({ player }) => (player.gpm === null ? [] : [player.gpm]));
  const xpm = players.flatMap(({ player }) => (player.xpm === null ? [] : [player.xpm]));
  const lastHits = players.flatMap(({ player }) =>
    player.lastHits === null ? [] : [player.lastHits],
  );
  const heroDamage = players.flatMap(({ player }) =>
    player.heroDamage === null ? [] : [player.heroDamage],
  );
  const totalKills = kills.reduce((sum, value) => sum + value, 0);
  const totalDeaths = deaths.reduce((sum, value) => sum + value, 0);
  const totalAssists = assists.reduce((sum, value) => sum + value, 0);

  return {
    hero: toHeroSummary(hero),
    window,
    games,
    wins,
    winRate: games === 0 ? null : wins / games,
    usageShare: ratio(games, totalWindowGames),
    kdaRatio: (totalKills + totalAssists) / Math.max(totalDeaths, 1),
    averageKills: average(kills) ?? 0,
    averageDeaths: average(deaths) ?? 0,
    averageAssists: average(assists) ?? 0,
    averageGpm: average(gpm),
    averageXpm: average(xpm),
    averageLastHits: average(lastHits),
    averageHeroDamage: average(heroDamage),
    fieldCoverage: {
      gpm: { observedCount: gpm.length, coverageRate: ratio(gpm.length, games) },
      xpm: { observedCount: xpm.length, coverageRate: ratio(xpm.length, games) },
      lastHits: { observedCount: lastHits.length, coverageRate: ratio(lastHits.length, games) },
      heroDamage: {
        observedCount: heroDamage.length,
        coverageRate: ratio(heroDamage.length, games),
      },
    },
    lastPlayedAt: players[0]?.match.detail.startTime ?? null,
  };
};

export const calculateHeroList = (
  accountId: string,
  matches: StoredMatch[],
  heroes: HeroDetail[],
  window: MetricWindow,
): PlayerHeroStats[] => {
  const selectedMatches = selectWindow(matches, window);
  return heroes
    .map((hero) => calculateHeroStats(accountId, selectedMatches, hero, window, selectedMatches.length))
    .filter((stats) => stats.games > 0)
    .sort((left, right) => right.games - left.games || left.hero.id.localeCompare(right.hero.id));
};

export const calculateOverview = (
  profile: PlayerProfile,
  matches: StoredMatch[],
  heroes: HeroDetail[],
  window: MetricWindow,
): PlayerOverview => {
  const selectedMatches = selectWindow(matches, window);
  const players = selectedMatches.map((match) => targetPlayer(match.detail, profile.accountId));
  const wins = players.filter((player) => player.isWin).length;
  const heroStats = calculateHeroList(profile.accountId, matches, heroes, window);
  const kills = players.map((player) => player.kills);
  const deaths = players.map((player) => player.deaths);
  const assists = players.map((player) => player.assists);
  const gpm = players.flatMap((player) => (player.gpm === null ? [] : [player.gpm]));
  const xpm = players.flatMap((player) => (player.xpm === null ? [] : [player.xpm]));
  const lastHits = players.flatMap((player) =>
    player.lastHits === null ? [] : [player.lastHits],
  );
  const heroDamage = players.flatMap((player) =>
    player.heroDamage === null ? [] : [player.heroDamage],
  );
  const totalKills = kills.reduce((sum, value) => sum + value, 0);
  const totalDeaths = deaths.reduce((sum, value) => sum + value, 0);
  const totalAssists = assists.reduce((sum, value) => sum + value, 0);
  const games = selectedMatches.length;

  return {
    profile,
    window,
    games,
    wins,
    winRate: games === 0 ? null : wins / games,
    kdaRatio: (totalKills + totalAssists) / Math.max(totalDeaths, 1),
    averageKills: average(kills) ?? 0,
    averageDeaths: average(deaths) ?? 0,
    averageAssists: average(assists) ?? 0,
    averageGpm: average(gpm),
    averageXpm: average(xpm),
    averageLastHits: average(lastHits),
    averageHeroDamage: average(heroDamage),
    fieldCoverage: {
      gpm: { observedCount: gpm.length, coverageRate: ratio(gpm.length, games) },
      xpm: { observedCount: xpm.length, coverageRate: ratio(xpm.length, games) },
      lastHits: { observedCount: lastHits.length, coverageRate: ratio(lastHits.length, games) },
      heroDamage: {
        observedCount: heroDamage.length,
        coverageRate: ratio(heroDamage.length, games),
      },
    },
    distinctHeroes: heroStats.length,
    favoriteHeroId: heroStats[0]?.hero.id ?? null,
    recentMatches: selectedMatches
      .slice(0, 10)
      .map((match) => toMatchSummary(match.detail, profile.accountId)),
    heroes: heroStats,
  };
};
