# Plan 008: Sync Pair Configuration - Technical Design

**Date:** 2026-02-28
**Status:** Technical Design
**Depends on:** Plan 007 (Repo Replication to Azure Storage), Plan 008 (Sync Pair Configuration)
**Input documents:** plan-008-sync-pair-configuration.md, codebase-analysis-sync-pair-config.md

---

## 1. Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | `folder` field is REQUIRED in SyncPairDestination (no default, no fallback) | Project no-fallback rule. Explicit routing prevents accidental overwrites at container root. |
| D2 | Sequential processing (one pair at a time) | Predictable error reporting, resource usage, and log ordering. Parallel can be added later. |
| D3 | Fail-open: continue remaining pairs if one fails | Maximizes useful work per invocation. Per-pair results reported in response. |
| D4 | PAT only for DevOps sync pairs (no azure-ad) | azure-ad uses machine-level DefaultAzureCredential, not a per-pair credential. Including it in a per-pair config is semantically misleading. The `authMethod` field is removed from DevOpsSyncPairSource; PAT is implied. |
| D5 | Sync pair config is a separate file (not part of .azure-fs.json) | Different structure, contains secrets, different lifecycle. Clean separation. |
| D6 | Pass `containerClient` as parameter to streaming methods (not swap trick) | Type-safe, no `any` casts, testable, thread-safe. Minor signature change to private methods. |
| D7 | Credential interfaces for client services (not TS constructor overloads) | Simpler than TS overloads. A union type `ResolvedConfig | GitHubClientCredentials` discriminated by a field. |
| D8 | 30-minute timeout for sync API endpoint | Multi-pair operations can be long. The /sync route applies its own timeout middleware that overrides the 5-min default on the repo router. |
| D9 | `js-yaml` as YAML parser | Well-established, actively maintained, CommonJS-compatible. |
| D10 | DevOps `pat` is required (not optional) in sync pairs | Since D4 removes azure-ad from sync pairs, PAT becomes the only auth method and must always be present. |

---

## 2. Type Changes

### 2.1 New Types in `src/types/repo-replication.types.ts`

**Location:** Insert after the existing `DevOpsRepoConfig` interface (after line 129).
**Method:** `insert_after_symbol` on `DevOpsRepoConfig` in `src/types/repo-replication.types.ts`.

```typescript
// ---------------------------------------------------------------------------
// Sync Pair Configuration Types
// ---------------------------------------------------------------------------

/** Azure Storage destination for a sync pair */
export interface SyncPairDestination {
  /** Azure Storage account URL (e.g., "https://myaccount.blob.core.windows.net") */
  accountUrl: string;
  /** Container name in the storage account */
  container: string;
  /** Destination folder path within the container (REQUIRED, no default) */
  folder: string;
  /** SAS token for authenticating to the storage account (no leading "?") */
  sasToken: string;
  /** SAS token expiry in ISO 8601 format (optional, enables proactive warning) */
  sasTokenExpiry?: string;
}

/** GitHub source configuration for a sync pair */
export interface GitHubSyncPairSource {
  /** Repository in "owner/repo" format */
  repo: string;
  /** Branch, tag, or commit SHA. If omitted, default branch is used. */
  ref?: string;
  /** GitHub Personal Access Token (optional for public repos, required for private) */
  token?: string;
  /** Token expiry in ISO 8601 format */
  tokenExpiry?: string;
}

/** Azure DevOps source configuration for a sync pair (PAT auth only) */
export interface DevOpsSyncPairSource {
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
  /** Whether to resolve LFS pointers */
  resolveLfs?: boolean;
  /** Personal Access Token (REQUIRED for sync pairs - PAT auth only) */
  pat: string;
  /** PAT expiry in ISO 8601 format */
  patExpiry?: string;
  /** Organization URL override (e.g., "https://dev.azure.com/myorg") */
  orgUrl?: string;
}

/** A single GitHub sync pair */
export interface GitHubSyncPair {
  /** Unique name for this sync pair */
  name: string;
  /** Platform discriminator */
  platform: "github";
  /** GitHub source configuration */
  source: GitHubSyncPairSource;
  /** Azure Storage destination */
  destination: SyncPairDestination;
}

/** A single Azure DevOps sync pair */
export interface DevOpsSyncPair {
  /** Unique name for this sync pair */
  name: string;
  /** Platform discriminator */
  platform: "azure-devops";
  /** Azure DevOps source configuration */
  source: DevOpsSyncPairSource;
  /** Azure Storage destination */
  destination: SyncPairDestination;
}

/** Union type for any sync pair (discriminated on `platform` field) */
export type SyncPair = GitHubSyncPair | DevOpsSyncPair;

/** Root structure of a sync pair configuration file */
export interface SyncPairConfig {
  syncPairs: SyncPair[];
}

/** Result for a single sync pair execution */
export interface SyncPairItemResult {
  /** Sync pair name */
  name: string;
  /** Platform identifier */
  platform: RepoPlatform;
  /** Source identifier (e.g., "owner/repo" or "org/project/repo") */
  source: string;
  /** Destination path (container/folder) */
  destPath: string;
  /** Whether this pair succeeded */
  success: boolean;
  /** Replication result (present on success) */
  result?: RepoReplicationResult;
  /** Error message (present on failure) */
  error?: string;
  /** Error code (present on failure) */
  errorCode?: string;
}

/** Aggregate result of a sync pair batch operation */
export interface SyncPairBatchResult {
  /** Total number of sync pairs processed */
  totalPairs: number;
  /** Number of pairs that succeeded */
  succeeded: number;
  /** Number of pairs that failed */
  failed: number;
  /** Per-pair results in processing order */
  results: SyncPairItemResult[];
  /** Total wall-clock duration in milliseconds */
  totalDurationMs: number;
}
```

