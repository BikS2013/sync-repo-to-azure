# Plan 011 - Blob Metadata and Index Tags: Technical Design

**Date**: 2026-03-02
**Status**: Draft
**Based on**: plan-011-blob-metadata-and-tags.md, codebase-analysis-blob-metadata.md

---

## 1. Overview

This document specifies the exact code changes required to implement blob metadata, blob index tags, a blob search service, a search API endpoint, and a search CLI command. Every change is described with the target file, symbol name path, operation type, and the full TypeScript code.

---

## 2. New Type Definitions

### 2.1 `BlobUploadMetadata` Interface

**File**: `src/types/repo-replication.types.ts`
**Operation**: `insert_after_symbol` after `RepoFileUploadResult`
**Symbol path**: `RepoFileUploadResult`

```typescript
/** Metadata and tags applied to each blob during upload */
export interface BlobUploadMetadata {
  /** Source registry identifier (e.g., "owner/repo" or "org/project/repo") */
  source_registry: string;
  /** File path within the source repository */
  source_path: string;
  /** ISO 8601 timestamp of the sync operation */
  sync_time: string;
}
```

**Rationale**: Placed after `RepoFileUploadResult` (line 63) to group all per-file types together. Uses underscore-cased keys because Azure Blob metadata keys must be valid C# identifiers (no hyphens allowed).

### 2.2 `BlobSearchParams` Interface

**File**: `src/services/blob-search.service.ts` (new file -- see Section 6)
**Operation**: Defined within the new service file, not in `repo-replication.types.ts`, because search types are only used by the search service and its consumers (controller + CLI command). This avoids coupling the replication types module to search concerns.

```typescript
/** Parameters for searching blobs by tags */
export interface BlobSearchParams {
  /** Filter by source registry (exact match) */
  sourceRegistry?: string;
  /** Filter by source path (exact match) */
  sourcePath?: string;
  /** Filter by sync time (greater than or equal to, ISO 8601) */
  syncTimeFrom?: string;
  /** Filter by sync time (less than or equal to, ISO 8601) */
  syncTimeTo?: string;
  /** Maximum number of results to return (default: 100, max: 5000) */
  maxResults?: number;
}
```

### 2.3 `BlobSearchResultItem` and `BlobSearchResult` Interfaces

**File**: `src/services/blob-search.service.ts` (same new file)

```typescript
/** Individual blob search result */
export interface BlobSearchResultItem {
  /** Blob name (full path in container) */
  blobName: string;
  /** Container name */
  containerName: string;
  /** Tags associated with the blob */
  tags: Record<string, string>;
}

/** Aggregate search result */
export interface BlobSearchResult {
  /** Number of matching blobs returned */
  count: number;
  /** Whether more results are available beyond maxResults */
  truncated: boolean;
  /** Matching blobs */
  blobs: BlobSearchResultItem[];
  /** The tag filter SQL query that was executed */
  filterQuery: string;
  /** Duration of the search operation in milliseconds */
  durationMs: number;
}
```

### 2.4 Type Export Update

**File**: `src/types/index.ts`
**Operation**: `edit` -- add `BlobUploadMetadata` to the `repo-replication.types` export block
**Symbol path**: The export block starting at line 24

**Before** (line 24-52):
```typescript
export {
  RepoPlatform,
  DevOpsVersionType,
  DevOpsAuthMethod,
  GitHubRepoParams,
  DevOpsRepoParams,
  RepoFileUploadResult,
  RepoReplicationResult,
  GitHubRepoInfo,
  GitHubRepoConfig,
  DevOpsRepoConfig,
  SyncPairDestination,
  GitHubSyncPairSource,
  DevOpsSyncPairSource,
  GitHubSyncPair,
  DevOpsSyncPair,
  SyncPair,
  SyncPairConfig,
  SyncPairItemResult,
  SyncPairBatchResult,
} from "./repo-replication.types";
```

**After**:
```typescript
export {
  RepoPlatform,
  DevOpsVersionType,
  DevOpsAuthMethod,
  GitHubRepoParams,
  DevOpsRepoParams,
  RepoFileUploadResult,
  RepoReplicationResult,
  BlobUploadMetadata,
  GitHubRepoInfo,
  GitHubRepoConfig,
  DevOpsRepoConfig,
  SyncPairDestination,
  GitHubSyncPairSource,
  DevOpsSyncPairSource,
  GitHubSyncPair,
  DevOpsSyncPair,
  SyncPair,
  SyncPairConfig,
  SyncPairItemResult,
  SyncPairBatchResult,
} from "./repo-replication.types";
```

**Impact**: Any module importing from `../types` or `../types/index` can now access `BlobUploadMetadata`.

---

## 3. Modified `uploadEntryToBlob()`

**File**: `src/services/repo-replication.service.ts`
**Symbol path**: `RepoReplicationService/uploadEntryToBlob`
**Operation**: `replace_symbol_body`

### 3.1 Signature Change

**Before** (line 690-695):
```typescript
private async uploadEntryToBlob(
    containerClient: ContainerClient,
    blobPath: string,
    entryStream: Readable,
    size?: number,
): Promise<{ success: boolean; size: number; error?: string }>
```

**After**:
```typescript
private async uploadEntryToBlob(
    containerClient: ContainerClient,
    blobPath: string,
    entryStream: Readable,
    size?: number,
    blobMetadata?: BlobUploadMetadata,
): Promise<{ success: boolean; size: number; error?: string }>
```

### 3.2 Full Replacement Body

The complete new method body (replacing lines 690-729):

