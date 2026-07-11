import type { OpenDotaProvider } from "@dodo/dota-data";

export type PlayerDataProvider = Pick<
  OpenDotaProvider,
  "getPlayerProfile" | "getRecentMatches" | "getHeroConstants" | "getItemConstants"
>;