**Impact on `src/types/index.ts`:** Add new exports to the `repo-replication.types` block:

```typescript
export {
  // ... existing exports ...
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

**Method:** Edit `src/types/index.ts`, expand the existing `repo-replication.types` export block.

### 2.2 New Error Codes in `src/types/errors.types.ts`

**Location:** Append to the `RepoErrorCode` enum (after `REPO_MISSING_PARAMS`).
**Method:** `replace_symbol_body` on `RepoErrorCode` in `src/types/errors.types.ts`.

```typescript
export enum RepoErrorCode {
  REPO_NOT_FOUND = "REPO_NOT_FOUND",
  REPO_AUTH_MISSING = "REPO_AUTH_MISSING",
  REPO_ARCHIVE_DOWNLOAD_FAILED = "REPO_ARCHIVE_DOWNLOAD_FAILED",
  REPO_EXTRACTION_FAILED = "REPO_EXTRACTION_FAILED",
  REPO_UPLOAD_FAILED = "REPO_UPLOAD_FAILED",
  REPO_RATE_LIMITED = "REPO_RATE_LIMITED",
  REPO_PATH_TRAVERSAL = "REPO_PATH_TRAVERSAL",
  REPO_MISSING_PARAMS = "REPO_MISSING_PARAMS",
  REPO_INVALID_SYNC_CONFIG = "REPO_INVALID_SYNC_CONFIG",
  REPO_SYNC_PAIR_FAILED = "REPO_SYNC_PAIR_FAILED",
}
```

---

## 3. Error Factory Methods

### 3.1 New Methods in `src/errors/repo-replication.error.ts`

**Location:** Insert after the `missingParams` static method (after line 101).
**Method:** `insert_after_symbol` on `RepoReplicationError/missingParams` in `src/errors/repo-replication.error.ts`.

```typescript
/** Sync pair configuration is invalid or malformed. */
static invalidSyncConfig(reason: string, details?: unknown): RepoReplicationError {
  return new RepoReplicationError(
    "REPO_INVALID_SYNC_CONFIG",
    `Invalid sync pair configuration: ${reason}`,
    400,
    details,
  );
}

