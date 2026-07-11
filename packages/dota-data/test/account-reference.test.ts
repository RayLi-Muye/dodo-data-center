import { describe, expect, it } from "vitest";

import {
  resolveAccountReference,
  STEAM_ID64_ACCOUNT_OFFSET,
} from "../src/account-reference.js";

describe("resolveAccountReference", () => {
  it("resolves a Dota Account ID deterministically", () => {
    expect(resolveAccountReference({ kind: "account_id", value: "123456789" })).toEqual({
      accountId: "123456789",
      steamId64: "76561198083722517",
    });
  });

  it("resolves a SteamID64 deterministically", () => {
    expect(resolveAccountReference({ kind: "steam_id64", value: "76561198083722517" })).toEqual({
      accountId: "123456789",
      steamId64: "76561198083722517",
    });
  });

  it("resolves only the supported Steam profiles URL form", () => {
    expect(
      resolveAccountReference({
        kind: "steam_profile_url",
        value: "https://steamcommunity.com/profiles/76561198083722517/",
      }),
    ).toEqual({ accountId: "123456789", steamId64: "76561198083722517" });
  });

  it("rejects vanity URLs without looking up an unknown service", () => {
    expect(() =>
      resolveAccountReference({
        kind: "steam_profile_url",
        value: "https://steamcommunity.com/id/synthetic-player",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "UNSUPPORTED_ACCOUNT_REFERENCE",
        retryable: false,
      }),
    );
  });

  it.each([
    { kind: "account_id", value: "0" },
    { kind: "account_id", value: "4294967296" },
    { kind: "steam_id64", value: STEAM_ID64_ACCOUNT_OFFSET.toString() },
    { kind: "steam_profile_url", value: "http://steamcommunity.com/profiles/76561198083722517" },
  ] as const)("rejects invalid reference $value", (reference) => {
    expect(() => resolveAccountReference(reference)).toThrowError(
      expect.objectContaining({ code: "INVALID_ACCOUNT_ID" }),
    );
  });
});
