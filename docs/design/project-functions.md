# Repository Sync Tool - Functional Requirements

**Project Name**: repo-sync
**Date**: 2026-02-28
**Version**: 2.0.0

---

## Priority Classification

- **P0**: Must-have for the tool to be functional. Blocks agent usage if absent.
- **P1**: Important for complete functionality. Tool is usable without these but with limitations.
- **P2**: Nice-to-have. Enhances developer/agent experience.

---

## 1. Configuration Management

### F1.1 Configuration File Loading (P0)

**Description**: Load tool configuration from a JSON file (`.repo-sync.json`).

**Inputs**:
- Config file path (explicit via `--config` or auto-discovered at CWD/HOME)

**Outputs**:
- Parsed `ResolvedConfig` object with all required fields

**Behavior**:
- Search order: `--config` path > CWD `.repo-sync.json` > HOME `.repo-sync.json`
- Parse JSON content, validate all fields
- Throw `ConfigError` with detailed message if file not found or malformed

**Edge cases**:
- File exists but is empty JSON `{}` -- throw error for missing required fields
- File has extra unknown fields -- ignore them (forward compatibility)
- File has invalid JSON syntax -- throw parse error with line number if possible
- Multiple config files exist (CWD and HOME) -- CWD takes precedence

---

### F1.2 Environment Variable Configuration (P0)

**Description**: Load configuration from environment variables.

**Inputs**:
- Standard Azure env vars: `AZURE_STORAGE_ACCOUNT_URL`, `AZURE_STORAGE_CONTAINER_NAME`, `AZURE_FS_AUTH_METHOD`
- Auth-specific env vars: `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_SAS_TOKEN`
- Tool-specific env vars: `AZURE_FS_LOG_LEVEL`, `AZURE_FS_RETRY_STRATEGY`, etc.

**Outputs**:
- Partial config object (may not have all fields -- will be merged)

**Edge cases**:
- Env var set to empty string -- treated as not set (throw if required)
- Env var has leading/trailing whitespace -- trim before use

---

### F1.3 CLI Flag Configuration Overrides (P0)

**Description**: Override configuration via CLI flags. Highest priority source.

**Inputs**:
- `--account-url`, `--container`, `--auth-method`, `--config`

**Outputs**:
- Partial config object merged with highest priority

**Edge cases**:
- Both `--config` and `--account-url` provided -- CLI flags override config file values
- Flag provided with empty value -- throw validation error

---

### F1.4 Configuration Validation (P0)

**Description**: Validate that all required configuration is present and valid. No fallbacks or defaults for any required parameter.

**Inputs**:
- Merged config from all sources

**Outputs**:
- `ResolvedConfig` (valid) or throws `ConfigError`

**Behavior**:
- Every required field missing triggers `ConfigError` with:
  - Name of missing field
  - All 3 ways to provide it (CLI flag, env var, config file key)
  - Example value
- **Storage section is conditionally required**: If no storage fields are provided, the storage section is omitted from `ResolvedConfig` (sync-pairs-only mode). If any storage field is provided, all required storage fields must be present.

**Edge cases**:
- All sources return nothing -- error must list ALL missing required fields, not just the first one
- `authMethod` is set but corresponding credential env var is missing -- auth-specific error message
- No storage fields provided -- application starts without global container client (sync-pairs-only mode)

---

### F1.5 Interactive Configuration Init (P1)

**Description**: `repo-sync config init` -- interactively create a `.repo-sync.json` file.

**Inputs**:
- User responses to interactive prompts (account URL, container name, auth method, logging, retry)

**Outputs**:
- `.repo-sync.json` file created in current directory

**Edge cases**:
- File already exists -- prompt for overwrite confirmation
- User cancels mid-flow -- no file created

---

### F1.6 Configuration Display (P1)

**Description**: `repo-sync config show` -- display the fully resolved configuration (with sensitive values masked).

**Inputs**:
- Resolved config from all sources

**Outputs**:
- JSON or human-readable display of all config values
- Connection strings, SAS tokens, PATs shown as `***masked***`

---

### F1.7 Connection Validation (P0)

**Description**: `repo-sync config validate` -- test the connection to Azure Storage.

**Inputs**:
- Resolved config

**Outputs**:
- `ConnectionTestResult` with: success, authMethod, accountUrl, containerName, containerExists

**Behavior**:
- Create client using configured auth method
- Call `containerClient.exists()` to verify connectivity and permissions
- On 403: provide troubleshooting steps (check RBAC role, wait for propagation)

**Edge cases**:
- Container does not exist -- report `containerExists: false` but `success: true` (connection works)
- Network timeout -- report with retry suggestion

---

## 2. Authentication

### F2.1 Azure AD Authentication (P0)

**Description**: Authenticate using `DefaultAzureCredential` from `@azure/identity`.

**Inputs**:
- `storage.accountUrl` from config
- `storage.authMethod` = `"azure-ad"`

**Outputs**:
- `BlobServiceClient` authenticated via Azure AD

**Behavior**:
- Creates `DefaultAzureCredential` which auto-discovers credentials (Azure CLI, env vars, managed identity)
- Works with `az login` for local development

**Edge cases**:
- User not logged in via Azure CLI -- `DefaultAzureCredential` throws; tool wraps with helpful message
- RBAC role not assigned -- 403 error with troubleshooting steps
- Role assignment propagation delay (up to 8 minutes) -- mentioned in error guidance

---

### F2.2 SAS Token Authentication (P0)

**Description**: Authenticate using a Shared Access Signature token.

**Inputs**:
- `storage.accountUrl` from config
- `AZURE_STORAGE_SAS_TOKEN` environment variable
- `storage.authMethod` = `"sas-token"`

**Outputs**:
- `BlobServiceClient` authenticated via SAS token

**Edge cases**:
- SAS token expired -- 403 error with "SAS token may be expired" message
- SAS token missing required permissions -- 403 with permission guidance
- SAS token has `?` prefix vs without -- handle both formats
- Env var not set -- `AuthError` with instructions

---

### F2.3 Connection String Authentication (P0)

**Description**: Authenticate using a full connection string.

**Inputs**:
- `AZURE_STORAGE_CONNECTION_STRING` environment variable
- `storage.authMethod` = `"connection-string"`

**Outputs**:
- `BlobServiceClient` authenticated via connection string

**Edge cases**:
- Malformed connection string -- SDK error wrapped with helpful message
- Env var not set -- `AuthError` with instructions
- Connection string for wrong account -- operations may fail with 404

---

## 3. Repository Replication

### F3.1 GitHub Repository Replication -- CLI (P1)

**Description**: Replicate the complete file tree of a GitHub repository into an Azure Blob Storage folder via the CLI.

