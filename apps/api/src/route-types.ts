import type {
  HeroDetail,
  HeroSummary,
  MatchCoreDetail,
  MatchSummary,
  PlayerHeroStats,
  PlayerOverview,
  PlayerProfile,
} from "@dodo/contracts";

export type {
  HeroDetail,
  HeroSummary,
  MatchCoreDetail,
  MatchSummary,
  PlayerHeroStats,
  PlayerOverview,
  PlayerProfile,
};

export type MatchPlayer = MatchCoreDetail["players"][number];
export type MetricWindow = PlayerHeroStats["window"];
