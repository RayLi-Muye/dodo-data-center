export type Dota2OfficialProviderErrorReason =
  | "rate_limited"
  | "upstream_5xx"
  | "upstream_http"
  | "invalid_response"
  | "network"
  | "timeout";

export type Dota2OfficialProviderErrorCode =
  | "DOTA2_OFFICIAL_RATE_LIMITED"
  | "DOTA2_OFFICIAL_UNAVAILABLE";

export class Dota2OfficialProviderError extends Error {
  readonly code: Dota2OfficialProviderErrorCode;

  constructor(
    readonly reason: Dota2OfficialProviderErrorReason,
    message: string,
    readonly retryable: boolean,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "Dota2OfficialProviderError";
    this.code = reason === "rate_limited"
      ? "DOTA2_OFFICIAL_RATE_LIMITED"
      : "DOTA2_OFFICIAL_UNAVAILABLE";
  }
}
