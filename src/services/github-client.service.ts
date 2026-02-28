import { Octokit } from "@octokit/rest";
import { Readable } from "stream";
import { Logger } from "../utils/logger.utils";
import { checkTokenExpiry } from "../utils/token-expiry.utils";
import { RepoReplicationError } from "../errors/repo-replication.error";
import { GitHubRepoInfo } from "../types/repo-replication.types";
import { ResolvedConfig } from "../types/config.types";

/**
 * GitHub client service for repository replication.
 *
 * Wraps Octokit for metadata queries and native fetch for streaming
 * tarball downloads. Supports both authenticated (token) and
 * unauthenticated (60 req/hr) access.
 *
 * No temp files are written -- the archive stream is returned as a
 * Node.js Readable that can be piped through gunzip + tar-stream.
 */
/** Per-pair credentials for GitHubClientService (used by sync pairs) */
export interface GitHubClientCredentials {
  token?: string;
  tokenExpiry?: string;
}

export class GitHubClientService {
  private octokit: Octokit;
  private token: string | undefined;
  private logger: Logger;

  constructor(configOrCredentials: ResolvedConfig | GitHubClientCredentials, logger: Logger) {
    this.logger = logger;

    // Discriminate: ResolvedConfig has a 'storage' property, credentials do not
    if ('storage' in configOrCredentials) {
      // ResolvedConfig path (existing behavior - backward compatible)
      this.token = configOrCredentials.github?.token;
      checkTokenExpiry("GITHUB_TOKEN", configOrCredentials.github?.tokenExpiry, logger);
    } else {
      // Direct credentials path (sync pair)
      this.token = configOrCredentials.token;
      if (configOrCredentials.token) {
        checkTokenExpiry("GITHUB_TOKEN (sync pair)", configOrCredentials.tokenExpiry, logger);
      }
    }

    if (this.token) {
      this.octokit = new Octokit({ auth: this.token });
      this.logger.debug("GitHub client created with token authentication");
    } else {
      this.octokit = new Octokit();
      this.logger.warn(
        "GitHub client created without token -- unauthenticated rate limit is 60 requests/hour",
      );
    }
  }

  /**
   * Validate that authentication is sufficient for the intended operation.
   *
   * @param requireToken - When true, throws if no GITHUB_TOKEN is set
   * @throws RepoReplicationError with code REPO_AUTH_MISSING
   */
  validateAuth(requireToken: boolean): void {
    if (requireToken && !this.token) {
      throw RepoReplicationError.authMissing(
        "GitHub",
        "GITHUB_TOKEN",
        "Repository is private",
      );
    }
  }

  /**
   * Fetch repository metadata from the GitHub REST API.
   *
   * @param owner - Repository owner (user or organization)
   * @param repo  - Repository name
   * @returns GitHubRepoInfo with default branch, visibility, and full name
   */
  async getRepoInfo(owner: string, repo: string): Promise<GitHubRepoInfo> {
    try {
      const { data } = await this.octokit.rest.repos.get({ owner, repo });

      return {
        defaultBranch: data.default_branch,
        isPrivate: data.private,
        fullName: data.full_name,
      };
    } catch (error: unknown) {
      const repoIdentifier = `${owner}/${repo}`;

      if (isOctokitError(error)) {
        if (error.status === 404) {
          throw RepoReplicationError.notFound("GitHub", repoIdentifier);
        }

        if (error.status === 403) {
          const rateLimitRemaining = getResponseHeader(
            error,
            "x-ratelimit-remaining",
          );

          if (rateLimitRemaining === "0") {
            const resetHeader = getResponseHeader(error, "x-ratelimit-reset");
            const retryAfter = resetHeader
              ? Math.max(0, Number(resetHeader) - Math.floor(Date.now() / 1000))
              : undefined;
            throw RepoReplicationError.rateLimited("GitHub", retryAfter);
          }

          throw RepoReplicationError.authMissing(
            "GitHub",
            "GITHUB_TOKEN",
            `Access denied to ${repoIdentifier}`,
          );
        }
      }

      const message = error instanceof Error ? error.message : String(error);
      throw RepoReplicationError.downloadFailed(
        "GitHub",
        repoIdentifier,
        message,
      );
    }
  }

  /**
   * Download a repository tarball as a Node.js Readable stream.
   *
   * Uses native fetch with the GitHub API to obtain a raw stream
   * without buffering the entire archive in memory. The returned
   * stream is gzip-compressed and should be piped through
   * `zlib.createGunzip()` then `tar.extract()`.
   *
   * @param owner - Repository owner
   * @param repo  - Repository name
   * @param ref   - Git ref (branch, tag, or commit SHA)
   * @returns A Node.js Readable stream of the gzipped tarball
   */
  async getArchiveStream(
    owner: string,
    repo: string,
    ref: string,
  ): Promise<Readable> {
    const repoIdentifier = `${owner}/${repo}`;

    this.logger.info(`Downloading tarball from GitHub: ${repoIdentifier}@${ref}`);

    const url = `https://api.github.com/repos/${owner}/${repo}/tarball/${ref}`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "azure-fs-cli",
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    let response: Response;
    try {
      response = await fetch(url, { headers, redirect: "follow" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw RepoReplicationError.downloadFailed(
        "GitHub",
        repoIdentifier,
        message,
      );
    }

    if (!response.ok) {
      if (response.status === 404) {
        throw RepoReplicationError.notFound("GitHub", repoIdentifier);
      }

      if (response.status === 403) {
        const rateLimitRemaining = response.headers.get(
          "x-ratelimit-remaining",
        );

        if (rateLimitRemaining === "0") {
          const resetHeader = response.headers.get("x-ratelimit-reset");
          const retryAfter = resetHeader
            ? Math.max(0, Number(resetHeader) - Math.floor(Date.now() / 1000))
            : undefined;
          throw RepoReplicationError.rateLimited("GitHub", retryAfter);
        }

        throw RepoReplicationError.authMissing(
          "GitHub",
          "GITHUB_TOKEN",
          `Access denied to ${repoIdentifier}`,
        );
      }

      throw RepoReplicationError.downloadFailed(
        "GitHub",
        repoIdentifier,
        `HTTP ${response.status}: ${response.statusText}`,
      );
    }

    if (!response.body) {
      throw RepoReplicationError.downloadFailed(
        "GitHub",
        repoIdentifier,
        "Response body is empty",
      );
    }

    this.logger.debug("GitHub tarball response received, returning stream");

    return Readable.fromWeb(response.body as import("stream/web").ReadableStream);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Shape of an Octokit HTTP error */
interface OctokitHttpError {
  status: number;
  response?: {
    headers?: Record<string, string>;
  };
}

function isOctokitError(error: unknown): error is OctokitHttpError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as OctokitHttpError).status === "number"
  );
}

function getResponseHeader(
  error: OctokitHttpError,
  header: string,
): string | undefined {
  return error.response?.headers?.[header];
}
