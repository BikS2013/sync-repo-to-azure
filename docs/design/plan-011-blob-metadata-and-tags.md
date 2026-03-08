# Plan 011 - Blob Metadata and Index Tags for Source Tracking

**Date**: 2026-03-02
**Status**: Draft
**Depends on**: Plan 007 (repo replication), Plan 008 (sync pairs)

---

## 1. Objective

For each file replicated from GitHub or Azure DevOps to Azure Blob Storage, set both **blob metadata** and **blob index tags** containing:

| Field | Metadata Key | Tag Key | Value Format |
|-------|-------------|---------|-------------|
| Source Registry | `source_registry` | `source_registry` | `owner/repo` (GitHub) or `org/project/repo` (Azure DevOps) |
| Source Path | `source_path` | `source_path` | Relative file path inside the repository (e.g., `src/index.ts`) |
| Sync Time | `sync_time` | `sync_time` | ISO 8601 timestamp (e.g., `2026-03-02T10:30:00.000Z`) |

**Why both?** Azure Blob metadata is stored per-blob but is **not natively queryable**. Blob index tags support `findBlobsByTags()` queries, enabling search by source registry, path, or sync time. Setting both provides maximum flexibility: metadata for per-blob inspection and tags for cross-container search.

**Additionally**, this plan introduces:
- A new **CLI command** (`repo search-blobs`) to search blobs by tags
- A new **API endpoint** (`GET /api/v1/repo/search`) to search blobs by tags
- A new **blob search service** to encapsulate `findBlobsByTags()` logic

---

## 2. Azure SDK Background

### 2.1 Blob Metadata

- Set via the `metadata` property in `BlockBlobUploadOptions` / `BlockBlobUploadStreamOptions`
- Included in the same HTTP PUT request as the blob content (no additional API call)
- Keys: must be valid C# identifiers (letters, digits, underscore; no hyphens), case-insensitive
- Values: UTF-8 strings, max 8 KB total for all key-value pairs per blob
- NOT queryable via Azure Blob Storage API

### 2.2 Blob Index Tags

- Set via `blockBlobClient.setTags()` after upload, or via `tags` property in upload options
- Keys: 1-128 chars (alphanumeric + limited special chars), values: 0-256 chars
- Maximum 10 tags per blob
- **Queryable** via `BlobServiceClient.findBlobsByTags(tagFilterSql)` using SQL-like WHERE syntax
- Supported operators: `=`, `>`, `<`, `>=`, `<=`, `AND`
- Tag values are always strings; comparison is lexicographic

### 2.3 Tag Limitations and Mitigations

| Constraint | Limit | Impact | Mitigation |
|-----------|-------|--------|------------|
| Max tags per blob | 10 | We use 3 of 10 -- sufficient headroom | N/A |
| Max value length | 256 chars | Long file paths may exceed | Truncate `source_path` tag to 256 chars; full path always in metadata |
| Tag indexing delay | Minutes | Newly uploaded blobs may not appear in tag queries immediately | Document eventual consistency in API response |
| `source_path` with `/` chars | Allowed in tag values | No issue | N/A |

---

## 3. Implementation Steps

### Step 1: Add `BlobUploadMetadata` Interface

**File**: `src/types/repo-replication.types.ts`
**Action**: Add new interface after `RepoFileUploadResult` (after line 63)

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

**Verification**: TypeScript compiles without errors. The interface is exported from `src/types/index.ts`.

---

### Step 2: Modify `uploadEntryToBlob()` Signature and Implementation

**File**: `src/services/repo-replication.service.ts`
**Symbol**: `RepoReplicationService.uploadEntryToBlob()` (lines 690-729)
**Action**: Add optional `blobMetadata?: BlobUploadMetadata` parameter and pass to both upload paths

**Current signature** (line 690-695):
```typescript
private async uploadEntryToBlob(
    containerClient: ContainerClient,
    blobPath: string,
    entryStream: Readable,
    size?: number,
): Promise<{ success: boolean; size: number; error?: string }>
```

**New signature**:
```typescript
private async uploadEntryToBlob(
    containerClient: ContainerClient,
    blobPath: string,
    entryStream: Readable,
    size?: number,
    blobMetadata?: BlobUploadMetadata,
): Promise<{ success: boolean; size: number; error?: string }>
```

**Implementation changes inside the method**:

