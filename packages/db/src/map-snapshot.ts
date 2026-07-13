import { createHash } from "node:crypto";

import {
  canonicalMapSnapshotPayload,
  dataQualitySchema,
  dataSourceSchema,
  mapVersionSchema,
  timestampSchema,
  type MapVersion,
} from "@dodo/contracts";

import type { StaticDataSnapshot } from "./types.js";

export class MapAuditError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "MapAuditError";
  }
}

export const calculateMapContentHash = (value: MapVersion): string => {
  return createHash("sha256").update(canonicalMapSnapshotPayload(value)).digest("hex");
};

export const parseAuditedMapPayload = (value: unknown): MapVersion => {
  let map: MapVersion;
  try {
    map = mapVersionSchema.parse(value);
  } catch (error) {
    throw new MapAuditError("Map payload failed schema validation", error);
  }
  if (map.sourceRevision.snapshotSha256 !== calculateMapContentHash(map)) {
    throw new MapAuditError("Map source revision hash does not match the canonical map payload");
  }
  return map;
};

export const parseConsistentMapSnapshot = (
  value: unknown,
  snapshot: StaticDataSnapshot,
): MapVersion => {
  const map = parseAuditedMapPayload(value);
  let source: ReturnType<typeof dataSourceSchema.parse>;
  let quality: ReturnType<typeof dataQualitySchema.parse>;
  try {
    source = dataSourceSchema.parse(snapshot.source);
    quality = dataQualitySchema.parse(snapshot.quality);
    timestampSchema.parse(snapshot.fetchedAt);
    timestampSchema.parse(snapshot.checkedAt);
    timestampSchema.parse(snapshot.changedAt);
  } catch (error) {
    throw new MapAuditError("Map snapshot metadata failed schema validation", error);
  }
  const contentHash = calculateMapContentHash(map);

  if (source !== "curated_map" && source !== "seed") {
    throw new MapAuditError("Map snapshots must use curated_map or seed as their source");
  }
  if (snapshot.contentHash !== contentHash) {
    throw new MapAuditError("Map snapshot content hash does not match the canonical map payload");
  }
  if (snapshot.officialVersion !== map.patch) {
    throw new MapAuditError("Map snapshot official version does not match the map patch");
  }
  if (quality !== map.quality) {
    throw new MapAuditError("Map snapshot quality does not match the map payload");
  }
  return map;
};

export const mapSnapshotIsConsistent = (
  value: unknown,
  snapshot: StaticDataSnapshot,
): boolean => {
  try {
    parseConsistentMapSnapshot(value, snapshot);
    return true;
  } catch {
    return false;
  }
};
