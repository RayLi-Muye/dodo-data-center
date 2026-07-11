import type {
  ErrorMeta,
  OperationMeta,
  PlayerDataStatus,
  ResponseMeta,
} from "./types.js";

import { SEED_UPDATED_AT } from "@dodo/db";

export type MetaDescriptor = {
  updatedAt: string;
  sources: OperationMeta["sources"];
  quality: OperationMeta["quality"];
};

type MetaInput = {
  sampleSize: number;
  eligibleCount?: number;
  coverageRate?: number;
  excludedCount?: number;
  exclusionReasons?: string[];
  filtersApplied?: Record<string, unknown>;
  inputWatermark?: string | null;
  quality?: "complete" | "partial" | "stale";
  updatedAt?: string;
  metricVersion?: string;
  sources?: OperationMeta["sources"];
};

export const createMetricMeta = ({
  sampleSize,
  eligibleCount = sampleSize,
  coverageRate = eligibleCount === 0 ? 1 : sampleSize / eligibleCount,
  excludedCount = 0,
  exclusionReasons = [],
  filtersApplied = {},
  inputWatermark = null,
  quality = "complete",
  updatedAt = SEED_UPDATED_AT,
  metricVersion = "seed-v1",
  sources = ["seed"],
}: MetaInput): ResponseMeta => ({
  sampleSize,
  eligibleCount,
  coverageRate,
  excludedCount,
  exclusionReasons,
  updatedAt,
  inputWatermark,
  metricVersion,
  filtersApplied,
  sources,
  quality,
});

export const createOperationMeta = (
  descriptor: Partial<MetaDescriptor> = {},
): OperationMeta => ({
  updatedAt: descriptor.updatedAt ?? SEED_UPDATED_AT,
  sources: descriptor.sources ?? ["seed"],
  quality: descriptor.quality ?? "complete",
});

export const createErrorMeta = (
  status?: PlayerDataStatus,
  retryAfterSeconds: number | null = null,
  descriptor: Partial<MetaDescriptor> = {},
): ErrorMeta => {
  const meta: ErrorMeta = {
    updatedAt: descriptor.updatedAt ?? SEED_UPDATED_AT,
    sources: descriptor.sources ?? ["seed"],
    retryAfterSeconds,
  };
  if (status) meta.status = status;
  return meta;
};
