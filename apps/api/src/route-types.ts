import type {
  HeroDetail,
  HeroSummary,
  MatchDetail,
  MatchSummary,
  PlayerHeroStats,
  PlayerOverview,
  PlayerProfile,
} from "@dodo/contracts";

export type {
  HeroDetail,
  HeroSummary,
  MatchDetail,
  MatchSummary,
  PlayerHeroStats,
  PlayerOverview,
  PlayerProfile,
};

export type MatchPlayer = MatchDetail["players"][number];
export type MetricWindow = PlayerHeroStats["window"];
