import { describe, expect, it } from "vitest";

import candidateFixture from "../fixtures/audited-map-snapshot-candidate.json";
import {
  buildAuditedMapSnapshot,
  canonicalMapSnapshotJson,
  computeMapSnapshotSha256,
  verifyAuditedMapSnapshot,
} from "../src/audited-map-snapshot.js";

function candidate(): Record<string, any> {
  return structuredClone(candidateFixture);
}

describe("audited map snapshots", () => {
  it("declares a complete coverage partition for the partial synthetic fixture", () => {
    const fixture = candidate();

    expect(fixture.quality).toBe("partial");
    expect(fixture.coverage.includedTypes).toEqual(["lane", "roshan"]);
    expect(fixture.coverage.exclusions.map((entry: { type: string }) => entry.type)).toEqual([
      "tower",
      "tormentor",
      "twin_gate",
      "watcher",
      "wisdom_rune",
      "outpost",
      "shop",
      "rune",
      "lotus_pool",
      "neutral_camp",
      "landmark",
    ]);
    expect(() => buildAuditedMapSnapshot(fixture)).not.toThrow();
  });

  it("builds a schema-valid canonical snapshot with a deterministic hash", () => {
    const built = buildAuditedMapSnapshot(candidate());

    expect(built.sourceRevision.snapshotSha256).toBe(
      "4aec8c8748aefec3b22fb13b6be604aa54766fda6b42b6a20115a50556ec3a0b",
    );
    expect(verifyAuditedMapSnapshot(built)).toEqual(built);
  });

  it("ignores object-key and feature order while preserving coordinate order", () => {
    const original = candidate();
    const reordered = {
      verifiedAt: original.verifiedAt,
      coverage: original.coverage,
      sourceRevision: {
        extractorVersion: original.sourceRevision.extractorVersion,
        resourceSha256: original.sourceRevision.resourceSha256,
        appId: original.sourceRevision.appId,
        resourcePath: original.sourceRevision.resourcePath,
        depotManifestId: original.sourceRevision.depotManifestId,
        extractor: original.sourceRevision.extractor,
        buildId: original.sourceRevision.buildId,
      },
      sourceUrls: original.sourceUrls,
      sourceSnapshot: original.sourceSnapshot,
      features: [...original.features].reverse(),
      bounds: {
        maxY: original.bounds.maxY,
        minX: original.bounds.minX,
        maxX: original.bounds.maxX,
        minY: original.bounds.minY,
      },
      coordinateSystem: original.coordinateSystem,
      quality: original.quality,
      patch: original.patch,
      id: original.id,
    };

    expect(canonicalMapSnapshotJson(reordered)).toBe(canonicalMapSnapshotJson(original));
    expect(computeMapSnapshotSha256(reordered)).toBe(computeMapSnapshotSha256(original));
    expect(canonicalMapSnapshotJson(original)).toContain("[[-800,-800],[0,0],[800,800]]");
  });

  it("changes the hash when a coordinate changes", () => {
    const changed = candidate();
    changed.features[0].geometry.coordinates = [251, 600];
    const reversed = candidate();
    reversed.features[1].geometry.coordinates.reverse();

    expect(computeMapSnapshotSha256(changed)).not.toBe(
      computeMapSnapshotSha256(candidate()),
    );
    expect(computeMapSnapshotSha256(reversed)).not.toBe(
      computeMapSnapshotSha256(candidate()),
    );
  });

  it.each([
    ["invalid geometry", (value: Record<string, any>) => {
      value.features[0].geometry = { type: "Point", coordinates: [250, 600, 1] };
    }],
    ["invalid bounds", (value: Record<string, any>) => {
      value.bounds.maxX = value.bounds.minX;
    }],
    ["out-of-bounds geometry", (value: Record<string, any>) => {
      value.features[0].geometry.coordinates = [1001, 600];
    }],
    ["duplicate feature IDs", (value: Record<string, any>) => {
      value.features[1].id = value.features[0].id;
    }],
    ["missing source references", (value: Record<string, any>) => {
      value.features[0].sourceRefs = [];
    }],
    ["missing known feature type coverage", (value: Record<string, any>) => {
      value.coverage.exclusions = value.coverage.exclusions.filter(
        (entry: { type: string }) => entry.type !== "neutral_camp",
      );
    }],
  ])("rejects %s before hashing", (_label, mutate) => {
    const invalid = candidate();
    mutate(invalid);

    expect(() => buildAuditedMapSnapshot(invalid)).toThrow();
  });

  it("rejects a stored snapshot whose canonical payload does not match its hash", () => {
    const stored = buildAuditedMapSnapshot(candidate());
    stored.sourceRevision.snapshotSha256 = "f".repeat(64);

    expect(() => verifyAuditedMapSnapshot(stored)).toThrow(
      "Map snapshot SHA-256 does not match its canonical payload.",
    );
  });
});