```typescript
private async uploadEntryToBlob(
    containerClient: ContainerClient,
    blobPath: string,
    entryStream: Readable,
    size?: number,
    blobMetadata?: BlobUploadMetadata,
): Promise<{ success: boolean; size: number; error?: string }> {
    try {
      const blockBlobClient =
        containerClient.getBlockBlobClient(blobPath);

      // Build metadata and tags from the blob metadata if provided
      const metadata: Record<string, string> | undefined = blobMetadata
        ? {
            source_registry: blobMetadata.source_registry,
            source_path: blobMetadata.source_path,
            sync_time: blobMetadata.sync_time,
          }
        : undefined;

      const tags: Record<string, string> | undefined = blobMetadata
        ? {
            source_registry: blobMetadata.source_registry,
            source_path: blobMetadata.source_path.length <= 256
              ? blobMetadata.source_path
              : blobMetadata.source_path.substring(0, 256),
            sync_time: blobMetadata.sync_time,
          }
        : undefined;

      if (size !== undefined && size < SMALL_FILE_THRESHOLD) {
        // Small file: buffer and upload in one call
        const chunks: Buffer[] = [];
        for await (const chunk of entryStream) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const buffer = Buffer.concat(chunks);

        try {
          await blockBlobClient.upload(buffer, buffer.length, { metadata, tags });
        } catch (uploadErr: unknown) {
          // Graceful degradation: if tags fail (e.g., SAS token lacks tag permissions),
          // retry without tags but keep metadata
          if (tags && this.isTagPermissionError(uploadErr)) {
            this.logger.warn(
              `Tag permission denied for ${blobPath}, retrying upload with metadata only`,
            );
            await blockBlobClient.upload(buffer, buffer.length, { metadata });
          } else {
            throw uploadErr;
          }
        }

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

        try {
          await blockBlobClient.uploadStream(
            entryStream.pipe(counter),
            undefined,
            undefined,
            { metadata, tags },
          );
        } catch (uploadErr: unknown) {
          // Graceful degradation for stream uploads:
          // For large files, we cannot re-stream the original entryStream (already consumed).
          // If tag permission fails, we set tags separately after upload without tags.
          if (tags && this.isTagPermissionError(uploadErr)) {
            this.logger.warn(
              `Tag permission denied for ${blobPath} during stream upload. ` +
              `Tags will not be set on this blob. Metadata was included in the upload.`,
            );
            // Re-attempt without tags -- but stream is consumed, so we must
            // accept that this blob has no tags. Metadata was already part of
            // the failed request, so we need to re-upload. Since the stream
            // is consumed, we propagate the error for large files.
            // NOTE: For the stream path, if the upload itself failed, the blob
            // may not have been created. We let the error propagate.
            throw uploadErr;
          } else {
            throw uploadErr;
          }
        }

        return { success: true, size: bytesWritten };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, size: 0, error: message };
    }
  }
```

### 3.3 New Helper Method: `isTagPermissionError()`

**File**: `src/services/repo-replication.service.ts`
**Operation**: `insert_after_symbol` after `uploadEntryToBlob`
**Symbol path**: `RepoReplicationService/uploadEntryToBlob`

```typescript
/**
 * Check if an error is a tag permission error from Azure Blob Storage.
 *
 * Tag operations require the 't' (tag) permission on SAS tokens.
 * When missing, Azure returns a 403 with "AuthorizationPermissionMismatch"
 * or a status code 403 with error code "AuthorizationPermissionMismatch".
 */
private isTagPermissionError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const message = err.message.toLowerCase();
    return (
      message.includes("authorizationpermissionmismatch") ||
      message.includes("tags are not supported") ||
      (message.includes("403") && message.includes("tag"))
    );
  }
```

### 3.4 Import Addition

**File**: `src/services/repo-replication.service.ts`
**Operation**: `edit` -- add `BlobUploadMetadata` to the import block (line 12-23)

**Before** (line 12-23):
```typescript
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
```

**After**:
```typescript
import {
  GitHubRepoParams,
  DevOpsRepoParams,
  RepoReplicationResult,
  RepoFileUploadResult,
  BlobUploadMetadata,
  SyncPairConfig,
  SyncPair,
  GitHubSyncPair,
  DevOpsSyncPair,
  SyncPairItemResult,
  SyncPairBatchResult,
} from "../types/repo-replication.types";
```

### 3.5 Impact on Callers

The new `blobMetadata` parameter is **optional**, so both existing call sites in `streamTarToBlob()` and `streamZipToBlob()` continue to compile without changes. However, they will be modified in Sections 4 and 5 to pass the metadata.

---

## 4. Modified `streamTarToBlob()` (GitHub)

**File**: `src/services/repo-replication.service.ts`
**Symbol path**: `RepoReplicationService/streamTarToBlob`
**Operation**: Targeted edits within the existing method body (not a full replace)

### 4.1 Add `syncTime` Capture

**Location**: After `const stats: StreamingStats` initialization (after line 443), before the `const extract` line.

**Insert** (between `failedFiles: [],` closing brace and `const extract`):
```typescript
    // Capture batch-level sync time for all files in this archive
    const syncTime = new Date().toISOString();
```

### 4.2 Construct Metadata and Pass to `uploadEntryToBlob()`

**Location**: Inside `extract.on("entry", ...)` handler, around the `uploadEntryToBlob` call (line 499).

**Before** (line 499):
```typescript
          this.uploadEntryToBlob(client, blobPath, entryStream, header.size)
```

**After**:
```typescript
          const blobMetadata: BlobUploadMetadata = {
            source_registry: repoIdentifier,
            source_path: strippedPath,
            sync_time: syncTime,
          };

          this.uploadEntryToBlob(client, blobPath, entryStream, header.size, blobMetadata)
```

### 4.3 Impact

