import { AzureFsError } from "./base.error";

/**
 * Error thrown during repository replication operations.
 * Covers archive download failures, extraction errors, auth issues,
 * and repository-not-found scenarios.
 *
 * The statusCode property is set to enable proper HTTP status mapping
 * in the error handler middleware.
 */
export class RepoReplicationError extends AzureFsError {
  constructor(
    code: string,
    message: string,
    statusCode?: number,
    details?: unknown,
  ) {
    super(code, message, statusCode, details);
    this.name = "RepoReplicationError";
  }

  /** Repository was not found or is not accessible. */
  static notFound(platform: string, repoIdentifier: string): RepoReplicationError {
    return new RepoReplicationError(
      "REPO_NOT_FOUND",
      `Repository not found on ${platform}: ${repoIdentifier}. ` +
        `Verify the repository name and that your credentials have access.`,
      404,
      { platform, repoIdentifier },
    );
  }

  /** Required authentication token is missing. */
  static authMissing(
    platform: string,
    envVarName: string,
    reason: string,
  ): RepoReplicationError {
    return new RepoReplicationError(
      "REPO_AUTH_MISSING",
      `Authentication required for ${platform} repository access: ${reason}. ` +
        `Set the ${envVarName} environment variable.`,
      401,
      { platform, envVarName },
    );
  }

  /** Archive download failed (network error, HTTP error, etc.). */
  static downloadFailed(
    platform: string,
    repoIdentifier: string,
    reason: string,
  ): RepoReplicationError {
    return new RepoReplicationError(
      "REPO_ARCHIVE_DOWNLOAD_FAILED",
      `Failed to download archive from ${platform} for ${repoIdentifier}: ${reason}`,
      502,
      { platform, repoIdentifier },
    );
  }

  /** Stream extraction/parsing failed. */
  static extractionFailed(
    platform: string,
    repoIdentifier: string,
    reason: string,
  ): RepoReplicationError {
    return new RepoReplicationError(
      "REPO_EXTRACTION_FAILED",
      `Failed to parse archive stream from ${platform} for ${repoIdentifier}: ${reason}`,
      500,
      { platform, repoIdentifier },
    );
  }

  /** Rate limit exceeded (GitHub 403, Azure DevOps 429). */
  static rateLimited(
    platform: string,
    retryAfterSeconds?: number,
  ): RepoReplicationError {
    const retryMsg = retryAfterSeconds
      ? ` Retry after ${retryAfterSeconds} seconds.`
      : "";
    return new RepoReplicationError(
      "REPO_RATE_LIMITED",
      `Rate limit exceeded on ${platform}.${retryMsg}`,
      429,
      { platform, retryAfterSeconds },
    );
  }

  /** Required request parameters missing (API validation). */
  static missingParams(
    missingFields: string[],
  ): RepoReplicationError {
    return new RepoReplicationError(
      "REPO_MISSING_PARAMS",
      `Missing required fields: ${missingFields.join(", ")}`,
      400,
      { missingFields },
    );
  }

  /** Sync pair configuration is invalid (missing fields, malformed structure). */
  static invalidSyncConfig(message: string): RepoReplicationError {
    return new RepoReplicationError(
      "REPO_INVALID_SYNC_CONFIG",
      message,
      400,
    );
  }

  /** A specific sync pair failed during execution. */
  static syncPairFailed(pairName: string, cause: string): RepoReplicationError {
    return new RepoReplicationError(
      "REPO_SYNC_PAIR_FAILED",
      `Sync pair "${pairName}" failed: ${cause}`,
      500,
      { pairName },
    );
  }
}