/** A specific sync pair failed during batch execution. */
static syncPairFailed(
  pairName: string,
  reason: string,
): RepoReplicationError {
  return new RepoReplicationError(
    "REPO_SYNC_PAIR_FAILED",
    `Sync pair "${pairName}" failed: ${reason}`,
    500,
    { pairName },
  );
}
```

**Referencing symbols affected:** None. These are new static methods only called by new code.

---

## 4. New File: `src/config/sync-pair.loader.ts`

**Method:** Create new file.

### 4.1 Purpose

Load sync pair configuration from a JSON or YAML file, validate its structure, check token expiry, and return a typed `SyncPairConfig`.

### 4.2 Dependencies

- `js-yaml` (new npm dependency)
- `@types/js-yaml` (new dev dependency)
- `ConfigError` from `src/errors/config.error.ts`
- `RepoReplicationError` from `src/errors/repo-replication.error.ts`
- `SyncPairConfig`, `SyncPair`, `GitHubSyncPair`, `DevOpsSyncPair` from `src/types/repo-replication.types.ts`
- `checkTokenExpiry` from `src/utils/token-expiry.utils.ts`
- `Logger` from `src/utils/logger.utils.ts`

### 4.3 Exported Functions

#### `loadSyncPairConfig(filePath: string): unknown`

Reads file from disk, detects format by extension, parses content.

- `.json` -> `JSON.parse()`
- `.yaml` / `.yml` -> `yaml.load()` with `JSON_SCHEMA` (safe mode)
- Other extensions -> throw `ConfigError` with code `CONFIG_INVALID_VALUE`
- File not found -> throw `ConfigError` with code `CONFIG_FILE_NOT_FOUND`
- Parse failure -> throw `ConfigError` with code `CONFIG_FILE_PARSE_ERROR`

Returns raw parsed object (type `unknown`).

**Pattern followed:** Mirrors `loadConfigFile()` in `src/config/config.loader.ts` (lines 49-85) for file reading and error handling.

#### `validateSyncPairConfig(raw: unknown): SyncPairConfig`

Validates the parsed object and returns a typed `SyncPairConfig`.

Validation rules:
1. Top-level must be an object with `syncPairs` array
2. `syncPairs` must be non-empty
3. Each pair must have: `name` (string), `platform` (string), `source` (object), `destination` (object)
4. `name` must be unique across all pairs
5. `platform` must be `"github"` or `"azure-devops"`
6. Destination validation: `accountUrl`, `container`, `folder`, `sasToken` all required (strings, non-empty)
7. GitHub source validation: `source.repo` must be present and match `owner/repo` pattern (`/^[^/]+\/[^/]+$/`)
8. DevOps source validation: `source.organization`, `source.project`, `source.repository` must be present; `source.pat` must be present (per D4/D10)

All validation failures throw `RepoReplicationError.invalidSyncConfig(reason, details)`.

#### `checkSyncPairTokenExpiry(config: SyncPairConfig, logger: Logger): void`

Iterates all pairs and calls `checkTokenExpiry()` for each token:
- GitHub pairs: `checkTokenExpiry("sync:<name>:GITHUB_TOKEN", source.tokenExpiry, logger)` (only if token is present)
- DevOps pairs: `checkTokenExpiry("sync:<name>:AZURE_DEVOPS_PAT", source.patExpiry, logger)`
- All pairs: `checkTokenExpiry("sync:<name>:SAS_TOKEN", destination.sasTokenExpiry, logger)`

The `sync:<name>:` prefix makes expiry warnings identifiable per sync pair.

---

## 5. Service Changes

### 5.1 GitHubClientService Constructor Refactor

**File:** `src/services/github-client.service.ts`
**Method:** `replace_symbol_body` on `GitHubClientService/constructor`

#### New Credential Interface

```typescript
/** Per-pair credentials for GitHubClientService (used by sync pairs) */
export interface GitHubClientCredentials {
  token?: string;
  tokenExpiry?: string;
}
```

**Insert location:** Before the `GitHubClientService` class declaration (line 18).
**Method:** `insert_before_symbol` on `GitHubClientService`.

#### Modified Constructor

```typescript
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
```

**Backward compatibility:** The existing call `new GitHubClientService(this.config, this.logger)` in `RepoReplicationService.replicateGitHub()` (line 82) passes a `ResolvedConfig` which has a `storage` property, so it follows the existing path unchanged.

**Referencing symbols affected:**
- `RepoReplicationService/replicateGitHub` (line 82): No change needed. Passes `ResolvedConfig`.
- New `RepoReplicationService/replicateGitHubSyncPair`: Will pass `GitHubClientCredentials`.

### 5.2 DevOpsClientService Constructor Refactor

**File:** `src/services/devops-client.service.ts`
**Method:** `replace_symbol_body` on `DevOpsClientService/constructor`

#### New Credential Interface

```typescript
/** Per-pair credentials for DevOpsClientService (used by sync pairs, PAT only) */
export interface DevOpsClientCredentials {
  pat: string;
  patExpiry?: string;
  orgUrl?: string;
}
```

**Insert location:** Before the `DevOpsClientService` class declaration (line 18).
**Method:** `insert_before_symbol` on `DevOpsClientService`.

#### Modified Constructor

The current constructor uses `private readonly logger: Logger` in the parameter list (a TypeScript shorthand for declaring and assigning a property). This must be preserved in the refactored version. However, since we are changing the first parameter to a union type, the `logger` parameter can no longer use the shorthand (the shorthand only works when the parameter is a simple property -- the union type for the first parameter requires explicit property handling).

```typescript
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
```

**Important:** The `logger` property declaration must be changed from the shorthand `private readonly logger: Logger` in the constructor parameter to a separate class property declaration:

```typescript
private readonly logger: Logger;
```

This must be added alongside the existing property declarations (lines 19-21).

**Backward compatibility:** The existing call `new DevOpsClientService(this.config, this.logger)` in `RepoReplicationService.replicateDevOps()` (line 149) passes a `ResolvedConfig` which has `storage`, so it follows the existing path unchanged.

**Referencing symbols affected:**
- `RepoReplicationService/replicateDevOps` (line 149): No change needed.
- New `RepoReplicationService/replicateDevOpsSyncPair`: Will pass `DevOpsClientCredentials`.

### 5.3 New Function in `src/services/auth.service.ts`

**Location:** Insert after `createContainerClient` function (after line 47).
**Method:** `insert_after_symbol` on `createContainerClient` in `src/services/auth.service.ts`.

```typescript
/**
 * Create a ContainerClient for a sync pair destination using SAS token authentication.
 *
 * Unlike createContainerClient() which uses the global ResolvedConfig,
 * this function accepts explicit per-pair storage parameters.
 * Sync pairs always authenticate with SAS tokens.
 *
 * @param accountUrl - Azure Storage account URL
 * @param containerName - Container name
 * @param sasToken - SAS token (no leading "?")
 * @returns ContainerClient for the specified container
 */