- No signature change to `streamTarToBlob()` itself.
- Every GitHub file upload now includes metadata and tags.
- `syncTime` is captured once at method start, ensuring all files in a single replication share the same timestamp.

---

## 5. Modified `streamZipToBlob()` (Azure DevOps)

**File**: `src/services/repo-replication.service.ts`
**Symbol path**: `RepoReplicationService/streamZipToBlob`
**Operation**: Targeted edits within the existing method body

### 5.1 Add `syncTime` Capture

**Location**: After `const stats: StreamingStats` initialization (after line 573), before the `const parser` line.

**Insert** (between `failedFiles: [],` closing brace and `const parser`):
```typescript
    // Capture batch-level sync time for all files in this archive
    const syncTime = new Date().toISOString();
```

### 5.2 Construct Metadata and Pass to `uploadEntryToBlob()`

**Location**: Inside `parser.on("entry", ...)` handler, around the `uploadEntryToBlob` call (line 626).

**Before** (line 626):
```typescript
        const uploadPromise = this.uploadEntryToBlob(client, blobPath, entryAsReadable, size)
```

**After**:
```typescript
        const blobMetadata: BlobUploadMetadata = {
          source_registry: repoIdentifier,
          source_path: entryPath,
          sync_time: syncTime,
        };

        const uploadPromise = this.uploadEntryToBlob(client, blobPath, entryAsReadable, size, blobMetadata)
```

### 5.3 Impact

- No signature change to `streamZipToBlob()` itself.
- Every Azure DevOps file upload now includes metadata and tags.
- `syncTime` is captured once at method start.

---

## 6. New `BlobSearchService`

**File**: `src/services/blob-search.service.ts` (new file)
**Operation**: Create new file

### 6.1 Full File Content

```typescript
import { BlobServiceClient } from "@azure/storage-blob";
import { Logger } from "../utils/logger.utils";
import { BlobSearchError } from "../errors/blob-search.error";

// ---------------------------------------------------------------------------
// Search types
// ---------------------------------------------------------------------------

/** Parameters for searching blobs by tags */
export interface BlobSearchParams {
  /** Filter by source registry (exact match) */
  sourceRegistry?: string;
  /** Filter by source path (exact match) */
  sourcePath?: string;
  /** Filter by sync time (greater than or equal to, ISO 8601) */
  syncTimeFrom?: string;
  /** Filter by sync time (less than or equal to, ISO 8601) */
  syncTimeTo?: string;
  /** Maximum number of results to return (default: 100, max: 5000) */
  maxResults?: number;
}

/** Individual blob search result */
export interface BlobSearchResultItem {
  /** Blob name (full path in container) */
  blobName: string;
  /** Container name */
  containerName: string;
  /** Tags associated with the blob */
  tags: Record<string, string>;
}

/** Aggregate search result */
export interface BlobSearchResult {
  /** Number of matching blobs returned */
  count: number;
  /** Whether more results are available beyond maxResults */
  truncated: boolean;
  /** Matching blobs */
  blobs: BlobSearchResultItem[];
  /** The tag filter SQL query that was executed */
  filterQuery: string;
  /** Duration of the search operation in milliseconds */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Service for searching blobs by index tags.
 *
 * Uses `BlobServiceClient.findBlobsByTags()` which executes SQL-like
 * tag filter queries across the entire storage account.
 *
 * **Important**: Blob index tags have eventual consistency. Recently uploaded
 * blobs may not appear in search results for several minutes.
 *
 * **Authentication requirement**: `findBlobsByTags()` requires storage-account-level
 * authentication. Container-scoped SAS tokens will NOT work for this operation.
 */
export class BlobSearchService {
  constructor(
    private readonly blobServiceClient: BlobServiceClient,
    private readonly logger: Logger,
  ) {}

  /**
   * Search blobs by index tags.
   *
   * Builds a tag filter SQL query from the provided parameters
   * and executes it via `findBlobsByTags()`.
   *
   * @throws BlobSearchError if no filter criteria are provided
   * @throws BlobSearchError if the search operation fails
   */
  async searchByTags(params: BlobSearchParams): Promise<BlobSearchResult> {
    const startTime = Date.now();

    // Validate that at least one filter is provided
    if (!params.sourceRegistry && !params.sourcePath && !params.syncTimeFrom && !params.syncTimeTo) {
      throw BlobSearchError.missingParams();
    }

    // Validate maxResults range
    const maxResults = params.maxResults ?? 100;
    if (maxResults < 1 || maxResults > 5000) {
      throw BlobSearchError.invalidParam(
        "maxResults",
        `Must be between 1 and 5000, got ${maxResults}`,
      );
    }

    const filterQuery = this.buildFilterQuery(params);

    this.logger.debug(`Searching blobs with tag filter: ${filterQuery}`);

    try {
      const blobs: BlobSearchResultItem[] = [];
      let truncated = false;

      const iter = this.blobServiceClient.findBlobsByTags(filterQuery);
      for await (const item of iter) {
        if (blobs.length >= maxResults) {
          truncated = true;
          break;
        }
        blobs.push({
          blobName: item.name,
          containerName: item.containerName,
          tags: item.tags ?? {},
        });
      }

      const result: BlobSearchResult = {
        count: blobs.length,
        truncated,
        blobs,
        filterQuery,
        durationMs: Date.now() - startTime,
      };

      this.logger.info(
        `Tag search returned ${result.count} blobs (truncated: ${truncated}) in ${result.durationMs}ms`,
      );

      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Blob tag search failed: ${message}`);
      throw BlobSearchError.searchFailed(message);
    }
  }

  /**
   * Build a tag filter SQL query from search parameters.
   *
   * Uses the Azure Blob index tag query syntax:
   *   "tagKey" = 'tagValue' AND "tagKey2" >= 'value2'
   *
   * Values are escaped to prevent SQL injection in tag filter queries
   * by replacing single quotes with doubled single quotes.
   */
  private buildFilterQuery(params: BlobSearchParams): string {
    const conditions: string[] = [];

    if (params.sourceRegistry) {
      conditions.push(`"source_registry" = '${this.escapeTagValue(params.sourceRegistry)}'`);
    }
    if (params.sourcePath) {
      conditions.push(`"source_path" = '${this.escapeTagValue(params.sourcePath)}'`);
    }
    if (params.syncTimeFrom) {
      conditions.push(`"sync_time" >= '${this.escapeTagValue(params.syncTimeFrom)}'`);
    }
    if (params.syncTimeTo) {
      conditions.push(`"sync_time" <= '${this.escapeTagValue(params.syncTimeTo)}'`);
    }

    return conditions.join(" AND ");
  }

  /**
   * Escape a tag value for use in a tag filter query.
   * Azure tag filter values use single quotes; escape by doubling.
   */
  private escapeTagValue(value: string): string {
    return value.replace(/'/g, "''");
  }
}
```

### 6.2 Design Decisions

1. **Input validation**: The service validates that at least one filter is provided and that `maxResults` is in range (1-5000). This follows the pattern established in `RepoReplicationError.missingParams()`.

2. **SQL injection prevention**: Tag values are escaped by doubling single quotes. Azure's tag filter query language uses single-quoted string literals.

3. **Error wrapping**: Azure SDK errors are caught and re-thrown as `BlobSearchError` for consistent error handling through the middleware.

4. **Eventual consistency note**: Documented in the class JSDoc. The API response does not include a warning field, but the Swagger docs will note this.

---

## 7. New `BlobSearchError`

**File**: `src/errors/blob-search.error.ts` (new file)
**Operation**: Create new file

### 7.1 Full File Content

```typescript
import { AzureFsError } from "./base.error";