**Inputs**:
- `--repo <owner/repo>` (required): GitHub repository in `owner/repo` format
- `--dest <path>` (required): Destination folder path in Azure Blob Storage
- `--ref <branch|tag|sha>` (optional): Git ref to replicate. If omitted, the default branch is used.
- Environment variable `GITHUB_TOKEN` (optional for public repos, required for private repos): Personal Access Token for authentication
- Environment variable `GITHUB_TOKEN_EXPIRY` (optional): ISO 8601 expiry date for proactive warning

**Outputs**:
- `CommandResult<RepoReplicationResult>` containing:
  - `platform`: "github"
  - `source`: repository identifier
  - `ref`: the actual ref that was replicated
  - `destPath`: destination folder in Azure Blob Storage
  - `totalFiles`: number of files discovered in the archive
  - `successCount`: number of files successfully uploaded
  - `failedCount`: number of files that failed to upload
  - `totalBytes`: total bytes uploaded
  - `downloadDurationMs`, `extractionDurationMs`, `uploadDurationMs`, `totalDurationMs`: timing breakdown
  - `failedFiles`: per-file error details (only included when there are failures)

**Behavior**:
1. Validate configuration: check `GITHUB_TOKEN` if needed, check token expiry
2. If `--ref` is omitted, query GitHub API for the repository's default branch
3. Download tarball archive via `GET /repos/{owner}/{repo}/tarball/{ref}` (single API call)
4. Extract tarball to temporary directory using `tar` library with `strip: 1` (removes top-level `{owner}-{repo}-{sha}/` directory)
5. Walk extracted directory recursively, building upload task list
6. Upload all files to Azure Blob Storage using `parallelLimit` with configured concurrency (`batch.concurrency`)
7. Clean up temporary files (archive and extraction directory)
8. Return structured result

**Edge cases**:
- Repository does not exist or is not accessible: throw `RepoReplicationError` with `REPO_NOT_FOUND` code, exit code 1
- `GITHUB_TOKEN` missing for private repository: throw `ConfigError` with instructions, exit code 2
- `GITHUB_TOKEN_EXPIRY` is set and token is expired: throw `ConfigError`, exit code 2
- `GITHUB_TOKEN_EXPIRY` is set and token expires within 7 days: log warning, proceed normally
- Rate limit exceeded (403 with `X-RateLimit-Remaining: 0`): throw `RepoReplicationError` with helpful message about setting `GITHUB_TOKEN`
- Archive contains path traversal entries (`../`): skip those entries with warning log
- Some individual file uploads fail: record failures in result, continue with remaining files, do not abort
- Large repository exhausts temp disk space: operation fails with OS-level error; document disk space requirement (2x repo size)
- Git LFS files: only pointer files are included (GitHub limitation); document this clearly
- Submodules: only pointer files (`.gitmodules`) are included; document this clearly
- Empty directories: not preserved (git limitation, not present in tarball)

---

### F3.2 Azure DevOps Repository Replication -- CLI (P1)

**Description**: Replicate the complete file tree of an Azure DevOps Git repository into an Azure Blob Storage folder via the CLI.

**Inputs**:
- `--org <organization>` (required): Azure DevOps organization name
- `--project <project>` (required): Project name
- `--repo <repository>` (required): Repository name or GUID
- `--dest <path>` (required): Destination folder path in Azure Blob Storage
- `--ref <branch|tag|sha>` (optional): Version identifier. If omitted, the default branch is used.
- `--version-type <branch|tag|commit>` (optional): How to interpret `--ref`. Default: `branch`.
- `--resolve-lfs` (optional flag): Resolve LFS pointers to actual content
- Environment variable `AZURE_DEVOPS_AUTH_METHOD` (required): `pat` or `azure-ad`
- Environment variable `AZURE_DEVOPS_PAT` (required when auth method is `pat`): Personal Access Token
- Environment variable `AZURE_DEVOPS_PAT_EXPIRY` (optional): ISO 8601 expiry date for proactive warning

**Outputs**:
- `CommandResult<RepoReplicationResult>` with same structure as F3.1, with `platform: "azure-devops"`

**Behavior**:
1. Validate configuration: check auth method, check PAT if method is `pat`, check token expiry
2. Build Items API URL with `$format=zip`, `recursionLevel=Full`, `zipForUnix=true`, and optional `resolveLfs=true`
3. Authenticate using PAT (Basic auth) or Azure AD (`DefaultAzureCredential` with DevOps scope `499b84ac-1321-427f-aa17-267ca6975798/.default`)
4. Download zip archive to temporary file (single HTTP request)
5. Extract zip to temporary directory using `extract-zip`
6. Walk extracted directory recursively, building upload task list
7. Upload all files to Azure Blob Storage using `parallelLimit` with configured concurrency
8. Clean up temporary files
9. Return structured result

**Edge cases**:
- Repository does not exist (404): throw `RepoReplicationError` with `REPO_NOT_FOUND` code, exit code 1
- `AZURE_DEVOPS_AUTH_METHOD` not set: throw `ConfigError` with instructions, exit code 2
- `AZURE_DEVOPS_PAT` missing when auth method is `pat`: throw `ConfigError`, exit code 2
- `AZURE_DEVOPS_PAT_EXPIRY` set and token expired: throw `ConfigError`, exit code 2
- `AZURE_DEVOPS_PAT_EXPIRY` set and token expires within 7 days: log warning, proceed
- TSTU throttling (429 with `Retry-After`): honor `Retry-After` header and retry
- Authentication failure (401/403): throw with auth-specific message
- Path traversal in zip entries: skip with warning log
- Individual file upload failures: record in result, do not abort
- LFS resolution: when `--resolve-lfs` is set, `resolveLfs=true` is passed to the API; LFS pointer files are replaced with actual content
- Submodules: not included in zip archive; document this limitation
- Legacy Azure DevOps URL format (`{org}.visualstudio.com`): not supported; only `dev.azure.com/{org}` format

---

### F3.3 GitHub Repository Replication -- API (P1)

**Description**: Replicate a GitHub repository into Azure Blob Storage via the REST API.

**Inputs**:
- HTTP `POST /api/v1/repo/github`
- Request body (JSON):
  - `repo` (string, required): GitHub repository in `owner/repo` format
  - `ref` (string, optional): Branch, tag, or commit SHA
  - `destPath` (string, required): Destination folder in Azure Blob Storage

**Outputs**:
- HTTP 200 with `RepoReplicationResult` in standard response envelope (`success`, `data`, `metadata`)

**Behavior**:
- Same as F3.1 but triggered via HTTP POST instead of CLI
- Controller extracts parameters from request body, calls `RepoReplicationService.replicateGitHub()`
- A longer per-route timeout (5 minutes / 300000ms) is applied to repo replication endpoints to accommodate large repositories
- Response includes timing breakdown for observability

**Edge cases**:
- Missing required fields (`repo`, `destPath`): return HTTP 400 with `REPO_MISSING_PARAMS` error code
- Authentication failure: return HTTP 401 with `REPO_AUTH_MISSING`
- Repository not found: return HTTP 404 with `REPO_NOT_FOUND`
- Operation timeout: return HTTP 408 with `REQUEST_TIMEOUT`
- Internal error (archive/extraction/upload): return HTTP 500 with `REPO_REPLICATION_ERROR`

