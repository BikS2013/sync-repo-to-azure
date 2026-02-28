# Plan 007: Repository Replication to Azure Blob Storage

**Date**: 2026-02-28
**Status**: Draft
**Prerequisites**: Investigation document at `docs/reference/investigation-repo-replication.md`

---

## 1. Objective

Extend the azure-fs tool to replicate complete GitHub and Azure DevOps repositories into Azure Blob Storage folders. Both capabilities must be available through the CLI and REST API interfaces. The implementation uses a **direct streaming** approach: archive content (tarball for GitHub, zip for Azure DevOps) is streamed directly from the source platform into Azure Blob Storage with **zero intermediate local disk usage**. Each file entry is piped from the archive stream to `BlockBlobClient.uploadStream()` on-the-fly.

---

## 2. Phase Overview

| Phase | Name | Description | Depends On | Parallelizable With |
|-------|------|-------------|------------|---------------------|
| 1 | Foundation: Types, Config, and Error Classes | Define new types, config parameters, and error classes | None | None |
| 2 | GitHub Client Service | Implement GitHub API client using `@octokit/rest` | Phase 1 | Phase 3 |
| 3 | Azure DevOps Client Service | Implement Azure DevOps API client using native fetch | Phase 1 | Phase 2 |
| 4 | Repo Replication Orchestrator Service | Implement the extraction and upload orchestration | Phases 2, 3 | None |
| 5 | CLI Commands | Register `repo clone-github` and `repo clone-devops` commands | Phase 4 | Phase 6 |
| 6 | API Routes, Controller, and Swagger | Implement REST API endpoints for both replication operations | Phase 4 | Phase 5 |
| 7 | Documentation Update | Update CLAUDE.md, project-design.md, configuration-guide.md, cli-instructions.md, api-instructions.md | Phases 5, 6 | None |

---

## 3. Phase 1: Foundation -- Types, Config, and Error Classes

### 3.1 Objective

Define all new TypeScript types, configuration schema extensions, and custom error classes needed by the replication feature before any service code is written.

### 3.2 Files to Create

| File | Purpose |
|------|---------|
| `src/types/repo-replication.types.ts` | Result types for replication operations |
| `src/errors/repo-replication.error.ts` | Custom error class for replication failures |

### 3.3 Files to Modify

| File | Change |
|------|--------|
| `src/types/index.ts` | Add barrel export for `repo-replication.types.ts` |
| `src/types/config.types.ts` | Add optional `github` and `devops` sections to `AzureFsConfigFile` and `ResolvedConfig` |
| `src/config/config.loader.ts` | Load new env vars (`GITHUB_TOKEN`, `GITHUB_TOKEN_EXPIRY`, `AZURE_DEVOPS_PAT`, `AZURE_DEVOPS_PAT_EXPIRY`, `AZURE_DEVOPS_AUTH_METHOD`, `AZURE_DEVOPS_ORG_URL`) into config |
| `src/config/config.schema.ts` | Add validation for the new config sections (conditional: only required when repo commands are invoked) |
| `src/errors/base.error.ts` | Add `REPO_REPLICATION_ERROR` to the error code enum if not using a separate code |
| `src/types/errors.types.ts` | Add new error codes: `REPO_ARCHIVE_DOWNLOAD_FAILED`, `REPO_EXTRACTION_FAILED`, `REPO_AUTH_MISSING`, `REPO_NOT_FOUND` |

### 3.4 New Types Specification

