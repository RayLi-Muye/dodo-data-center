import { createHash } from "node:crypto";

import {
  canonicalMapSnapshotPayload,
  mapVersionSchema,
  type MapSourceRevision,
  type MapVersion,
} from "@dodo/contracts";

const PLACEHOLDER_SHA256 = "0".repeat(64);

export type AuditedMapSnapshotCandidate = Omit<MapVersion, "sourceRevision"> & {
  sourceRevision: Omit<MapSourceRevision, "snapshotSha256">;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCandidate(value: unknown): MapVersion {
  const sourceRevision = isRecord(value) && isRecord(value.sourceRevision)
    ? value.sourceRevision
    : {};
  return mapVersionSchema.parse(
    isRecord(value)
      ? {
          ...value,
          sourceRevision: { ...sourceRevision, snapshotSha256: PLACEHOLDER_SHA256 },
        }
      : value,
  );
}

export function canonicalMapSnapshotJson(candidate: unknown): string {
  return canonicalMapSnapshotPayload(parseCandidate(candidate));
}

export function computeMapSnapshotSha256(candidate: unknown): string {
  return createHash("sha256").update(canonicalMapSnapshotJson(candidate), "utf8").digest("hex");
}

export function buildAuditedMapSnapshot(candidate: unknown): MapVersion {
  const parsed = parseCandidate(candidate);
  return mapVersionSchema.parse({
    ...parsed,
    sourceRevision: {
      ...parsed.sourceRevision,
      snapshotSha256: computeMapSnapshotSha256(parsed),
    },
  });
}

export function verifyAuditedMapSnapshot(value: unknown): MapVersion {
  const map = mapVersionSchema.parse(value);
  const actualHash = createHash("sha256")
    .update(canonicalMapSnapshotPayload(map), "utf8")
    .digest("hex");
  if (actualHash !== map.sourceRevision.snapshotSha256) {
    throw new Error("Map snapshot SHA-256 does not match its canonical payload.");
  }
  return map;
}