---

### F3.4 Azure DevOps Repository Replication -- API (P1)

**Description**: Replicate an Azure DevOps repository into Azure Blob Storage via the REST API.

**Inputs**:
- HTTP `POST /api/v1/repo/devops`
- Request body (JSON):
  - `organization` (string, required): Azure DevOps organization name
  - `project` (string, required): Project name
  - `repository` (string, required): Repository name or GUID
  - `ref` (string, optional): Version identifier
  - `versionType` (string, optional): `branch`, `tag`, or `commit` (default: `branch`)
  - `destPath` (string, required): Destination folder in Azure Blob Storage
  - `resolveLfs` (boolean, optional): Resolve LFS pointers (default: false)

**Outputs**:
- HTTP 200 with `RepoReplicationResult` in standard response envelope

**Behavior**:
- Same as F3.2 but triggered via HTTP POST instead of CLI
- Controller extracts parameters from request body, calls `RepoReplicationService.replicateDevOps()`
- A longer per-route timeout (5 minutes / 300000ms) is applied
- Response includes timing breakdown

**Edge cases**:
- Missing required fields (`organization`, `project`, `repository`, `destPath`): return HTTP 400 with `REPO_MISSING_PARAMS`
- Authentication failure: return HTTP 401 with `REPO_AUTH_MISSING`
- Repository not found: return HTTP 404 with `REPO_NOT_FOUND`
- Operation timeout: return HTTP 408 with `REQUEST_TIMEOUT`
- Internal error: return HTTP 500 with `REPO_REPLICATION_ERROR`

---

### F3.5 Repo Replication Configuration -- GitHub (P1)

**Description**: Configuration parameters for GitHub repository replication.

**Inputs**:
- Environment variable `GITHUB_TOKEN` (secret, never in config file)
- Environment variable `GITHUB_TOKEN_EXPIRY` (optional, also settable in config file as `github.tokenExpiry`)
- Existing `batch.concurrency` controls upload parallelism

**Outputs**:
- Validated auth context for GitHub API access

**Behavior**:
- `GITHUB_TOKEN` is read from environment variables only (never from config file, as it is a secret)
- `GITHUB_TOKEN_EXPIRY`, when set, is checked before each replication:
  - Expired: throw `ConfigError`
  - Within 7 days: log warning
- For public repositories, `GITHUB_TOKEN` is optional (unauthenticated access at 60 req/hr limit)
- For private repositories, `GITHUB_TOKEN` is required; its absence throws `ConfigError`
- No fallback values: if the token is needed and missing, the operation fails immediately

**Edge cases**:
- `GITHUB_TOKEN_EXPIRY` is set but `GITHUB_TOKEN` is not: no validation needed (expiry only matters if token is present)
- `GITHUB_TOKEN_EXPIRY` is not a valid ISO 8601 date: throw `ConfigError`
- Token present but repo is public: token is used anyway (higher rate limit)

---

### F3.6 Repo Replication Configuration -- Azure DevOps (P1)

**Description**: Configuration parameters for Azure DevOps repository replication.

**Inputs**:
- Environment variable `AZURE_DEVOPS_AUTH_METHOD` (required when using DevOps replication): `pat` or `azure-ad`
- Environment variable `AZURE_DEVOPS_PAT` (secret, required when auth method is `pat`)
- Environment variable `AZURE_DEVOPS_PAT_EXPIRY` (optional)
- Environment variable `AZURE_DEVOPS_ORG_URL` (optional, overrides derived org URL)

**Outputs**:
- Validated auth context for Azure DevOps API access

**Behavior**:
- `AZURE_DEVOPS_AUTH_METHOD` must be explicitly set; its absence throws `ConfigError` when DevOps replication is attempted
- When method is `pat`:
  - `AZURE_DEVOPS_PAT` must be set; its absence throws `ConfigError`
  - Auth header: `Authorization: Basic ${base64(':' + PAT)}`
- When method is `azure-ad`:
  - Uses `DefaultAzureCredential` from `@azure/identity` with scope `499b84ac-1321-427f-aa17-267ca6975798/.default`
  - No additional env vars required beyond standard Azure Identity variables
- `AZURE_DEVOPS_PAT_EXPIRY` follows the same pattern as `GITHUB_TOKEN_EXPIRY`
- `AZURE_DEVOPS_ORG_URL`, when set, overrides the derived URL `https://dev.azure.com/{org}`

**Edge cases**:
- `AZURE_DEVOPS_AUTH_METHOD` is not `pat` or `azure-ad`: throw `ConfigError` with valid options
- `AZURE_DEVOPS_PAT_EXPIRY` set but `AZURE_DEVOPS_PAT` not set: no validation needed
- `AZURE_DEVOPS_PAT_EXPIRY` is not valid ISO 8601: throw `ConfigError`
- Azure AD token acquisition fails: throw `RepoReplicationError` with instructions to run `az login` or configure service principal

---

## 4. Sync Pair Configuration and Batch Replication

### F4.1 Sync Pair Configuration Loading (P1)

**Description**: Load repository-to-Azure-Storage sync pair definitions from a JSON or YAML configuration file or HTTP(S) URL. Each sync pair is self-contained with its own source repository credentials and its own Azure Storage destination.

**Inputs**:
- Local file path or HTTP(S) URL to a sync pair configuration file (`.json`, `.yaml`, or `.yml`)
- For Azure Blob Storage URLs, `AZURE_VENV_SAS_TOKEN` is auto-appended for authentication

**Outputs**:
- Parsed and validated `SyncPairConfig` object containing an array of `SyncPair` entries

**Behavior**:
- Detect file format by extension: `.json` uses `JSON.parse()`, `.yaml`/`.yml` uses `js-yaml`
- Validate top-level structure: `syncPairs` array must exist and be non-empty
- Validate each sync pair has required fields: `name` (unique), `platform`, `source`, `destination`
- For `platform: "github"`: validate `source.repo` is in `owner/repo` format
- For `platform: "azure-devops"`: validate `source.organization`, `source.project`, `source.repository`, `source.authMethod` are present; if `authMethod` is `pat`, validate `source.pat` is present
- Validate destination has `accountUrl`, `container`, `folder`, `sasToken`
- Check token expiry for all tokens using `checkTokenExpiry()` utility: source tokens (GitHub PAT, DevOps PAT) and destination SAS tokens
- All required fields must be present; no fallback values. Missing fields throw `RepoReplicationError.invalidSyncConfig()`
- File not found throws `ConfigError` with code `CONFIG_FILE_NOT_FOUND`
- Parse errors throw `ConfigError` with code `CONFIG_FILE_PARSE_ERROR`

**Sync Pair Configuration Schema**:

