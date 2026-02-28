# Plan 008: Sync Pair Configuration for Repository Replication

**Date:** 2026-02-28
**Status:** Draft
**Depends on:** Plan 007 (Repo Replication to Azure Storage)

---

## Open Questions / Decisions Requiring User Input

1. **Default value for `folder`**: The user specification says `folder` "can be `/`". Should `/` be the default when `folder` is omitted, or must the user always provide it explicitly? Treating it as required is consistent with the project's no-fallback rule. **Recommendation:** Make `folder` required (no default). If the user wants the `/` exception, it must be registered in the project memory file per CLAUDE.md rules before implementation.

2. **Concurrency model**: Should sync pairs be processed sequentially (safest, predictable error reporting) or in parallel with a configurable concurrency limit? **Recommendation:** Sequential by default. A `--concurrency <n>` CLI option can be added in a follow-up.

3. **API timeout for multi-pair sync**: The current repo routes have a 5-minute timeout. A config file with 10+ sync pairs may exceed this. Should the API endpoint use a longer timeout (e.g., 30 minutes), or should we implement an async job pattern? **Recommendation:** Use a 30-minute timeout for the sync endpoint initially. Async jobs can be added later.

4. **Partial failure handling**: If pair 3 of 5 fails, should the operation continue with pair 4 and 5, or abort? **Recommendation:** Continue processing all pairs, report per-pair results in the response (fail-open approach).

5. **DevOps `authMethod` in sync pair**: The current implementation supports `pat` and `azure-ad`. For sync pairs, `azure-ad` would use the machine's DefaultAzureCredential, not a per-pair credential. Should `azure-ad` be allowed in sync pairs? **Recommendation:** Yes, allow it. The `pat` field becomes optional when `authMethod` is `azure-ad`.

---

## Step 1: Install YAML Parsing Dependency

**Files to modify:**
- `package.json` -- add `js-yaml` to `dependencies`
- `package.json` -- add `@types/js-yaml` to `devDependencies`

**Changes:**
- Add `"js-yaml": "^4.1.0"` to `dependencies`
- Add `"@types/js-yaml": "^4.0.9"` to `devDependencies`
- Run `npm install`

**Verification:**
- `npm ls js-yaml` shows the package installed
- `npm run build` succeeds

**Parallelizable:** Yes -- this step has no code dependencies.

---

## Step 2: Define Sync Pair Type Interfaces

**Files to modify:**
- `src/types/repo-replication.types.ts` -- add new interfaces
- `src/types/index.ts` -- add new type exports
- `src/types/errors.types.ts` -- add new error codes to `RepoErrorCode`

**Changes to `src/types/repo-replication.types.ts`:**

Add the following new interfaces after the existing `DevOpsRepoConfig` interface (after line 129):

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
  /** Destination folder path within the container */
  folder: string;
  /** SAS token for authenticating to the storage account */
  sasToken: string;
  /** SAS token expiry in ISO 8601 format */
  sasTokenExpiry?: string;
}

/** GitHub source configuration for a sync pair */
export interface GitHubSyncPairSource {
  /** Repository in "owner/repo" format */
  repo: string;
  /** Branch, tag, or commit SHA. If omitted, default branch is used. */
  ref?: string;
  /** GitHub Personal Access Token */
  token?: string;
  /** Token expiry in ISO 8601 format */
  tokenExpiry?: string;
}

/** Azure DevOps source configuration for a sync pair */
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
  /** Personal Access Token */
  pat?: string;
  /** PAT expiry in ISO 8601 format */
  patExpiry?: string;
  /** Authentication method: "pat" or "azure-ad" */
  authMethod: DevOpsAuthMethod;
  /** Organization URL (e.g., "https://dev.azure.com/myorg") */
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

/** Union type for any sync pair */
export type SyncPair = GitHubSyncPair | DevOpsSyncPair;