1. Before the `if (size !== undefined && size < SMALL_FILE_THRESHOLD)` block, construct the upload options:

```typescript
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
```

2. Modify the small-file upload call (line 708):

```typescript
// Before:
await blockBlobClient.upload(buffer, buffer.length);

// After:
await blockBlobClient.upload(buffer, buffer.length, { metadata, tags });
```

3. Modify the large-file upload call (line 721):

```typescript
// Before:
await blockBlobClient.uploadStream(entryStream.pipe(counter));

// After:
await blockBlobClient.uploadStream(
  entryStream.pipe(counter),
  undefined,
  undefined,
  { metadata, tags },
);
```

**Verification**:
- TypeScript compiles without errors
- No existing callers break (parameter is optional)
- `npm run build` succeeds

---

### Step 3: Pass Metadata from `streamTarToBlob()` (GitHub)

**File**: `src/services/repo-replication.service.ts`
**Symbol**: `RepoReplicationService.streamTarToBlob()` (lines 430-545)
**Action**: Construct `BlobUploadMetadata` and pass to `uploadEntryToBlob()` call

**Location**: Inside the `extract.on("entry", ...)` handler, around lines 496-506

**Changes**:
1. Capture a batch-level sync time at the start of the method (after `const stats` initialization):

```typescript
const syncTime = new Date().toISOString();
```

2. Before the `uploadEntryToBlob()` call (around line 499), construct metadata:

```typescript
const blobMetadata: BlobUploadMetadata = {
  source_registry: repoIdentifier,
  source_path: strippedPath,
  sync_time: syncTime,
};
```

3. Update the `uploadEntryToBlob()` call (line 499):

```typescript
// Before:
this.uploadEntryToBlob(client, blobPath, entryStream, header.size)

// After:
this.uploadEntryToBlob(client, blobPath, entryStream, header.size, blobMetadata)
```

4. Add import for `BlobUploadMetadata` at the top of the file (line 12-23 import block).

**Verification**:
- All GitHub replication paths set metadata and tags on every uploaded blob
- The `syncTime` is captured once per batch for consistency

---

### Step 4: Pass Metadata from `streamZipToBlob()` (Azure DevOps)

**File**: `src/services/repo-replication.service.ts`
**Symbol**: `RepoReplicationService.streamZipToBlob()` (lines 560-676)
**Action**: Construct `BlobUploadMetadata` and pass to `uploadEntryToBlob()` call

**Location**: Inside the `parser.on("entry", ...)` handler, around lines 620-626

**Changes**:
1. Capture a batch-level sync time at the start of the method (after `const stats` initialization):

```typescript
const syncTime = new Date().toISOString();
```

2. Before the `uploadEntryToBlob()` call (around line 626), construct metadata:

```typescript
const blobMetadata: BlobUploadMetadata = {
  source_registry: repoIdentifier,
  source_path: entryPath,
  sync_time: syncTime,
};
```

3. Update the `uploadEntryToBlob()` call (line 626):

```typescript
// Before:
this.uploadEntryToBlob(client, blobPath, entryAsReadable, size)

// After:
this.uploadEntryToBlob(client, blobPath, entryAsReadable, size, blobMetadata)
```

**Verification**:
- All Azure DevOps replication paths set metadata and tags on every uploaded blob
- The `syncTime` is captured once per batch for consistency

---

### Step 5: Create Blob Search Service

**File**: `src/services/blob-search.service.ts` (new file)
**Action**: Create a service that wraps `BlobServiceClient.findBlobsByTags()`

