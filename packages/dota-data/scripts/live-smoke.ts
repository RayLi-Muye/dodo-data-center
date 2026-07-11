import { OpenDotaProvider, OpenDotaProviderError } from "../src/index.js";

type NodeRuntime = {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

const runtime = (globalThis as typeof globalThis & { process: NodeRuntime }).process;
const PROFESSIONAL_ACCOUNT_ID = runtime.env.OPENDOTA_SMOKE_ACCOUNT_ID ?? "86745912";

async function main() {
  const apiKey = runtime.env.OPENDOTA_API_KEY;
  const provider = new OpenDotaProvider(apiKey === undefined ? {} : { apiKey });
  const profile = await provider.getPlayerProfile(PROFESSIONAL_ACCOUNT_ID);
  const recent = await provider.getRecentMatches(PROFESSIONAL_ACCOUNT_ID, 1);
  const match = await provider.getMatchDetail(recent.matches[0]!.id);
  const [heroes, items] = await Promise.all([
    provider.getHeroConstants(),
    provider.getItemConstants(),
  ]);

  console.log(
    JSON.stringify({
      provider: "opendota",
      profile: {
        status: profile.status,
        steamId64Type: profile.steamId64 === null ? "null" : "string",
        hasPersonaName: profile.personaName !== null,
        hasAvatarUrl: profile.avatarUrl !== null,
      },
      recentMatches: {
        count: recent.matches.length,
        candidateCount: recent.eligibleCount,
        candidateLedgerCount: recent.candidateLedger.length,
        ledgerReconciles:
          recent.matches.length + recent.excludedCount === recent.candidateLedger.length,
        idType: typeof recent.matches[0]?.id,
        timestampIsUtc: recent.matches[0]?.startTime.endsWith("Z") ?? false,
      },
      matchDetail: {
        playerCount: match.players.length,
        parseStatus: match.parseStatus,
        anonymousPlayers: match.players.filter((player) => player.accountId === null).length,
      },
      constants: { heroCount: heroes.items.length, itemCount: items.items.length },
    }),
  );
}

main().catch((error: unknown) => {
  if (error instanceof OpenDotaProviderError) {
    console.error(
      JSON.stringify({
        provider: "opendota",
        ok: false,
        code: error.code,
        reason: error.reason,
        retryable: error.retryable,
        status: error.status,
      }),
    );
  } else {
    console.error(JSON.stringify({ provider: "opendota", ok: false, reason: "unexpected" }));
  }
  runtime.exitCode = 1;
});