GitHub sync pair fields:
- `name` (required): Unique identifier for this sync pair
- `platform` (required): Must be `"github"`
- `source.repo` (required): GitHub repository in `owner/repo` format
- `source.ref` (optional): Branch, tag, or commit SHA
- `source.token` (optional): GitHub Personal Access Token (required for private repos)
- `source.tokenExpiry` (optional): Token expiry in ISO 8601 format
- `destination.accountUrl` (required): Azure Storage account URL
- `destination.container` (required): Container name
- `destination.folder` (required): Destination folder path
- `destination.sasToken` (required): SAS token for Azure Storage
- `destination.sasTokenExpiry` (optional): SAS token expiry in ISO 8601 format

Azure DevOps sync pair fields:
- `name` (required): Unique identifier for this sync pair
- `platform` (required): Must be `"azure-devops"`
- `source.organization` (required): Azure DevOps organization name
- `source.project` (required): Project name
- `source.repository` (required): Repository name or GUID
- `source.ref` (optional): Version identifier
- `source.versionType` (optional): `"branch"`, `"tag"`, or `"commit"`
- `source.resolveLfs` (optional): Whether to resolve LFS pointers
- `source.pat` (conditional): Required when `authMethod` is `"pat"`
- `source.patExpiry` (optional): PAT expiry in ISO 8601 format
- `source.authMethod` (required): `"pat"` or `"azure-ad"`
- `source.orgUrl` (optional): Organization URL override
- `destination.accountUrl` (required): Azure Storage account URL
- `destination.container` (required): Container name
- `destination.folder` (required): Destination folder path
- `destination.sasToken` (required): SAS token for Azure Storage
- `destination.sasTokenExpiry` (optional): SAS token expiry in ISO 8601 format

**Edge cases**:
- File does not exist: throw `ConfigError`
- File has unrecognized extension: throw `ConfigError` with valid extensions
- File has valid extension but invalid content: throw parse error
- `syncPairs` is empty array: throw `RepoReplicationError.invalidSyncConfig()`
- Duplicate `name` across pairs: throw validation error
- Token already expired: throw `ConfigError` (via `checkTokenExpiry`)
- Token expiring within 7 days: log warning (via `checkTokenExpiry`)

---

### F4.2 Sync Pair Batch Replication -- CLI (P1)

**Description**: Execute all sync pairs from a configuration file via the CLI command `repo sync`.

**CLI Syntax**:
```
repo-sync repo sync --sync-config <path>
```

**Inputs**:
- `--config <path>` (required): Path to sync pair configuration file

**Outputs**:
- `SyncPairBatchResult` with per-pair results, aggregate counts, and total duration

**Behavior**:
- Load and validate sync pair config file
- Check token expiry for all pairs
- Process pairs sequentially
- Each pair creates its own `GitHubClientService` or `DevOpsClientService` with per-pair credentials
- Each pair creates its own `ContainerClient` with per-pair Azure Storage SAS token
- Continue processing remaining pairs if one fails (fail-open)
- Report per-pair success/failure in the result
- Maintain streaming architecture (zero local disk)

**Exit codes**:
- 0: All pairs succeeded
- 1: One or more pairs failed
- 2: Configuration/authentication error (config file missing, invalid, expired token)
- 3: Validation error (invalid config structure)

**Edge cases**:
- Config file has 0 valid pairs after validation: error before processing
- First pair fails: continue with remaining pairs, report failure
- All pairs fail: exit code 1 with full error details per pair
- Network failure mid-batch: affected pair fails, others continue

---

### F4.3 Sync Pair Batch Replication -- API (P1)

**Description**: Execute all sync pairs via the REST API endpoint `POST /api/v1/repo/sync`.

**Endpoint**: `POST /api/v1/repo/sync`

**Request body**: JSON object with the same structure as the sync pair config file (the `syncPairs` array with all pair definitions).

**Outputs**:
- HTTP 200: All pairs succeeded
- HTTP 207 (Multi-Status): Some pairs succeeded, some failed
- HTTP 400: Invalid sync pair configuration
- HTTP 500: All pairs failed

**Behavior**:
- Same processing logic as CLI command
- 30-minute timeout (overrides the default 5-minute repo route timeout)
- Request body is validated using the same `validateSyncPairConfig()` function
- Token expiry checked for all pairs before processing begins

**Edge cases**:
- Request body missing `syncPairs`: HTTP 400 with `REPO_MISSING_PARAMS`
- Request body too large: handled by Express JSON parser limit
- Timeout exceeded: HTTP 408 (or connection drop depending on timing)

---

### F4.4 List Sync Pairs -- CLI (P1)

**Description**: List all configured sync pairs from a configuration file via the CLI command `repo list-sync-pairs`. Credentials are never exposed; only token expiry status is shown.

**CLI Command**: `repo list-sync-pairs`

**Inputs**:
- `--sync-config <path>` (optional): Path to sync pair configuration file. Falls back to `AZURE_FS_SYNC_CONFIG_PATH` env var.

**Outputs**:
- `SyncPairListResult` containing:
  - `totalPairs`: number of configured pairs
  - `configPath`: resolved path to the configuration file
  - `syncPairs`: array of `SyncPairSummary` objects (name, platform, source, ref, destination details, token expiry status)

**Behavior**:
- Resolve config path: `--sync-config` flag > `AZURE_FS_SYNC_CONFIG_PATH` env var
- Load and validate config via `loadSyncPairConfig()`
- Build summaries via `summarizeSyncPairs()` with masked credentials
- Token status computed per pair: "valid", "expiring-soon", "expired", or "no-expiry-set"

**Edge cases**:
- No config path provided: ConfigError with guidance to use `--sync-config` or env var
- Config file not found: ConfigError
- Config file invalid: ConfigError with parse details

---

### F4.5 List Sync Pairs -- API (P1)

**Description**: List all configured sync pairs via the REST API endpoint `GET /api/v1/repo/sync-pairs`. Reads from the server's `AZURE_FS_SYNC_CONFIG_PATH`. Credentials are never included in the response.

**Endpoint**: `GET /api/v1/repo/sync-pairs`

**Outputs**:
- HTTP 200: Sync pairs listed successfully with `SyncPairListResult` in standard envelope
- HTTP 400: `AZURE_FS_SYNC_CONFIG_PATH` not configured
- HTTP 500: Config file read/parse failure

**Behavior**:
- Read config path from `process.env.AZURE_FS_SYNC_CONFIG_PATH`
- If not configured, return 400 with clear error
- Load and validate via `loadSyncPairConfig()`
- Build summaries via `summarizeSyncPairs()` — no credentials in response
- Token expiry status included per pair for monitoring

**Edge cases**:
- Env var not set: HTTP 400 with `CONFIG_MISSING`
- Config file deleted after startup: HTTP 500 from file read error

---

## 5. Cross-Cutting Features

### F5.1 JSON Output Mode (P0)

**Description**: All commands support `--json` flag for structured JSON output.

