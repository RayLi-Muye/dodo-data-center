import type { ApiError, ErrorMeta } from "@dodo/contracts";

type ApiErrorCode = ApiError["error"]["code"];

export class ApiHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly retryable = false,
    readonly meta?: ErrorMeta,
  ) {
    super(message);
    this.name = "ApiHttpError";
  }

  toResponse(): ApiError {
    const response: ApiError = {
      error: { code: this.code, message: this.message, retryable: this.retryable },
    };
    if (this.meta) response.meta = this.meta;
    return response;
  }
}
