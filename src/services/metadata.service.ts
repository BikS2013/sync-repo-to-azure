import { ContainerClient } from "@azure/storage-blob";
import { ResolvedConfig } from "../types/config.types";
import { MetadataResult, TagResult, TagQueryResult, TagQueryMatch } from "../types/metadata.types";
import { createContainerClient } from "./auth.service";
import { validatePath } from "./path.service";
import { BlobNotFoundError } from "../errors/blob-not-found.error";
import {
  validateMetadataKey,
  validateMetadataSize,
  validateTagCount,
} from "../utils/validation.utils";
import { withRetry, retryConfigFromResolved, RetryConfig } from "../utils/retry.utils";
import { Logger } from "../utils/logger.utils";

/**
 * Service for blob metadata and index tag operations.
 *
 * Metadata: arbitrary user-defined key-value pairs stored as blob properties.
 * Tags: blob index tags used for server-side filtering/querying.
 */
export class MetadataService {
  private readonly containerClient: ContainerClient;
  private readonly logger: Logger;
  private readonly retryConfig: RetryConfig;

  constructor(config: ResolvedConfig, logger: Logger) {
    this.containerClient = createContainerClient(config);
    this.retryConfig = retryConfigFromResolved(config);
    this.logger = logger;
  }

  // ─── Metadata operations ───────────────────────────────────────────

  /**
   * Set (replace all) metadata on a blob.
   * Validates key names and total size before writing.
   */
  async setMetadata(
    remotePath: string,
    metadata: Record<string, string>,
  ): Promise<MetadataResult> {
    const normalizedPath = validatePath(remotePath);
    const blobClient = this.containerClient.getBlobClient(normalizedPath);

    // Validate every key
    for (const key of Object.keys(metadata)) {
      validateMetadataKey(key);
    }
    validateMetadataSize(metadata);

    this.logger.logRequest("setMetadata", { remotePath: normalizedPath, metadata });

    return withRetry(async () => {
      await this.ensureBlobExists(normalizedPath);
      await blobClient.setMetadata(metadata);

      return { path: normalizedPath, metadata };
    }, this.retryConfig);
  }

  /**
   * Get all metadata from a blob.
   */
  async getMetadata(remotePath: string): Promise<MetadataResult> {
    const normalizedPath = validatePath(remotePath);
    const blobClient = this.containerClient.getBlobClient(normalizedPath);

    this.logger.logRequest("getMetadata", { remotePath: normalizedPath });

    return withRetry(async () => {
      try {
        const properties = await blobClient.getProperties();
        const metadata = (properties.metadata as Record<string, string>) ?? {};
        return { path: normalizedPath, metadata };
      } catch (error) {
        if (this.is404(error)) {
          throw new BlobNotFoundError(normalizedPath);
        }
        throw error;
      }
    }, this.retryConfig);
  }

  /**
   * Merge partial metadata into the existing metadata on a blob.
   * Existing keys not present in `partial` are preserved.
   */
  async updateMetadata(
    remotePath: string,
    partial: Record<string, string>,
  ): Promise<MetadataResult> {
    const normalizedPath = validatePath(remotePath);
    const blobClient = this.containerClient.getBlobClient(normalizedPath);

    // Validate new keys
    for (const key of Object.keys(partial)) {
      validateMetadataKey(key);
    }

    this.logger.logRequest("updateMetadata", { remotePath: normalizedPath, partial });

    return withRetry(async () => {
      // Get existing metadata
      const properties = await blobClient.getProperties().catch((err) => {
        if (this.is404(err)) {
          throw new BlobNotFoundError(normalizedPath);
        }
        throw err;
      });

      const existing = (properties.metadata as Record<string, string>) ?? {};
      const merged = { ...existing, ...partial };

      validateMetadataSize(merged);
      await blobClient.setMetadata(merged);

      return { path: normalizedPath, metadata: merged };
    }, this.retryConfig);
  }

  /**
   * Delete specific metadata keys from a blob.
   * Keys not present in `keys` are preserved.
   */
  async deleteMetadata(
    remotePath: string,
    keys: string[],
  ): Promise<MetadataResult> {
    const normalizedPath = validatePath(remotePath);
    const blobClient = this.containerClient.getBlobClient(normalizedPath);

    this.logger.logRequest("deleteMetadata", { remotePath: normalizedPath, keys });

    return withRetry(async () => {
      const properties = await blobClient.getProperties().catch((err) => {
        if (this.is404(err)) {
          throw new BlobNotFoundError(normalizedPath);
        }
        throw err;
      });

      const existing = { ...((properties.metadata as Record<string, string>) ?? {}) };
      for (const key of keys) {
        delete existing[key];
      }

      await blobClient.setMetadata(existing);

      return { path: normalizedPath, metadata: existing };
    }, this.retryConfig);
  }

  // ─── Tag operations ────────────────────────────────────────────────

  /**
   * Set (replace all) blob index tags on a blob.
   * Validates tag count before writing.
   */
  async setTags(
    remotePath: string,
    tags: Record<string, string>,
  ): Promise<TagResult> {
    const normalizedPath = validatePath(remotePath);
    const blobClient = this.containerClient.getBlobClient(normalizedPath);

    validateTagCount(tags);

    this.logger.logRequest("setTags", { remotePath: normalizedPath, tags });

    return withRetry(async () => {
      await this.ensureBlobExists(normalizedPath);
      await blobClient.setTags(tags);

      return { path: normalizedPath, tags };
    }, this.retryConfig);
  }

  /**
   * Get all blob index tags from a blob.
   */
  async getTags(remotePath: string): Promise<TagResult> {
    const normalizedPath = validatePath(remotePath);
    const blobClient = this.containerClient.getBlobClient(normalizedPath);

    this.logger.logRequest("getTags", { remotePath: normalizedPath });

    return withRetry(async () => {
      try {
        const response = await blobClient.getTags();
        return { path: normalizedPath, tags: response.tags };
      } catch (error) {
        if (this.is404(error)) {
          throw new BlobNotFoundError(normalizedPath);
        }
        throw error;
      }
    }, this.retryConfig);
  }

  /**
   * Query blobs by an OData tag filter expression.
   * Example filter: "env = 'prod' AND project = 'alpha'"
   */
  async queryByTags(tagFilter: string): Promise<TagQueryResult> {
    this.logger.logRequest("queryByTags", { filter: tagFilter });

    return withRetry(async () => {
      const matches: TagQueryMatch[] = [];

      for await (const blob of this.containerClient.findBlobsByTags(tagFilter)) {
        matches.push({
          name: blob.name,
          tags: blob.tags ?? {},
        });
      }

      return { filter: tagFilter, matches };
    }, this.retryConfig);
  }

  // ─── Private helpers ───────────────────────────────────────────────

  /**
   * Ensure the blob exists; throw BlobNotFoundError if not.
   */
  private async ensureBlobExists(normalizedPath: string): Promise<void> {
    const blobClient = this.containerClient.getBlobClient(normalizedPath);
    const exists = await blobClient.exists();
    if (!exists) {
      throw new BlobNotFoundError(normalizedPath);
    }
  }

  /**
   * Check if an error is a 404 (blob not found) from the Azure SDK.
   */
  private is404(error: unknown): boolean {
    return (
      error !== null &&
      typeof error === "object" &&
      (error as Record<string, unknown>)["statusCode"] === 404
    );
  }
}