**Outputs**:
```json
{
  "success": true,
  "data": { ... },
  "error": null,
  "metadata": {
    "command": "repo sync",
    "timestamp": "2026-02-28T10:30:00Z",
    "durationMs": 234
  }
}
```

**Edge cases**:
- Error in JSON mode -- error formatted as JSON to stdout, process exits with non-zero code
- Command produces no data -- `data: null` with `success: true`

---

### F5.2 Verbose Logging (P1)

**Description**: `--verbose` flag enables detailed logging of Azure SDK requests.

**Behavior**:
- Log all request parameters (method, URL, headers)
- Log response status codes and timing
- Omit file content from logs
- Log to stderr to keep stdout clean for JSON output

---

### F5.3 Configurable Retry (P1)

**Description**: Transient Azure errors (429, 503) are retried based on configured strategy.

**Strategies**:
- `none`: No retry, fail immediately
- `fixed`: Retry up to N times with fixed delay between each
- `exponential`: Retry with exponential backoff (delay doubles each attempt, capped at maxDelay)

**Edge cases**:
- Max retries exceeded -- throw the last error
- Non-retryable error (404, 403) -- fail immediately regardless of strategy
- Strategy is "none" -- `initialDelayMs` and `maxDelayMs` are not required

---

### F5.4 Path Normalization (P0)

**Description**: All blob paths are normalized before operations.

**Rules**:
1. Backslashes converted to forward slashes
2. Leading slashes removed
3. Double slashes collapsed
4. `.` segments removed
5. `..` segments resolved
6. Trailing slash preserved only for folder operations

**Edge cases**:
- Path `../escape/attempt` -- resolved relative to root (becomes `escape/attempt`)
- Path with only slashes `///` -- becomes empty string (root)
- Unicode characters in path -- preserved (Azure supports them)
- Path longer than 1024 characters -- `PathError`

---

### F5.5 Request Logging (P1)

**Description**: Log all Azure Storage requests with parameters but without file content.

**Logged fields**:
- Operation name (upload, download, delete, etc.)
- Blob path
- Request timestamp
- Response status code
- Response duration
- Content type and size (but not content itself)
- Metadata keys (but sensitive values masked)

**Not logged**:
- File content / body data
- Connection strings
- SAS tokens
- Account keys
- PATs

---

## 6. Error Handling

### F6.1 Structured Error Responses (P0)

**Description**: All errors return structured responses with machine-readable codes.

**Error codes**:

| Code | Category | Description |
|------|----------|-------------|
| `CONFIG_MISSING_REQUIRED` | Configuration | Required config parameter not found |
| `CONFIG_INVALID_VALUE` | Configuration | Config value fails validation |
| `CONFIG_FILE_NOT_FOUND` | Configuration | Config file path does not exist |
| `CONFIG_FILE_PARSE_ERROR` | Configuration | Config file has invalid JSON/YAML |
| `AUTH_MISSING_CONNECTION_STRING` | Authentication | Connection string env var not set |
| `AUTH_MISSING_SAS_TOKEN` | Authentication | SAS token env var not set |
| `AUTH_AZURE_AD_FAILED` | Authentication | DefaultAzureCredential failed |
| `AUTH_ACCESS_DENIED` | Authentication | 403 from Azure (RBAC issue) |
| `AUTH_INVALID_METHOD` | Authentication | Unknown auth method specified |
| `REPO_NOT_FOUND` | Repo Replication | Repository not found or not accessible |
| `REPO_AUTH_MISSING` | Repo Replication | Repository authentication credentials missing |
| `REPO_MISSING_PARAMS` | Repo Replication | Required repository parameters not provided |
| `REPO_REPLICATION_ERROR` | Repo Replication | General replication failure (archive/extraction/upload) |
| `REPO_INVALID_SYNC_CONFIG` | Repo Replication | Sync pair configuration is invalid |
| `PATH_TOO_LONG` | Validation | Blob path exceeds 1024 characters |
| `PATH_INVALID` | Validation | Path contains invalid characters |
| `NET_CONNECTION_FAILED` | Network | Cannot reach Azure Storage |
| `NET_TIMEOUT` | Network | Request timed out |
| `NET_TRANSIENT_ERROR` | Network | 429 or 503 from Azure |
| `UNKNOWN_ERROR` | General | Unexpected error |

---

## 7. REST API

### F7.1 API Server Startup (P0)

**Description**: Start an Express 5.x HTTP server exposing repo-sync operations as REST endpoints.

**Inputs**:
- Resolved configuration with `api` section (port, host, corsOrigins, swaggerEnabled, uploadMaxSizeMb, requestTimeoutMs)
- All existing Azure Storage configuration (storage, auth, logging, retry)

**Outputs**:
- HTTP server listening on `api.host:api.port`
- Structured JSON log message indicating successful startup

**Behavior**:
- Load and validate full configuration including `api` section (all six API parameters are required; no defaults)
- Create `BlobFileSystemService` instance (shared across all requests)
- Mount middleware: CORS, JSON body parser, request logger, timeout enforcement
- Mount repo replication routes under `/api/v1/repo`
- Mount health check routes at `/api/health`
- Conditionally mount Swagger UI at `/api/docs` when `api.swaggerEnabled` is true
- Mount centralized error handler middleware last
- Implement graceful shutdown on SIGTERM/SIGINT (stop azure-venv watcher, stop accepting connections, wait for in-flight requests with 10s timeout)
- At bootstrap, use `watchAzureVenv()` instead of `initAzureVenv()` to enable continuous polling for blob changes in Azure Blob Storage. The watcher polls at a configurable interval (`AZURE_VENV_POLL_INTERVAL`, default 30s) and updates in-memory state when blob changes are detected.
- Detect port-in-use (`EADDRINUSE`) and exit with clear error message

**Edge cases**:
- Missing `api` section in config -- `ConfigError` listing all six required API parameters
- Port already in use -- exit with `EADDRINUSE` error and exit code 1
- Azure Storage unreachable at startup -- server starts but health/ready returns unhealthy

---

### F7.2 API Configuration (P0)

**Description**: Extend the existing layered configuration system with API-specific settings.

**Inputs**:
- Config file `.repo-sync.json` with optional `api` section
- Environment variables: `AZURE_FS_API_PORT`, `AZURE_FS_API_HOST`, `AZURE_FS_API_CORS_ORIGINS`, `AZURE_FS_API_SWAGGER_ENABLED`, `AZURE_FS_API_UPLOAD_MAX_SIZE_MB`, `AZURE_FS_API_REQUEST_TIMEOUT_MS`

**Outputs**:
- `ApiResolvedConfig` extending `ResolvedConfig` with required `api: ApiConfig`

**Behavior**:
- Same priority: CLI Flags > Environment Variables > Config File
- `AZURE_FS_API_CORS_ORIGINS` parsed as comma-separated string into `string[]`
- All six API parameters are required when running the API server; throw `ConfigError` if any is missing
- CLI commands continue to work without any `api` section present