/**
 * Error thrown during blob search operations.
 * Covers missing search parameters, invalid parameters,
 * authentication issues, and search execution failures.
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

  /** No search filter criteria were provided. */
  static missingParams(): BlobSearchError {
    return new BlobSearchError(
      "BLOB_SEARCH_MISSING_PARAMS",
      "At least one search filter is required: sourceRegistry, sourcePath, syncTimeFrom, or syncTimeTo",
      400,
    );
  }

  /** A search parameter has an invalid value. */
  static invalidParam(paramName: string, reason: string): BlobSearchError {
    return new BlobSearchError(
      "BLOB_SEARCH_INVALID_PARAM",
      `Invalid search parameter "${paramName}": ${reason}`,
      400,
      { paramName },
    );
  }

  /** The search operation failed (Azure SDK error). */
  static searchFailed(reason: string): BlobSearchError {
    return new BlobSearchError(
      "BLOB_SEARCH_FAILED",
      `Blob tag search failed: ${reason}`,
      500,
    );
  }

  /** Storage authentication is not configured for search operations. */
  static authMissing(): BlobSearchError {
    return new BlobSearchError(
      "BLOB_SEARCH_AUTH_MISSING",
      "Azure Storage authentication is not configured. " +
      "Blob search requires storage-account-level authentication " +
      "(connection-string, SAS token with account scope, or Azure AD). " +
      "Container-scoped SAS tokens do not support findBlobsByTags().",
      401,
    );
  }
}
```

### 7.2 Error Code Enum Addition

**File**: `src/types/errors.types.ts`
**Operation**: `insert_after_symbol` after `RepoErrorCode`
**Symbol path**: `RepoErrorCode`

```typescript
/** Blob search error codes */
export enum BlobSearchErrorCode {
  BLOB_SEARCH_MISSING_PARAMS = "BLOB_SEARCH_MISSING_PARAMS",
  BLOB_SEARCH_INVALID_PARAM = "BLOB_SEARCH_INVALID_PARAM",
  BLOB_SEARCH_FAILED = "BLOB_SEARCH_FAILED",
  BLOB_SEARCH_AUTH_MISSING = "BLOB_SEARCH_AUTH_MISSING",
}
```

### 7.3 Type Export Update

**File**: `src/types/index.ts`
**Operation**: `edit` -- add `BlobSearchErrorCode` to the errors export block (line 24-30)

**Before**:
```typescript
export {
  ConfigErrorCode,
  AuthErrorCode,
  NetworkErrorCode,
  GeneralErrorCode,
  RepoErrorCode,
} from "./errors.types";
```

**After**:
```typescript
export {
  ConfigErrorCode,
  AuthErrorCode,
  NetworkErrorCode,
  GeneralErrorCode,
  RepoErrorCode,
  BlobSearchErrorCode,
} from "./errors.types";
```

---

## 8. New API Endpoint: `GET /api/v1/repo/search`

### 8.1 Controller Method

**File**: `src/api/controllers/repo.controller.ts`
**Symbol path**: `createRepoController`
**Operation**: `replace_symbol_body` -- modify the factory function

#### 8.1.1 Signature Change

**Before** (line 35-38):
```typescript
export function createRepoController(
  repoService: RepoReplicationService,
  logger: Logger,
) {
```

**After**:
```typescript
export function createRepoController(
  repoService: RepoReplicationService,
  logger: Logger,
  blobSearchService?: BlobSearchService,
) {
```

#### 8.1.2 New Import

**File**: `src/api/controllers/repo.controller.ts`
**Operation**: `edit` -- add import at top of file

Add after existing imports (after line 10):
```typescript
import { BlobSearchService } from "../../services/blob-search.service";
import { BlobSearchError } from "../../errors/blob-search.error";
```

#### 8.1.3 New Controller Method

Add inside the returned object, after the `syncPairs` method (after line 211, before the closing `};`):

```typescript
    /**
     * GET /api/v1/repo/search
     * Search blobs by index tags (source_registry, source_path, sync_time).
     * Query params: sourceRegistry, sourcePath, syncTimeFrom, syncTimeTo, maxResults
     */
    async searchBlobs(
      req: Request,
      res: Response,
      _next: NextFunction,
    ): Promise<void> {
      const startTime = Date.now();

      if (!blobSearchService) {
        throw BlobSearchError.authMissing();
      }

      const { sourceRegistry, sourcePath, syncTimeFrom, syncTimeTo, maxResults } = req.query;

      const result = await blobSearchService.searchByTags({
        sourceRegistry: sourceRegistry as string | undefined,
        sourcePath: sourcePath as string | undefined,
        syncTimeFrom: syncTimeFrom as string | undefined,
        syncTimeTo: syncTimeTo as string | undefined,
        maxResults: maxResults ? parseInt(maxResults as string, 10) : undefined,
      });

      res.json(buildResponse("repo-search-blobs", result, startTime));
    },
```

**Note**: Parameter validation (at least one filter, maxResults range) is delegated to `BlobSearchService.searchByTags()`, which throws `BlobSearchError` with appropriate status codes. The error handler middleware (which already handles `AzureFsError` subclasses) will format the response correctly.

### 8.2 Route Definition with Swagger

**File**: `src/api/routes/repo.routes.ts`
**Operation**: `edit` -- insert before `return router;` (before line 733)

```typescript
  /**
   * @openapi
   * /api/v1/repo/search:
   *   get:
   *     operationId: searchBlobs
   *     summary: Search blobs by index tags
   *     description: |
   *       Searches Azure Blob Storage for blobs matching the specified index tag criteria.
   *       Uses `findBlobsByTags()` for native tag-based queries across the storage account.
   *       At least one search filter must be provided.
   *
   *       **Important**: Tag indexing has eventual consistency; recently uploaded blobs may not
   *       appear immediately in search results (typically a few minutes delay).
   *
   *       **Authentication**: Requires storage-account-level authentication. Container-scoped
   *       SAS tokens do not support `findBlobsByTags()`.
   *     tags: [Blob Search]
   *     parameters:
   *       - in: query
   *         name: sourceRegistry
   *         schema:
   *           type: string
   *         description: Filter by source registry (exact match, e.g., "owner/repo" or "org/project/repo")
   *         example: "microsoft/typescript"
   *       - in: query
   *         name: sourcePath
   *         schema:
   *           type: string
   *         description: Filter by source file path (exact match)
   *         example: "src/index.ts"
   *       - in: query
   *         name: syncTimeFrom
   *         schema:
   *           type: string
   *           format: date-time
   *         description: Filter by sync time (>=, ISO 8601)
   *         example: "2026-03-01T00:00:00.000Z"
   *       - in: query
   *         name: syncTimeTo
   *         schema:
   *           type: string
   *           format: date-time
   *         description: Filter by sync time (<=, ISO 8601)
   *         example: "2026-03-02T23:59:59.999Z"
   *       - in: query
   *         name: maxResults
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 5000
   *           default: 100
   *         description: Maximum number of results to return
   *     responses:
   *       200:
   *         description: Search completed successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   type: object
   *                   properties:
   *                     count:
   *                       type: integer
   *                       example: 5
   *                     truncated:
   *                       type: boolean
   *                       example: false
   *                     blobs:
   *                       type: array
   *                       items:
   *                         type: object
   *                         properties:
   *                           blobName:
   *                             type: string
   *                             example: "repos/typescript/src/index.ts"
   *                           containerName:
   *                             type: string
   *                             example: "my-container"
   *                           tags:
   *                             type: object
   *                             additionalProperties:
   *                               type: string
   *                     filterQuery:
   *                       type: string
   *                       example: "\"source_registry\" = 'microsoft/typescript'"
   *                     durationMs:
   *                       type: integer
   *                       example: 350
   *                 metadata:
   *                   type: object
   *                   properties:
   *                     command:
   *                       type: string
   *                       example: "repo-search-blobs"
   *                     timestamp:
   *                       type: string
   *                       format: date-time
   *                     durationMs:
   *                       type: integer
   *       400:
   *         description: No search filters provided or invalid parameters
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: false
   *                 error:
   *                   type: object
   *                   properties:
   *                     code:
   *                       type: string
   *                       example: "BLOB_SEARCH_MISSING_PARAMS"
   *                     message:
   *                       type: string
   *                 metadata:
   *                   type: object
   *                   properties:
   *                     timestamp:
   *                       type: string
   *                       format: date-time
   *       401:
   *         description: Storage authentication not configured for search
   *       500:
   *         description: Search operation failed
   */
  router.get("/search", controller.searchBlobs);
```

### 8.3 Wire Up `BlobSearchService` in Route Factory

**File**: `src/api/routes/repo.routes.ts`
**Operation**: `edit` -- modify `createRepoController` call (line 16-19)

**Before**:
```typescript
  const controller = createRepoController(
    services.repoReplicationService!,
    services.logger,
  );
```

**After**:
```typescript
  const controller = createRepoController(
    services.repoReplicationService!,
    services.logger,
    services.blobSearchService,
  );
```

### 8.4 Add `blobSearchService` to `ApiServices`

**File**: `src/api/routes/index.ts`
**Symbol path**: `ApiServices`
**Operation**: `edit` -- add field to interface

**Before** (line 15-24):
```typescript
export interface ApiServices {
  config: ApiResolvedConfig;
  logger: Logger;
  /** Config source tracker (populated by resolveApiConfig, used by dev routes). */
  sourceTracker?: ConfigSourceTracker;
  /** Console commands instance (populated in non-production environments, used by hotkey routes). */
  consoleCommands?: ConsoleCommands;
  /** Repo replication service instance (optional, created when repo routes are needed). */
  repoReplicationService?: RepoReplicationService;
}
```

**After**:
```typescript
export interface ApiServices {
  config: ApiResolvedConfig;
  logger: Logger;
  /** Config source tracker (populated by resolveApiConfig, used by dev routes). */
  sourceTracker?: ConfigSourceTracker;
  /** Console commands instance (populated in non-production environments, used by hotkey routes). */
  consoleCommands?: ConsoleCommands;
  /** Repo replication service instance (optional, created when repo routes are needed). */
  repoReplicationService?: RepoReplicationService;
  /** Blob search service instance (optional, created when storage auth is available). */
  blobSearchService?: BlobSearchService;
}
```

**Add import** at the top of the file:
```typescript
import { BlobSearchService } from "../../services/blob-search.service";
```

### 8.5 Create `BlobSearchService` in Server Startup

**File**: `src/api/server.ts`
**Operation**: Multiple edits

#### 8.5.1 Add Import

After the existing `createContainerClient` import (line 7):

**Before**:
```typescript
import { createContainerClient } from "../services/auth.service";
```

**After**:
```typescript
import { createContainerClient, createBlobServiceClient } from "../services/auth.service";
```

Add new import:
```typescript
import { BlobSearchService } from "../services/blob-search.service";
```

#### 8.5.2 Create Service in `startServer()`

**Location**: After the `repoReplicationService` creation (after line 117), before the port check block.

**Insert**:
```typescript
  // 3b. Create blob search service (requires storage-account-level auth)
  let blobSearchService: BlobSearchService | undefined;
  if (config.storage) {
    try {
      const blobServiceClient = createBlobServiceClient(config);
      blobSearchService = new BlobSearchService(blobServiceClient, logger);
      logger.info("Blob search service initialized");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`Blob search service not available: ${message}`);
      logger.warn("GET /api/v1/repo/search endpoint will return 401 for search requests.");
    }
  }