/** Root structure of a sync pair configuration file */
export interface SyncPairConfig {
  syncPairs: SyncPair[];
}

/** Result for a single sync pair execution */
export interface SyncPairItemResult {
  /** Sync pair name */
  name: string;
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
  successCount: number;
  /** Number of pairs that failed */
  failedCount: number;
  /** Per-pair results */
  pairResults: SyncPairItemResult[];
  /** Total wall-clock duration in milliseconds */
  totalDurationMs: number;
}
```

**Changes to `src/types/errors.types.ts`:**

Add two new entries to the `RepoErrorCode` enum:

```typescript
REPO_INVALID_SYNC_CONFIG = "REPO_INVALID_SYNC_CONFIG",
REPO_SYNC_PAIR_FAILED = "REPO_SYNC_PAIR_FAILED",
```

**Changes to `src/types/index.ts`:**

Add new type exports to the `repo-replication.types` export block:

```typescript
SyncPairDestination,
GitHubSyncPairSource,
DevOpsSyncPairSource,
GitHubSyncPair,
DevOpsSyncPair,
SyncPair,
SyncPairConfig,
SyncPairItemResult,
SyncPairBatchResult,
```

**Verification:**
- `npm run build` succeeds
- All new types are importable

**Parallelizable with:** Step 1

---

## Step 3: Create Sync Pair Config Loader and Validator

**New file:** `src/config/sync-pair.loader.ts`

**Purpose:** Load sync pair configuration from a JSON or YAML file, validate its structure, and return a typed `SyncPairConfig`.

**Dependencies:** Step 1 (js-yaml), Step 2 (types)

**Implementation details:**

```typescript
// src/config/sync-pair.loader.ts

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { ConfigError } from "../errors/config.error";
import { RepoReplicationError } from "../errors/repo-replication.error";
import {
  SyncPairConfig,
  SyncPair,
  GitHubSyncPair,
  DevOpsSyncPair,
} from "../types/repo-replication.types";
import { checkTokenExpiry } from "../utils/token-expiry.utils";
import { Logger } from "../utils/logger.utils";
```

**Functions to implement:**

1. `loadSyncPairConfig(filePath: string): SyncPairConfig`
   - Read file from disk
   - Detect format by extension (`.json`, `.yaml`, `.yml`)
   - Parse with `JSON.parse()` or `yaml.load()`
   - Throw `ConfigError` with code `CONFIG_FILE_NOT_FOUND` if file does not exist
   - Throw `ConfigError` with code `CONFIG_FILE_PARSE_ERROR` if parse fails

2. `validateSyncPairConfig(raw: unknown): SyncPairConfig`
   - Validate top-level has `syncPairs` array
   - Validate array is non-empty
   - Validate each pair has `name`, `platform`, `source`, `destination`
   - Validate `name` is unique across all pairs
   - Dispatch to `validateGitHubPair()` or `validateDevOpsPair()` based on `platform`
   - Validate destination has `accountUrl`, `container`, `folder`, `sasToken`
   - Throw `RepoReplicationError.invalidSyncConfig()` for any validation failure

3. `validateGitHubPair(pair: unknown, pairName: string): GitHubSyncPair`
   - Validate `source.repo` is present and in `owner/repo` format

4. `validateDevOpsPair(pair: unknown, pairName: string): DevOpsSyncPair`
   - Validate `source.organization`, `source.project`, `source.repository` are present
   - Validate `source.authMethod` is present (required, no fallback)
   - If `source.authMethod === "pat"`, validate `source.pat` is present

5. `checkSyncPairTokenExpiry(config: SyncPairConfig, logger: Logger): void`
   - For each pair, call `checkTokenExpiry()` on:
     - GitHub pairs: `source.token` with `source.tokenExpiry`
     - DevOps pairs: `source.pat` with `source.patExpiry`
     - All pairs: `destination.sasToken` with `destination.sasTokenExpiry`

**Verification:**
- `npm run build` succeeds
- Unit tests with valid/invalid JSON and YAML files

---

## Step 4: Add Error Factory Methods to RepoReplicationError

**File to modify:** `src/errors/repo-replication.error.ts`

**Changes:**

Add two new static factory methods:

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

**Verification:**
- `npm run build` succeeds

**Parallelizable with:** Step 3

---

## Step 5: Refactor Client Services to Accept Per-Pair Credentials

**Files to modify:**
- `src/services/github-client.service.ts` -- `GitHubClientService` constructor
- `src/services/devops-client.service.ts` -- `DevOpsClientService` constructor

### 5a. GitHubClientService

**Current constructor signature (line 24):**
```typescript
constructor(config: ResolvedConfig, logger: Logger)
```

**New overloaded constructor approach -- use an optional credential parameter object:**

Add a new interface and modify the constructor:

```typescript
/** Per-pair credentials for GitHubClientService (used by sync pairs) */
export interface GitHubClientCredentials {
  token?: string;
  tokenExpiry?: string;
}

