import * as zlib from "zlib";
import { Readable, Transform } from "stream";
import * as tarStream from "tar-stream";
import * as unzipper from "unzipper";
import { ContainerClient } from "@azure/storage-blob";
import { Logger } from "../utils/logger.utils";
import { normalizePath } from "./path.service";
import { GitHubClientService, GitHubClientCredentials } from "./github-client.service";
import { DevOpsClientService, DevOpsClientCredentials } from "./devops-client.service";
import { createSyncPairContainerClient } from "./auth.service";
import { RepoReplicationError } from "../errors/repo-replication.error";
import {
  GitHubRepoParams,
  DevOpsRepoParams,
  RepoReplicationResult,
  RepoFileUploadResult,
  SyncPairConfig,
  SyncPair,
  GitHubSyncPair,
  DevOpsSyncPair,
  SyncPairItemResult,
  SyncPairBatchResult,
} from "../types/repo-replication.types";
import { ResolvedConfig } from "../types/config.types";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Streaming pipeline statistics accumulated during archive extraction */
interface StreamingStats {
  totalFiles: number;
  successCount: number;
  failedCount: number;
  totalBytes: number;
  failedFiles: RepoFileUploadResult[];
}

/** Threshold below which a file is buffered and uploaded in a single call */
const SMALL_FILE_THRESHOLD = 4 * 1024 * 1024; // 4 MB

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Orchestrates streaming replication of Git repositories to Azure Blob Storage.
 *
 * Coordinates the full pipeline: archive stream retrieval from the source
 * platform (GitHub tarball / Azure DevOps zip), streaming extraction of
 * individual entries, and per-entry upload to Azure Blob Storage via
 * BlockBlobClient.
 *
 * **Zero local disk usage** -- no temp files or directories are created.
 * Download, extraction, and upload happen concurrently as data flows through
 * the Node.js stream pipeline.
 */
export class RepoReplicationService {
  private readonly containerClient: ContainerClient;
  private readonly config: ResolvedConfig;
  private readonly logger: Logger;