```typescript
// src/types/repo-replication.types.ts

/** Source platform for the repository */
export type RepoPlatform = "github" | "azure-devops";

/** Version type for Azure DevOps (GitHub uses ref directly) */
export type DevOpsVersionType = "branch" | "tag" | "commit";

/** Auth method for Azure DevOps */
export type DevOpsAuthMethod = "pat" | "azure-ad";

/** Parameters for a GitHub replication request */
export interface GitHubRepoParams {
  /** Repository in "owner/repo" format */
  repo: string;
  /** Git ref: branch name, tag, or commit SHA. If omitted, default branch is used. */
  ref?: string;
  /** Destination folder path in Azure Blob Storage */
  destPath: string;
}

/** Parameters for an Azure DevOps replication request */
export interface DevOpsRepoParams {
  /** Azure DevOps organization name */
  organization: string;
  /** Project name */
  project: string;
  /** Repository name or GUID */
  repository: string;
  /** Version identifier (branch name, tag, commit SHA) */
  ref?: string;
  /** How to interpret the ref */
  versionType?: DevOpsVersionType;
  /** Destination folder path in Azure Blob Storage */
  destPath: string;
  /** Whether to resolve LFS pointers */
  resolveLfs?: boolean;
}

/** Per-file upload result within a replication operation */
export interface RepoFileUploadResult {
  /** Relative path within the repository */
  repoPath: string;
  /** Full blob path in Azure Storage */
  blobPath: string;
  /** File size in bytes */
  size: number;
  /** Whether this file was uploaded successfully */
  success: boolean;
  /** Error message if upload failed */
  error?: string;
}

/** Aggregate result of a repository replication operation */
export interface RepoReplicationResult {
  /** Source platform */
  platform: RepoPlatform;
  /** Source repository identifier */
  source: string;
  /** Git ref that was replicated */
  ref: string;
  /** Destination folder path in Azure Blob Storage */
  destPath: string;
  /** Total number of files discovered in the archive */
  totalFiles: number;
  /** Number of files successfully uploaded */
  successCount: number;
  /** Number of files that failed to upload */
  failedCount: number;
  /** Total bytes uploaded */
  totalBytes: number;
  /** Duration of the streaming operation (stream + upload combined) in milliseconds */
  streamingDurationMs: number;
  /** Total wall-clock duration in milliseconds */
  totalDurationMs: number;
  /** Per-file results (only included if there were failures, to avoid huge payloads) */
  failedFiles?: RepoFileUploadResult[];
}
```

### 3.5 Configuration Extensions

New environment variables:

| Variable | Config Key | Required | Purpose |
|----------|-----------|----------|---------|
| `GITHUB_TOKEN` | N/A (secret) | When using `repo clone-github` on private repos | GitHub Personal Access Token |
| `GITHUB_TOKEN_EXPIRY` | `github.tokenExpiry` | No (recommended) | ISO 8601 expiry date for proactive warning |
| `AZURE_DEVOPS_PAT` | N/A (secret) | When `AZURE_DEVOPS_AUTH_METHOD=pat` | Azure DevOps Personal Access Token |
| `AZURE_DEVOPS_PAT_EXPIRY` | `devops.patExpiry` | No (recommended) | ISO 8601 expiry date for proactive warning |
| `AZURE_DEVOPS_AUTH_METHOD` | `devops.authMethod` | When using `repo clone-devops` | `pat` or `azure-ad` |
| `AZURE_DEVOPS_ORG_URL` | `devops.orgUrl` | No (can be derived from --org) | Default org URL: `https://dev.azure.com/{org}` |

**Config loading strategy**: These config values are only validated when a repo replication command is invoked, not at startup. This means existing users of file/folder/edit commands are unaffected. The validation is performed inside the GitHub/DevOps client services, following the project's "no fallback" policy: missing required tokens throw `ConfigError`.

### 3.6 Acceptance Criteria

- [ ] `RepoReplicationResult` and related types compile with no errors
- [ ] `RepoReplicationError` extends `AzureFsError` with proper error codes
- [ ] Config loader reads new env vars when present
- [ ] Config validation throws `ConfigError` for missing `GITHUB_TOKEN` when GitHub replication is attempted on a private repo
- [ ] Config validation throws `ConfigError` for missing `AZURE_DEVOPS_PAT` when DevOps auth method is `pat`
- [ ] Token expiry check warns (logs) when token is within 7 days of expiry, throws when expired
- [ ] Existing commands and tests continue to work unchanged

---

## 4. Phase 2: GitHub Client Service

### 4.1 Objective

Implement a service that authenticates with the GitHub API, downloads a tarball archive of a repository, and returns the archive stream/path for extraction.

### 4.2 npm Packages to Install

| Package | Version | Purpose |
|---------|---------|---------|
| `@octokit/rest` | latest | GitHub REST API client with TypeScript types |
| `tar-stream` | latest | Low-level streaming tar extraction with entry-by-entry control |
| `@types/tar-stream` | latest | TypeScript type definitions for `tar-stream` |

### 4.3 Files to Create

| File | Purpose |
|------|---------|
| `src/services/github-client.service.ts` | GitHub API wrapper: auth, metadata fetch, archive download |

### 4.4 Service API Design

```typescript
class GitHubClientService {
  constructor(logger: Logger);

  /** Validate that a GitHub token is available (for private repos) */
  validateAuth(requireToken: boolean): void;

  /** Get repository metadata (default branch, visibility) */
  getRepoInfo(owner: string, repo: string): Promise<GitHubRepoInfo>;

  /** Get tarball archive as a readable stream (NOT downloaded to disk) */
  getArchiveStream(owner: string, repo: string, ref: string): Promise<NodeJS.ReadableStream>;
}
```

### 4.5 Key Implementation Details

