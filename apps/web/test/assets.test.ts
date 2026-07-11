import { describe, expect, it } from "vitest";

import { dotaAssetUrl, normalizeDotaAssetName } from "../lib/assets";

describe("Dota CDN assets", () => {
  it("normalizes provider and seed hero names", () => {
    expect(normalizeDotaAssetName("npc_dota_hero_antimage", "hero")).toBe("antimage");
    expect(normalizeDotaAssetName("seed_axe", "hero")).toBe("axe");
  });

  it("maps seed item aliases to official asset names", () => {
    expect(normalizeDotaAssetName("seed_treads", "item")).toBe("power_treads");
    expect(normalizeDotaAssetName("seed_bkb", "item")).toBe("black_king_bar");
  });

  it("rejects unsafe names instead of constructing arbitrary URLs", () => {
    expect(dotaAssetUrl("../secret", "hero")).toBeNull();
  });
});
