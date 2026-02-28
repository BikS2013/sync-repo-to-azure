# Codebase Analysis: Sync Pair Configuration for Repository Replication

**Date:** 2026-02-28
**Purpose:** Pre-implementation analysis for adding JSON/YAML sync pair configuration to the repository replication module.

---

## 1. Project Overview

| Aspect | Detail |
|--------|--------|
| **Language** | TypeScript (strict mode) |
| **Runtime** | Node.js |
| **Build system** | `tsc` (TypeScript compiler) |
| **Package manager** | npm |
| **CLI framework** | Commander.js |
| **API framework** | Express.js |
| **Azure SDK** | `@azure/storage-blob`, `@azure/identity` |
| **GitHub SDK** | Octokit (`@octokit/rest`) |
| **Config format** | `.azure-fs.json` (JSON only, searched in CWD then HOME) |
| **Entry points** | CLI: `src/index.ts`, API: `src/api/server.ts` |

---

## 2. Architecture Map: Repository Replication Module

### 2.1 Data Flow (Current)

```
CLI Command / API Request
        |
        v
resolveConfig(globalOpts)  -----> buildMergedConfig() -----> validateConfig()
        |                           |                           |
        |                    loadConfigFile()              ResolvedConfig
        |                    loadEnvConfig()                    |
        |                    loadCliConfig()                    |
        v                                                      v
RepoReplicationService(config, containerClient, logger)
        |
        +---> replicateGitHub(params: GitHubRepoParams)
        |         |
        |         +---> new GitHubClientService(config, logger)
        |         |         reads config.github?.token
        |         |         reads config.github?.tokenExpiry
        |         +---> githubClient.getArchiveStream()
        |         +---> streamTarToBlob(stream, destPath)
        |
        +---> replicateDevOps(params: DevOpsRepoParams)
                  |
                  +---> new DevOpsClientService(config, logger)
                  |         reads config.devops?.pat
                  |         reads config.devops?.patExpiry
                  |         reads config.devops?.authMethod
                  |         reads config.devops?.orgUrl
                  +---> devopsClient.getArchiveStream()
                  +---> streamZipToBlob(stream, destPath)
```

### 2.2 Key Observation: Tight Coupling to Global Config

Currently, `GitHubClientService` and `DevOpsClientService` read credentials from `ResolvedConfig.github` and `ResolvedConfig.devops` -- **a single set of credentials for the entire application**. The sync pair concept requires **per-pair credentials and per-pair storage targets**, which is fundamentally different.

### 2.3 Key Observation: ContainerClient Created Once

`createContainerClient(config)` creates a `ContainerClient` using the global `config.storage` settings (accountUrl, containerName, authMethod). For sync pairs, each pair needs its own Azure Storage target (account URL + container + SAS token), meaning **a new ContainerClient must be created per sync pair**.

---

## 3. Relevant Symbol Map

### 3.1 Types and Interfaces

| Symbol | File | Lines | Description |
|--------|------|-------|-------------|
| `ResolvedConfig` | `src/types/config.types.ts` | 105-136 | Global config interface; has optional `github?` and `devops?` sections |
| `AzureFsConfigFile` | `src/types/config.types.ts` | 46-86 | Config file shape; `github?` and `devops?` are sub-objects |
| `GitHubRepoConfig` | `src/types/repo-replication.types.ts` | 111-116 | `{ token?: string; tokenExpiry?: string }` |
| `DevOpsRepoConfig` | `src/types/repo-replication.types.ts` | 119-128 | `{ pat?; patExpiry?; authMethod?; orgUrl? }` |
| `GitHubRepoParams` | `src/types/repo-replication.types.ts` | 19-26 | `{ repo; ref?; destPath }` |
| `DevOpsRepoParams` | `src/types/repo-replication.types.ts` | 29-44 | `{ organization; project; repository; ref?; versionType?; destPath; resolveLfs? }` |
| `RepoReplicationResult` | `src/types/repo-replication.types.ts` | 47-108 | Result type for replication operations |
| `RepoPlatform` | `src/types/repo-replication.types.ts` | 6 | `"github" \| "azure-devops"` |
| `DevOpsAuthMethod` | `src/types/repo-replication.types.ts` | 12 | `"pat" \| "azure-ad"` |
| `ApiServices` | `src/api/routes/index.ts` | 21-32 | API dependency injection; has optional `repoReplicationService?` |

