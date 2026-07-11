import type { AccountReference, AccountResolution } from "@dodo/contracts";

export const STEAM_ID64_ACCOUNT_OFFSET = 76_561_197_960_265_728n;

const MAX_ACCOUNT_ID = 4_294_967_295n;
const SUPPORTED_STEAM_HOSTS = new Set(["steamcommunity.com", "www.steamcommunity.com"]);

export type AccountReferenceErrorCode =
  | "INVALID_ACCOUNT_ID"
  | "UNSUPPORTED_ACCOUNT_REFERENCE";

export class AccountReferenceError extends Error {
  readonly retryable = false;

  constructor(
    readonly code: AccountReferenceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AccountReferenceError";
  }
}

function invalidAccount(message: string): never {
  throw new AccountReferenceError("INVALID_ACCOUNT_ID", message);
}

function accountIdFromSteamId64(value: string): string {
  if (!/^\d{17}$/.test(value)) {
    return invalidAccount("SteamID64 must contain exactly 17 decimal digits");
  }

  const steamId64 = BigInt(value);
  const accountId = steamId64 - STEAM_ID64_ACCOUNT_OFFSET;
  if (accountId <= 0n || accountId > MAX_ACCOUNT_ID) {
    return invalidAccount("SteamID64 is outside the supported Dota account range");
  }

  return accountId.toString();
}

function resolveAccountId(value: string): AccountResolution {
  if (!/^\d{1,10}$/.test(value)) {
    return invalidAccount("Dota Account ID must contain 1 to 10 decimal digits");
  }

  const accountId = BigInt(value);
  if (accountId <= 0n || accountId > MAX_ACCOUNT_ID) {
    return invalidAccount("Dota Account ID is outside the unsigned 32-bit range");
  }

  return {
    accountId: accountId.toString(),
    steamId64: (STEAM_ID64_ACCOUNT_OFFSET + accountId).toString(),
  };
}

function resolveProfileUrl(value: string): AccountResolution {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalidAccount("Steam profile reference must be a valid URL");
  }

  if (url.protocol !== "https:" || !SUPPORTED_STEAM_HOSTS.has(url.hostname.toLowerCase())) {
    return invalidAccount("Steam profile URL must use https://steamcommunity.com");
  }

  const pathSegments = url.pathname.split("/").filter(Boolean);
  if (pathSegments[0]?.toLowerCase() === "id") {
    throw new AccountReferenceError(
      "UNSUPPORTED_ACCOUNT_REFERENCE",
      "Steam vanity URLs are not supported in the MVP",
    );
  }

  if (pathSegments.length !== 2 || pathSegments[0]?.toLowerCase() !== "profiles") {
    return invalidAccount("Steam profile URL must match /profiles/<steamid64>");
  }

  const steamId64 = pathSegments[1] ?? "";
  return { accountId: accountIdFromSteamId64(steamId64), steamId64 };
}

export function resolveAccountReference(reference: AccountReference): AccountResolution {
  if (!reference || typeof reference !== "object" || typeof reference.value !== "string") {
    return invalidAccount("Account reference is malformed");
  }

  switch (reference.kind) {
    case "account_id":
      return resolveAccountId(reference.value);
    case "steam_id64":
      return {
        accountId: accountIdFromSteamId64(reference.value),
        steamId64: reference.value,
      };
    case "steam_profile_url":
      return resolveProfileUrl(reference.value);
    default:
      throw new AccountReferenceError(
        "UNSUPPORTED_ACCOUNT_REFERENCE",
        "Account reference kind is not supported in the MVP",
      );
  }
}