```typescript
import { BlobServiceClient, TaggedBlobItem } from "@azure/storage-blob";
import { Logger } from "../utils/logger.utils";

/** Parameters for searching blobs by tags */
export interface BlobSearchParams {
  /** Filter by source registry (exact match) */
  sourceRegistry?: string;
  /** Filter by source path (exact match) */
  sourcePath?: string;
  /** Filter by sync time (greater than or equal to) */
  syncTimeFrom?: string;
  /** Filter by sync time (less than or equal to) */
  syncTimeTo?: string;
  /** Maximum number of results to return */
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

/**
 * Service for searching blobs by index tags.
 *
 * Uses `BlobServiceClient.findBlobsByTags()` which executes SQL-like
 * tag filter queries across the entire storage account.
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
   * At least one filter parameter (sourceRegistry, sourcePath, syncTimeFrom,
   * syncTimeTo) must be provided.
   */
  async searchByTags(params: BlobSearchParams): Promise<BlobSearchResult> {
    const startTime = Date.now();
    const filterQuery = this.buildFilterQuery(params);
    const maxResults = params.maxResults ?? 100;

    this.logger.debug(`Searching blobs with tag filter: ${filterQuery}`);

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
  }

  /**
   * Build a tag filter SQL query from search parameters.
   *
   * Uses the Azure Blob index tag query syntax:
   *   "tagKey" = 'tagValue' AND "tagKey2" >= 'value2'
   *
   * Throws if no filter criteria are provided.
   */
  private buildFilterQuery(params: BlobSearchParams): string {
    const conditions: string[] = [];

    if (params.sourceRegistry) {
      conditions.push(`"source_registry" = '${params.sourceRegistry}'`);
    }
    if (params.sourcePath) {
      conditions.push(`"source_path" = '${params.sourcePath}'`);
    }
    if (params.syncTimeFrom) {
      conditions.push(`"sync_time" >= '${params.syncTimeFrom}'`);
    }
    if (params.syncTimeTo) {
      conditions.push(`"sync_time" <= '${params.syncTimeTo}'`);
    }

    if (conditions.length === 0) {
      throw new Error(
        "At least one search filter is required: sourceRegistry, sourcePath, syncTimeFrom, or syncTimeTo",
      );
    }

    return conditions.join(" AND ");
  }
}
```

**Verification**:
- TypeScript compiles without errors
- The service is importable from the API controller and CLI command modules

---

### Step 6: Add Error Codes for Blob Search

**File**: `src/types/errors.types.ts`
**Action**: Add a new `BlobSearchErrorCode` enum after `RepoErrorCode`

```typescript
/** Blob search error codes */
export enum BlobSearchErrorCode {
  BLOB_SEARCH_MISSING_PARAMS = "BLOB_SEARCH_MISSING_PARAMS",
  BLOB_SEARCH_FAILED = "BLOB_SEARCH_FAILED",
  BLOB_SEARCH_AUTH_MISSING = "BLOB_SEARCH_AUTH_MISSING",
}
```

**Verification**: TypeScript compiles. The enum is available for import.

---

### Step 7: Create API Endpoint for Blob Search

#### 7a. Create Controller Method

**File**: `src/api/controllers/repo.controller.ts`
**Symbol**: `createRepoController()` return object
**Action**: Add `searchBlobs` method to the returned controller object

The controller method:
1. Extracts query parameters: `sourceRegistry`, `sourcePath`, `syncTimeFrom`, `syncTimeTo`, `maxResults`
2. Validates that at least one search filter is provided (returns 400 if not)
3. Calls `BlobSearchService.searchByTags()`
4. Returns the result in the standard API envelope

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

  const { sourceRegistry, sourcePath, syncTimeFrom, syncTimeTo, maxResults } = req.query;

  // Validate at least one filter
  if (!sourceRegistry && !sourcePath && !syncTimeFrom && !syncTimeTo) {
    res.status(400).json({
      success: false,
      error: {
        code: "BLOB_SEARCH_MISSING_PARAMS",
        message: "At least one search filter is required: sourceRegistry, sourcePath, syncTimeFrom, or syncTimeTo",
      },
      metadata: { timestamp: new Date().toISOString() },
    });
    return;
  }

  const result = await blobSearchService.searchByTags({
    sourceRegistry: sourceRegistry as string | undefined,
    sourcePath: sourcePath as string | undefined,
    syncTimeFrom: syncTimeFrom as string | undefined,
    syncTimeTo: syncTimeTo as string | undefined,
    maxResults: maxResults ? parseInt(maxResults as string, 10) : undefined,
  });

  res.json(buildResponse("repo-search-blobs", result, startTime));
}
```

**Note**: The controller factory `createRepoController()` must be updated to accept a `BlobSearchService` instance as an additional parameter. The factory signature becomes:

```typescript
export function createRepoController(
  repoService: RepoReplicationService,
  logger: Logger,
  blobSearchService?: BlobSearchService,
)
```

#### 7b. Register the Route

**File**: `src/api/routes/repo.routes.ts`
**Action**: Add GET route after the existing routes (before `return router;`)

Add the Swagger annotation and route:

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
 *       Note: Tag indexing has eventual consistency; recently uploaded blobs may not
 *       appear immediately in search results.
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
 *         description: No search filters provided
 *       500:
 *         description: Search operation failed
 */
router.get("/search", controller.searchBlobs);
```