export class GitHubClientService {
  // ... existing fields ...

  constructor(config: ResolvedConfig, logger: Logger);
  constructor(credentials: GitHubClientCredentials, logger: Logger);
  constructor(
    configOrCredentials: ResolvedConfig | GitHubClientCredentials,
    logger: Logger,
  ) {
    this.logger = logger;

    // Determine if this is a ResolvedConfig or direct credentials
    if ('storage' in configOrCredentials) {
      // ResolvedConfig path (existing behavior)
      this.token = configOrCredentials.github?.token;
      checkTokenExpiry("GITHUB_TOKEN", configOrCredentials.github?.tokenExpiry, logger);
    } else {
      // Direct credentials path (sync pair)
      this.token = configOrCredentials.token;
      checkTokenExpiry("GITHUB_TOKEN (sync pair)", configOrCredentials.tokenExpiry, logger);
    }

    if (this.token) {
      this.octokit = new Octokit({ auth: this.token });
      this.logger.debug("GitHub client created with token authentication");
    } else {
      this.octokit = new Octokit();
      this.logger.warn("GitHub client created without token -- unauthenticated rate limit is 60 requests/hour");
    }
  }
```

**Key constraint:** The existing call site `new GitHubClientService(this.config, this.logger)` in `RepoReplicationService.replicateGitHub()` (line 82) must continue to work without modification.

### 5b. DevOpsClientService

**Current constructor signature (line 24):**
```typescript
constructor(config: ResolvedConfig, private readonly logger: Logger)
```

**New approach -- same pattern:**

```typescript
/** Per-pair credentials for DevOpsClientService (used by sync pairs) */
export interface DevOpsClientCredentials {
  pat?: string;
  patExpiry?: string;
  authMethod?: DevOpsAuthMethod;
  orgUrl?: string;
}

export class DevOpsClientService {
  // ... existing fields ...

