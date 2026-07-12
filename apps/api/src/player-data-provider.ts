import type { Dota2OfficialProvider, OpenDotaProvider } from "@dodo/dota-data";

export type PlayerDataProvider = Pick<
  OpenDotaProvider,
  | "getPlayerProfile"
  | "getRecentMatches"
  | "getPlayerMatchesPage"
  | "getMatchDetail"
  | "getHeroConstants"
  | "getHeroAbilityConstants"
  | "getItemConstants"
  | "getPatchConstants"
> & Pick<Dota2OfficialProvider, "getRecentUpdateReleases">;
