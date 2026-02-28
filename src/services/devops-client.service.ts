import { DefaultAzureCredential } from "@azure/identity";
import { Readable } from "stream";
import { Logger } from "../utils/logger.utils";
import { checkTokenExpiry } from "../utils/token-expiry.utils";
import { RepoReplicationError } from "../errors/repo-replication.error";
import { ConfigError } from "../errors/config.error";
import { DevOpsVersionType, DevOpsAuthMethod } from "../types/repo-replication.types";
import { ResolvedConfig } from "../types/config.types";

/**
 * Client service for Azure DevOps Git repository operations.
 *
 * Handles authentication (PAT or Azure AD) and downloads repository
 * archives as streaming zip content via the Azure DevOps Items REST API.
 *
 * No temp files or disk writes -- the returned Readable stream can be
 * piped directly through unzipper.Parse() for streaming extraction.
 */
/** Per-pair credentials for DevOpsClientService (used by sync pairs, PAT only) */
export interface DevOpsClientCredentials {
  pat: string;
  patExpiry?: string;
  orgUrl?: string;
}

export class DevOpsClientService {
  private readonly authMethod: DevOpsAuthMethod | undefined;
  private readonly pat: string | undefined;
  private readonly orgUrl: string | undefined;
  private readonly logger: Logger;

  constructor(configOrCredentials: ResolvedConfig | DevOpsClientCredentials, logger: Logger) {
    this.logger = logger;

    if ('storage' in configOrCredentials) {
      // ResolvedConfig path (existing behavior)
      this.pat = configOrCredentials.devops?.pat;
      this.orgUrl = configOrCredentials.devops?.orgUrl;
      this.authMethod = configOrCredentials.devops?.authMethod;
      if (this.pat) {
        checkTokenExpiry("AZURE_DEVOPS_PAT", configOrCredentials.devops?.patExpiry, logger);
      }
    } else {
      // Direct credentials path (sync pair, PAT only)
      this.pat = configOrCredentials.pat;
      this.orgUrl = configOrCredentials.orgUrl;
      this.authMethod = "pat"; // Sync pairs are PAT-only (design decision D4)
      checkTokenExpiry("AZURE_DEVOPS_PAT (sync pair)", configOrCredentials.patExpiry, logger);
    }
  }

  /**
   * Validate that the configured authentication method and credentials are present.
   *
   * @throws ConfigError if AZURE_DEVOPS_AUTH_METHOD is not set
   * @throws RepoReplicationError if auth method is 'pat' but no PAT is provided
   */
  validateAuth(): void {
    if (this.authMethod === undefined) {
      throw new ConfigError(
        "CONFIG_MISSING_REQUIRED",
        "AZURE_DEVOPS_AUTH_METHOD is required for Azure DevOps repository operations. " +
          "Set it to 'pat' or 'azure-ad'.",
        { paramName: "AZURE_DEVOPS_AUTH_METHOD" },
      );
    }

    if (this.authMethod === "pat" && !this.pat) {
      throw RepoReplicationError.authMissing(
        "Azure DevOps",
        "AZURE_DEVOPS_PAT",
        "Auth method is 'pat' but no token provided",
      );
    }

    // azure-ad: DefaultAzureCredential handles auth; no additional checks needed
  }

  /**
   * Build the Authorization header value for the configured auth method.
   *
   * - PAT: HTTP Basic auth with empty username
   * - Azure AD: Bearer token via DefaultAzureCredential with Azure DevOps scope
   */
  private async getAuthHeader(): Promise<string> {
    if (this.authMethod === "pat") {
      return "Basic " + Buffer.from(":" + this.pat).toString("base64");
    }

    // Azure AD auth
    const credential = new DefaultAzureCredential();
    const tokenResponse = await credential.getToken(
      "499b84ac-1321-427f-aa17-267ca6975798/.default",
    );
    return `Bearer ${tokenResponse.token}`;
  }