  constructor(config: ResolvedConfig, logger: Logger);
  constructor(credentials: DevOpsClientCredentials, logger: Logger);
  constructor(
    configOrCredentials: ResolvedConfig | DevOpsClientCredentials,
    logger: Logger,
  ) {
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
      // Direct credentials path (sync pair)
      this.pat = configOrCredentials.pat;
      this.orgUrl = configOrCredentials.orgUrl;
      this.authMethod = configOrCredentials.authMethod;
      if (this.pat) {
        checkTokenExpiry("AZURE_DEVOPS_PAT (sync pair)", configOrCredentials.patExpiry, logger);
      }
    }
  }
```

**Key constraint:** The existing call site `new DevOpsClientService(this.config, this.logger)` in `RepoReplicationService.replicateDevOps()` (line 149) must continue to work without modification.

**Verification:**
- `npm run build` succeeds
- Existing `repo clone-github` and `repo clone-devops` commands still work (manual test with a test script)

**Parallelizable with:** Steps 3 and 4

---

## Step 6: Add Per-Pair ContainerClient Factory to Auth Service

**File to modify:** `src/services/auth.service.ts`

**Changes:**

Add a new exported function (after `createContainerClient` at line 44):

```typescript
/**
 * Create a ContainerClient for a sync pair destination using SAS token authentication.
 *
 * Unlike createContainerClient() which uses global ResolvedConfig, this function
 * accepts explicit per-pair storage parameters. Sync pairs always use SAS tokens.
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

**Verification:**
- `npm run build` succeeds

**Parallelizable with:** Steps 3, 4, 5

---

## Step 7: Add `replicateFromSyncConfig()` to RepoReplicationService

**File to modify:** `src/services/repo-replication.service.ts`

**Dependencies:** Steps 2, 3, 4, 5, 6

**Changes:**

Add new imports at the top:
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

Add a new public method to `RepoReplicationService`:

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
  const pairResults: SyncPairItemResult[] = [];

  for (const pair of syncConfig.syncPairs) {
    const pairResult = await this.executeSyncPair(pair);
    pairResults.push(pairResult);
  }

  const successCount = pairResults.filter((r) => r.success).length;
  const failedCount = pairResults.filter((r) => !r.success).length;

  return {
    totalPairs: syncConfig.syncPairs.length,
    successCount,
    failedCount,
    pairResults,
    totalDurationMs: Date.now() - totalStart,
  };
}
```

Add private helper methods:

```typescript
/**
 * Execute a single sync pair.
 */
private async executeSyncPair(pair: SyncPair): Promise<SyncPairItemResult> {
  try {
    this.logger.info(`Processing sync pair: ${pair.name} (${pair.platform})`);

    // Create per-pair ContainerClient
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

    this.logger.info(`Sync pair "${pair.name}" completed: ${result.successCount}/${result.totalFiles} files`);

    return {
      name: pair.name,
      success: true,
      result,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as any)?.code;
    this.logger.error(`Sync pair "${pair.name}" failed: ${message}`);

    return {
      name: pair.name,
      success: false,
      error: message,
      errorCode: code,
    };
  }
}

/**
 * Replicate a GitHub sync pair using per-pair credentials and destination.
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

  let ref = pair.source.ref;
  if (!ref) {
    const repoInfo = await githubClient.getRepoInfo(owner, repo);
    ref = repoInfo.defaultBranch;
    if (repoInfo.isPrivate) {
      githubClient.validateAuth(true);
    }
  }

  const archiveStream = await githubClient.getArchiveStream(owner, repo, ref);

  // Use the per-pair containerClient for blob uploads
  // We need to temporarily swap the containerClient for this operation
  const originalContainerClient = this.containerClient;
  (this as any).containerClient = containerClient;

  try {
    const streamStart = Date.now();
    const stats = await this.streamTarToBlob(archiveStream, pair.destination.folder, repoIdentifier);
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
  } finally {
    (this as any).containerClient = originalContainerClient;
  }
}

/**
 * Replicate a DevOps sync pair using per-pair credentials and destination.
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
    authMethod: pair.source.authMethod,
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

  const originalContainerClient = this.containerClient;
  (this as any).containerClient = containerClient;

  try {
    const streamStart = Date.now();
    const stats = await this.streamZipToBlob(archiveStream, pair.destination.folder, repoIdentifier);
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
  } finally {
    (this as any).containerClient = originalContainerClient;
  }
}
```

**Alternative design note:** The "swap containerClient" approach above is pragmatic but uses `any` casts. A cleaner approach is to make `streamTarToBlob` and `streamZipToBlob` accept `containerClient` as a parameter, extracting the `uploadEntryToBlob` call to use the provided client. This is recommended if the team prefers strict typing. The implementation should pass `containerClient` as an additional parameter to the private streaming methods rather than doing the swap trick. This plan recommends the cleaner approach during implementation.

**Verification:**
- `npm run build` succeeds
- Manual test with a sample sync pair config file

---

## Step 8: Add `repo sync` CLI Command

**File to modify:** `src/commands/repo.commands.ts`

**Dependencies:** Steps 2, 3, 7

**Changes:**

Add imports:
```typescript
import { loadSyncPairConfig, validateSyncPairConfig, checkSyncPairTokenExpiry } from "../config/sync-pair.loader";
```

Add new command inside `registerRepoCommands()` (after the `clone-devops` command, before function closing brace):

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

      // Create a RepoReplicationService with a dummy containerClient
      // (sync pairs create their own per-pair containerClient)
      const containerClient = createContainerClient(config);
      const service = new RepoReplicationService(config, containerClient, logger);

      const result = await service.replicateFromSyncConfig(syncConfig);

      const output = formatSuccess(result, "repo sync", startTime);
      outputResult(output, jsonMode);

      // Set exit code based on partial failures
      if (result.failedCount > 0 && result.successCount === 0) {
        process.exitCode = 1; // All failed
      } else if (result.failedCount > 0) {
        process.exitCode = 1; // Partial failure
      }
    } catch (err) {
      const output = formatErrorFromException(err, "repo sync", startTime);
      outputResult(output, jsonMode);
      process.exitCode = exitCodeForError(err);
    }
  });
```

**Note:** The global config is still loaded for logging settings. The `containerClient` from global config serves as a fallback for the `RepoReplicationService` constructor. Each sync pair overrides with its own container client.

**Verification:**
- `npm run build` succeeds
- `azure-fs repo sync --config test-sync.json` produces correct output
- `azure-fs repo clone-github` still works unchanged

---

## Step 9: Add `POST /api/v1/repo/sync` API Endpoint

**Files to modify:**
- `src/api/controllers/repo.controller.ts` -- add `syncPairs` method
- `src/api/routes/repo.routes.ts` -- add route with OpenAPI spec

### 9a. Controller

Add imports:
```typescript
import { loadSyncPairConfig, validateSyncPairConfig, checkSyncPairTokenExpiry } from "../../config/sync-pair.loader";
import { SyncPairConfig } from "../../types/repo-replication.types";
```

Add new method to the object returned by `createRepoController()`:

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

  const statusCode = result.failedCount > 0 && result.successCount === 0 ? 500
    : result.failedCount > 0 ? 207  // Multi-Status for partial success
    : 200;

  res.status(statusCode).json(buildResponse("repo-sync", result, startTime));
},
```

### 9b. Route

Add new route in `createRepoRoutes()` (after the `/devops` route):

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
 *       and Azure Storage destination. Pairs are processed sequentially.
 *       This is a long-running operation; a 30-minute timeout is applied.
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
 *                 items:
 *                   type: object
 *                   required: [name, platform, source, destination]
 *                   properties:
 *                     name:
 *                       type: string
 *                       description: Unique name for this sync pair
 *                     platform:
 *                       type: string
 *                       enum: [github, azure-devops]
 *                     source:
 *                       type: object
 *                       description: Source repository configuration (platform-specific)
 *                     destination:
 *                       type: object
 *                       required: [accountUrl, container, folder, sasToken]
 *                       properties:
 *                         accountUrl:
 *                           type: string
 *                         container:
 *                           type: string
 *                         folder:
 *                           type: string
 *                         sasToken:
 *                           type: string
 *                         sasTokenExpiry:
 *                           type: string
 *     responses:
 *       200:
 *         description: All sync pairs completed successfully
 *       207:
 *         description: Some sync pairs failed (partial success)
 *       400:
 *         description: Invalid sync pair configuration
 *       500:
 *         description: All sync pairs failed
 */
router.post("/sync", createTimeoutMiddleware(1800000), controller.syncPairs);
```

**Note:** The sync endpoint gets its own 30-minute timeout (overriding the 5-minute default for repo routes).

**Verification:**
- `npm run build` succeeds
- Swagger UI shows the new endpoint
- `curl -X POST http://localhost:3000/api/v1/repo/sync -H "Content-Type: application/json" -d @test-sync.json` works

---

## Step 10: Create Test Scripts

**New files:**
- `test_scripts/test-repo-sync-github.sh`
- `test_scripts/test-repo-sync-devops.sh`
- `test_scripts/test-repo-sync-mixed.sh`
- `test_scripts/sample-sync-config.json`
- `test_scripts/sample-sync-config.yaml`

**Purpose:** Manual test scripts that exercise the CLI `repo sync` command and the API `POST /api/v1/repo/sync` endpoint with sample configurations.

**Verification:**
- Scripts execute without syntax errors
- Both JSON and YAML config files are parseable

---

## Step 11: Update Documentation

**Files to modify:**
- `CLAUDE.md` -- add `repo sync` CLI documentation and API endpoint
- `docs/design/project-design.md` -- update architecture sections
- `docs/design/project-functions.md` -- add sync pair functional requirements
- `docs/design/configuration-guide.md` -- add sync pair config file documentation
- `cli-instructions.md` -- add `repo sync` command
- `api-instructions.md` -- add `POST /api/v1/repo/sync` endpoint
- `Issues - Pending Items.md` -- review and update

### Documentation details:

**CLAUDE.md updates:**
- Add `sync-pair.loader.ts` to project structure
- Add `repo sync` CLI command documentation
- Add `POST /api/v1/repo/sync` API endpoint documentation
- Add sync pair config file format to environment variables section

**project-functions.md updates:**
- New function F7.3: Sync Pair Configuration Loading
- New function F7.4: Sync Pair Batch Replication

**configuration-guide.md updates:**
- New section: "Sync Pair Configuration File"
- Document JSON and YAML formats
- Document all fields with purpose, how to obtain, and recommendations
- Include token expiry fields

**Verification:**
- All documentation is internally consistent
- No references to non-existent code or endpoints

---

## Step Dependency Graph

```
Step 1 (js-yaml) ──────────────────┐
                                    ├── Step 3 (loader/validator) ──┐
Step 2 (types) ─────────────────────┘                               │
                                                                    │
Step 4 (error factories) ──────────────────────────────────────────┤
                                                                    │
Step 5 (client service refactor) ──────────────────────────────────┤
                                                                    │
Step 6 (per-pair ContainerClient) ─────────────────────────────────┤
                                                                    │
                                    ┌───────────────────────────────┘
                                    v
                         Step 7 (service method) ──┐
                                                    ├── Step 8 (CLI command)
                                                    ├── Step 9 (API endpoint)
                                                    ├── Step 10 (test scripts)
                                                    └── Step 11 (documentation)
```

**Parallelizable groups:**
- Group A (concurrent): Steps 1, 2, 4, 5, 6
- Group B (requires Group A): Step 3
- Group C (requires Steps 2-6): Step 7
- Group D (requires Step 7, concurrent): Steps 8, 9, 10, 11

---

## Risk Mitigation Summary

| Risk | Mitigation |
|------|------------|
| Breaking existing `clone-github` / `clone-devops` | Overloaded constructors maintain backward compatibility; existing methods untouched |
| ContainerClient coupling | New `createSyncPairContainerClient()` is a separate function, does not modify existing `createContainerClient()` |
| No-fallback rule violation | `folder` is required in sync pair config; no default values anywhere |
| Token expiry not checked | `checkSyncPairTokenExpiry()` calls existing `checkTokenExpiry()` for all tokens in all pairs |
| API timeout exceeded | Sync endpoint uses 30-minute timeout (separate from 5-minute repo route default) |
| YAML parsing regression | `js-yaml` is only used in `sync-pair.loader.ts`, does not affect existing JSON config loading |
| Streaming architecture broken | Per-pair replication reuses the same streaming pipeline (`streamTarToBlob` / `streamZipToBlob`) |