```

#### 8.5.3 Pass to `createApp()`

**File**: `src/api/server.ts`
**Operation**: Modify `createApp` signature and `startServer` call

**`createApp` signature change**:

**Before** (line 28-34):
```typescript
export function createApp(
  config: ApiResolvedConfig,
  logger: Logger,
  actualPort?: number,
  consoleCommands?: ConsoleCommands,
  repoReplicationService?: RepoReplicationService,
): Express {
```

**After**:
```typescript
export function createApp(
  config: ApiResolvedConfig,
  logger: Logger,
  actualPort?: number,
  consoleCommands?: ConsoleCommands,
  repoReplicationService?: RepoReplicationService,
  blobSearchService?: BlobSearchService,
): Express {
```

**`ApiServices` construction change** (line 67-73):

**Before**:
```typescript
  const services: ApiServices = {
    config,
    logger,
    sourceTracker: config.sourceTracker,
    consoleCommands,
    repoReplicationService,
  };
```

**After**:
```typescript
  const services: ApiServices = {
    config,
    logger,
    sourceTracker: config.sourceTracker,
    consoleCommands,
    repoReplicationService,
    blobSearchService,
  };
```

**`createApp` call in `startServer()`** (line 158-164):

**Before**:
```typescript
  const app = createApp(
    config,
    logger,
    actualPort !== config.api.port ? actualPort : undefined,
    consoleCommands ?? undefined,
    repoReplicationService,
  );
```

**After**:
```typescript
  const app = createApp(
    config,
    logger,
    actualPort !== config.api.port ? actualPort : undefined,
    consoleCommands ?? undefined,
    repoReplicationService,
    blobSearchService,
  );
```

---

## 9. New CLI Command: `repo search-blobs`

**File**: `src/commands/repo.commands.ts`
**Symbol path**: `registerRepoCommands`
**Operation**: Insert new command after the `list-sync-pairs` command block (before the closing `}` of the function, after line 186)

### 9.1 New Import

Add to the import block at the top of the file:

```typescript
import { createBlobServiceClient } from "../services/auth.service";
import { BlobSearchService } from "../services/blob-search.service";
```

### 9.2 Command Definition

```typescript
  // --- search-blobs ---
  repo
    .command("search-blobs")
    .description("Search blobs by index tags (source_registry, source_path, sync_time)")
    .option("--source-registry <registry>", "Filter by source registry (exact match, e.g., owner/repo)")
    .option("--source-path <path>", "Filter by source file path (exact match)")
    .option("--sync-time-from <datetime>", "Filter by sync time (>= ISO 8601)")
    .option("--sync-time-to <datetime>", "Filter by sync time (<= ISO 8601)")
    .option("--max-results <count>", "Maximum results to return (1-5000)", "100")
    .action(async (options: Record<string, unknown>, cmd: Command) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent!.parent!.opts();
      const jsonMode = globalOpts.json === true;

      try {
        const config = resolveConfig(globalOpts);
        const logger = new Logger(config.logging.level, globalOpts.verbose === true);
        const blobServiceClient = createBlobServiceClient(config);
        const blobSearchService = new BlobSearchService(blobServiceClient, logger);

        const result = await blobSearchService.searchByTags({
          sourceRegistry: options["sourceRegistry"] as string | undefined,
          sourcePath: options["sourcePath"] as string | undefined,
          syncTimeFrom: options["syncTimeFrom"] as string | undefined,
          syncTimeTo: options["syncTimeTo"] as string | undefined,
          maxResults: options["maxResults"] ? parseInt(options["maxResults"] as string, 10) : undefined,
        });

        const output = formatSuccess(result, "repo search-blobs", startTime);
        outputResult(output, jsonMode);
      } catch (err) {
        const output = formatErrorFromException(err, "repo search-blobs", startTime);
        outputResult(output, jsonMode);
        process.exitCode = exitCodeForError(err);
      }
    });
