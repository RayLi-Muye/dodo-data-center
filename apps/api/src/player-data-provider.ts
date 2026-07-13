import type { Dota2OfficialProvider, OpenDotaProvider } from "@dodo/dota-data";

export type PlayerDataProvider = Pick<
  OpenDotaProvider,
  | "getPlayerProfile"
  | "getRecentMatches"
  | "getPlayerMatchesPage"
  | "getMatchDetail"
> &
  Pick<
    Dota2OfficialProvider,
    | "getHeroConstants"
    | "getHeroAbilityConstants"
    | "getItemConstants"
    | "getPatchConstants"
    | "getRecentUpdateReleases"
  >;
