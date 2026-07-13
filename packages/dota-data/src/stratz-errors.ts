export type StratzProviderErrorCode =
  | "AUTHENTICATION"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "FAILED"
  | "NOT_FOUND";

export type StratzProviderErrorReason =
  | "invalid_token"
  | "forbidden"
  | "rate_limited"
  | "cloudflare_challenge"
  | "upstream_5xx"
  | "upstream_http"
  | "graphql_error"
  | "invalid_response"
  | "network"
  | "timeout"
  | "not_found";

export class StratzProviderError extends Error {
  constructor(
    readonly code: StratzProviderErrorCode,
    readonly reason: StratzProviderErrorReason,
    message: string,
    readonly retryable: boolean,
    readonly status: number | null = null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "StratzProviderError";
  }
}