#### 7c. Wire Up `BlobSearchService` in API Server

**File**: `src/api/server.ts`
**Action**: Create a `BlobSearchService` instance when creating the API services. This requires creating a `BlobServiceClient` (not just a `ContainerClient`).

**File**: `src/api/routes/index.ts`
**Action**: Add `blobSearchService?: BlobSearchService` to the `ApiServices` interface.

**File**: `src/services/auth.service.ts`
**Action**: The `createBlobServiceClient()` function already exists. The API server should call it and pass the `BlobServiceClient` to `BlobSearchService`.

**Verification**:
- `GET /api/v1/repo/search?sourceRegistry=microsoft/typescript` returns results
- `GET /api/v1/repo/search` without filters returns 400
- Swagger UI shows the endpoint with all parameters

---

### Step 8: Create CLI Command for Blob Search

**File**: `src/commands/repo.commands.ts`
**Action**: Add `repo search-blobs` subcommand to the `repo` command group

```typescript
repo
  .command("search-blobs")
  .description("Search blobs by index tags (source_registry, source_path, sync_time)")
  .option("--source-registry <registry>", "Filter by source registry (exact match)")
  .option("--source-path <path>", "Filter by source file path (exact match)")
  .option("--sync-time-from <datetime>", "Filter by sync time (>= ISO 8601)")
  .option("--sync-time-to <datetime>", "Filter by sync time (<= ISO 8601)")
  .option("--max-results <count>", "Maximum results to return", "100")
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
      process.exit(exitCodeForError(err));
    }
  });
```

**Verification**:
- `repo-sync repo search-blobs --source-registry "microsoft/typescript"` returns results
- `repo-sync repo search-blobs` with no filters exits with error (code 3)
- `repo-sync repo search-blobs --help` shows all options

---

### Step 9: Update Type Exports

**File**: `src/types/index.ts`
**Action**: Add export for `BlobUploadMetadata`

```typescript
export type { BlobUploadMetadata } from "./repo-replication.types";
```

**Verification**: The type is importable from `../types` or `../types/index`.

---

### Step 10: Update Non-Goals in Project Design

**File**: `docs/design/project-design.md`
**Section**: 1.2 Non-Goals
**Action**: Remove "metadata management, or tag querying on blobs" from the non-goals list, since this feature now adds both metadata setting and tag-based querying.

**Before**:
```
- Folder operations, metadata management, or tag querying on blobs
```

**After**:
```
- Generic folder operations on blobs (list, delete, move folders)
```

Also add to section 1.1 Goals:
```
- Set source-tracking metadata and index tags on each uploaded blob
- Support blob search by index tags (source registry, source path, sync time)
```

---

## 4. File Modification Summary

### New Files

| File | Description |
|------|-------------|
| `src/services/blob-search.service.ts` | Blob search service wrapping `findBlobsByTags()` |

### Modified Files

| File | Changes |
|------|---------|
| `src/services/repo-replication.service.ts` | (1) Import `BlobUploadMetadata`. (2) Add `blobMetadata` param to `uploadEntryToBlob()`. (3) Pass metadata+tags to `upload()` and `uploadStream()`. (4) Construct metadata in `streamTarToBlob()`. (5) Construct metadata in `streamZipToBlob()`. |
| `src/types/repo-replication.types.ts` | Add `BlobUploadMetadata` interface |
| `src/types/index.ts` | Export `BlobUploadMetadata` |
| `src/types/errors.types.ts` | Add `BlobSearchErrorCode` enum |
| `src/api/controllers/repo.controller.ts` | (1) Accept `BlobSearchService` in factory. (2) Add `searchBlobs` method. |
| `src/api/routes/repo.routes.ts` | Add `GET /search` route with Swagger annotation |
| `src/api/routes/index.ts` | Add `blobSearchService` to `ApiServices` interface |
| `src/api/server.ts` | Create and inject `BlobSearchService` instance |
| `src/commands/repo.commands.ts` | Add `repo search-blobs` subcommand |
| `docs/design/project-design.md` | Update goals/non-goals, add blob metadata/search architecture |
| `docs/design/project-functions.md` | Add F6.x functional requirements |
| `docs/design/configuration-guide.md` | Note that no new configuration is required for metadata (automatic) |
| `CLAUDE.md` | Update project structure, environment variables table (no new vars), CLI/API documentation |
| `cli-instructions.md` | Add `repo search-blobs` command documentation |
| `api-instructions.md` | Add `GET /api/v1/repo/search` endpoint documentation |
| `Issues - Pending Items.md` | Register any gaps found during implementation |

