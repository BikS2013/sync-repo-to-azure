import { BlobServiceClient } from "@azure/storage-blob";
import { BlobSearchError } from "../errors/blob-search.error";
import { Logger } from "../utils/logger.utils";

/**
 * Parameters for searching blobs by metadata tags.
 */
export interface BlobSearchParams {
  /** Filter by source_registry tag (exact match). */
  sourceRegistry?: string;
  /** Filter by source_path tag (exact match). */
  sourcePath?: string;
  /** Filter by sync_time tag >= this ISO 8601 date. */
  syncTimeFrom?: string;
  /** Filter by sync_time tag <= this ISO 8601 date. */
  syncTimeTo?: string;
  /** Restrict search to a specific container. */
  containerName?: string;
  /** Maximum number of results to return (1-5000, default 100). */
  maxResults?: number;
}

/**
 * A single blob found by tag search.
 */
export interface BlobSearchResultItem {
  blobName: string;
  containerName: string;
  tags: Record<string, string>;
}

/**
 * Result of a blob tag search operation.
 */
export interface BlobSearchResult {
  items: BlobSearchResultItem[];
  totalFound: number;
  truncated: boolean;
  filterQuery: string;
}

/**
 * Service for searching blobs in Azure Blob Storage by their metadata tags.
 *
 * Uses the Azure Blob Storage "Find Blobs by Tags" API which queries the
 * blob index (secondary index on blob tags). Requires the storage account
 * to have blob index tags enabled.
 */
export class BlobSearchService {
  constructor(
    private readonly blobServiceClient: BlobServiceClient,
    private readonly logger: Logger,
  ) {}

  /**
   * Search for blobs by their metadata tags.
   *
   * At least one search parameter (sourceRegistry, sourcePath, syncTimeFrom,
   * or syncTimeTo) must be provided. Results are limited to maxResults (default 100).
   *
   * @param params - Search parameters.
   * @returns Search results with matching blob metadata.
   */
  async searchByTags(params: BlobSearchParams): Promise<BlobSearchResult> {
    this.validateParams(params);
    const filterQuery = this.buildFilterQuery(params);
    this.logger.debug(`Searching blobs with filter: ${filterQuery}`);

    const maxResults = params.maxResults ?? 100;
    const items: BlobSearchResultItem[] = [];

    try {
      const iterator = this.blobServiceClient.findBlobsByTags(filterQuery);
      for await (const blob of iterator) {
        if (items.length >= maxResults) {
          return { items, totalFound: items.length, truncated: true, filterQuery };
        }
        items.push({
          blobName: blob.name,
          containerName: blob.containerName,
          tags: blob.tags ? { ...blob.tags } : {},
        });
      }
    } catch (error) {
      throw BlobSearchError.searchFailed(
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error : undefined,
      );
    }

    return { items, totalFound: items.length, truncated: false, filterQuery };
  }

  /**
   * Validate that at least one search parameter is provided and that
   * date parameters are valid ISO 8601 strings.
   */
  private validateParams(params: BlobSearchParams): void {
    if (
      !params.sourceRegistry &&
      !params.sourcePath &&
      !params.syncTimeFrom &&
      !params.syncTimeTo
    ) {
      throw BlobSearchError.missingParams(
        "At least one of sourceRegistry, sourcePath, syncTimeFrom, or syncTimeTo is required",
      );
    }
    if (params.syncTimeFrom && isNaN(Date.parse(params.syncTimeFrom))) {
      throw BlobSearchError.invalidParam(
        "syncTimeFrom",
        "Must be a valid ISO 8601 date string",
      );
    }
    if (params.syncTimeTo && isNaN(Date.parse(params.syncTimeTo))) {
      throw BlobSearchError.invalidParam(
        "syncTimeTo",
        "Must be a valid ISO 8601 date string",
      );
    }
    if (
      params.maxResults !== undefined &&
      (params.maxResults < 1 || params.maxResults > 5000)
    ) {
      throw BlobSearchError.invalidParam(
        "maxResults",
        "Must be between 1 and 5000",
      );
    }
  }

  /**
   * Build an OData-style filter query for the Azure "Find Blobs by Tags" API.
   *
   * Tag names are double-quoted and tag values are single-quoted, as per
   * the Azure Blob Storage tag query syntax.
   */
  private buildFilterQuery(params: BlobSearchParams): string {
    const conditions: string[] = [];

    if (params.sourceRegistry) {
      conditions.push(
        `"source_registry" = '${this.escapeTagValue(params.sourceRegistry)}'`,
      );
    }
    if (params.sourcePath) {
      conditions.push(
        `"source_path" = '${this.escapeTagValue(params.sourcePath)}'`,
      );
    }
    if (params.syncTimeFrom) {
      conditions.push(
        `"sync_time" >= '${this.escapeTagValue(params.syncTimeFrom)}'`,
      );
    }
    if (params.syncTimeTo) {
      conditions.push(
        `"sync_time" <= '${this.escapeTagValue(params.syncTimeTo)}'`,
      );
    }
    if (params.containerName) {
      conditions.push(
        `@container = '${this.escapeTagValue(params.containerName)}'`,
      );
    }

    return conditions.join(" AND ");
  }

  /**
   * Escape single quotes in tag values by doubling them.
   */
  private escapeTagValue(value: string): string {
    return value.replace(/'/g, "''");
  }
}