**Edge cases**:
- `corsOrigins` empty string -- throw `ConfigError` (at least one origin required)
- `port` is not a valid integer or out of range -- throw `ConfigError`
- `uploadMaxSizeMb` is zero or negative -- throw `ConfigError`

---

### F7.3 Health Check Endpoints (P0)

**Description**: Provide liveness and readiness health check endpoints.

**Endpoints**:
- `GET /api/health` -- Liveness probe (always returns 200 if server is running)
- `GET /api/health/ready` -- Readiness probe (verifies Azure Storage connectivity)

**Outputs**:
```json
{
  "status": "ok",
  "timestamp": "2026-02-28T10:00:00Z",
  "uptime": 3600,
  "checks": {
    "azureStorage": "connected"
  }
}
```

**Edge cases**:
- Azure Storage unreachable -- readiness returns `{ status: "degraded", checks: { azureStorage: "disconnected" } }` with HTTP 503
- Liveness always returns 200 regardless of downstream connectivity

---

### F7.4 Repo Replication Endpoints (P0)

**Description**: Expose repository replication operations as HTTP endpoints.

**Endpoints**:

| Method | Path | Maps To | Description |
|--------|------|---------|-------------|
| `POST` | `/api/v1/repo/github` | `replicateGitHub()` | Replicate GitHub repo to Azure Blob Storage |
| `POST` | `/api/v1/repo/devops` | `replicateDevOps()` | Replicate Azure DevOps repo to Azure Blob Storage |
| `POST` | `/api/v1/repo/sync` | `syncPairs()` | Execute batch sync pair replication |
| `GET` | `/api/v1/repo/sync-pairs` | `listSyncPairs()` | List configured sync pairs with token status |

**Behavior**:
- GitHub and DevOps endpoints use a 5-minute timeout
- Sync endpoint uses a 30-minute timeout
- All responses use the standard envelope format (`success`, `data`, `metadata`)
- Sync endpoint returns HTTP 207 for partial success

**Edge cases**:
- Missing required fields: HTTP 400 with `REPO_MISSING_PARAMS`
- Auth failure: HTTP 401 with `REPO_AUTH_MISSING`
- Repository not found: HTTP 404 with `REPO_NOT_FOUND`
- Operation timeout: HTTP 408
- Internal error: HTTP 500 with `REPO_REPLICATION_ERROR`

---

### F7.5 Error Mapping Middleware (P0)

**Description**: Centralized Express error middleware that maps error subclasses to appropriate HTTP status codes.

**Behavior**:
- `AzureFsError` instances: use `err.statusCode` or code-to-status mapping table, respond with `err.toJSON()`
- Unknown errors: log full error, respond with 500 and generic message (never expose internal details)

**Response format** (all errors):
```json
{
  "success": false,
  "error": {
    "code": "REPO_NOT_FOUND",
    "message": "Repository not found: owner/repo"
  },
  "metadata": {
    "command": "api:repo-github",
    "timestamp": "2026-02-28T10:00:00Z",
    "durationMs": 45
  }
}
```

---

### F7.6 Swagger/OpenAPI Documentation (P1)

**Description**: Interactive API documentation at `/api/docs` using swagger-jsdoc and swagger-ui-express.

**Behavior**:
- When `api.swaggerEnabled` is `true`: mount Swagger UI at `/api/docs`, serve OpenAPI JSON at `/api/docs.json`
- When `api.swaggerEnabled` is `false`: both endpoints return 404
- All routes annotated with `@openapi` JSDoc comments
- Reusable component schemas defined in `src/api/swagger/schemas.ts`

**Edge cases**:
- `swaggerEnabled` not set -- `ConfigError` (required parameter)

---

### F7.7 Request Logging & Timeout (P1)

**Description**: Log all HTTP requests and enforce per-request timeouts.

**Request logging**:
- Log: HTTP method, URL path, status code, response time, content length
- Do not log: request body content, file content, authorization headers

**Timeout**:
- Configurable via `api.requestTimeoutMs`
- Long-running requests are aborted and respond with 408 Request Timeout

---

### F7.8 CORS Configuration (P0)

**Description**: Restrict cross-origin access to explicitly configured origins.

**Behavior**:
- Use the `cors` npm package with `origin` set to `api.corsOrigins` array
- Reject requests from non-configured origins
- Set `credentials: true` for cookie/header auth support
- Cache preflight responses with `maxAge: 86400` (24 hours)

**Edge cases**:
- Wildcard `*` in corsOrigins -- allowed but generates a warning log at startup
- Request from unlisted origin -- 403 from CORS middleware

---

## 8. API Server Enhancement Features

### F8.1 NODE_ENV Support (P0)

**Description**: Add `NODE_ENV` as a required configuration parameter for the API server, controlling environment-specific behaviors.

**Inputs**:
- `NODE_ENV` environment variable or `api.nodeEnv` in config file
- Valid values: `development`, `production`, `test`

**Outputs**:
- `nodeEnv` field available on `ApiConfig` interface

**Behavior**:
- Required when starting the API server (throw `ConfigError` if missing)
- Controls error response detail: stack traces included only in `development` mode
- Controls Swagger server description: "Production server" vs "Development server"
- Gates development-only routes (F8.5)
- CLI commands are NOT affected (not validated for CLI)

**Edge cases**:
- Missing value -- `ConfigError` with remediation guidance
- Invalid value (e.g., `staging`) -- `ConfigError` with valid options list
- Not prefixed with `AZURE_FS_` because it is a standard Node.js convention

---

### F8.2 Config Source Tracking (P1)

**Description**: Track which configuration source (config file, environment variable, or CLI flag) provided each resolved configuration value.

**Inputs**:
- The three-layer config merge process (config file, env vars, CLI flags)

**Outputs**:
- `ConfigSourceTracker` object attached to `ApiResolvedConfig`
- Each tracked key maps to one of: `config-file`, `environment-variable`, `cli-flag`

**Behavior**:
- During config merge, record which source "won" for each key
- Only the winning source is recorded (highest priority that provided a value)
- Keys are tracked with dot notation (e.g., `storage.accountUrl`, `api.port`)
- Only active for API server path (`resolveApiConfig()`); CLI path (`resolveConfig()`) is unaffected
- Consumed by development routes (F8.5) to display source audit trail

**Edge cases**:
- Key provided by multiple sources -- only the highest-priority source is recorded
- Key not provided by any source -- not tracked (validation will throw before tracking matters)
- OS-level env vars (PATH, HOME) -- not tracked, shown as `system` in dev routes

---

### F8.3 Container-Aware Swagger URLs (P1)

**Description**: Enhance Swagger/OpenAPI specification generation to auto-detect runtime environments (Azure App Service, Kubernetes, Docker) and generate correct server URLs.