---

## 5. Dependency Order

```
Step 1  (types: BlobUploadMetadata)
   |
   v
Step 2  (uploadEntryToBlob: accept metadata + tags)
   |
   +----+----+
   |         |
   v         v
Step 3    Step 4
(tar)     (zip)
   |         |
   +----+----+
        |
        v
Step 5  (BlobSearchService)
   |
   v
Step 6  (error codes)
   |
   +----+----+----+
   |         |    |
   v         v    v
Step 7    Step 8  Step 9
(API)    (CLI)   (type exports)
   |         |    |
   +----+----+----+
        |
        v
Step 10 (documentation updates)
```

Steps 1-4 can be implemented and tested independently of Steps 5-9.
Steps 3 and 4 are independent and can be done in parallel after Step 2.
Steps 7, 8, and 9 are independent and can be done in parallel after Steps 5-6.

---

## 6. Interface Contracts

### 6.1 Preserved Contracts

| Interface | Change | Backward Compatible |
|-----------|--------|-------------------|
| `uploadEntryToBlob()` | New optional `blobMetadata` parameter | Yes (optional param) |
| `streamTarToBlob()` | No signature change (metadata constructed internally) | Yes |
| `streamZipToBlob()` | No signature change (metadata constructed internally) | Yes |
| `RepoReplicationResult` | No change | Yes |
| `RepoFileUploadResult` | No change | Yes |
| Existing API endpoints | No change to request/response schemas | Yes |
| Existing CLI commands | No change to options or output | Yes |

### 6.2 New Contracts

| Interface | Type | Description |
|-----------|------|-------------|
| `BlobUploadMetadata` | TypeScript interface | 3 required string fields: `source_registry`, `source_path`, `sync_time` |
| `BlobSearchParams` | TypeScript interface | Search filter parameters for tag queries |
| `BlobSearchResult` | TypeScript interface | Aggregated search result with blob list |
| `GET /api/v1/repo/search` | REST API | Query params: `sourceRegistry`, `sourcePath`, `syncTimeFrom`, `syncTimeTo`, `maxResults` |
| `repo search-blobs` | CLI command | Options: `--source-registry`, `--source-path`, `--sync-time-from`, `--sync-time-to`, `--max-results` |

---

## 7. Testing Plan

### 7.1 Test Script: Metadata and Tags Verification

**File**: `test_scripts/test-blob-metadata-tags.ts`
**Purpose**: Verify metadata and tags are set on uploaded blobs after replication

Test steps:
1. Run a GitHub replication via CLI (`repo clone-github`)
2. Use Azure SDK to read a known blob's metadata via `getProperties()`
3. Assert that `source_registry`, `source_path`, `sync_time` are present in metadata
4. Use Azure SDK to read the blob's tags via `getTags()`
5. Assert that `source_registry`, `source_path`, `sync_time` are present in tags
6. Repeat for Azure DevOps replication (`repo clone-devops`)

### 7.2 Test Script: Blob Search

**File**: `test_scripts/test-blob-search.ts`
**Purpose**: Verify the blob search API endpoint and CLI command

Test steps:
1. Replicate a known repository (to ensure tags exist)
2. Wait ~60 seconds for tag indexing (eventual consistency)
3. Call `GET /api/v1/repo/search?sourceRegistry=owner/repo` and verify results
4. Call with `sourcePath` filter and verify narrower results
5. Call with `syncTimeFrom`/`syncTimeTo` range and verify results
6. Call with no filters and verify 400 error
7. Test CLI: `repo-sync repo search-blobs --source-registry "owner/repo"` and verify JSON output

### 7.3 Test Script: Tag Truncation

**File**: `test_scripts/test-tag-truncation.ts`
**Purpose**: Verify long file paths are truncated in tags but preserved in metadata

Test steps:
1. Create a mock scenario with a file path > 256 chars
2. Verify the tag value is truncated to 256 chars
3. Verify the metadata value contains the full path

### 7.4 Edge Cases to Verify