  constructor(config: ResolvedConfig, containerClient: ContainerClient, logger: Logger) {
    this.config = config;
    this.containerClient = containerClient;
    this.logger = logger;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Replicate a GitHub repository to Azure Blob Storage.
   *
   * Flow:
   * 1. Resolve default branch if no ref is specified
   * 2. Validate auth for private repos
   * 3. Stream tarball -> gunzip -> tar-stream extract -> per-entry blob upload
   */
  async replicateGitHub(
    params: GitHubRepoParams,
  ): Promise<RepoReplicationResult> {
    const totalStart = Date.now();

    const [owner, repo] = this.parseGitHubRepo(params.repo);
    const repoIdentifier = `${owner}/${repo}`;

    const githubClient = new GitHubClientService(this.config, this.logger);

    // Resolve ref: use provided ref or fetch default branch from repo info
    let ref = params.ref;
    if (!ref) {
      this.logger.info(
        `No ref specified for ${repoIdentifier}, fetching default branch`,
      );
      const repoInfo = await githubClient.getRepoInfo(owner, repo);
      ref = repoInfo.defaultBranch;
      this.logger.info(`Using default branch: ${ref}`);

      // If repo is private, validate auth
      if (repoInfo.isPrivate) {
        githubClient.validateAuth(true);
      }
    }

    // Get archive stream
    const archiveStream = await githubClient.getArchiveStream(owner, repo, ref);

    // Stream through tar pipeline
    const streamStart = Date.now();
    const stats = await this.streamTarToBlob(
      archiveStream,
      params.destPath,
      repoIdentifier,
    );
    const streamingDurationMs = Date.now() - streamStart;

    const totalDurationMs = Date.now() - totalStart;

    this.logger.info(
      `GitHub replication complete for ${repoIdentifier}@${ref}: ` +
        `${stats.successCount}/${stats.totalFiles} files, ` +
        `${stats.totalBytes} bytes in ${totalDurationMs}ms`,
    );

    return {
      platform: "github",
      source: repoIdentifier,
      ref,
      destPath: params.destPath,
      totalFiles: stats.totalFiles,
      successCount: stats.successCount,
      failedCount: stats.failedCount,
      totalBytes: stats.totalBytes,
      streamingDurationMs,
      totalDurationMs,
      failedFiles: stats.failedCount > 0 ? stats.failedFiles : undefined,
    };
  }

  /**
   * Replicate an Azure DevOps repository to Azure Blob Storage.
   *
   * Flow:
   * 1. Validate auth (PAT or Azure AD)
   * 2. Stream zip -> unzipper.Parse() -> per-entry blob upload
   */
  async replicateDevOps(
    params: DevOpsRepoParams,
  ): Promise<RepoReplicationResult> {
    const totalStart = Date.now();

    const repoIdentifier = `${params.organization}/${params.project}/${params.repository}`;

    const devopsClient = new DevOpsClientService(this.config, this.logger);
    devopsClient.validateAuth();

    // Get archive stream
    const archiveStream = await devopsClient.getArchiveStream(
      params.organization,
      params.project,
      params.repository,
      params.ref,
      params.versionType,
      params.resolveLfs,
    );

    // Stream through zip pipeline
    const streamStart = Date.now();
    const stats = await this.streamZipToBlob(
      archiveStream,
      params.destPath,
      repoIdentifier,
    );
    const streamingDurationMs = Date.now() - streamStart;

    const totalDurationMs = Date.now() - totalStart;

    const ref = params.ref ?? "default";

    this.logger.info(
      `DevOps replication complete for ${repoIdentifier}@${ref}: ` +
        `${stats.successCount}/${stats.totalFiles} files, ` +
        `${stats.totalBytes} bytes in ${totalDurationMs}ms`,
    );

    return {
      platform: "azure-devops",
      source: repoIdentifier,
      ref,
      destPath: params.destPath,
      totalFiles: stats.totalFiles,
      successCount: stats.successCount,
      failedCount: stats.failedCount,
      totalBytes: stats.totalBytes,
      streamingDurationMs,
      totalDurationMs,
      failedFiles: stats.failedCount > 0 ? stats.failedFiles : undefined,
    };
  }

  // -----------------------------------------------------------------------
  // Sync Pair API
  // -----------------------------------------------------------------------

  /**
   * Execute all sync pairs from a sync pair configuration.
   *
   * Each pair is processed sequentially. Each pair creates its own
   * GitHubClientService or DevOpsClientService with per-pair credentials,
   * and its own ContainerClient with per-pair Azure Storage SAS token.
   *
   * The method continues processing remaining pairs even if one fails
   * (fail-open). Per-pair results are collected and returned.
   */
  async replicateFromSyncConfig(
    syncConfig: SyncPairConfig,
  ): Promise<SyncPairBatchResult> {
    const totalStart = Date.now();
    const results: SyncPairItemResult[] = [];

    for (const pair of syncConfig.syncPairs) {
      const itemResult = await this.executeSyncPair(pair);
      results.push(itemResult);
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return {
      totalPairs: syncConfig.syncPairs.length,
      succeeded,
      failed,
      results,
      totalDurationMs: Date.now() - totalStart,
    };
  }

  /**
   * Execute a single sync pair with error isolation (fail-open).
   */
  private async executeSyncPair(pair: SyncPair): Promise<SyncPairItemResult> {
    const sourceId = pair.platform === "github"
      ? pair.source.repo
      : `${pair.source.organization}/${pair.source.project}/${pair.source.repository}`;
    const destPath = `${pair.destination.container}/${pair.destination.folder}`;

    try {
      this.logger.info(`Processing sync pair: "${pair.name}" (${pair.platform})`);

      // Create per-pair ContainerClient using SAS token
      const pairContainerClient = createSyncPairContainerClient(
        pair.destination.accountUrl,
        pair.destination.container,
        pair.destination.sasToken,
      );

      let result: RepoReplicationResult;

      if (pair.platform === "github") {
        result = await this.replicateGitHubSyncPair(pair, pairContainerClient);
      } else {
        result = await this.replicateDevOpsSyncPair(pair, pairContainerClient);
      }

      this.logger.info(
        `Sync pair "${pair.name}" completed: ${result.successCount}/${result.totalFiles} files`
      );

      return {
        name: pair.name,
        platform: pair.platform,
        source: sourceId,
        destPath,
        success: true,
        result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Sync pair "${pair.name}" failed: ${message}`);

      return {
        name: pair.name,
        platform: pair.platform,
        source: sourceId,
        destPath,
        success: false,
        error: message,
      };
    }
  }

  /**
   * Replicate a GitHub sync pair using per-pair credentials and per-pair container client.
   */
  private async replicateGitHubSyncPair(
    pair: GitHubSyncPair,
    containerClient: ContainerClient,
  ): Promise<RepoReplicationResult> {
    const totalStart = Date.now();
    const [owner, repo] = this.parseGitHubRepo(pair.source.repo);
    const repoIdentifier = `${owner}/${repo}`;

    const credentials: GitHubClientCredentials = {
      token: pair.source.token,
      tokenExpiry: pair.source.tokenExpiry,
    };
    const githubClient = new GitHubClientService(credentials, this.logger);

    // Resolve ref
    let ref = pair.source.ref;
    if (!ref) {
      const repoInfo = await githubClient.getRepoInfo(owner, repo);
      ref = repoInfo.defaultBranch;
      if (repoInfo.isPrivate) {
        githubClient.validateAuth(true);
      }
    }

    const archiveStream = await githubClient.getArchiveStream(owner, repo, ref);

    const streamStart = Date.now();
    const stats = await this.streamTarToBlob(
      archiveStream,
      pair.destination.folder,
      repoIdentifier,
      containerClient,  // Per-pair container client
    );
    const streamingDurationMs = Date.now() - streamStart;

    return {
      platform: "github",
      source: repoIdentifier,
      ref,
      destPath: pair.destination.folder,
      totalFiles: stats.totalFiles,
      successCount: stats.successCount,
      failedCount: stats.failedCount,
      totalBytes: stats.totalBytes,
      streamingDurationMs,
      totalDurationMs: Date.now() - totalStart,
      failedFiles: stats.failedCount > 0 ? stats.failedFiles : undefined,
    };
  }

  /**
   * Replicate a DevOps sync pair using per-pair credentials and per-pair container client.
   */
  private async replicateDevOpsSyncPair(
    pair: DevOpsSyncPair,
    containerClient: ContainerClient,
  ): Promise<RepoReplicationResult> {
    const totalStart = Date.now();
    const repoIdentifier = `${pair.source.organization}/${pair.source.project}/${pair.source.repository}`;

    const credentials: DevOpsClientCredentials = {
      pat: pair.source.pat,
      patExpiry: pair.source.patExpiry,
      orgUrl: pair.source.orgUrl,
    };
    const devopsClient = new DevOpsClientService(credentials, this.logger);
    devopsClient.validateAuth();

    const archiveStream = await devopsClient.getArchiveStream(
      pair.source.organization,
      pair.source.project,
      pair.source.repository,
      pair.source.ref,
      pair.source.versionType,
      pair.source.resolveLfs,
    );

    const streamStart = Date.now();
    const stats = await this.streamZipToBlob(
      archiveStream,
      pair.destination.folder,
      repoIdentifier,
      containerClient,  // Per-pair container client
    );
    const streamingDurationMs = Date.now() - streamStart;

    return {
      platform: "azure-devops",
      source: repoIdentifier,
      ref: pair.source.ref ?? "default",
      destPath: pair.destination.folder,
      totalFiles: stats.totalFiles,
      successCount: stats.successCount,
      failedCount: stats.failedCount,
      totalBytes: stats.totalBytes,
      streamingDurationMs,
      totalDurationMs: Date.now() - totalStart,
      failedFiles: stats.failedCount > 0 ? stats.failedFiles : undefined,
    };
  }

  // -----------------------------------------------------------------------
  // Tar streaming pipeline (GitHub)
  // -----------------------------------------------------------------------

  /**
   * Stream a gzipped tarball into Azure Blob Storage.
   *
   * Pipeline: archiveStream -> gunzip -> tar-stream extract -> per-entry upload
   *
   * The first path component of each tar entry is stripped (GitHub adds an
   * "owner-repo-sha/" prefix to every entry).
   */
  private async streamTarToBlob(
    archiveStream: Readable,
    destPath: string,
    repoIdentifier: string,
    containerClient?: ContainerClient,
  ): Promise<StreamingStats> {
    const client = containerClient ?? this.containerClient;
    const stats: StreamingStats = {
      totalFiles: 0,
      successCount: 0,
      failedCount: 0,
      totalBytes: 0,
      failedFiles: [],
    };

    const extract = tarStream.extract();
    const gunzip = zlib.createGunzip();

    return new Promise<StreamingStats>((resolve, reject) => {
      let streamErrorHandled = false;

      const handleError = (err: Error): void => {
        if (streamErrorHandled) return;
        streamErrorHandled = true;
        reject(
          RepoReplicationError.extractionFailed(
            "GitHub",
            repoIdentifier,
            err.message,
          ),
        );
      };

      archiveStream.on("error", handleError);
      gunzip.on("error", handleError);
      extract.on("error", handleError);

      extract.on(
        "entry",
        (header: tarStream.Headers, entryStream: Readable, next: () => void) => {
          // Skip non-file entries (directories, symlinks, etc.)
          if (header.type !== "file") {
            entryStream.resume();
            next();
            return;
          }

          const strippedPath = this.stripFirstComponent(header.name);

          // Skip entries with empty paths after stripping
          if (!strippedPath) {
            entryStream.resume();
            next();
            return;
          }

          // Path traversal protection
          if (!this.isPathSafe(strippedPath)) {
            this.logger.warn(
              `Skipping unsafe path in archive: ${header.name}`,
            );
            entryStream.resume();
            next();
            return;
          }

          const blobPath = normalizePath(destPath + "/" + strippedPath);
          stats.totalFiles++;

          this.uploadEntryToBlob(client, blobPath, entryStream, header.size)
            .then((result) => {
              if (result.success) {
                stats.successCount++;
                stats.totalBytes += result.size;
                this.logger.debug(
                  `Uploaded: ${blobPath} (${result.size} bytes)`,
                );
              } else {
                stats.failedCount++;
                stats.failedFiles.push({
                  repoPath: strippedPath,
                  blobPath,
                  size: 0,
                  success: false,
                  error: result.error,
                });
                this.logger.warn(
                  `Failed to upload ${blobPath}: ${result.error}`,
                );
              }
              next();
            })
            .catch((err: Error) => {
              stats.failedCount++;
              stats.failedFiles.push({
                repoPath: strippedPath,
                blobPath,
                size: 0,
                success: false,
                error: err.message,
              });
              this.logger.warn(`Failed to upload ${blobPath}: ${err.message}`);
              next();
            });
        },
      );

      extract.on("finish", () => {
        if (!streamErrorHandled) {
          resolve(stats);
        }
      });

      // Wire up the pipeline: archive -> gunzip -> tar extract
      archiveStream.pipe(gunzip).pipe(extract);
    });
  }

  // -----------------------------------------------------------------------
  // Zip streaming pipeline (Azure DevOps)
  // -----------------------------------------------------------------------

  /**
   * Stream a zip archive into Azure Blob Storage.
   *
   * Pipeline: archiveStream -> unzipper.Parse() -> per-entry upload
   *
   * Unlike the tar pipeline, Azure DevOps zip entries do not have a prefix
   * directory to strip.
   */
  private async streamZipToBlob(
    archiveStream: Readable,
    destPath: string,
    repoIdentifier: string,
    containerClient?: ContainerClient,
  ): Promise<StreamingStats> {
    const client = containerClient ?? this.containerClient;
    const stats: StreamingStats = {
      totalFiles: 0,
      successCount: 0,
      failedCount: 0,
      totalBytes: 0,
      failedFiles: [],
    };

    const parser = unzipper.Parse();

    return new Promise<StreamingStats>((resolve, reject) => {
      let streamErrorHandled = false;
      const pendingUploads: Promise<void>[] = [];

      const handleError = (err: Error): void => {
        if (streamErrorHandled) return;
        streamErrorHandled = true;
        reject(
          RepoReplicationError.extractionFailed(
            "Azure DevOps",
            repoIdentifier,
            err.message,
          ),
        );
      };

      archiveStream.on("error", handleError);
      parser.on("error", handleError);

      parser.on("entry", (entry: unzipper.Entry) => {
        // Skip directories
        if (entry.type === "Directory") {
          entry.autodrain();
          return;
        }

        const entryPath = entry.path;

        // Path traversal protection
        if (!this.isPathSafe(entryPath)) {
          this.logger.warn(
            `Skipping unsafe path in archive: ${entryPath}`,
          );
          entry.autodrain();
          return;
        }

        const blobPath = normalizePath(destPath + "/" + entryPath);
        // uncompressedSize exists at runtime but is missing from @types/unzipper
        const vars = entry.vars as Record<string, unknown>;
        const size = typeof vars["uncompressedSize"] === "number"
          ? vars["uncompressedSize"]
          : undefined;
        stats.totalFiles++;

        // Convert the Entry to a Readable for uploadEntryToBlob
        const entryAsReadable = entry as unknown as Readable;

        // Track the upload promise so we can await all uploads before resolving
        const uploadPromise = this.uploadEntryToBlob(client, blobPath, entryAsReadable, size)
          .then((result) => {
            if (result.success) {
              stats.successCount++;
              stats.totalBytes += result.size;
              this.logger.debug(
                `Uploaded: ${blobPath} (${result.size} bytes)`,
              );
            } else {
              stats.failedCount++;
              stats.failedFiles.push({
                repoPath: entryPath,
                blobPath,
                size: 0,
                success: false,
                error: result.error,
              });
              this.logger.warn(
                `Failed to upload ${blobPath}: ${result.error}`,
              );
            }
          })
          .catch((err: Error) => {
            stats.failedCount++;
            stats.failedFiles.push({
              repoPath: entryPath,
              blobPath,
              size: 0,
              success: false,
              error: err.message,
            });
            this.logger.warn(
              `Failed to upload ${blobPath}: ${err.message}`,
            );
          });
        pendingUploads.push(uploadPromise);
      });

      parser.on("close", () => {
        if (streamErrorHandled) return;
        // Wait for all in-flight uploads to complete before resolving
        Promise.all(pendingUploads).then(() => {
          if (!streamErrorHandled) {
            resolve(stats);
          }
        });
      });

      // Wire up the pipeline
      archiveStream.pipe(parser);
    });
  }

  // -----------------------------------------------------------------------
  // Upload helpers
  // -----------------------------------------------------------------------

  /**
   * Upload a single archive entry stream to Azure Blob Storage.
   *
   * Small files (< 4 MB, when size is known) are buffered into memory and
   * uploaded in a single `upload()` call. Larger or unknown-size files are
   * streamed via `uploadStream()`.
   */
  private async uploadEntryToBlob(
    containerClient: ContainerClient,
    blobPath: string,
    entryStream: Readable,
    size?: number,
  ): Promise<{ success: boolean; size: number; error?: string }> {
    try {
      const blockBlobClient =
        containerClient.getBlockBlobClient(blobPath);

      if (size !== undefined && size < SMALL_FILE_THRESHOLD) {
        // Small file: buffer and upload in one call
        const chunks: Buffer[] = [];
        for await (const chunk of entryStream) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const buffer = Buffer.concat(chunks);

        await blockBlobClient.upload(buffer, buffer.length);

        return { success: true, size: buffer.length };
      } else {
        // Large or unknown-size file: stream upload with byte counting
        let bytesWritten = 0;
        const counter = new Transform({
          transform(chunk, _encoding, callback) {
            bytesWritten += chunk.length;
            callback(null, chunk);
          },
        });

        await blockBlobClient.uploadStream(entryStream.pipe(counter));

        return { success: true, size: bytesWritten };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, size: 0, error: message };
    }
  }

  // -----------------------------------------------------------------------
  // Path helpers
  // -----------------------------------------------------------------------

  /**
   * Strip the first path component from a tar entry path.
   *
   * GitHub tarballs prefix every entry with "owner-repo-sha/", e.g.:
   *   "owner-repo-abc123/src/index.ts" -> "src/index.ts"
   *   "owner-repo-abc123/" -> ""
   */
  private stripFirstComponent(entryPath: string): string {
    const slashIndex = entryPath.indexOf("/");
    if (slashIndex === -1) {
      return entryPath;
    }
    return entryPath.substring(slashIndex + 1);
  }

  /**
   * Check whether an archive entry path is safe (no path traversal).
   *
   * @returns false if the path contains ".." components or starts with "/"
   */
  private isPathSafe(entryPath: string): boolean {
    if (entryPath.startsWith("/")) {
      return false;
    }

    const segments = entryPath.split("/");
    return !segments.some((segment) => segment === "..");
  }

  /**
   * Parse a GitHub repo string in "owner/repo" format.
   *
   * @throws RepoReplicationError if the format is invalid
   */
  private parseGitHubRepo(repo: string): [string, string] {
    const parts = repo.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw RepoReplicationError.missingParams([
        'repo (must be in "owner/repo" format)',
      ]);
    }
    return [parts[0], parts[1]];
  }
}