export function createSyncPairContainerClient(
  accountUrl: string,
  containerName: string,
  sasToken: string,
): ContainerClient {
  const separator = accountUrl.includes("?") ? "&" : "?";
  const serviceClient = new BlobServiceClient(`${accountUrl}${separator}${sasToken}`);
  return serviceClient.getContainerClient(containerName);
}
```

**Referencing symbols affected:** None. New function, only called by new code.

### 5.4 RepoReplicationService: Refactor Streaming Methods

**File:** `src/services/repo-replication.service.ts`

#### 5.4.1 Refactor `uploadEntryToBlob` Signature

**Current signature (line 463):**
```typescript
private async uploadEntryToBlob(
  blobPath: string,
  entryStream: Readable,
  size?: number,
): Promise<{ success: boolean; size: number; error?: string }>
```

**New signature:**
```typescript
private async uploadEntryToBlob(
  containerClient: ContainerClient,
  blobPath: string,
  entryStream: Readable,
  size?: number,
): Promise<{ success: boolean; size: number; error?: string }>
```

**Body change:** Replace `this.containerClient.getBlockBlobClient(blobPath)` with `containerClient.getBlockBlobClient(blobPath)`.

**Method:** `replace_symbol_body` on `RepoReplicationService/uploadEntryToBlob`.

#### 5.4.2 Refactor `streamTarToBlob` Signature

**Current signature (line 207):**
```typescript
private async streamTarToBlob(
  archiveStream: Readable,
  destPath: string,
  repoIdentifier: string,
): Promise<StreamingStats>
```

**New signature:**
```typescript
private async streamTarToBlob(
  archiveStream: Readable,
  destPath: string,
  repoIdentifier: string,
  containerClient?: ContainerClient,
): Promise<StreamingStats>
```

**Body change:** At the start of the method, resolve the container client:
```typescript
const client = containerClient ?? this.containerClient;
```

Then pass `client` to all `this.uploadEntryToBlob(client, blobPath, ...)` calls.

**Method:** `replace_symbol_body` on `RepoReplicationService/streamTarToBlob`.

#### 5.4.3 Refactor `streamZipToBlob` Signature

Same pattern as `streamTarToBlob`:

**New signature:**
```typescript
private async streamZipToBlob(
  archiveStream: Readable,
  destPath: string,
  repoIdentifier: string,
  containerClient?: ContainerClient,
): Promise<StreamingStats>
```

**Body change:** Same pattern: `const client = containerClient ?? this.containerClient;` and pass to upload calls.

**Method:** `replace_symbol_body` on `RepoReplicationService/streamZipToBlob`.

#### 5.4.4 Update Existing Callers

**`replicateGitHub` (line 107):** Change `this.streamTarToBlob(archiveStream, params.destPath, repoIdentifier)` -- no change needed because the `containerClient` parameter is optional and defaults to `this.containerClient`.

**`replicateDevOps` (line 168):** Same -- no change needed.

### 5.5 RepoReplicationService: New Public Method

**Location:** Insert after `replicateDevOps` method (after line 193).
**Method:** `insert_after_symbol` on `RepoReplicationService/replicateDevOps`.

#### `replicateFromSyncConfig(syncConfig: SyncPairConfig): Promise<SyncPairBatchResult>`

```typescript
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
```

#### New Private Methods

Insert after `replicateFromSyncConfig`:

```typescript
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
    const code = (err as any)?.code as string | undefined;
    this.logger.error(`Sync pair "${pair.name}" failed: ${message}`);

    return {
      name: pair.name,
      platform: pair.platform,
      source: sourceId,
      destPath,
      success: false,
      error: message,
      errorCode: code,
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
```

#### New Imports Required

Add to the top of `src/services/repo-replication.service.ts`:

```typescript
import { createSyncPairContainerClient } from "./auth.service";
import { GitHubClientCredentials } from "./github-client.service";
import { DevOpsClientCredentials } from "./devops-client.service";
import {
  SyncPairConfig,
  SyncPair,
  GitHubSyncPair,
  DevOpsSyncPair,
  SyncPairItemResult,
  SyncPairBatchResult,
} from "../types/repo-replication.types";
```

---

## 6. CLI Changes

### 6.1 New Command in `src/commands/repo.commands.ts`

**Location:** Insert after the `clone-devops` command action block (after line 94, before the closing `}` of `registerRepoCommands`).
**Method:** `insert_after_symbol` is not ideal here since the command is not a named symbol. Use `Edit` to insert before the closing brace of `registerRepoCommands`.

#### New Imports

Add to the top of `src/commands/repo.commands.ts`:

```typescript
import {
  loadSyncPairConfig,
  validateSyncPairConfig,
  checkSyncPairTokenExpiry,
} from "../config/sync-pair.loader";
```

#### New Command

```typescript
// --- sync ---
repo
  .command("sync")
  .description("Replicate repositories from a sync pair configuration file (JSON or YAML)")
  .requiredOption("--config <path>", "Path to sync pair configuration file (.json, .yaml, .yml)")
  .action(async (options: Record<string, unknown>, cmd: Command) => {
    const startTime = Date.now();
    const globalOpts = cmd.parent!.parent!.opts();
    const jsonMode = globalOpts.json === true;

    try {
      const config = resolveConfig(globalOpts);
      const logger = new Logger(config.logging.level, globalOpts.verbose === true);

      // Load and validate sync pair config
      const configPath = options["config"] as string;
      const rawConfig = loadSyncPairConfig(configPath);
      const syncConfig = validateSyncPairConfig(rawConfig);

      // Check token expiry for all pairs
      checkSyncPairTokenExpiry(syncConfig, logger);

      // Create RepoReplicationService (global containerClient used as fallback for constructor)
      const containerClient = createContainerClient(config);
      const service = new RepoReplicationService(config, containerClient, logger);

      const result = await service.replicateFromSyncConfig(syncConfig);

      const output = formatSuccess(result, "repo sync", startTime);
      outputResult(output, jsonMode);

      // Set exit code based on failures
      if (result.failed > 0) {
        process.exitCode = 1;
      }
    } catch (err) {
      const output = formatErrorFromException(err, "repo sync", startTime);
      outputResult(output, jsonMode);
      process.exitCode = exitCodeForError(err);
    }
  });