- File paths with unicode characters
- File paths with spaces
- Empty file (0 bytes) -- both metadata and tags should still be set
- Repository with no files -- no blobs uploaded, no errors
- Sync pair replication -- metadata/tags set via both `replicateGitHubSyncPair()` and `replicateDevOpsSyncPair()` paths

---

## 8. Documentation Updates

### 8.1 `CLAUDE.md`

- Add `src/services/blob-search.service.ts` to project structure with description
- Add `BlobUploadMetadata` to the types section description
- Add `BlobSearchErrorCode` to the errors section
- Document the `repo search-blobs` CLI command
- Document the `GET /api/v1/repo/search` API endpoint
- Note that metadata and tags are automatically set during replication (no configuration needed)

### 8.2 `cli-instructions.md`

- Add `repo search-blobs` command documentation with syntax, options, examples, and output format

### 8.3 `api-instructions.md`

- Add `GET /api/v1/repo/search` to the endpoint table
- Add curl examples for searching by source registry, path, and time range
- Document query parameters and response format

### 8.4 `docs/design/project-design.md`

- Update goals and non-goals (Step 10)
- Add "Blob Metadata and Tags" section under the architecture description
- Document the metadata/tags flow in the replication pipeline diagram

### 8.5 `docs/design/project-functions.md`

Add new functional requirements:

- **F6.1 Blob Metadata Setting (P0)**: Every file uploaded during replication must have blob metadata set with `source_registry`, `source_path`, `sync_time`
- **F6.2 Blob Index Tag Setting (P0)**: Every file uploaded during replication must have blob index tags set with `source_registry`, `source_path`, `sync_time` (source_path truncated to 256 chars for tags)
- **F6.3 Blob Search by Tags - API (P1)**: `GET /api/v1/repo/search` endpoint to search blobs by index tags with filters for sourceRegistry, sourcePath, syncTimeFrom, syncTimeTo
- **F6.4 Blob Search by Tags - CLI (P1)**: `repo search-blobs` CLI command with matching filter options
- **F6.5 Batch Sync Time Consistency (P2)**: All files within a single replication operation share the same `sync_time` value (captured at batch start)

### 8.6 `docs/design/configuration-guide.md`

- Add a note under a "Blob Metadata and Tags" section explaining that metadata and tags are set automatically during replication with no additional configuration required
- Mention the `findBlobsByTags()` storage account requirement (Blob Index Tags must be enabled on the storage account)

---

## 9. Risk Assessment

### Low Risk
- **Additive change**: All signature modifications are additive (optional parameters)
- **No breaking changes**: Existing API and CLI contracts are unchanged
- **No performance impact**: Metadata/tags are included in the same upload HTTP request
- **Single modification point**: All blob uploads go through `uploadEntryToBlob()`

### Medium Risk
- **Blob Index Tags availability**: The `findBlobsByTags()` API requires the Blob Index Tags feature, which is available on general-purpose v2 storage accounts. If the storage account does not support it, tag operations will fail with an Azure SDK error. The metadata setting will still work regardless.
- **Tag indexing eventual consistency**: Search results may not include blobs uploaded in the last few minutes. This should be documented in API responses and Swagger docs.
- **SAS token permissions**: If using SAS token auth, the token must include the `t` (tag) permission for `setTags()`. If the `tags` property in upload options fails, it will cause the upload itself to fail. This is a breaking risk for existing SAS tokens that lack tag permissions.

### Mitigation for SAS Token Tag Permission Risk
The `tags` property in upload options is passed alongside `metadata`. If the storage account or SAS token does not support tags, the entire upload will fail. To mitigate:
- In `uploadEntryToBlob()`, attempt upload with both metadata and tags first
- If the upload fails and the error indicates a tag permission issue, retry with metadata only (no tags) and log a warning
- This graceful degradation ensures existing deployments are not broken

---

## 10. Open Questions

1. **Tag permission fallback**: Should we implement the graceful degradation described above, or fail hard when tags cannot be set? (Recommendation: implement fallback with warning log, register as a pending item if not implemented)

2. **Blob search authentication**: The `findBlobsByTags()` operation requires storage-account-level authentication (not container-level). For deployments using only sync-pair SAS tokens (container-scoped), the search endpoint may not work. Should we document this limitation or provide an alternative?

3. **Search result pagination**: The current design uses `maxResults` with a `truncated` flag. Should we add cursor-based pagination for large result sets? (Recommendation: defer to a future plan)