- Use `@octokit/rest` with `auth: process.env.GITHUB_TOKEN` (or unauthenticated for public repos)
- `getArchiveStream()` calls `octokit.rest.repos.downloadTarballArchive()` with `parseSuccessResponseBody: false` to avoid buffering the entire archive in memory
- Returns a Node.js `ReadableStream` which the orchestrator pipes through `zlib.createGunzip()` and `tar-stream` extract
- **No temp files**: the stream flows directly from GitHub to the archive parser
- Check `GITHUB_TOKEN_EXPIRY` at construction time; warn if within 7 days, throw if expired
- Handle 404 (repo not found) -> throw `RepoReplicationError` with `REPO_NOT_FOUND`
- Handle 403 (rate limit or auth) -> throw `RepoReplicationError` with descriptive message including rate limit headers

### 4.6 Acceptance Criteria

- [ ] `GitHubClientService` can be instantiated with or without a token
- [ ] `getRepoInfo()` returns the default branch and whether the repo is private
- [ ] `getArchiveStream()` returns a readable stream (NOT a file path) that can be piped through gunzip and tar-stream
- [ ] No temp files are created on disk during archive retrieval
- [ ] Token expiry warning is logged 7 days before expiry
- [ ] Expired token throws `ConfigError`
- [ ] Missing token for private repo throws `ConfigError`
- [ ] Rate limit 403 is caught and rethrown with helpful message
- [ ] 404 for nonexistent repo throws `RepoReplicationError`

---

## 5. Phase 3: Azure DevOps Client Service

### 5.1 Objective

Implement a service that authenticates with the Azure DevOps REST API, downloads a zip archive of a repository, and returns the archive path for extraction.

### 5.2 npm Packages to Install

| Package | Version | Purpose |
|---------|---------|---------|
| `unzipper` | latest | Streaming zip extraction -- parses zip entries from an HTTP response stream |

Note: `unzipper` has built-in TypeScript types.

### 5.3 Files to Create

| File | Purpose |
|------|---------|
| `src/services/devops-client.service.ts` | Azure DevOps API wrapper: auth, archive download |

### 5.4 Service API Design

```typescript
class DevOpsClientService {
  constructor(logger: Logger);

  /** Validate Azure DevOps auth configuration */
  validateAuth(): void;

  /** Get zip archive as a readable stream (NOT downloaded to disk) */
  getArchiveStream(
    organization: string,
    project: string,
    repository: string,
    ref?: string,
    versionType?: DevOpsVersionType,
    resolveLfs?: boolean,
  ): Promise<NodeJS.ReadableStream>;
}
```

### 5.5 Key Implementation Details

- Two auth methods, selected by `AZURE_DEVOPS_AUTH_METHOD` env var:
  - **PAT**: `Authorization: Basic ${Buffer.from(':' + pat).toString('base64')}`
  - **azure-ad**: Use `DefaultAzureCredential` from `@azure/identity` (already a project dependency) with scope `499b84ac-1321-427f-aa17-267ca6975798/.default`
- Build the Items API URL:
  ```
  GET https://dev.azure.com/{org}/{project}/_apis/git/repositories/{repo}/items
    ?path=/&$format=zip&recursionLevel=Full&versionDescriptor.version={ref}
    &versionDescriptor.versionType={versionType}&resolveLfs={resolveLfs}
    &zipForUnix=true&api-version=7.1
  ```
- Use native `fetch` (Node 18+ built-in) for the HTTP request
- Return the response body as a Node.js `ReadableStream` via `Readable.fromWeb()` -- **no temp files**
- The orchestrator pipes this stream through `unzipper.Parse()` for streaming extraction
- Check `AZURE_DEVOPS_PAT_EXPIRY` at construction time (same pattern as GitHub)
- Handle 401/403 -> throw with auth-specific message
- Handle 404 -> throw `RepoReplicationError` with `REPO_NOT_FOUND`
- Honor `Retry-After` header on 429 responses

### 5.6 Acceptance Criteria

- [ ] `DevOpsClientService` authenticates with PAT
- [ ] `DevOpsClientService` authenticates with Azure AD (`DefaultAzureCredential`)
- [ ] `getArchiveStream()` returns a readable stream (NOT a file path) that can be piped through unzipper.Parse()
- [ ] No temp files are created on disk during archive retrieval
- [ ] `resolveLfs=true` is passed when requested
- [ ] `zipForUnix=true` is always set
- [ ] PAT expiry warning at 7 days, error when expired
- [ ] Missing `AZURE_DEVOPS_AUTH_METHOD` throws `ConfigError`
- [ ] Missing `AZURE_DEVOPS_PAT` when method is `pat` throws `ConfigError`
- [ ] 404 throws `RepoReplicationError` with descriptive message

---

