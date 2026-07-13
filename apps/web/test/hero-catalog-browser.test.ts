import { describe, expect, it, vi } from "vitest";

import { parseHeroGroups, readHeroGroups, writeHeroGroups } from "../lib/hero-groups";

describe("hero catalog browser storage", () => {
  it("parses only bounded, schema-like custom groups", () => {
    expect(parseHeroGroups(JSON.stringify([
      { heroIds: ["1", "1", "2", null], id: "pool", name: "  中路池  " },
      { heroIds: [], id: "", name: "invalid" },
      "invalid",
    ]))).toEqual([{ heroIds: ["1", "2"], id: "pool", name: "中路池" }]);
    expect(parseHeroGroups("not-json")).toEqual([]);
    expect(parseHeroGroups(JSON.stringify({ groups: [] }))).toEqual([]);
  });

  it("deduplicates group IDs and bounds IDs and members", () => {
    const heroIds = ["x".repeat(33), ...Array.from({ length: 300 }, (_, index) => String(index + 1))];
    const groups = parseHeroGroups(JSON.stringify([
      { heroIds, id: "pool", name: "第一组" },
      { heroIds: ["999"], id: "pool", name: "重复组" },
    ]));

    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe("第一组");
    expect(groups[0]?.heroIds).toHaveLength(256);
    expect(groups[0]?.heroIds).not.toContain("x".repeat(33));
    expect(groups[0]?.heroIds.at(-1)).toBe("256");
  });

  it("limits parsed group count and rejects oversized storage payloads", () => {
    const candidates = Array.from({ length: 30 }, (_, index) => ({ heroIds: [], id: `pool-${index}`, name: `分组 ${index}` }));
    expect(parseHeroGroups(JSON.stringify(candidates))).toHaveLength(20);
    expect(parseHeroGroups(`"${"x".repeat(256_001)}"`)).toEqual([]);
  });

  it("falls back to empty groups when localStorage reads fail", () => {
    const storage = {
      getItem: vi.fn(() => { throw new Error("blocked"); }),
      setItem: vi.fn(),
    };
    expect(readHeroGroups(storage)).toEqual([]);
  });

  it("contains localStorage quota failures without crashing", () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => { throw new Error("quota"); }),
    };
    expect(writeHeroGroups(storage, [{ heroIds: ["1"], id: "pool", name: "练习池" }])).toBe(false);
  });
});
