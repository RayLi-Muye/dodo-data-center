import type { CanonicalRecentMatchQualityContext } from "./types.js";

export type OpenDotaProviderErrorCode =
  | "NOT_FOUND"
  | "PROFILE_PRIVATE"
  | "HISTORY_PRIVATE"
  | "PARSE_PENDING"
  | "SOURCE_RATE_LIMITED"
  | "SOURCE_UNAVAILABLE";

export type OpenDotaProviderErrorReason =
  | "not_found"
  | "profile_unavailable"
  | "history_unavailable"
  | "match_data_unavailable"
  | "player_data_unavailable"
  | "rate_limited"
  | "upstream_5xx"
  | "upstream_http"
  | "invalid_response"
  | "network"
  | "timeout";

export class OpenDotaProviderError extends Error {
  readonly qualityContext?: CanonicalRecentMatchQualityContext;

  constructor(
    readonly code: OpenDotaProviderErrorCode,
    readonly reason: OpenDotaProviderErrorReason,
    message: string,
    readonly retryable: boolean,
    readonly status: number | null = null,
    readonly retryAfterSeconds: number | null = null,
    qualityContext?: CanonicalRecentMatchQualityContext,
  ) {
    super(message);
    this.name = "OpenDotaProviderError";
    if (qualityContext !== undefined) this.qualityContext = qualityContext;
  }
}
