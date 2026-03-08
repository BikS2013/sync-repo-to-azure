# Codebase Analysis: Adding Blob Metadata for Source Tracking

**Date:** 2026-03-02
**Objective:** Add per-blob metadata (source registry, source path, sync time) to every file uploaded to Azure Blob Storage during repository replication.

---

## 1. Project Overview

| Attribute | Value |
|-----------|-------|
| **Language** | TypeScript |
| **Runtime** | Node.js |
| **Build System** | npm + tsc (tsconfig.json) |
| **Key Framework** | Express.js (REST API), Commander.js (CLI) |
| **Azure SDK** | `@azure/storage-blob` v12.31.0+ |
| **Archive Libraries** | `tar-stream` (GitHub tarballs), `unzipper` (Azure DevOps zips) |
| **Entry Points** | CLI: `src/index.ts`, API: `src/api/server.ts` |

---

## 2. Architecture Map

### Replication Pipeline Flow

```
CLI / API Request
       |
       v
RepoReplicationService  (src/services/repo-replication.service.ts)
  |-- replicateGitHub()        -> GitHubClientService.getArchiveStream() -> streamTarToBlob()
  |-- replicateDevOps()        -> DevOpsClientService.getArchiveStream() -> streamZipToBlob()
  |-- replicateFromSyncConfig() -> executeSyncPair() -> replicateGitHubSyncPair() or replicateDevOpsSyncPair()
       |
       v
streamTarToBlob() / streamZipToBlob()
       |
       v  (per entry/file in archive)
uploadEntryToBlob()
       |
       v
BlockBlobClient.upload() or BlockBlobClient.uploadStream()
```

### Key Insight: Individual File Upload

The archive (tarball or zip) is **streamed and extracted entry-by-entry**. Each individual file from the repository is uploaded as a **separate blob** to Azure Blob Storage. This means metadata can be set on each individual blob.

---

## 3. Relevant Symbol Map

### 3.1 Core Upload Method

**File:** `src/services/repo-replication.service.ts`
**Symbol:** `RepoReplicationService.uploadEntryToBlob()` (lines 689-728)
**Signature:** `private async uploadEntryToBlob(containerClient: ContainerClient, blobPath: string, entryStream: Readable, size?: number): Promise<{ success: boolean; size: number; error?: string }>`

This is the **single point** where all blobs are created. It uses two Azure SDK methods:
- **Small files** (< 4 MB): `blockBlobClient.upload(buffer, buffer.length)` (line 709)
- **Large files** (>= 4 MB or unknown size): `blockBlobClient.uploadStream(entryStream.pipe(counter))` (line 720)

**Neither call currently passes metadata options.**

### 3.2 Tar Streaming (GitHub)

**File:** `src/services/repo-replication.service.ts`
**Symbol:** `RepoReplicationService.streamTarToBlob()` (lines 429-545)
**Signature:** `private async streamTarToBlob(archiveStream: Readable, destPath: string, repoIdentifier: string, containerClient?: ContainerClient): Promise<StreamingStats>`

- `repoIdentifier` is in format `owner/repo` (e.g., `"octocat/Hello-World"`)
- Per-entry `strippedPath` is the file path inside the repo (after stripping the first directory component from the tarball)
- Calls `uploadEntryToBlob(client, blobPath, entryStream, header.size)` at line 506

### 3.3 Zip Streaming (Azure DevOps)

**File:** `src/services/repo-replication.service.ts`
**Symbol:** `RepoReplicationService.streamZipToBlob()` (lines 559-676)
**Signature:** `private async streamZipToBlob(archiveStream: Readable, destPath: string, repoIdentifier: string, containerClient?: ContainerClient): Promise<StreamingStats>`

- `repoIdentifier` is in format `org/project/repo` (e.g., `"myorg/myproject/myrepo"`)
- Per-entry `entryPath` is the file path directly from the zip entry (no stripping needed for DevOps zips)
- Calls `uploadEntryToBlob(client, blobPath, entryAsReadable, size)` at line 634

### 3.4 Replication Entry Points (Source Info Available)

| Method | Lines | Platform | Source Identifier Format | Ref Available |
|--------|-------|----------|-------------------------|---------------|
| `replicateGitHub()` | 80-149 | `"github"` | `owner/repo` | Yes (resolved or provided) |
| `replicateDevOps()` | 158-220 | `"azure-devops"` | `org/project/repo` | Yes (or `"default"`) |
| `replicateGitHubSyncPair()` | 316-364 | `"github"` | `owner/repo` | Yes (resolved or provided) |
| `replicateDevOpsSyncPair()` | 369-415 | `"azure-devops"` | `org/project/repo` | Yes (or `"default"`) |

### 3.5 Type Definitions

**File:** `src/types/repo-replication.types.ts`