## 6. Phase 4: Repo Replication Orchestrator Service

### 6.1 Objective

Implement the central orchestration service that coordinates the streaming pipeline: archive stream retrieval, streaming extraction, and per-entry upload to Azure Blob Storage. This service delegates to the platform-specific clients (Phase 2/3) for stream acquisition and uses `BlockBlobClient` directly for uploads.

### 6.2 Files to Create

| File | Purpose |
|------|---------|
| `src/services/repo-replication.service.ts` | Orchestration: stream -> parse archive entries -> pipe each to blob storage |

### 6.3 Service API Design

```typescript
class RepoReplicationService {
  constructor(
    blobService: BlobFileSystemService,
    logger: Logger,
  );

  /** Replicate a GitHub repository to Azure Blob Storage */
  replicateGitHub(params: GitHubRepoParams): Promise<RepoReplicationResult>;

  /** Replicate an Azure DevOps repository to Azure Blob Storage */
  replicateDevOps(params: DevOpsRepoParams): Promise<RepoReplicationResult>;
}
```

### 6.4 Orchestration Flow (Streaming -- Both Platforms)

**GitHub (tarball stream):**

```
1. Validate configuration (GitHub token for private repos)
2. If ref not specified: call getRepoInfo() to get default_branch
3. Get tarball stream via githubClient.getArchiveStream()
4. Pipe: stream -> zlib.createGunzip() -> tar-stream extract
5. For each tar entry:
   a. Skip if type !== 'file'
   b. Strip first path component (remove "owner-repo-sha/" prefix)
   c. Skip if path contains ".." (path traversal protection)
   d. Build blobPath = destPath + "/" + strippedPath
   e. Upload entry stream to BlockBlobClient.uploadStream() or .upload()
   f. Record per-file success/failure
6. Return RepoReplicationResult
7. NO temp files to clean up
```

**Azure DevOps (zip stream):**

```
1. Validate configuration (PAT or Azure AD)
2. Get zip stream via devopsClient.getArchiveStream()
3. Pipe: stream -> unzipper.Parse()
4. For each zip entry:
   a. Skip if type === 'Directory' (autodrain)
   b. Skip if path contains ".." (path traversal protection)
   c. Build blobPath = destPath + "/" + entry.path
   d. Upload entry stream to BlockBlobClient.uploadStream() or .upload()
   e. Record per-file success/failure
5. Return RepoReplicationResult
6. NO temp files to clean up
```

**Key difference from the previous design**: Download, extraction, and upload are no longer separate phases. They happen concurrently as data flows through the pipeline. This means `streamingDurationMs` replaces the separate `downloadDurationMs`, `extractionDurationMs`, and `uploadDurationMs` fields.

### 6.5 Key Implementation Details