  /**
   * Download a repository archive as a streaming zip from Azure DevOps.
   *
   * Uses the Items REST API with recursionLevel=Full and $format=zip.
   * The returned Readable stream can be piped through unzipper.Parse()
   * for streaming extraction without touching disk.
   *
   * @param organization - Azure DevOps organization name
   * @param project - Project name
   * @param repository - Repository name or GUID
   * @param ref - Optional version identifier (branch, tag, or commit SHA)
   * @param versionType - How to interpret the ref (branch, tag, commit)
   * @param resolveLfs - Whether to resolve LFS pointers
   * @returns Node.js Readable stream of the zip archive
   */
  async getArchiveStream(
    organization: string,
    project: string,
    repository: string,
    ref?: string,
    versionType?: DevOpsVersionType,
    resolveLfs?: boolean,
  ): Promise<Readable> {
    this.validateAuth();

    // Determine base URL: prefer orgUrl from env, fall back to constructing from organization param
    const baseUrl = this.orgUrl
      ? this.orgUrl.replace(/\/+$/, "")
      : `https://dev.azure.com/${encodeURIComponent(organization)}`;

    // Build the Items API URL
    const apiUrl = new URL(
      `${baseUrl}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repository)}/items`,
    );
    apiUrl.searchParams.set("path", "/");
    apiUrl.searchParams.set("$format", "zip");
    apiUrl.searchParams.set("recursionLevel", "Full");
    apiUrl.searchParams.set("zipForUnix", "true");
    apiUrl.searchParams.set("api-version", "7.1");

    if (ref) {
      apiUrl.searchParams.set("versionDescriptor.version", ref);
    }
    if (versionType) {
      apiUrl.searchParams.set("versionDescriptor.versionType", versionType);
    }
    if (resolveLfs) {
      apiUrl.searchParams.set("resolveLfs", "true");
    }

    const repoIdentifier = `${organization}/${project}/${repository}`;
    this.logger.info(
      `Downloading zip archive from Azure DevOps: ${repoIdentifier}`,
      { organization, project, repository, ref, versionType },
    );

    const authHeader = await this.getAuthHeader();

    let response: Response;
    try {
      response = await fetch(apiUrl.toString(), {
        headers: {
          Authorization: authHeader,
          Accept: "application/zip",
        },
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw RepoReplicationError.downloadFailed(
        "Azure DevOps",
        repoIdentifier,
        `Network error: ${reason}`,
      );
    }

    if (!response.ok) {
      await this.handleErrorResponse(response, repoIdentifier);
    }

    if (!response.body) {
      throw RepoReplicationError.downloadFailed(
        "Azure DevOps",
        repoIdentifier,
        "Response body is empty",
      );
    }

    return Readable.fromWeb(response.body as any);
  }

  /**
   * Map HTTP error responses to the appropriate RepoReplicationError.
   */
  private async handleErrorResponse(
    response: Response,
    repoIdentifier: string,
  ): Promise<never> {
    const status = response.status;

    if (status === 401 || status === 403) {
      throw RepoReplicationError.authMissing(
        "Azure DevOps",
        this.authMethod === "pat" ? "AZURE_DEVOPS_PAT" : "AZURE_DEVOPS_AUTH_METHOD",
        `HTTP ${status}: Access denied to ${repoIdentifier}`,
      );
    }

    if (status === 404) {
      throw RepoReplicationError.notFound("Azure DevOps", repoIdentifier);
    }

    if (status === 429) {
      const retryAfterHeader = response.headers.get("Retry-After");
      const retryAfterSeconds = retryAfterHeader
        ? parseInt(retryAfterHeader, 10)
        : undefined;
      throw RepoReplicationError.rateLimited(
        "Azure DevOps",
        Number.isNaN(retryAfterSeconds) ? undefined : retryAfterSeconds,
      );
    }

    // Generic error
    let body = "";
    try {
      body = await response.text();
    } catch {
      // Ignore body read failures
    }
    throw RepoReplicationError.downloadFailed(
      "Azure DevOps",
      repoIdentifier,
      `HTTP ${status}: ${body || response.statusText}`,
    );
  }
}