**Inputs**:
- Auto-detected env vars: `WEBSITE_HOSTNAME`, `WEBSITE_SITE_NAME`, `K8S_SERVICE_HOST`, `K8S_SERVICE_PORT`, `DOCKER_HOST_URL`
- User overrides: `PUBLIC_URL`, `AZURE_FS_API_SWAGGER_ADDITIONAL_SERVERS`, `AZURE_FS_API_SWAGGER_SERVER_VARIABLES`
- Optional `actualPort` when port was auto-selected (F8.4)

**Outputs**:
- Swagger spec `servers` array with environment-appropriate URL(s)
- Optional server variables for interactive URL editing in Swagger UI
- Optional additional server entries

**Behavior**:
- Detection priority chain: Azure App Service > PUBLIC_URL > Kubernetes > Docker > local development
- All detection env vars are optional (not validated in config schema)
- `AZURE_FS_API_SWAGGER_ADDITIONAL_SERVERS`: comma-separated URLs added as extra server entries
- `AZURE_FS_API_SWAGGER_SERVER_VARIABLES=true`: adds protocol/host/port variables to Swagger UI
- When `actualPort` differs from configured port, Swagger URL uses the actual port

**Edge cases**:
- No container env vars set -- falls back to `http://{host}:{port}` (correct local behavior, not a "fallback" violation)
- Multiple detection vars set -- priority chain determines winner
- Azure App Service always uses HTTPS when `WEBSITE_SITE_NAME` is present

---

### F8.4 PortChecker Utility (P0)

**Description**: Proactive port availability check before the Express server attempts to listen, with optional auto-selection of the next available port.

**Inputs**:
- `AUTO_SELECT_PORT` environment variable or `api.autoSelectPort` in config file (required, `true`/`false`)
- Configured `api.port` and `api.host`

**Outputs**:
- If port available: server starts normally
- If port occupied and `AUTO_SELECT_PORT=true`: auto-selects next available port, logs the change
- If port occupied and `AUTO_SELECT_PORT=false`: exits with error identifying the process using the port

**Behavior**:
- `PortChecker.isPortAvailable()`: TCP probe to check if port can be bound
- `PortChecker.findAvailablePort()`: scans sequentially from startPort, max 10 attempts
- `PortChecker.getProcessUsingPort()`: uses `lsof` to identify occupying process (macOS/Linux only)
- Existing `server.on("error")` handler kept as safety net against race conditions
- When auto-selecting, the Express app is created with the actual port so Swagger URLs are correct

**Edge cases**:
- Race condition: port becomes occupied between check and listen -- safety net handler catches `EADDRINUSE`
- All 10 scanned ports occupied -- exit with error listing the range checked
- `lsof` not available (Windows) -- `getProcessUsingPort()` returns `null`, informational only
- `AUTO_SELECT_PORT` not set -- `ConfigError` (required parameter, no fallback)

---

### F8.5 Development Routes (P1)

**Description**: Development-only API endpoints for inspecting environment variables and configuration sources.