| Interface | Lines | Relevance |
|-----------|-------|-----------|
| `RepoReplicationResult` | 65-90 | Contains `platform`, `source`, `ref` -- result type returned after replication |
| `RepoFileUploadResult` | 51-62 | Per-file result tracking (currently: repoPath, blobPath, size, success, error) |
| `GitHubRepoParams` | 19-26 | Input params: `repo`, `ref?`, `destPath` |
| `DevOpsRepoParams` | 29-44 | Input params: `organization`, `project`, `repository`, `ref?`, `destPath` |
| `StreamingStats` | 30-36 (in service file) | Internal: aggregates upload stats |
| `RepoPlatform` | 6 | Type: `"github" | "azure-devops"` |

### 3.6 Azure Blob SDK Imports

**File:** `src/services/repo-replication.service.ts`, line 5
Currently imports only: `ContainerClient`
Will need: `BlockBlobUploadOptions`, `BlockBlobUploadStreamOptions` (or use the `metadata` property directly on existing upload/uploadStream options)

---

## 4. Pattern Catalog

### 4.1 Error Handling
- All errors in `uploadEntryToBlob` are caught and returned as `{ success: false, error: message }` -- errors do NOT throw, they are collected in `stats.failedFiles`.
- Custom error classes: `RepoReplicationError`, `ConfigError`, `AuthError` (all extend `AzureFsError`).

### 4.2 Logging
- Uses `Logger` from `src/utils/logger.utils.ts` with levels: debug, info, warn, error.
- Per-file upload logs at debug level: `this.logger.debug(`Uploaded: ${blobPath} (${result.size} bytes)`)`.

### 4.3 Config Convention
- No fallback values allowed for configuration settings (per project rules).
- Environment variables prefixed with `AZURE_FS_` or `AZURE_VENV_`.

### 4.4 Code Style
- Private methods use the `private` access modifier.
- Async/await pattern throughout.
- No semicolons enforced (mixed usage observed).

---

## 5. Impact Analysis

### 5.1 Files That MUST Be Modified

| File | Change Description |
|------|--------------------|
| **`src/services/repo-replication.service.ts`** | (1) Modify `uploadEntryToBlob()` to accept and pass metadata to `blockBlobClient.upload()` and `blockBlobClient.uploadStream()`. (2) Modify `streamTarToBlob()` to pass source registry, source path, and sync time to `uploadEntryToBlob()`. (3) Modify `streamZipToBlob()` similarly. |
| **`src/types/repo-replication.types.ts`** | (Optional) Add a `BlobMetadata` interface or extend `RepoFileUploadResult` if metadata needs to be tracked in results. |

### 5.2 Azure SDK Metadata Mechanism

The `@azure/storage-blob` SDK supports metadata on both `upload()` and `uploadStream()`:

```typescript
// For blockBlobClient.upload():
await blockBlobClient.upload(buffer, buffer.length, {
  metadata: {
    source_registry: "octocat/Hello-World",
    source_path: "src/index.ts",
    sync_time: "2026-03-02T10:30:00.000Z",
  },
});

// For blockBlobClient.uploadStream():
await blockBlobClient.uploadStream(stream, undefined, undefined, {
  metadata: {
    source_registry: "octocat/Hello-World",
    source_path: "src/index.ts",
    sync_time: "2026-03-02T10:30:00.000Z",
  },
});
```

**Azure Blob metadata constraints:**
- Keys: case-insensitive, must be valid C# identifiers (letters, digits, underscore; no hyphens)
- Values: strings only, up to 8 KB total for all key-value pairs combined
- Metadata is indexed and searchable via Azure Blob inventory / Azure Cognitive Search

### 5.3 Signature Change for `uploadEntryToBlob`

Current:
```typescript
private async uploadEntryToBlob(
    containerClient: ContainerClient,
    blobPath: string,
    entryStream: Readable,
    size?: number,
): Promise<{ success: boolean; size: number; error?: string }>
```

Proposed:
```typescript
private async uploadEntryToBlob(
    containerClient: ContainerClient,
    blobPath: string,
    entryStream: Readable,
    size?: number,
    metadata?: Record<string, string>,
): Promise<{ success: boolean; size: number; error?: string }>
```

### 5.4 Callers of `uploadEntryToBlob` (2 call sites)

1. **`streamTarToBlob()`** line 506 -- must construct metadata with:
   - `source_registry`: `repoIdentifier` (already available as parameter, format: `owner/repo`)
   - `source_path`: `strippedPath` (already available as local variable)
   - `sync_time`: `new Date().toISOString()`

2. **`streamZipToBlob()`** line 634 -- must construct metadata with:
   - `source_registry`: `repoIdentifier` (already available as parameter, format: `org/project/repo`)
   - `source_path`: `entryPath` (already available as local variable)
   - `sync_time`: `new Date().toISOString()`

### 5.5 API and CLI Impact