```

**Note:** The `RepoReplicationService` constructor still requires a `containerClient` from the global config. This is used by existing `replicateGitHub`/`replicateDevOps` methods. For sync pairs, each pair creates its own `ContainerClient` via `createSyncPairContainerClient()`. The global container client is not used during sync pair processing but is required for the constructor signature.

---

## 7. API Changes

### 7.1 Controller: New Method in `src/api/controllers/repo.controller.ts`

**Location:** Insert after the `cloneDevOps` method (before the closing `};` of the return object).
**Method:** Edit to add new method to the returned object.

#### New Imports

```typescript
import {
  validateSyncPairConfig,
  checkSyncPairTokenExpiry,
} from "../../config/sync-pair.loader";
```

#### New Method

```typescript
/**
 * POST /api/v1/repo/sync
 * Execute repository replication from a sync pair configuration.
 * Body: sync pair configuration object (same structure as JSON/YAML file content)
 */
async syncPairs(
  req: Request,
  res: Response,
  _next: NextFunction,
): Promise<void> {
  const startTime = Date.now();

  const body = req.body;
  if (!body || !body.syncPairs) {
    throw RepoReplicationError.missingParams(["syncPairs"]);
  }

  // Validate the sync pair configuration
  const syncConfig = validateSyncPairConfig(body);

  // Check token expiry
  checkSyncPairTokenExpiry(syncConfig, logger);

  logger.info(`API: Processing ${syncConfig.syncPairs.length} sync pairs`);

  const result = await repoService.replicateFromSyncConfig(syncConfig);

  // HTTP status: 200 (all ok), 207 (partial), 500 (all failed)
  const statusCode = result.failed > 0 && result.succeeded === 0
    ? 500
    : result.failed > 0
      ? 207
      : 200;

  res.status(statusCode).json(buildResponse("repo-sync", result, startTime));
},
```

### 7.2 Route: New Endpoint in `src/api/routes/repo.routes.ts`

**Location:** Insert after the `/devops` route (after line 445, before `return router;`).
**Method:** Edit to add route before `return router;`.

```typescript
/**
 * @openapi
 * /api/v1/repo/sync:
 *   post:
 *     operationId: syncRepositories
 *     summary: Replicate repositories from sync pair configuration
 *     description: |
 *       Executes a batch of repository replication operations from a sync pair
 *       configuration. Each pair specifies its own source repository credentials
 *       and Azure Storage destination (SAS token auth). Pairs are processed sequentially.
 *       This is a long-running operation; a 30-minute timeout is applied.
 *       DevOps sync pairs use PAT authentication only.
 *     tags: [Repository Replication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [syncPairs]
 *             properties:
 *               syncPairs:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [name, platform, source, destination]
 *                   properties:
 *                     name:
 *                       type: string
 *                       description: Unique name for this sync pair
 *                       example: "my-github-repo"
 *                     platform:
 *                       type: string
 *                       enum: [github, azure-devops]
 *                       description: Source platform
 *                     source:
 *                       type: object
 *                       description: Source repository configuration (platform-specific)
 *                     destination:
 *                       type: object
 *                       required: [accountUrl, container, folder, sasToken]
 *                       properties:
 *                         accountUrl:
 *                           type: string
 *                           description: Azure Storage account URL
 *                           example: "https://myaccount.blob.core.windows.net"
 *                         container:
 *                           type: string
 *                           description: Container name
 *                           example: "my-container"
 *                         folder:
 *                           type: string
 *                           description: Destination folder path (required)
 *                           example: "repos/my-repo"
 *                         sasToken:
 *                           type: string
 *                           description: SAS token for Azure Storage auth
 *                         sasTokenExpiry:
 *                           type: string
 *                           description: SAS token expiry (ISO 8601)
 *     responses:
 *       200:
 *         description: All sync pairs completed successfully
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
 *                     totalPairs:
 *                       type: integer
 *                       example: 3
 *                     succeeded:
 *                       type: integer
 *                       example: 3
 *                     failed:
 *                       type: integer
 *                       example: 0
 *                     results:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           name:
 *                             type: string
 *                           platform:
 *                             type: string
 *                           source:
 *                             type: string
 *                           destPath:
 *                             type: string
 *                           success:
 *                             type: boolean
 *                           result:
 *                             type: object
 *                           error:
 *                             type: string
 *                           errorCode:
 *                             type: string
 *                     totalDurationMs:
 *                       type: integer
 *                       example: 45000
 *                 metadata:
 *                   type: object
 *                   properties:
 *                     command:
 *                       type: string
 *                       example: "repo-sync"
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *                     durationMs:
 *                       type: integer
 *       207:
 *         description: Some sync pairs failed (partial success)
 *       400:
 *         description: Invalid sync pair configuration
 *       500:
 *         description: All sync pairs failed
 */