**Endpoints**:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/dev/env` | List all environment variables with sources and masking |
| `GET` | `/api/dev/env/:key` | Get a specific environment variable |

**Inputs**:
- `NODE_ENV=development` (routes only mounted in development mode)
- `ConfigSourceTracker` from config loading (optional, enhances source display)

**Outputs**:

`GET /api/dev/env`:
```json
{
  "success": true,
  "data": {
    "environment": "development",
    "totalVariables": 45,
    "variables": [
      { "name": "AZURE_FS_API_PORT", "value": "3000", "source": "environment-variable", "masked": false }
    ],
    "sources": { "config-file": 5, "environment-variable": 12, "system": 28 }
  },
  "metadata": { "timestamp": "2026-02-28T10:00:00Z" }
}
```

**Behavior**:
- Two layers of security: routes NOT mounted when `NODE_ENV !== "development"` + handlers return 403 as defense in depth
- All `process.env` keys listed, sorted alphabetically
- Sensitive keys (containing SECRET, PASSWORD, TOKEN, KEY, PRIVATE, CREDENTIAL) have values masked as `***MASKED***`
- Source labels: `config-file`, `environment-variable`, `cli-flag` for tracked keys; `system` for OS-level vars
- Responses use the project's standard envelope format

**Edge cases**:
- `NODE_ENV=production` -- routes not mounted (404); handler also returns 403 (belt and suspenders)
- Requested key does not exist -- 404 with key name
- Key is case-insensitive -- normalized to uppercase before lookup
- No `ConfigSourceTracker` available -- all sources show as `system`

---

### F8.6 Console Hotkeys (P2)

**Description**: Interactive keyboard shortcuts for the API server console during development and debugging. Provides quick access to common developer actions without restarting the server.

**Inputs**:
- `NODE_ENV` (feature is only active when `NODE_ENV !== "production"`)
- Keyboard input via `process.stdin` (letter + Enter)
- Resolved `ApiResolvedConfig` for config inspection

**Outputs**:
- Console feedback for each hotkey action (colored via `chalk`)
- Runtime changes to `AZURE_FS_LOG_LEVEL` environment variable (verbose toggle)
- Console output suppression (freeze toggle)

**Hotkeys**:

| Key | Action | Description |
|-----|--------|-------------|
| `c` | Clear console | Clears the terminal including scrollback buffer; re-displays help |
| `f` | Freeze/unfreeze output | Suppresses all `console.log`, `console.error`, `console.warn` calls when frozen; restores when unfrozen |
| `v` | Toggle verbose mode | Sets `AZURE_FS_LOG_LEVEL` to `debug` (on) or `info` (off) at runtime |
| `i` | Inspect configuration | Displays all resolved configuration keys with sensitive values masked |
| `h` | Show help | Prints the hotkey reference table |
| `Ctrl+C` | Graceful exit | Triggers cleanup and `process.exit(0)` |

**Behavior**:
- The `ConsoleCommands` class is instantiated in `src/api/server.ts` after `server.listen()` completes
- `ConsoleCommands.createInspector(config)` builds a config inspector function that masks sensitive values
- The verbose toggle modifies `process.env.AZURE_FS_LOG_LEVEL` at runtime, which affects subsequent logger operations
- The freeze toggle replaces `console.log/error/warn` with no-op functions; unfreezing restores the originals
- On graceful shutdown (SIGTERM/SIGINT), `cleanup()` closes the readline interface and restores console methods
- Uses `chalk@4` (CommonJS-compatible) for colored terminal output

**Edge cases**:
- `NODE_ENV=production` -- `ConsoleCommands` is never instantiated; no stdin listener is created
- stdin not available (e.g., piped input) -- setup catches errors and logs a warning; server continues normally
- Unrecognized input -- silently ignored (no error, no feedback)
- Multiple freeze toggles -- idempotent; freeze/unfreeze alternates correctly
- Verbose toggle when log level was already `debug` -- still toggles to `info` on next press

---

### F8.7 Hotkey API Endpoints (P1)

**Description**: HTTP endpoints that invoke the same console hotkey actions remotely. Provides access to hotkey functionality in Docker containers, cloud deployments, and other environments where stdin is not reachable.

**Endpoints**:

| Method | Path | Action | Equivalent Hotkey |
|--------|------|--------|-------------------|
| `POST` | `/api/dev/hotkeys/clear` | Clear console output | `c` |
| `POST` | `/api/dev/hotkeys/freeze` | Toggle freeze/unfreeze log output | `f` |
| `POST` | `/api/dev/hotkeys/verbose` | Toggle verbose mode (debug/info) | `v` |
| `GET` | `/api/dev/hotkeys/config` | Inspect resolved configuration (masked) | `i` |
| `GET` | `/api/dev/hotkeys/status` | Get current state (frozen, verbose) | -- |
| `GET` | `/api/dev/hotkeys/help` | List available hotkeys and descriptions | `h` |

**Inputs**:
- `NODE_ENV=development` (routes only mounted in development mode)
- `ConsoleCommands` instance injected via `ApiServices`

**Outputs**:

`POST /api/dev/hotkeys/verbose`:
```json
{
  "success": true,
  "data": { "action": "verbose", "verbose": true },
  "metadata": { "timestamp": "2026-02-28T10:00:00Z" }
}
```

`GET /api/dev/hotkeys/status`:
```json
{
  "success": true,
  "data": { "frozen": false, "verbose": true },
  "metadata": { "timestamp": "2026-02-28T10:00:00Z" }
}
```

`GET /api/dev/hotkeys/help`:
```json
{
  "success": true,
  "data": {
    "action": "help",
    "hotkeys": [
      { "key": "c", "command": "clear", "description": "Clear console (including scrollback buffer)" },
      { "key": "f", "command": "freeze", "description": "Freeze / unfreeze log output" },
      { "key": "v", "command": "verbose", "description": "Toggle verbose mode (switches log level between debug/info)" },
      { "key": "i", "command": "config", "description": "Inspect resolved configuration (sensitive values masked)" },
      { "key": "h", "command": "help", "description": "Show available hotkeys" },
      { "key": "Ctrl+C", "command": "exit", "description": "Graceful exit" }
    ]
  },
  "metadata": { "timestamp": "2026-02-28T10:00:00Z" }
}
```

**Behavior**:
- Routes mounted at `/api/dev/hotkeys` inside the existing `if (nodeEnv === "development")` block
- Each handler performs defense-in-depth `NODE_ENV` check (returns 403 if not in development)
- Returns 503 if `ConsoleCommands` instance is null (service unavailable)
- The `ConsoleCommands` instance is created before `createApp()` and injected into `ApiServices`
- The `setup()` method (readline) is still called after `server.listen()`
- Action methods (`executeClear()`, `executeFreeze()`, `executeVerbose()`, `executeInspect()`, `getStatus()`, `getHelp()`) return structured data used by both console and API
- Swagger tag: "Hotkeys"

**Edge cases**:
- `NODE_ENV=production` -- routes not mounted (404); handler also returns 403 (defense in depth)
- `ConsoleCommands` is null -- 503 with descriptive message
- Config inspector not available -- `executeInspect()` returns `{ action: "inspect", config: null }`
- Multiple consecutive freeze toggles -- each call toggles the state correctly

---

## 9. Docker Deployment

### F9.1 Docker Containerization (P1)

**Description**: Package the REST API as a Docker container for production deployment.

**Implementation**:
- Multi-stage Dockerfile: builder stage compiles TypeScript, production stage contains only compiled JS and production dependencies
- Base image: `node:20-alpine` for minimal footprint
- Non-root execution: runs as the built-in `node` user
- Built-in health check: `wget` against `/api/health` every 30s
- `.dockerignore` excludes unnecessary files (docs, tests, source maps, .git)

**Docker Files**:

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage production image |
| `.dockerignore` | Build context exclusions |
| `docker-compose.yml` | Local dev/testing convenience |
| `.env.docker.example` | Docker-specific env template with production defaults |

**Configuration in Docker**:
- All configuration via environment variables (no config files in the image)
- `.env` file loaded by Docker Compose at runtime
- Docker Compose sets production overrides: `NODE_ENV=production`, `AZURE_FS_API_HOST=0.0.0.0`, `AUTO_SELECT_PORT=false`
- `PUBLIC_URL` supported for reverse proxy scenarios

**Build & Run**:
```bash
docker build -t repo-sync-api .
docker run --env-file .env -p 3000:3000 repo-sync-api
docker compose up
```

**Production Readiness**:
- Health check endpoints (`/api/health`, `/api/health/ready`)
- Graceful shutdown on `SIGTERM`/`SIGINT`
- Container-aware Swagger URL detection
- Console hotkeys auto-disabled in production

---

## 10. Feature Summary by Priority

### P0 -- Must-Have

| ID | Feature |
|----|---------|
| F1.1 | Config file loading |
| F1.2 | Environment variable configuration |
| F1.3 | CLI flag overrides |
| F1.4 | Configuration validation (no fallbacks) |
| F1.7 | Connection validation |
| F2.1 | Azure AD authentication |
| F2.2 | SAS Token authentication |
| F2.3 | Connection String authentication |
| F5.1 | JSON output mode |
| F5.4 | Path normalization |
| F6.1 | Structured error responses |
| F7.1 | API server startup and graceful shutdown |
| F7.2 | API configuration (6 required parameters, no defaults) |
| F7.3 | Health check endpoints (liveness + readiness) |
| F7.4 | Repo replication endpoints (github, devops, sync) |
| F7.5 | Error mapping middleware |
| F7.8 | CORS configuration |
| F8.1 | NODE_ENV support (environment mode control) |
| F8.4 | PortChecker utility (proactive port conflict resolution) |

### P1 -- Important

| ID | Feature |
|----|---------|
| F1.5 | Interactive config init |
| F1.6 | Config display |
| F3.1 | GitHub repository replication (CLI) |
| F3.2 | Azure DevOps repository replication (CLI) |
| F3.3 | GitHub repository replication (API) |
| F3.4 | Azure DevOps repository replication (API) |
| F3.5 | GitHub replication configuration |
| F3.6 | Azure DevOps replication configuration |
| F4.1 | Sync pair configuration loading (JSON/YAML) |
| F4.2 | Sync pair batch replication (CLI) |
| F4.3 | Sync pair batch replication (API) |
| F5.2 | Verbose logging |
| F5.3 | Configurable retry |
| F5.5 | Request logging |
| F7.6 | Swagger/OpenAPI documentation |
| F7.7 | Request logging and timeout |
| F8.2 | Config source tracking |
| F8.3 | Container-aware Swagger URLs |
| F8.5 | Development routes |
| F8.7 | Hotkey API endpoints |
| F9.1 | Docker containerization |

### P2 -- Nice-to-Have

| ID | Feature |
|----|---------|
| F8.6 | Console hotkeys (interactive developer shortcuts) |