### 3.2 Services

| Symbol | File | Lines | Constructor Signature |
|--------|------|-------|-----------------------|
| `RepoReplicationService` | `src/services/repo-replication.service.ts` | 55-59 | `constructor(config: ResolvedConfig, containerClient: ContainerClient, logger: Logger)` |
| `GitHubClientService` | `src/services/github-client.service.ts` | 23-38 | `constructor(config: ResolvedConfig, logger: Logger)` -- reads `config.github?.token` |
| `DevOpsClientService` | `src/services/devops-client.service.ts` | 23-36 | `constructor(config: ResolvedConfig, private readonly logger: Logger)` -- reads `config.devops?.pat`, `config.devops?.orgUrl`, `config.devops?.authMethod` |

### 3.3 Commands and Controllers

| Symbol | File | Lines | Description |
|--------|------|-------|-------------|
| `registerRepoCommands` | `src/commands/repo.commands.ts` | 16-94 | CLI `repo clone-github` and `repo clone-devops` commands |
| `createRepoController` | `src/api/controllers/repo.controller.ts` | 28-130 | API `POST /api/v1/repo/github` and `POST /api/v1/repo/devops` |
| `createRepoRoutes` | `src/api/routes/repo.routes.ts` | 13-447 | Express router with OpenAPI specs (5-min timeout override) |

### 3.4 Config Loading

| Symbol | File | Lines | Description |
|--------|------|-------|-------------|
| `loadConfigFile` | `src/config/config.loader.ts` | 48-84 | Loads `.azure-fs.json` (JSON only, no YAML support) |
| `loadEnvConfig` | `src/config/config.loader.ts` | 99-222 | Maps env vars to config sections; GitHub and DevOps at lines 202-220 |
| `buildMergedConfig` | `src/config/config.loader.ts` | 311-335 | Merges file < env < CLI; sections: storage, logging, retry, batch, api, github, devops |
| `validateConfig` | `src/config/config.schema.ts` | 16-259 | Validates and builds `ResolvedConfig`; GitHub/DevOps sections at lines 223-258 |
| `resolveConfig` | `src/config/config.loader.ts` | 356-367 | CLI entry: builds CliOptions, calls loadConfig |
| `resolveApiConfig` | `src/config/config.loader.ts` | (API-specific variant) | API entry: also validates API section |

### 3.5 Error Handling

| Symbol | File | Description |
|--------|------|-------------|
| `RepoReplicationError` | `src/errors/repo-replication.error.ts` | Static factory methods: `.notFound()`, `.authMissing()`, `.downloadFailed()`, `.extractionFailed()`, `.rateLimited()`, `.missingParams()` |
| `RepoErrorCode` | `src/types/errors.types.ts` | Error code enum for repo operations |
| `ConfigError` | `src/errors/config.error.ts` | Config validation errors with `.missingRequired()`, `.invalidValue()` |

### 3.6 Utilities

| Symbol | File | Description |
|--------|------|-------------|
| `checkTokenExpiry` | `src/utils/token-expiry.utils.ts` | Validates token expiry dates, throws if expired, warns if within 7 days |
| `createContainerClient` | `src/services/auth.service.ts` | Creates `ContainerClient` from `ResolvedConfig.storage` |

---

## 4. Pattern Catalog

### 4.1 Config Loading Pattern

**Priority order (highest wins):** CLI flags > Environment variables > Config file (`.azure-fs.json`)

**Config file:** JSON only, searched at `CWD/.azure-fs.json` then `HOME/.azure-fs.json`. No YAML support currently exists. The `loadConfigFile()` uses `JSON.parse()`.

**No fallback rule:** The project has a strict rule -- missing required config must raise an exception, never substitute defaults. See `CLAUDE.md` and `config.schema.ts`.

### 4.2 Service Construction Pattern

Services are constructed once at startup and shared:
- CLI: created in command action callback (`registerRepoCommands`)
- API: created in `startServer()` and passed via `ApiServices` interface

The `RepoReplicationService` takes `(config, containerClient, logger)` and internally creates `GitHubClientService`/`DevOpsClientService` on each call to `replicateGitHub`/`replicateDevOps`.

### 4.3 Error Handling Pattern

- Custom error classes extend `AzureFsError`
- Static factory methods for specific error scenarios
- Error codes defined in enums (`RepoErrorCode`)
- API error handler middleware translates errors to JSON responses with status codes