router.post("/sync", createTimeoutMiddleware(1800000), controller.syncPairs);
```

**Note:** The `/sync` route applies its own 30-minute timeout middleware that overrides the 5-minute timeout set at the router level (line 22). This works because `createTimeoutMiddleware` clears any previously set timeout timer (see `src/api/middleware/timeout.middleware.ts` lines 30-36).

---

## 8. npm Dependencies

### 8.1 New Dependencies

```
npm install js-yaml
npm install --save-dev @types/js-yaml
```

**Versions:**
- `js-yaml`: `^4.1.0` (latest 4.x, stable, CommonJS-compatible)
- `@types/js-yaml`: `^4.0.9`

---

## 9. File Change Summary

### 9.1 Modified Files

| File | Symbol/Location | Operation | Description |
|------|----------------|-----------|-------------|
| `src/types/repo-replication.types.ts` | After `DevOpsRepoConfig` | `insert_after_symbol` | Add 10 new type interfaces |
| `src/types/errors.types.ts` | `RepoErrorCode` enum | `replace_symbol_body` | Add 2 new error codes |
| `src/types/index.ts` | `repo-replication.types` export block | Edit | Add new type exports |
| `src/errors/repo-replication.error.ts` | After `missingParams` | `insert_after_symbol` | Add 2 new static factory methods |
| `src/services/github-client.service.ts` | Before `GitHubClientService` | `insert_before_symbol` | Add `GitHubClientCredentials` interface |
| `src/services/github-client.service.ts` | `GitHubClientService/constructor` | `replace_symbol_body` | Accept union type parameter |
| `src/services/devops-client.service.ts` | Before `DevOpsClientService` | `insert_before_symbol` | Add `DevOpsClientCredentials` interface |
| `src/services/devops-client.service.ts` | `DevOpsClientService/constructor` | `replace_symbol_body` | Accept union type, add logger property |
| `src/services/auth.service.ts` | After `createContainerClient` | `insert_after_symbol` | Add `createSyncPairContainerClient` |
| `src/services/repo-replication.service.ts` | `uploadEntryToBlob` | `replace_symbol_body` | Add containerClient parameter |
| `src/services/repo-replication.service.ts` | `streamTarToBlob` | `replace_symbol_body` | Add optional containerClient parameter |
| `src/services/repo-replication.service.ts` | `streamZipToBlob` | `replace_symbol_body` | Add optional containerClient parameter |
| `src/services/repo-replication.service.ts` | After `replicateDevOps` | `insert_after_symbol` | Add 4 new methods |
| `src/services/repo-replication.service.ts` | Top imports | Edit | Add new imports |
| `src/commands/repo.commands.ts` | Before closing `}` | Edit | Add `repo sync` command |
| `src/commands/repo.commands.ts` | Top imports | Edit | Add new imports |
| `src/api/controllers/repo.controller.ts` | Before closing `};` | Edit | Add `syncPairs` method |
| `src/api/controllers/repo.controller.ts` | Top imports | Edit | Add new imports |
| `src/api/routes/repo.routes.ts` | Before `return router;` | Edit | Add `/sync` route |
| `package.json` | dependencies | Edit | Add `js-yaml` |
| `package.json` | devDependencies | Edit | Add `@types/js-yaml` |

### 9.2 New Files

| File | Purpose |
|------|---------|
| `src/config/sync-pair.loader.ts` | Sync pair config loading, parsing, validation, token expiry checking |

### 9.3 Files NOT Modified (Backward Compatibility)

| File | Reason |
|------|--------|
| `src/config/config.loader.ts` | Sync pair config is separate from main `.azure-fs.json` |
| `src/config/config.schema.ts` | No changes to main config validation |
| `src/types/config.types.ts` | `ResolvedConfig` unchanged |
| `src/api/routes/index.ts` | No changes to `ApiServices` or route registration (existing `repoReplicationService` is reused) |
| `src/api/server.ts` | No changes to server startup |

---

## 10. Data Flow Diagram

```
CLI: azure-fs repo sync --config sync-pairs.json
API: POST /api/v1/repo/sync { syncPairs: [...] }
        |
        v