- **No API or CLI changes required** for the basic feature. The metadata is set transparently during upload.
- The `RepoReplicationResult` and `RepoFileUploadResult` types do not need changes unless the caller wants to see metadata in the response.
- Swagger docs do not need updates unless we add metadata to the response payload.

---

## 6. Risk Assessment

### 6.1 Low Risk
- **Single modification point:** All blob uploads go through `uploadEntryToBlob()` -- only one method to change.
- **No breaking changes:** Adding an optional `metadata` parameter does not break existing callers.
- **No performance impact:** Metadata is included in the same HTTP PUT request as the blob content -- no additional API call.

### 6.2 Medium Risk
- **Metadata key naming:** Azure Blob metadata keys cannot contain hyphens. Use underscores: `source_registry`, `source_path`, `sync_time`.
- **Metadata value encoding:** File paths with special characters (unicode, spaces) should be safe as Azure metadata values are UTF-8 strings, but paths should not exceed the 8 KB total metadata limit per blob.

### 6.3 Considerations
- **Sync time granularity:** Using a single `new Date().toISOString()` per file means files within the same sync batch will have slightly different timestamps (milliseconds apart). This is acceptable and actually more accurate. Alternatively, capture a single timestamp at the batch level and pass it through -- this provides better consistency for "when was this sync run started."
- **Searching by metadata:** Azure Blob Storage does not natively support querying blobs by metadata. To enable searching, you need either:
  - **Azure Blob Inventory** + **Azure Data Lake Analytics** / **Synapse**
  - **Azure Cognitive Search** with a blob indexer (supports metadata fields)
  - **Blob index tags** (alternative to metadata, max 10 tags, but natively searchable via `findBlobsByTags()`)

---

## 7. Constraints Discovered

1. **No existing metadata is set on blobs.** The current upload calls pass no options at all. This is a clean slate.

2. **Two upload paths exist** in `uploadEntryToBlob()`:
   - `blockBlobClient.upload(buffer, length)` for small files -- accepts `BlockBlobUploadOptions` as 3rd param
   - `blockBlobClient.uploadStream(stream)` for large files -- accepts `BlockBlobUploadStreamOptions` as 4th param (after bufferSize and maxConcurrency)
   Both option types support a `metadata` property.

3. **The `ContainerClient` import is the only Azure SDK import** in the replication service. Adding metadata does NOT require importing new types (metadata is passed as a plain `Record<string, string>` in the options object).

4. **Archive entry paths differ between platforms:**
   - **GitHub (tar):** Paths include a first component (e.g., `repo-ref-sha/src/index.ts`), stripped by `stripFirstComponent()` to `src/index.ts`
   - **Azure DevOps (zip):** Paths are used as-is from the zip entry (e.g., `src/index.ts`)

5. **The `repoIdentifier` is always available** in both `streamTarToBlob()` and `streamZipToBlob()` as a parameter, making it easy to pass as the `source_registry` metadata value.

6. **Blob index tags vs. metadata trade-off:** If the goal is to enable **searching** blobs by source registry or path, **blob index tags** (`setTags()`) would be more appropriate than metadata, because Azure Blob Storage supports native tag-based queries via `findBlobsByTags()`. However, tags have a limit of 10 per blob and 256 chars per value. Metadata has no count limit but is not natively searchable. The request specifically asks for "metadata" so we implement metadata, but the search use case should be noted.

---

## 8. Recommended Implementation Approach

### Step 1: Modify `uploadEntryToBlob()` signature
Add an optional `metadata?: Record<string, string>` parameter.

### Step 2: Pass metadata to both upload methods
```typescript
// Small file path:
await blockBlobClient.upload(buffer, buffer.length, { metadata });

// Large file path:
await blockBlobClient.uploadStream(entryStream.pipe(counter), undefined, undefined, { metadata });
```

### Step 3: Construct metadata in `streamTarToBlob()` and `streamZipToBlob()`
```typescript
const blobMetadata: Record<string, string> = {
  source_registry: repoIdentifier,    // "owner/repo" or "org/project/repo"
  source_path: strippedPath,           // or entryPath for zip
  sync_time: new Date().toISOString(), // ISO 8601 timestamp
};
```

### Step 4: Pass metadata to `uploadEntryToBlob()` calls
Both call sites in `streamTarToBlob()` (line 506) and `streamZipToBlob()` (line 634).

### Files to modify:
- `src/services/repo-replication.service.ts` (the only file that needs code changes)

### Files that may optionally be updated:
- `src/types/repo-replication.types.ts` -- if we want to define a typed metadata interface
- `docs/design/project-design.md` -- document the metadata feature
- `docs/design/project-functions.md` -- register the new functionality
- `docs/design/configuration-guide.md` -- no new config needed (metadata is automatic)
- `CLAUDE.md` -- no new CLI/API commands needed