### 4.4 API Pattern

- Factory functions: `createXxxRoutes(services)` -> Router
- Controller factory: `createXxxController(service, logger)` -> handler object
- OpenAPI annotations in JSDoc comments above route handlers
- Services injected via `ApiServices` bag

---

## 5. Impact Analysis

### 5.1 Files That MUST Be Modified

| File | Reason |
|------|--------|
| `src/types/repo-replication.types.ts` | New interfaces: `SyncPair`, `GitHubSyncPair`, `DevOpsSyncPair`, `SyncPairConfig`, `SyncPairResult` (batch result) |
| `src/services/repo-replication.service.ts` | New methods: `replicateFromSyncPairs()` / `replicateFromSyncConfig()`; must create per-pair ContainerClient and per-pair client services with per-pair credentials |
| `src/services/github-client.service.ts` | Constructor must accept per-pair token (not just global config). Either overload constructor or accept explicit token param |
| `src/services/devops-client.service.ts` | Constructor must accept per-pair PAT/orgUrl/authMethod (not just global config). Same consideration |
| `src/commands/repo.commands.ts` | New CLI command: `repo sync` or `repo sync-pairs` that accepts a config file path |
| `src/api/controllers/repo.controller.ts` | New controller method: `syncPairs` that accepts JSON/YAML config in body or file reference |
| `src/api/routes/repo.routes.ts` | New route: `POST /api/v1/repo/sync` with OpenAPI spec |
| `src/errors/repo-replication.error.ts` | New error factories: `.invalidSyncConfig()`, `.syncPairFailed()` |
| `src/types/errors.types.ts` | New error codes in `RepoErrorCode`: `REPO_INVALID_SYNC_CONFIG`, `REPO_SYNC_PAIR_FAILED` |

### 5.2 Files That MIGHT Need Modification

| File | Reason |
|------|--------|
| `src/services/auth.service.ts` | May need a function to create ContainerClient from per-pair SAS token + account URL (currently uses global config) |
| `src/config/config.loader.ts` | If sync pairs can also be defined in the main `.azure-fs.json`, the `loadConfigFile`, `loadEnvConfig`, and `buildMergedConfig` functions need updating. However, it may be cleaner to keep sync pair config as a **separate file** |
| `src/config/config.schema.ts` | If sync pairs are part of main config, `validateConfig` needs a new section. If separate file, a new `validateSyncPairConfig()` function is needed |
| `src/types/config.types.ts` | If sync pairs are added to `AzureFsConfigFile` / `ResolvedConfig` |
| `src/api/routes/index.ts` | `ApiServices` may need a sync-pair service reference, or the existing `repoReplicationService` may be extended |
| `src/api/server.ts` | If a new service is created for sync pairs |
| `src/types/index.ts` | New type exports |
| `package.json` | YAML parsing dependency (e.g., `js-yaml`) if YAML support is added |

### 5.3 New Files That Likely Need Creation

| File | Purpose |
|------|---------|
| `src/config/sync-pair.loader.ts` | Load and parse sync pair config from JSON or YAML file |
| `src/config/sync-pair.schema.ts` | Validate sync pair config structure |
| `src/types/sync-pair.types.ts` | Or extend `repo-replication.types.ts` with sync pair interfaces |

### 5.4 Interfaces/Contracts Affected

1. **`GitHubClientService` constructor** -- currently `(config: ResolvedConfig, logger: Logger)`, reads token from `config.github?.token`. Must accept per-pair token.
2. **`DevOpsClientService` constructor** -- currently `(config: ResolvedConfig, logger: Logger)`, reads PAT from `config.devops?.pat`. Must accept per-pair PAT/orgUrl.
3. **`RepoReplicationService` constructor** -- currently `(config: ResolvedConfig, containerClient: ContainerClient, logger: Logger)`. The `containerClient` is bound to one storage target. Per-pair requires per-pair ContainerClient creation.
4. **`createContainerClient(config: ResolvedConfig)`** -- uses global storage config. Need a variant that accepts explicit account URL + SAS token + container.

---

## 6. Risk Assessment

### 6.1 High Risk: Breaking Existing Single-Repo Commands

The existing `clone-github` and `clone-devops` commands must continue to work unchanged. The sync pair feature must be additive, not replacing the current single-repo flow.