loadSyncPairConfig(filePath)          (CLI only: reads file from disk)
        |
        v
validateSyncPairConfig(raw)           (validates structure, required fields)
        |
        v
checkSyncPairTokenExpiry(config, logger)  (warns/throws for expired tokens)
        |
        v
RepoReplicationService.replicateFromSyncConfig(syncConfig)
        |
        |   for each pair (sequential):
        |   ┌──────────────────────────────────────────────────────────────┐
        |   │ executeSyncPair(pair)                                        │
        |   │   |                                                          │
        |   │   v                                                          │
        |   │ createSyncPairContainerClient(dest.accountUrl,               │
        |   │                                dest.container,               │
        |   │                                dest.sasToken)                │
        |   │   |                                                          │
        |   │   v                                                          │
        |   │ [github]  new GitHubClientService(credentials, logger)       │
        |   │           githubClient.getArchiveStream(owner, repo, ref)    │
        |   │           streamTarToBlob(stream, folder, id, containerCli)  │
        |   │                                                              │
        |   │ [devops]  new DevOpsClientService(credentials, logger)       │
        |   │           devopsClient.getArchiveStream(org, proj, repo,...) │
        |   │           streamZipToBlob(stream, folder, id, containerCli)  │
        |   │                                                              │
        |   │   |                                                          │
        |   │   v                                                          │
        |   │ SyncPairItemResult { name, success, result/error }           │
        |   └──────────────────────────────────────────────────────────────┘
        |
        v
