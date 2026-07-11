import type { AccountReference, AccountResolution, ErrorMeta } from "@dodo/contracts";
import {
  AccountReferenceError,
  resolveAccountReference as resolveDataAccountReference,
} from "@dodo/dota-data";

import { ApiHttpError } from "./errors.js";
import { createErrorMeta } from "./meta.js";

export const resolveAccountReference = (
  reference: AccountReference,
  errorMeta: ErrorMeta = createErrorMeta(),
): AccountResolution => {
  try {
    return resolveDataAccountReference(reference);
  } catch (error) {
    if (error instanceof AccountReferenceError) {
      throw new ApiHttpError(
        400,
        error.code,
        error.message,
        error.retryable,
        errorMeta,
      );
    }
    throw error;
  }
};

export const canonicalizeAccountId = (accountId: string, errorMeta?: ErrorMeta): string =>
  resolveAccountReference({ kind: "account_id", value: accountId }, errorMeta).accountId;
