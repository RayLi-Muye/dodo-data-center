import type { OpenDotaProvider } from "@dodo/dota-data";

export type PlayerDataProvider = Pick<
  OpenDotaProvider,
  | "getPlayerProfile"
  | "getRecentMatches"
  | "getMatchDetail"
  | "getHeroConstants"
  | "getItemConstants"
>;