```

### 9.3 CLI Usage Examples

```bash
# Search all blobs from a GitHub repo
repo-sync repo search-blobs --source-registry "microsoft/typescript"

# Search for a specific file
repo-sync repo search-blobs --source-path "src/index.ts"

# Search within a time range
repo-sync repo search-blobs --source-registry "myorg/myproject/myrepo" \
  --sync-time-from "2026-03-01T00:00:00.000Z" \
  --sync-time-to "2026-03-02T23:59:59.999Z"

# Combine filters with max results
repo-sync repo search-blobs \
  --source-registry "microsoft/typescript" \
  --sync-time-from "2026-03-01T00:00:00.000Z" \
  --max-results 50

# JSON output mode
repo-sync repo search-blobs --source-registry "microsoft/typescript" --json
```

---

## 10. Error Handling Summary

### 10.1 Tag Permission Failures in Upload

**Location**: `uploadEntryToBlob()` in `repo-replication.service.ts`

**Behavior**:
- For **small files** (buffered upload): If the upload with tags fails due to tag permission issues, the method retries the upload with metadata only (no tags) and logs a warning. The buffer is still available for retry.
- For **large files** (stream upload): If the upload with tags fails due to tag permission issues, the error is logged but propagated, since the stream is consumed and cannot be re-read. The file will be recorded as a failed upload in the stats. This is an acceptable tradeoff since stream uploads of large files cannot be retried without re-downloading the archive.

**Detection**: The `isTagPermissionError()` helper checks for Azure SDK error patterns indicating tag permission denial (HTTP 403 with `AuthorizationPermissionMismatch`).

### 10.2 Search Errors

| Error | Code | HTTP Status | Trigger |
|-------|------|-------------|---------|
| No filters provided | `BLOB_SEARCH_MISSING_PARAMS` | 400 | All filter params are undefined |
| Invalid maxResults | `BLOB_SEARCH_INVALID_PARAM` | 400 | maxResults < 1 or > 5000 |
| Azure SDK error | `BLOB_SEARCH_FAILED` | 500 | `findBlobsByTags()` throws |
| No storage auth | `BLOB_SEARCH_AUTH_MISSING` | 401 | `blobSearchService` is undefined |

### 10.3 Error Class Hierarchy

```
AzureFsError (base.error.ts)
  ├── ConfigError (config.error.ts)
  ├── AuthError (auth.error.ts)
  ├── RepoReplicationError (repo-replication.error.ts)
  └── BlobSearchError (blob-search.error.ts)  <-- NEW