- **Zero local disk usage**: No temp directories, no temp files, no `os.tmpdir()`.
- For GitHub tarball, use `tar-stream` extract with `zlib.createGunzip()`. Manually strip the first path component from each entry name (equivalent to `tar`'s `strip: 1`).
- For Azure DevOps zip, use `unzipper.Parse()` which processes entries sequentially from the stream.
- **Small file optimization**: Files < 4 MB are buffered in memory and uploaded via `blockBlobClient.upload()`. Files >= 4 MB are streamed via `blockBlobClient.uploadStream()`.
- Security: validate that no extracted path contains `..` (path traversal protection).
- Progress: log each file upload at debug level; log total count and bytes at info level after completion.
- **Sequential processing**: Tar and zip streams are inherently sequential; files are uploaded one at a time as they appear in the archive. This is a constraint of the streaming format, not a design limitation.
- The `containerClient` is passed directly to the service for creating `BlockBlobClient` instances per entry.

### 6.6 Files to Modify

| File | Change |
|------|--------|
| (none) | This is a new service with no modifications to existing files |

### 6.7 Acceptance Criteria

- [ ] `replicateGitHub()` streams tarball directly from GitHub to Azure Blob Storage with zero disk usage
- [ ] `replicateDevOps()` streams zip directly from Azure DevOps to Azure Blob Storage with zero disk usage
- [ ] No temp files or temp directories are created during the operation
- [ ] First path component is stripped from GitHub tarball entries
- [ ] Path traversal in archive entries is detected and skipped with a warning log
- [ ] Failed individual file uploads do not abort the entire operation; they are recorded in the result
- [ ] `totalDurationMs` and `streamingDurationMs` are accurately captured
- [ ] Small files (< 4 MB) are buffered and uploaded via `upload()`, large files are streamed via `uploadStream()`

---

## 7. Phase 5: CLI Commands

### 7.1 Objective

Register `repo clone-github` and `repo clone-devops` as CLI subcommands under a new `repo` command group.

### 7.2 Files to Create

| File | Purpose |
|------|---------|
| `src/commands/repo.commands.ts` | CLI command registration for `repo clone-github` and `repo clone-devops` |

### 7.3 Files to Modify

| File | Change |
|------|--------|
| `src/commands/index.ts` | Add `export { registerRepoCommands }` barrel export |
| `src/index.ts` | Call `registerRepoCommands(program)` |

### 7.4 CLI Command Specification

#### `repo clone-github`

```
azure-fs repo clone-github --repo <owner/repo> --dest <path> [--ref <branch|tag|sha>] [--json] [--verbose]
```

| Option | Required | Description |
|--------|----------|-------------|
| `--repo <owner/repo>` | Yes | GitHub repository in `owner/repo` format |
| `--dest <path>` | Yes | Destination folder path in Azure Blob Storage |
| `--ref <ref>` | No | Branch name, tag, or commit SHA. Omit for default branch. |

#### `repo clone-devops`

```
azure-fs repo clone-devops --org <org> --project <project> --repo <repo> --dest <path> [--ref <ref>] [--version-type <branch|tag|commit>] [--resolve-lfs] [--json] [--verbose]
```

| Option | Required | Description |
|--------|----------|-------------|
| `--org <org>` | Yes | Azure DevOps organization name |
| `--project <project>` | Yes | Project name |
| `--repo <repo>` | Yes | Repository name |
| `--dest <path>` | Yes | Destination folder path in Azure Blob Storage |
| `--ref <ref>` | No | Branch, tag, or commit SHA. Omit for default branch. |
| `--version-type <type>` | No | How to interpret `--ref`: `branch` (default), `tag`, or `commit` |
| `--resolve-lfs` | No | Resolve LFS pointers to actual content (Azure DevOps only) |

### 7.5 Command Implementation Pattern

Follow the same pattern as `file.commands.ts`:
1. Parse args and global options
2. `resolveConfig(globalOpts)` to get config
3. Create `Logger`, `BlobFileSystemService`
4. Create `RepoReplicationService(blobService, logger)`
5. Call `service.replicateGitHub(params)` or `service.replicateDevOps(params)`
6. `formatSuccess(result, "repo-clone-github", startTime)` and `outputResult()`
7. Catch errors -> `formatErrorFromException()` + `exitCodeForError()`

### 7.6 Acceptance Criteria

- [ ] `azure-fs repo clone-github --repo owner/repo --dest folder --json` produces valid JSON output
- [ ] `azure-fs repo clone-devops --org myorg --project myproj --repo myrepo --dest folder --json` produces valid JSON output
- [ ] Missing `--repo` or `--dest` prints usage help and exits with code 3
- [ ] `--verbose` enables debug logging throughout the operation
- [ ] `--ref` is correctly forwarded to the service
- [ ] `--resolve-lfs` is only available on `clone-devops`
- [ ] Exit code 1 for operation errors (network, archive, etc.)
- [ ] Exit code 2 for auth/config errors

---

## 8. Phase 6: API Routes, Controller, and Swagger

### 8.1 Objective

Expose repository replication via the REST API with full Swagger documentation.

### 8.2 Files to Create

| File | Purpose |
|------|---------|
| `src/api/routes/repo.routes.ts` | Route definitions for `/api/v1/repo/github` and `/api/v1/repo/devops` |
| `src/api/controllers/repo.controller.ts` | Request handlers for repo replication endpoints |

### 8.3 Files to Modify

| File | Change |
|------|--------|
| `src/api/routes/index.ts` | Import and mount `createRepoRoutes` at `/api/v1/repo`; add `RepoReplicationService` to `ApiServices` |
| `src/api/server.ts` | Instantiate `RepoReplicationService` and pass to route registration |

### 8.4 API Endpoints

#### POST /api/v1/repo/github

**Request Body (JSON):**

```json
{
  "repo": "owner/repo",
  "ref": "main",
  "destPath": "repos/my-project"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `repo` | string | Yes | GitHub repository in `owner/repo` format |
| `ref` | string | No | Branch, tag, or SHA. Omit for default branch. |
| `destPath` | string | Yes | Destination folder in Azure Blob Storage |

**Response (200):**

```json
{
  "success": true,
  "data": {
    "platform": "github",
    "source": "owner/repo",
    "ref": "main",
    "destPath": "repos/my-project",
    "totalFiles": 142,
    "successCount": 142,
    "failedCount": 0,
    "totalBytes": 5242880,
    "streamingDurationMs": 9500,
    "totalDurationMs": 11750
  },
  "metadata": {
    "command": "repo-clone-github",
    "timestamp": "2026-02-28T10:00:00.000Z",
    "durationMs": 11750
  }
}
```

#### POST /api/v1/repo/devops

**Request Body (JSON):**

```json
{
  "organization": "myorg",
  "project": "myproject",
  "repository": "myrepo",
  "ref": "main",
  "versionType": "branch",
  "destPath": "repos/my-devops-project",
  "resolveLfs": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `organization` | string | Yes | Azure DevOps organization name |
| `project` | string | Yes | Project name |
| `repository` | string | Yes | Repository name |
| `ref` | string | No | Version identifier. Omit for default branch. |
| `versionType` | string | No | `branch` (default), `tag`, or `commit` |
| `destPath` | string | Yes | Destination folder in Azure Blob Storage |
| `resolveLfs` | boolean | No | Resolve LFS pointers (default: false) |

**Response (200):** Same structure as GitHub endpoint with `platform: "azure-devops"`.

### 8.5 Swagger Annotations

Both endpoints must include full `@openapi` JSDoc annotations in `repo.routes.ts` following the established pattern from `file.routes.ts`. The annotations must define:
- `operationId`
- `summary` and `description`
- `tags: [Repository Replication]`
- Request body schema
- 200, 400, 401, 404, 500 response schemas

### 8.6 Error Responses

| HTTP Status | Error Code | Condition |
|-------------|-----------|-----------|
| 400 | `REPO_MISSING_PARAMS` | Required fields missing from request body |
| 401 | `REPO_AUTH_MISSING` | Token not configured for private repo or DevOps |
| 404 | `REPO_NOT_FOUND` | Repository does not exist or not accessible |
| 408 | `REQUEST_TIMEOUT` | Operation exceeded request timeout |
| 500 | `REPO_REPLICATION_ERROR` | Archive download, extraction, or upload failure |

### 8.7 Timeout Consideration

Repository replication is a long-running operation. The existing `requestTimeoutMs` may be too short. Two approaches:

**Option A (recommended)**: The repo replication endpoints bypass the global timeout middleware by applying a longer timeout specifically to these routes. A reasonable value is 5 minutes (300000ms).

**Option B**: Document that users should increase `AZURE_FS_API_REQUEST_TIMEOUT_MS` when using repo replication endpoints.

The plan recommends Option A: apply a longer timeout to `/api/v1/repo/*` routes explicitly.

### 8.8 Acceptance Criteria

- [ ] `POST /api/v1/repo/github` replicates a GitHub repo and returns `RepoReplicationResult`
- [ ] `POST /api/v1/repo/devops` replicates an Azure DevOps repo and returns `RepoReplicationResult`
- [ ] Missing required fields return 400 with descriptive error
- [ ] Auth errors return 401
- [ ] Repo not found returns 404
- [ ] Swagger UI shows both endpoints with full schema
- [ ] Long-running requests do not time out prematurely

---

## 9. Phase 7: Documentation Update

### 9.1 Objective

Update all project documentation to reflect the new repo replication capability.

### 9.2 Files to Modify

| File | Change |
|------|--------|
| `CLAUDE.md` | Add `repo.commands.ts` to project structure; add new env vars; add `repo-replication.service.ts`, `github-client.service.ts`, `devops-client.service.ts` to service listing; add `repo.routes.ts`, `repo.controller.ts` to API listing; add `repo-replication.types.ts` and `repo-replication.error.ts` to types/errors listing |
| `cli-instructions.md` | Add `repo clone-github` and `repo clone-devops` command documentation with examples |
| `api-instructions.md` | Add `POST /api/v1/repo/github` and `POST /api/v1/repo/devops` endpoint documentation with curl examples |
| `docs/design/project-design.md` | Add repo replication to architecture diagram; add new service layer entries; add new dependency graph entries |
| `docs/design/project-functions.md` | Add section 14 with functional requirements (see separate update) |
| `docs/design/configuration-guide.md` | Add configuration entries for `GITHUB_TOKEN`, `GITHUB_TOKEN_EXPIRY`, `AZURE_DEVOPS_PAT`, `AZURE_DEVOPS_PAT_EXPIRY`, `AZURE_DEVOPS_AUTH_METHOD`, `AZURE_DEVOPS_ORG_URL` |
| `Issues - Pending Items.md` | Register any gaps found during documentation |

### 9.3 Acceptance Criteria

- [ ] All six documentation files are updated
- [ ] New env vars are listed in CLAUDE.md environment variables table
- [ ] New files are listed in CLAUDE.md project structure
- [ ] CLI instructions include full command syntax and examples
- [ ] API instructions include curl examples for both endpoints
- [ ] Configuration guide documents every new variable with purpose, how to obtain, recommended management
- [ ] No gaps between code and documentation

---

## 10. Complete File Inventory

### 10.1 New Files (7)

| File | Phase |
|------|-------|
| `src/types/repo-replication.types.ts` | 1 |
| `src/errors/repo-replication.error.ts` | 1 |
| `src/services/github-client.service.ts` | 2 |
| `src/services/devops-client.service.ts` | 3 |
| `src/services/repo-replication.service.ts` | 4 |
| `src/commands/repo.commands.ts` | 5 |
| `src/api/routes/repo.routes.ts` | 6 |
| `src/api/controllers/repo.controller.ts` | 6 |

### 10.2 Modified Files (14)

| File | Phase |
|------|-------|
| `src/types/index.ts` | 1 |
| `src/types/config.types.ts` | 1 |
| `src/types/errors.types.ts` | 1 |
| `src/config/config.loader.ts` | 1 |
| `src/config/config.schema.ts` | 1 |
| `src/commands/index.ts` | 5 |
| `src/index.ts` | 5 |
| `src/api/routes/index.ts` | 6 |
| `src/api/server.ts` | 6 |
| `CLAUDE.md` | 7 |
| `cli-instructions.md` | 7 |
| `api-instructions.md` | 7 |
| `docs/design/project-design.md` | 7 |
| `docs/design/project-functions.md` | 7 |
| `docs/design/configuration-guide.md` | 7 |
| `Issues - Pending Items.md` | 7 |

### 10.3 npm Packages to Install (3)

| Package | Type | Phase |
|---------|------|-------|
| `@octokit/rest` | production | 2 |
| `tar-stream` | production | 2 |
| `unzipper` | production | 3 |

Note: `@types/tar-stream` is a dev dependency. `unzipper` has built-in TypeScript types.

---

## 11. Dependency Graph (Execution Order)

```
Phase 1 (Foundation)
  |
  +--> Phase 2 (GitHub Client) --+
  |                               |
  +--> Phase 3 (DevOps Client) --+
                                  |
                                  v
                          Phase 4 (Orchestrator)
                                  |
                          +-------+-------+
                          |               |
                          v               v
                  Phase 5 (CLI)   Phase 6 (API)
                          |               |
                          +-------+-------+
                                  |
                                  v
                      Phase 7 (Documentation)
```

**Parallelizable pairs:**
- Phase 2 and Phase 3 (no dependencies between them)
- Phase 5 and Phase 6 (no dependencies between them)

---

## 12. Risks and Mitigations

### 12.1 Large Repository Size

**Risk**: Repositories with many large files (e.g., monorepos) may take very long to stream and upload, and individual large files may consume significant memory during buffering.

**Mitigation**:
- The streaming design eliminates disk space requirements entirely (zero local storage).
- Large files (>= 4 MB) are streamed via `uploadStream()` without full buffering.
- For the API, apply a generous per-route timeout (5 minutes).
- Log per-file upload progress at debug level; log total count and bytes at info level.

### 12.2 GitHub Rate Limiting

**Risk**: Unauthenticated requests are limited to 60/hour, which could cause failures for even a single archive download if the user makes other API calls.

**Mitigation**:
- Always recommend using `GITHUB_TOKEN`.
- If archive download fails with 403 and `X-RateLimit-Remaining: 0`, throw a clear error message advising the user to set `GITHUB_TOKEN`.
- The archive download is a single API call, so rate limits are unlikely to be hit in normal authenticated usage.

### 12.3 Azure DevOps TSTU Throttling

**Risk**: Large zip downloads consume significant TSTU budget.

**Mitigation**:
- Honor `Retry-After` header on 429 responses.
- Log warnings when `X-RateLimit-Remaining` is low.
- Document that very large repos may require waiting between replication attempts.

### 12.4 Streaming Pipeline Failure

**Risk**: If the streaming pipeline fails mid-way (e.g., network error during upload of a file), already-uploaded files remain in blob storage, and the operation cannot be resumed.

**Mitigation**:
- Individual file upload failures are recorded but do not abort the overall stream processing.
- The result includes `failedFiles` array so callers can identify and retry specific files.
- Since no temp files are created, there is no cleanup burden on failure.
- Note: There is no checkpoint/resume mechanism. A failed operation must be restarted from the beginning.

### 12.5 Archive Contains Path Traversal Entries

**Risk**: Malicious or corrupted archives could contain `../` paths.

**Mitigation**:
- For tarball: check each `header.name` for `..` before processing.
- For zip: check each `entry.path` for `..` before processing.
- Skip (with warning log) any entry whose path contains `..`. The entry stream is autodrained to avoid stalling the parser.

### 12.6 Git LFS and Submodule Limitations

**Risk**: Users expect full content but receive pointer files.

**Mitigation**:
- Document clearly in CLI help, API docs, and project-functions.md.
- Azure DevOps: offer `--resolve-lfs` / `resolveLfs` option (supported by the API).
- GitHub: no API support for LFS resolution; document this limitation.
- Submodules: document that neither platform includes submodule content.

### 12.7 npm Package Compatibility

**Risk**: `@octokit/rest`, `tar-stream`, or `unzipper` may have breaking changes or incompatibilities with the project's TypeScript/Node version.

**Mitigation**:
- Pin specific versions in `package.json`.
- Test during Phase 2/3 implementation.
- `tar-stream` is widely used (~8M weekly downloads) and well-maintained.
- `unzipper` is mature (~3M weekly downloads) with built-in TypeScript types.

---

## 13. Configuration Policy Alignment

Per project conventions, the following strict rules apply:

1. **No fallback values**: Missing `GITHUB_TOKEN` for private repo access throws `ConfigError`. Missing `AZURE_DEVOPS_PAT` when auth method is `pat` throws `ConfigError`. Missing `AZURE_DEVOPS_AUTH_METHOD` when `clone-devops` is invoked throws `ConfigError`.

2. **Token expiry proactive warning**: Both `GITHUB_TOKEN_EXPIRY` and `AZURE_DEVOPS_PAT_EXPIRY` follow the pattern established by `AZURE_STORAGE_SAS_TOKEN_EXPIRY`. When set, the service checks the date at initialization:
   - If expired: throw `ConfigError` with message "GITHUB_TOKEN has expired (expiry: ...)".
   - If within 7 days of expiry: log a warning "GITHUB_TOKEN expires in X days".
   - These expiry variables are optional (not all tokens have known expiry dates).

3. **Secrets never in config files**: `GITHUB_TOKEN` and `AZURE_DEVOPS_PAT` are environment-variable-only. They are never read from `.azure-fs.json`.

---

## 14. Estimated Effort

| Phase | Estimated Hours | Notes |
|-------|----------------|-------|
| Phase 1: Foundation | 2-3 | Types, config, error classes |
| Phase 2: GitHub Client | 3-4 | Includes @octokit/rest integration and error handling |
| Phase 3: DevOps Client | 3-4 | Includes dual auth and fetch-based download |
| Phase 4: Orchestrator | 4-5 | Core streaming pipeline logic, per-entry upload, error handling |
| Phase 5: CLI Commands | 2-3 | Following established patterns |
| Phase 6: API Endpoints | 3-4 | Routes, controller, Swagger, timeout handling |
| Phase 7: Documentation | 2-3 | Six files to update |
| **Total** | **19-26** | |

---

## 15. Testing Strategy

### 15.1 Unit Tests (out of scope for initial implementation, documented for future)

- Mock `@octokit/rest` to test `GitHubClientService` without network calls
- Mock `fetch` to test `DevOpsClientService`
- Mock `BlobFileSystemService.uploadFile()` to test `RepoReplicationService` orchestration

### 15.2 Integration Tests (manual, using test_scripts/)

Create test scripts in `test_scripts/` folder:

| Script | Purpose |
|--------|---------|
| `test-repo-clone-github-cli.sh` | Test GitHub replication via CLI with a small public repo |
| `test-repo-clone-devops-cli.sh` | Test Azure DevOps replication via CLI |
| `test-repo-clone-github-api.sh` | Test GitHub replication via API endpoint (curl) |
| `test-repo-clone-devops-api.sh` | Test Azure DevOps replication via API endpoint (curl) |

### 15.3 Test Repository Recommendations

- **GitHub (public)**: Use a small, well-known public repo (e.g., `octocat/Hello-World` -- 1 file)
- **GitHub (private)**: Use a project-owned test repo with `GITHUB_TOKEN`
- **Azure DevOps**: Requires org/project access with PAT

---

## 16. Post-Implementation Verification Checklist

- [ ] `npm run build` succeeds with no TypeScript errors
- [ ] All existing CLI commands work unchanged
- [ ] API server starts with no errors
- [ ] Swagger UI shows new endpoints at `/api/docs`
- [ ] GitHub public repo replication works via CLI
- [ ] GitHub public repo replication works via API
- [ ] Azure DevOps repo replication works via CLI (if PAT available)
- [ ] Azure DevOps repo replication works via API (if PAT available)
- [ ] Missing token for private repo shows clear error message
- [ ] No temp files are created during operation (zero disk usage verified)
- [ ] All documentation files are consistent with the implementation
- [ ] `Issues - Pending Items.md` has no new unresolved items related to this feature