**Mitigation:** Add new methods/commands rather than modifying existing ones. Keep the current `replicateGitHub`/`replicateDevOps` methods untouched.

### 6.2 High Risk: Service Constructor Coupling

`GitHubClientService` and `DevOpsClientService` constructors are tightly coupled to `ResolvedConfig`. The cleanest approach is to make them accept explicit credential parameters alongside (or instead of) the global config.

**Options:**
- A. Overload constructors to accept explicit credentials (preferred -- backward compatible)
- B. Extract credential parameters into separate interfaces that both global config and sync pairs can provide
- C. Create a "config adapter" that builds a synthetic `ResolvedConfig` per sync pair (hacky, not recommended)

### 6.3 Medium Risk: ContainerClient Per-Pair

Currently `createContainerClient(config)` uses global config and creates a SAS/connection-string/Azure AD client. Sync pairs specify their own SAS tokens and account URLs. A new factory function is needed.

**Note:** Sync pairs always use SAS tokens (based on the spec), so the per-pair factory only needs to handle SAS-based auth.

### 6.4 Medium Risk: YAML Dependency

The project currently has no YAML parsing. Adding `js-yaml` or `yaml` is a new dependency.

### 6.5 Low Risk: Config File Separation

Sync pair config should likely be a **separate file** (not part of `.azure-fs.json`) because:
- It contains secrets (PAT tokens, SAS tokens) that may need different access controls
- It has a fundamentally different structure (array of pairs vs. flat config)
- It avoids bloating the main config validation

---

## 7. Constraints Discovered

### 7.1 No Fallback Values

From `CLAUDE.md`: "You must never create fallback solutions for configuration settings. In every case a configuration setting is not provided you must raise the appropriate exception."

**Implication:** Every required field in a sync pair (repo source, credentials, storage target, container) must throw an explicit error if missing. Optional fields like `ref` or `folder` (defaulting to `/`) must be documented as explicit exceptions registered in the project memory.

### 7.2 Config File Is JSON Only

`loadConfigFile()` at line 48-84 uses `JSON.parse()`. The sync pair loader must handle both JSON and YAML as per the requirement. This is new functionality.

### 7.3 Token Expiry Pattern

The project has an established `checkTokenExpiry()` utility. Sync pair tokens (GitHub PAT, DevOps PAT, Azure SAS) must follow this same pattern, checking expiry and warning within 7 days.

### 7.4 Exit Code Convention

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Operation error |
| 2 | Configuration/authentication error |
| 3 | Validation error |

Sync pair config validation errors should use exit code 3. Auth failures per pair should use exit code 2.

### 7.5 Streaming Architecture

The replication uses streaming (tar for GitHub, zip for DevOps) with zero local disk usage. Sync pairs must maintain this -- they should process pairs sequentially or with controlled concurrency, not download everything to disk.

### 7.6 API Timeout

Repo routes have a 5-minute timeout override (`createTimeoutMiddleware(300000)` at line 21 in `repo.routes.ts`). Sync pairs with multiple repos may need a longer timeout or a different strategy (async job, webhook callback).

### 7.7 Documentation Requirements (CLAUDE.md)

Every new operation must update:
- `project-design.md` and `project-functions.md`
- API and Swagger content
- `CLAUDE.md` with CLI/API documentation
- `configuration-guide.md`
- `Issues - Pending Items.md` for any gaps

---

## 8. Proposed Sync Pair Configuration Schema

Based on the analysis, the sync pair config file should look like:

### JSON Format
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
        "folder": "/",
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
        "authMethod": "pat",
        "orgUrl": "https://dev.azure.com/myorg"
      },
      "destination": {
        "accountUrl": "https://myaccount.blob.core.windows.net",
        "container": "my-container",
        "folder": "repos/myrepo",
        "sasToken": "sv=2022-11-02&ss=b&srt=co&sp=rwdlacyx...",
        "sasTokenExpiry": "2026-12-31T00:00:00Z"
      }
    }
  ]
}
```

### YAML Format
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
      folder: /
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
      authMethod: pat
      orgUrl: https://dev.azure.com/myorg
    destination:
      accountUrl: https://myaccount.blob.core.windows.net
      container: my-container
      folder: repos/myrepo
      sasToken: "sv=2022-11-02&ss=b&srt=co&sp=rwdlacyx..."
      sasTokenExpiry: "2026-12-31T00:00:00Z"
```