```

All errors follow the existing `AzureFsError` pattern with `code`, `message`, `statusCode`, and optional `details`. The error handler middleware in `error-handler.middleware.ts` already handles `AzureFsError` subclasses by extracting the `statusCode` for the HTTP response.

---

## 11. File Modification Summary

### New Files

| File | Description |
|------|-------------|
| `src/services/blob-search.service.ts` | Blob search service wrapping `findBlobsByTags()` with types |
| `src/errors/blob-search.error.ts` | BlobSearchError class with factory methods |

### Modified Files

| File | Symbol | Operation | Change |
|------|--------|-----------|--------|
| `src/types/repo-replication.types.ts` | After `RepoFileUploadResult` | `insert_after_symbol` | Add `BlobUploadMetadata` interface |
| `src/types/index.ts` | Export blocks | `edit` | Add `BlobUploadMetadata`, `BlobSearchErrorCode` |
| `src/types/errors.types.ts` | After `RepoErrorCode` | `insert_after_symbol` | Add `BlobSearchErrorCode` enum |
| `src/services/repo-replication.service.ts` | Import block | `edit` | Add `BlobUploadMetadata` import |
| `src/services/repo-replication.service.ts` | `uploadEntryToBlob` | `replace_symbol_body` | Add `blobMetadata` param, metadata/tags logic, tag fallback |
| `src/services/repo-replication.service.ts` | After `uploadEntryToBlob` | `insert_after_symbol` | Add `isTagPermissionError` helper |
| `src/services/repo-replication.service.ts` | `streamTarToBlob` | `edit` (2 locations) | Add `syncTime`, construct metadata, pass to upload |
| `src/services/repo-replication.service.ts` | `streamZipToBlob` | `edit` (2 locations) | Add `syncTime`, construct metadata, pass to upload |
| `src/api/controllers/repo.controller.ts` | `createRepoController` | `replace_symbol_body` | Add `blobSearchService` param, `searchBlobs` method |
| `src/api/routes/repo.routes.ts` | `createRepoRoutes` | `edit` (2 locations) | Add `GET /search` route with Swagger, pass `blobSearchService` |
| `src/api/routes/index.ts` | `ApiServices` | `edit` | Add `blobSearchService` field and import |
| `src/api/server.ts` | `createApp` | `edit` | Add `blobSearchService` param, pass to services |
| `src/api/server.ts` | `startServer` | `edit` | Create `BlobSearchService`, pass to `createApp` |
| `src/commands/repo.commands.ts` | `registerRepoCommands` | `edit` | Add `search-blobs` subcommand |

---

## 12. Dependency Order

```
Phase 1: Types
  Step 1: BlobUploadMetadata interface (repo-replication.types.ts)
  Step 2: BlobSearchErrorCode enum (errors.types.ts)
  Step 3: Type exports (index.ts)

