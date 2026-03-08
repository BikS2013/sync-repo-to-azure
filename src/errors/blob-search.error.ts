import { AzureFsError } from "./base.error";
import { BlobSearchErrorCode } from "../types/errors.types";

/**
 * Error class for blob search operations.
 * Follows the same pattern as RepoReplicationError.
 */
export class BlobSearchError extends AzureFsError {
  constructor(
    code: string,
    message: string,
    statusCode?: number,
    details?: unknown,
  ) {
    super(code, message, statusCode, details);
    this.name = "BlobSearchError";
  }

  /** At least one search parameter is required. */
  static missingParams(detail: string): BlobSearchError {
    return new BlobSearchError(
      BlobSearchErrorCode.MISSING_PARAMS,
      `Missing required search parameters: ${detail}`,
      400,
    );
  }

  /** A search parameter has an invalid value. */
  static invalidParam(param: string, detail: string): BlobSearchError {
    return new BlobSearchError(
      BlobSearchErrorCode.INVALID_PARAM,
      `Invalid search parameter '${param}': ${detail}`,
      400,
      { param },
    );
  }

  /** The blob search operation failed. */
  static searchFailed(detail: string, cause?: Error): BlobSearchError {
    return new BlobSearchError(
      BlobSearchErrorCode.SEARCH_FAILED,
      `Blob search failed: ${detail}`,
      500,
      cause ? { cause: cause.message } : undefined,
    );
  }

  /** Azure Storage authentication is required for blob search. */
  static authMissing(): BlobSearchError {
    return new BlobSearchError(
      BlobSearchErrorCode.AUTH_MISSING,
      "Azure Storage authentication is required for blob search. " +
        "Configure AZURE_STORAGE_ACCOUNT_URL and an auth method (connection-string, sas-token, or azure-ad).",
      401,
    );
  }
}