SyncPairBatchResult { totalPairs, succeeded, failed, results, totalDurationMs }
```

---

## 11. Validation Rules Summary

### 11.1 Config File Validation (sync-pair.loader.ts)

| Rule | Error Type |
|------|-----------|
| File does not exist | `ConfigError` (CONFIG_FILE_NOT_FOUND) |
| Unrecognized file extension | `ConfigError` (CONFIG_INVALID_VALUE) |
| JSON/YAML parse failure | `ConfigError` (CONFIG_FILE_PARSE_ERROR) |
| Missing `syncPairs` array | `RepoReplicationError.invalidSyncConfig` |
| Empty `syncPairs` array | `RepoReplicationError.invalidSyncConfig` |
| Duplicate pair names | `RepoReplicationError.invalidSyncConfig` |
| Missing pair `name`/`platform`/`source`/`destination` | `RepoReplicationError.invalidSyncConfig` |
| Invalid `platform` value | `RepoReplicationError.invalidSyncConfig` |
| GitHub: missing `source.repo` | `RepoReplicationError.invalidSyncConfig` |
| GitHub: `source.repo` not in `owner/repo` format | `RepoReplicationError.invalidSyncConfig` |
| DevOps: missing `source.organization`/`project`/`repository` | `RepoReplicationError.invalidSyncConfig` |
| DevOps: missing `source.pat` | `RepoReplicationError.invalidSyncConfig` |
| Destination: missing `accountUrl`/`container`/`folder`/`sasToken` | `RepoReplicationError.invalidSyncConfig` |
| Token expired | `ConfigError` (via checkTokenExpiry) |
| Token expiring within 7 days | Warning log (via checkTokenExpiry) |

---

## 12. Sample Sync Pair Configuration

### 12.1 JSON Format

```json
{
  "syncPairs": [
    {
      "name": "my-github-repo",
      "platform": "github",
      "source": {
        "repo": "owner/repo-name",
        "ref": "main",
        "token": "ghp_xxxx",
        "tokenExpiry": "2026-12-31T00:00:00Z"
      },
      "destination": {
        "accountUrl": "https://myaccount.blob.core.windows.net",
        "container": "my-container",
        "folder": "repos/github/repo-name",
        "sasToken": "sv=2022-11-02&ss=b&srt=co&sp=rwdlacyx...",
        "sasTokenExpiry": "2026-12-31T00:00:00Z"
      }
    },
    {
      "name": "my-devops-repo",
      "platform": "azure-devops",
      "source": {
        "organization": "myorg",
        "project": "myproject",
        "repository": "myrepo",
        "ref": "main",
        "pat": "xxxx",
        "patExpiry": "2026-12-31T00:00:00Z",
        "orgUrl": "https://dev.azure.com/myorg"
      },
      "destination": {
        "accountUrl": "https://myaccount.blob.core.windows.net",
        "container": "my-container",
        "folder": "repos/devops/myrepo",
        "sasToken": "sv=2022-11-02&ss=b&srt=co&sp=rwdlacyx...",
        "sasTokenExpiry": "2026-12-31T00:00:00Z"
      }
    }
  ]
}
```

### 12.2 YAML Format

```yaml
syncPairs:
  - name: my-github-repo
    platform: github
    source:
      repo: owner/repo-name
      ref: main
      token: ghp_xxxx
      tokenExpiry: "2026-12-31T00:00:00Z"
    destination:
      accountUrl: https://myaccount.blob.core.windows.net
      container: my-container
      folder: repos/github/repo-name
      sasToken: "sv=2022-11-02&ss=b&srt=co&sp=rwdlacyx..."
      sasTokenExpiry: "2026-12-31T00:00:00Z"

  - name: my-devops-repo
    platform: azure-devops
    source:
      organization: myorg
      project: myproject
      repository: myrepo
      ref: main
      pat: xxxx
      patExpiry: "2026-12-31T00:00:00Z"
      orgUrl: https://dev.azure.com/myorg
    destination:
      accountUrl: https://myaccount.blob.core.windows.net
      container: my-container
      folder: repos/devops/myrepo
      sasToken: "sv=2022-11-02&ss=b&srt=co&sp=rwdlacyx..."
      sasTokenExpiry: "2026-12-31T00:00:00Z"
```

---

## 13. Deviations from Plan 008

| Item | Plan 008 | This Design | Reason |
|------|----------|-------------|--------|
| DevOps `authMethod` in sync pairs | Allows `pat` and `azure-ad` | PAT only, `authMethod` field removed | User design decision D4. azure-ad is machine-level, not per-pair. |
| DevOps `pat` optionality | Optional when `authMethod` is `azure-ad` | Required (always) | Consequence of D4. |
| ContainerClient per-pair strategy | Swap `this.containerClient` with `any` cast | Pass as parameter to streaming methods | Type-safe, no `any` casts (D6). |
| `SyncPairBatchResult.successCount` | Named `successCount` | Named `succeeded` | Shorter, consistent with `failed`. |
| `SyncPairBatchResult.failedCount` | Named `failedCount` | Named `failed` | Shorter. |
| `SyncPairBatchResult.pairResults` | Named `pairResults` | Named `results` | Simpler; the context already implies pairs. |
| `SyncPairItemResult` fields | Only `name`, `success`, `result`, `error`, `errorCode` | Added `platform`, `source`, `destPath` | Richer per-pair metadata for observability. |
| Constructor overloads | TypeScript method overloads | Single constructor with union parameter | Simpler implementation; TS overloads add verbosity without runtime benefit. |

---

## 14. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking `clone-github` / `clone-devops` | Constructor union type preserves backward compatibility. Streaming method parameters are optional (default to `this.containerClient`). |
| No-fallback rule violation | `folder` is required. DevOps `pat` is required. All required fields validated in `validateSyncPairConfig`. |
| Token expiry not checked | `checkSyncPairTokenExpiry()` runs before processing begins. Uses existing `checkTokenExpiry()`. |
| API timeout exceeded | Sync endpoint uses 30-minute timeout (overrides 5-minute repo default via nested `createTimeoutMiddleware`). |
| YAML parsing regression | `js-yaml` is only imported in `sync-pair.loader.ts`. Existing JSON config loading is untouched. |
| Streaming architecture broken | Per-pair replication reuses existing `streamTarToBlob`/`streamZipToBlob` pipelines. No local disk usage. |
| Memory leak from per-pair client creation | Clients are garbage-collected after each pair completes (sequential processing). |