Phase 2: Core Upload Changes
  Step 4: Import BlobUploadMetadata (repo-replication.service.ts imports)
  Step 5: Modify uploadEntryToBlob() + add isTagPermissionError()
  Step 6: Modify streamTarToBlob() to pass metadata
  Step 7: Modify streamZipToBlob() to pass metadata

Phase 3: Search Infrastructure
  Step 8: Create BlobSearchError (blob-search.error.ts)
  Step 9: Create BlobSearchService (blob-search.service.ts)

Phase 4: API & CLI Integration (can be done in parallel)
  Step 10: Modify controller (repo.controller.ts)
  Step 11: Modify routes (repo.routes.ts + index.ts)
  Step 12: Modify server (server.ts)
  Step 13: Add CLI command (repo.commands.ts)
```

Steps 6 and 7 are independent and can be done in parallel.
Steps 10-13 are independent and can be done in parallel after Step 9.

---

## 13. Backward Compatibility

| Component | Change | Backward Compatible | Notes |
|-----------|--------|-------------------|-------|
| `uploadEntryToBlob()` | New optional `blobMetadata` parameter | Yes | Existing callers pass no metadata (treated as undefined) |
| `streamTarToBlob()` | No signature change | Yes | Metadata constructed internally |
| `streamZipToBlob()` | No signature change | Yes | Metadata constructed internally |
| `createRepoController()` | New optional `blobSearchService` parameter | Yes | Existing callers pass no service |
| `createApp()` | New optional `blobSearchService` parameter | Yes | Existing callers pass no service |
| `ApiServices` | New optional `blobSearchService` field | Yes | Existing objects don't include it |
| Existing API endpoints | No changes | Yes | Request/response schemas unchanged |
| Existing CLI commands | No changes | Yes | Options and output unchanged |
| `RepoReplicationResult` | No changes | Yes | Does not include metadata info |
| `RepoFileUploadResult` | No changes | Yes | Does not include metadata info |

---

## 14. Tag Permission Graceful Degradation: Detailed Flow

```
uploadEntryToBlob(containerClient, blobPath, stream, size, blobMetadata)
  |
  |-- Construct metadata: Record<string, string> from blobMetadata
  |-- Construct tags: Record<string, string> from blobMetadata (source_path truncated to 256 chars)
  |
  |-- IF small file (size < 4MB):
  |     |-- Buffer stream into memory
  |     |-- TRY: blockBlobClient.upload(buffer, length, { metadata, tags })
  |     |     |-- SUCCESS: return { success: true, size }
  |     |     |-- FAIL (tag permission error):
  |     |           |-- LOG WARNING
  |     |           |-- RETRY: blockBlobClient.upload(buffer, length, { metadata })
  |     |           |-- SUCCESS: return { success: true, size } (blob has metadata but no tags)
  |     |     |-- FAIL (other error): throw -> caught by outer catch
  |
  |-- IF large file:
  |     |-- TRY: blockBlobClient.uploadStream(stream, undef, undef, { metadata, tags })
  |     |     |-- SUCCESS: return { success: true, size }
  |     |     |-- FAIL (tag permission error):
  |     |           |-- LOG WARNING
  |     |           |-- Stream is consumed, cannot retry
  |     |           |-- throw -> caught by outer catch -> return { success: false, error }
  |     |     |-- FAIL (other error): throw -> caught by outer catch
  |
  |-- CATCH: return { success: false, size: 0, error: message }
```

---

## 15. API Response Examples

### 15.1 Successful Search

```json
{
  "success": true,
  "data": {
    "count": 3,
    "truncated": false,
    "blobs": [
      {
        "blobName": "repos/typescript/src/index.ts",
        "containerName": "my-container",
        "tags": {
          "source_registry": "microsoft/typescript",
          "source_path": "src/index.ts",
          "sync_time": "2026-03-02T10:30:00.000Z"
        }
      },
      {
        "blobName": "repos/typescript/src/compiler.ts",
        "containerName": "my-container",
        "tags": {
          "source_registry": "microsoft/typescript",
          "source_path": "src/compiler.ts",
          "sync_time": "2026-03-02T10:30:00.000Z"
        }
      },
      {
        "blobName": "repos/typescript/package.json",
        "containerName": "my-container",
        "tags": {
          "source_registry": "microsoft/typescript",
          "source_path": "package.json",
          "sync_time": "2026-03-02T10:30:00.000Z"
        }
      }
    ],
    "filterQuery": "\"source_registry\" = 'microsoft/typescript'",
    "durationMs": 350
  },
  "metadata": {
    "command": "repo-search-blobs",
    "timestamp": "2026-03-02T11:15:00.000Z",
    "durationMs": 355
  }
}
```

### 15.2 No Filters Error (400)

```json
{
  "success": false,
  "error": {
    "code": "BLOB_SEARCH_MISSING_PARAMS",
    "message": "At least one search filter is required: sourceRegistry, sourcePath, syncTimeFrom, or syncTimeTo"
  },
  "metadata": {
    "timestamp": "2026-03-02T11:15:00.000Z"
  }
}
```

### 15.3 Auth Missing Error (401)

```json
{
  "success": false,
  "error": {
    "code": "BLOB_SEARCH_AUTH_MISSING",
    "message": "Azure Storage authentication is not configured. Blob search requires storage-account-level authentication..."
  },
  "metadata": {
    "timestamp": "2026-03-02T11:15:00.000Z"
  }
}
```
