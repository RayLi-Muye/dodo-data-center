import type { OpenDotaProvider } from "@dodo/dota-data";

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
>;
