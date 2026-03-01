# Repo Sync Tool - Project Design

**Project Name**: repo-sync
**Date**: 2026-02-28
**Version**: 2.0.0

---

## 1. Overview

`repo-sync` is a TypeScript CLI tool and REST API that replicates GitHub and Azure DevOps repositories into Azure Blob Storage. It uses a **direct streaming** approach: archive content is piped from the source platform directly into Azure Blob Storage with **zero intermediate local disk usage**. The tool supports both single-repo replication and configuration-driven batch replication via sync pairs.

### 1.1 Goals

- Replicate GitHub and Azure DevOps repositories to Azure Blob Storage via streaming
- Support sync pair configuration for batch replication of multiple repositories
- Support multiple authentication methods for both source platforms and Azure Storage
- Output structured JSON for reliable agent parsing
- Enforce strict configuration with no silent fallbacks
- Be modular, testable, and extensible

### 1.2 Non-Goals

- Generic file upload/download to Azure Blob Storage
- Folder operations, metadata management, or tag querying on blobs
- File editing or patching operations
- Git history replication (only working tree at a specified ref)
- Submodule resolution
- Incremental/differential sync
- GUI or web interface

---

## 2. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        CLI Layer (Commander.js)                   │
│                                                                  │
│  repo-sync <command> [args] [--json] [--verbose] [--config path] │
│                                                                  │
│  Commands: config | repo clone-github | repo clone-devops |      │
│            repo sync | repo list-sync-pairs                      │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             │ resolves config, creates service
                             v
┌──────────────────────────────────────────────────────────────────┐
│                     Service Layer                                 │
│                                                                  │
│  ┌────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │
│  │ ConfigService   │  │ AuthService       │  │ PathService      │  │
│  │                │  │                  │  │                 │  │
│  │ Load & validate│  │ Create clients   │  │ Normalize &     │  │
│  │ config from    │  │ per auth method  │  │ validate paths  │  │
│  │ CLI/env/file   │  │ (3 methods)      │  │                 │  │
│  └────────┬───────┘  └────────┬─────────┘  └────────┬────────┘  │
│           │                   │                      │           │
│           v                   v                      v           │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │              RepoReplicationService                        │   │
│  │                                                           │   │
│  │  replicateGitHub(params)   - stream tar to blob storage   │   │
│  │  replicateDevOps(params)   - stream zip to blob storage   │   │
│  │  replicateFromSyncConfig() - batch sync pair execution    │   │
│  │                                                           │   │
│  │  GitHubClientService    DevOpsClientService               │   │
│  │  (Octokit/tar-stream)   (fetch/unzipper)                  │   │
│  └─────────────────────────┬─────────────────────────────────┘   │
│                            │                                     │
│  ┌─────────────────────────┼─────────────────────────────────┐   │
│  │  Cross-Cutting Concerns │                                 │   │
│  │                         │                                 │   │
│  │  RetryUtil    Logger    OutputFormatter    TokenExpiry     │   │
│  └─────────────────────────┼─────────────────────────────────┘   │
└────────────────────────────┼─────────────────────────────────────┘
                             │
                             v
┌──────────────────────────────────────────────────────────────────┐
│                   Azure SDK Layer                                 │
│                                                                  │
│  @azure/storage-blob      @azure/identity                        │
│                                                                  │
│  BlobServiceClient        DefaultAzureCredential                 │
│  ContainerClient          (+ SAS Token, Connection String)       │
│  BlockBlobClient                                                 │
└──────────────────────────────────────────────────────────────────┘
                             │
                             v
                   Azure Blob Storage
```

---

## 3. Module Relationships

### 3.1 Dependency Graph

```
src/index.ts
  └── src/commands/*.ts
        ├── src/config/config.loader.ts
        │     └── src/config/config.schema.ts
        │           └── src/types/config.types.ts
        ├── src/config/sync-pair.loader.ts
        ├── src/services/auth.service.ts
        │     ├── src/types/config.types.ts
        │     └── src/errors/auth.error.ts
        ├── src/services/repo-replication.service.ts
        │     ├── src/services/github-client.service.ts
        │     │     ├── @octokit/rest
        │     │     ├── src/utils/token-expiry.utils.ts
        │     │     ├── src/errors/repo-replication.error.ts
        │     │     └── src/errors/config.error.ts
        │     ├── src/services/devops-client.service.ts
        │     │     ├── @azure/identity
        │     │     ├── src/utils/token-expiry.utils.ts
        │     │     ├── src/errors/repo-replication.error.ts
        │     │     └── src/errors/config.error.ts
        │     ├── src/services/path.service.ts
        │     │     └── src/errors/path.error.ts
        │     ├── tar-stream (streaming tar extraction)
        │     ├── zlib (Node.js built-in, gunzip)
        │     └── unzipper (streaming zip extraction)
        └── src/utils/output.utils.ts
              └── src/types/command-result.types.ts
```

### 3.2 Module Responsibilities

| Module | Responsibility | Key Exports |
|--------|---------------|-------------|
| `config.loader` | Load config from CLI flags, env vars, config file; merge; validate | `loadConfig()`, `resolveConfig()` |
| `config.schema` | Config interfaces and validation schemas | `RepoSyncConfigFile`, `ResolvedConfig` |
| `sync-pair.loader` | Load, parse, validate sync pair config (JSON/YAML) | `loadSyncPairConfig()`, `validateSyncPairConfig()` |
| `auth.service` | Create Azure SDK clients for each auth method | `createBlobServiceClient()`, `createContainerClient()`, `createSyncPairContainerClient()`, `validateConnection()` |
| `path.service` | Path normalization, validation, folder/file distinction | `normalizePath()`, `normalizeFolderPath()`, `validateBlobPath()` |
| `github-client.service` | GitHub API client (archive stream download) | `GitHubClientService` class |
| `devops-client.service` | Azure DevOps API client (archive stream download) | `DevOpsClientService` class |
| `repo-replication.service` | Streaming archive-to-blob orchestration (single repo + sync pairs) | `RepoReplicationService` class |
| `output.utils` | Format CommandResult as JSON or human-readable text | `formatOutput()` |
| `retry.utils` | Configurable retry wrapper (none/exponential/fixed) | `withRetry()` |
| `logger.utils` | Request logging (parameters only, no file content) | `Logger` class |
| `token-expiry.utils` | Token expiry checking utility | `checkTokenExpiry()` |
| `console-commands.utils` | Interactive console hotkeys for API server development/debugging | `ConsoleCommands` class |

---

## 4. Data Flow Diagrams

### 4.1 GitHub Replication Flow

```
User/Agent invokes: repo-sync repo clone-github --repo owner/repo --dest repos/my-project --json

    ┌───────────┐
    │ Commander  │  Parse args: command=repo clone-github, repo=owner/repo,
    │  Parser    │  dest=repos/my-project, json=true
    └─────┬─────┘
          │
          v
    ┌───────────┐
    │  Config    │  1. Load CLI flags (--account-url, --container, etc.)
    │  Loader    │  2. Load env vars (AZURE_STORAGE_*, GITHUB_TOKEN)
    └─────┬─────┘  3. Load .repo-sync.json
          │        4. Merge (CLI > env > file)
          │        5. Validate (throw if missing)
          v
    ┌───────────┐
    │   Auth     │  Create ContainerClient using configured authMethod
    │  Service   │
    └─────┬─────┘
          │
          v
    ┌─────────────────────────────────────────────────┐
    │  RepoReplicationService.replicateGitHub()        │
    │                                                 │
    │  1. Resolve ref (default branch if omitted)     │
    │  2. Get tarball stream from GitHubClientService  │
    │  3. Pipe: HTTP -> gunzip -> tar-stream extract   │
    │  4. For each entry: pipe to uploadStream()       │
    │  5. Return RepoReplicationResult                 │
    │  6. NO temp files, NO cleanup needed             │
    └─────┬───────────────────────────────────────────┘
          │
          v
    ┌───────────┐
    │  Output    │  Format as CommandResult JSON:
    │  Formatter │  { success: true, data: RepoReplicationResult, metadata: { ... } }
    └─────┬─────┘
          │
          v
    stdout (JSON)
```

### 4.2 Configuration Resolution Flow

```
    ┌──────────────────────────────────────────────────┐
    │                Resolution Order                    │
    │                                                  │
    │  Step 1: CLI Flags                               │
    │    --account-url, --container, --auth-method     │
    │                 │                                │
    │                 v                                │
    │  Step 2: Environment Variables                   │
    │    AZURE_STORAGE_ACCOUNT_URL                     │
    │    AZURE_STORAGE_CONTAINER_NAME                  │
    │    AZURE_FS_AUTH_METHOD                           │
    │                 │                                │
    │                 v                                │
    │  Step 3: Config File (.repo-sync.json)           │
    │    Search: --config path > CWD > HOME            │
    │                 │                                │
    │                 v                                │
    │  Step 4: Validation                              │
    │    Missing required -> throw ConfigError         │
    │    Invalid values  -> throw ConfigError          │
    │    All present     -> return ResolvedConfig      │
    └──────────────────────────────────────────────────┘
```

### 4.3 Authentication Flow

```
    ResolvedConfig.storage.authMethod
          │
          ├── "azure-ad"
          │     └── new DefaultAzureCredential()
          │         Discovers credentials from:
          │         1. Environment vars (AZURE_TENANT_ID, etc.)
          │         2. Managed Identity
          │         3. Azure CLI (az login)
          │         4. Visual Studio Code
          │
          ├── "sas-token"
          │     └── Read AZURE_STORAGE_SAS_TOKEN env var
          │         (throw AuthError if missing)
          │         -> BlobServiceClient(url + sasToken)
          │
          └── "connection-string"
                └── Read AZURE_STORAGE_CONNECTION_STRING env var
                    (throw AuthError if missing)
                    -> BlobServiceClient.fromConnectionString()
```

---

## 5. Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript 5+ | Type safety, IDE support, project requirement |
| Runtime | Node.js 18+ | LTS, required for Azure SDK features and native fetch |
| CLI Framework | Commander.js 12+ | Lightweight, TypeScript-first, mature ecosystem |
| Azure SDK | @azure/storage-blob 12.31+ | Official Microsoft SDK, comprehensive TypeScript types |
| Auth SDK | @azure/identity 4+ | DefaultAzureCredential support for passwordless auth |
| GitHub SDK | @octokit/rest | Official GitHub REST API client |
| Tar Streaming | tar-stream | Low-level streaming tar extraction (entry-by-entry control) |
| Zip Streaming | unzipper | Streaming zip extraction from HTTP response stream |
| YAML Parsing | js-yaml | Sync pair config file support (JSON/YAML) |
| Env loading | dotenv 16+ | Load .env files for local development |
| Module system | CommonJS | Best compatibility with Commander.js and Azure SDK |
| Build tool | tsc (TypeScript compiler) | Simple, no bundler needed for CLI tool |
| Output format | JSON (default) | Agent-consumable, consistent structure |
| Config format | JSON (.repo-sync.json) | Simple, human-editable, no additional parser needed |
| Error handling | Custom error classes | Structured error codes for agent parsing |
| Retry strategy | Configurable (none/exponential/fixed) | User-controlled recovery |
| Logging | Custom logger (request params, no content) | Log everything except file content and credentials |

---

## 6. Key Architectural Decisions

### 6.1 No Fallback/Default Values for Configuration

**Decision**: Every required configuration parameter must be explicitly provided. Missing values throw `ConfigError` with detailed instructions on how to provide the value.

**Rationale**: Per project conventions. Prevents silent misconfiguration where a default value causes the tool to connect to the wrong resource.

**Exception — Optional Global Storage**: The global storage section (`storage.accountUrl`, `storage.containerName`, `storage.authMethod`) is optional for sync-pairs-only deployments. When no storage fields are provided, the application starts in sync-pairs-only mode where single-repo commands (`clone-github`, `clone-devops`) are unavailable but sync pair operations work using per-pair credentials. If any storage field is provided, all required storage fields must be present (partial configuration throws `ConfigError`).

### 6.2 Service Layer Abstraction

**Decision**: All Azure SDK operations are wrapped in service classes, never called directly from command handlers.

**Rationale**:
- Commands stay thin (parse args, call service, format output)
- Service layer is testable independently
- Service layer can be used as a library by other tools
- Retry logic and logging are applied consistently at the service level

### 6.3 Direct Streaming Architecture

**Decision**: Archive content is piped from the source platform directly into Azure Blob Storage with zero intermediate local disk usage. For GitHub, a tarball stream is parsed entry-by-entry using `tar-stream`. For Azure DevOps, a zip stream is parsed using `unzipper`.

**Rationale**: Eliminates the need for temporary directories, avoids the 2x disk space overhead of download-then-extract, and enables processing in memory-constrained containers (Docker, Kubernetes pods, Azure App Service).

### 6.4 Structured JSON Output for Every Command

**Decision**: Every command returns `CommandResult<T>` with `success`, `data`, `error`, and `metadata` fields.

**Rationale**: AI agents need consistent, parseable output. The `success` boolean allows quick pass/fail checking. The `error.code` field allows agents to handle specific error types programmatically.

### 6.5 Three Azure Storage Authentication Methods

**Decision**: Support azure-ad (recommended), sas-token, and connection-string. Selection is explicit via `authMethod` config parameter.

**Rationale**: Different environments need different auth methods. Azure AD for development/production, SAS for temporary access, connection string for quick prototyping. Explicit selection prevents ambiguity.

### 6.6 Lazy Validation for Repo Credentials

**Decision**: The `github` and `devops` configuration sections are not validated at config load time. They are validated lazily by the client services when a repo command is invoked.

**Rationale**: Ensures that users who do not use specific repo commands are unaffected by missing credentials for those platforms.

---

## 7. Security Considerations

1. **No secrets in config files**: Connection strings, SAS tokens, GitHub tokens, and Azure DevOps PATs must come from environment variables, never from `.repo-sync.json`
2. **Azure AD as primary auth**: DefaultAzureCredential provides the strongest security model
3. **Request logging omits content**: Logger records request parameters but never file content or credentials
4. **Config file in .gitignore**: The `.repo-sync.json` file should be gitignored; only `.repo-sync.json.example` is committed
5. **Process exit on error**: Failed operations exit with non-zero codes to prevent agents from continuing with stale state
6. **Path traversal protection**: Archive entries containing `..` are skipped with a warning log

---

## 8. Scalability and Extensibility

### Future Extensions (not in scope for v2.0)

1. **Incremental sync**: Differential updates based on state tracking
2. **Parallel sync pair execution**: Process multiple sync pairs concurrently
3. **Progress streaming**: Server-Sent Events or WebSocket for real-time replication progress
4. **Resume capability**: Checkpoint/resume for failed mid-stream operations
5. **Submodule support**: Resolve and include submodule content
6. **GitHub LFS resolution**: Download actual LFS content instead of pointer files

### Extension Points in Current Design

- **AuthService**: New auth methods can be added by extending the factory pattern
- **Client Services**: New source platforms (GitLab, Bitbucket) can be added as new client services
- **RepoReplicationService**: New replication strategies added as methods
- **Commands**: New command files registered in `commands/index.ts`
- **Output formatters**: Additional output formats (YAML, table) can be added alongside JSON
- **Retry strategies**: New strategies added to the retry utility

---

## 9. REST API Layer

The REST API layer exposes repository replication operations over HTTP using Express 5.x. It is an **additional interface alongside the CLI**, not a replacement. Both entry points share the same service layer.

### 9.1 Dual Entry Point Architecture

```
                              repo-sync
         ┌──────────────────────┬──────────────────────┐
         │                      │                      │
         v                      v                      │
┌──────────────────┐   ┌──────────────────────┐        │
│  CLI Entry Point │   │  API Entry Point      │        │
│  src/index.ts    │   │  src/api/server.ts    │        │
│  (Commander.js)  │   │  (Express 5)          │        │
└────────┬─────────┘   └────────┬─────────────┘        │
         │                      │                      │
┌────────┴─────────┐   ┌───────┴──────────────┐       │
│  CLI Commands     │   │  API Controllers     │       │
│  (parse argv,    │   │  (parse req,         │       │
│   call services, │   │   call services,     │       │
│   format output) │   │   format response)   │       │
└────────┬─────────┘   └───────┬──────────────┘       │
         │                      │                      │
         └──────────┬───────────┘                      │
                    │                                  │
                    v                                  │
┌────────────────────────────────────────────────┐     │
│              Shared Service Layer               │     │
│                                                │     │
│  RepoReplicationService  AuthService           │     │
│  GitHubClientService     ConfigLoader          │     │
│  DevOpsClientService     PathService           │     │
│  SyncPairLoader          RetryUtil / Logger     │     │
└────────────────────┬───────────────────────────┘     │
                     │                                 │
                     v                                 │
┌────────────────────────────────────────────────┐     │
│              Azure SDK Layer                    │     │
│  @azure/storage-blob    @azure/identity        │     │
└────────────────────────────────────────────────┘     │
```

### 9.2 API Module Structure

```
src/api/
  server.ts                    - Express app factory, HTTP server lifecycle, graceful shutdown
  routes/
    index.ts                   - Route registration barrel
    health.routes.ts           - GET /api/health, GET /api/health/ready
    repo.routes.ts             - POST /api/v1/repo/github, /api/v1/repo/devops, /api/v1/repo/sync, GET /api/v1/repo/sync-pairs
    hotkeys.routes.ts          - Remote console hotkey actions (POST/GET /api/dev/hotkeys/*)
    dev.routes.ts              - /api/dev/env development-only routes
  controllers/
    repo.controller.ts         - Repo replication request handlers
    hotkeys.controller.ts      - Remote console hotkey action handlers
    dev.controller.ts          - Development diagnostic endpoint handlers
  middleware/
    error-handler.middleware.ts - Error -> HTTP status code mapping
    request-logger.middleware.ts- Request/response logging (no body content)
    timeout.middleware.ts       - Per-request timeout enforcement
  swagger/
    config.ts                  - swagger-jsdoc OpenAPI 3.0 configuration
    schemas.ts                 - Reusable OpenAPI component schemas
```

### 9.3 API Request Data Flow

```
HTTP Request
    │
    ├── 1. CORS middleware (validate origin)
    ├── 2. JSON body parser
    ├── 3. Request logger (method, URL, timing)
    ├── 4. Timeout middleware (enforce api.requestTimeoutMs)
    ├── 5. Route matching -> Controller
    │       │
    │       ├── Extract params from req.body
    │       ├── Call shared service method (plain TypeScript args, never req/res)
    │       └── Return CommandResult<T> as JSON response
    │
    ├── 6. 404 handler (unmatched routes)
    └── 7. Error handler middleware
            ├── RepoReplicationError -> mapped HTTP status + toJSON()
            ├── ConfigError / AuthError -> sanitized messages
            └── Unknown -> 500 (generic message, details hidden)
```

### 9.4 Service Lifecycle

Services are instantiated **once** at server startup and injected into controllers via closures:

0. `watchAzureVenv()` performs initial sync of remote files and environment variables from Azure Blob Storage (no-op if `AZURE_VENV` is not set), then starts a background polling watcher that detects blob changes and updates in-memory state. This runs **before** any config resolution so that remote `.env` values are available in `process.env`. The watcher stop function is stored in `azure-venv-holder` for graceful shutdown.
1. `loadApiConfig()` resolves and validates configuration (base + API section)
2. `new Logger(config.logging.level)` creates a shared logger
3. `new RepoReplicationService(containerClient, logger)` creates the replication service
4. If `NODE_ENV !== "production"`: `ConsoleCommands` is instantiated with a config inspector
5. `createApp(config, repoService, logger, actualPort, consoleCommands)` builds the Express app with services injected
6. `app.listen(config.api.port, config.api.host)` starts the HTTP server
7. After `server.listen()`: `ConsoleCommands.setup()` is called to start the readline interface
8. On graceful shutdown: `stopWatch()` stops the azure-venv polling watcher, `ConsoleCommands.cleanup()` restores console methods and closes the readline interface

### 9.5 Configuration Extension

The existing config system includes an optional `api` section:

- **Config file**: `.repo-sync.json` has `api: { port, host, corsOrigins, swaggerEnabled, requestTimeoutMs }`
- **Environment variables**: `AZURE_FS_API_PORT`, `AZURE_FS_API_HOST`, `AZURE_FS_API_CORS_ORIGINS`, `AZURE_FS_API_SWAGGER_ENABLED`, `AZURE_FS_API_REQUEST_TIMEOUT_MS`
- **Priority**: CLI Flags > Environment Variables > Config File (unchanged)
- **Validation**: All API parameters are required when running in API mode; missing values throw `ConfigError`. CLI commands ignore the `api` section entirely.

### 9.6 Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| HTTP Framework | Express 5.x | Built-in async error handling eliminates boilerplate |
| API Documentation | swagger-jsdoc + swagger-ui-express | Lowest friction, no architectural changes needed |
| Error Mapping | Centralized middleware | Single location; leverages existing error class `toJSON()` |
| Auth Error Sanitization | Generic messages to API clients | Prevents leaking env var names and config paths |
| Repo Timeout Override | 5 minutes for repo routes, 30 minutes for sync | Long-running operations need extended timeouts |

### 9.7 Console Hotkeys (ConsoleCommands)

The `ConsoleCommands` class (`src/utils/console-commands.utils.ts`) provides interactive keyboard shortcuts for the API server during development and debugging. It is a standalone utility with one external dependency (`chalk@4` for colored output).

**Activation**: Only enabled when `NODE_ENV !== "production"`. Initialized after `server.listen()` in `src/api/server.ts` and cleaned up during graceful shutdown.

**Hotkeys** (type letter + Enter):

| Key | Action |
|-----|--------|
| `c` | Clear console (including scrollback buffer) |
| `f` | Freeze/unfreeze log output (suppresses `console.log/error/warn` when frozen) |
| `v` | Toggle verbose mode (sets `AZURE_FS_LOG_LEVEL` between `debug` and `info` at runtime) |
| `i` | Inspect resolved configuration (sensitive values masked) |
| `h` | Show help listing all hotkeys |
| `Ctrl+C` | Graceful exit |

**API Endpoints** (remote access, mounted at `/api/dev/hotkeys` when `NODE_ENV=development`):

| Endpoint | Method | Action |
|----------|--------|--------|
| `/api/dev/hotkeys/clear` | POST | Clear console output |
| `/api/dev/hotkeys/freeze` | POST | Toggle freeze/unfreeze log output |
| `/api/dev/hotkeys/verbose` | POST | Toggle verbose mode (debug/info) |
| `/api/dev/hotkeys/config` | GET | Inspect resolved configuration (masked) |
| `/api/dev/hotkeys/status` | GET | Get current state (frozen, verbose) |
| `/api/dev/hotkeys/help` | GET | List available hotkeys and descriptions |

All endpoints return structured JSON with `success`, `data`, and `metadata` fields. Defense-in-depth `NODE_ENV` check returns 403 if not in development. Returns 503 if `ConsoleCommands` is not initialized.

---

## 10. Docker Deployment

### 10.1 Container Architecture

The API is containerized using a multi-stage Docker build for minimal image size and security:

```
┌──────────────────────────────────────────────────┐
│              Docker Image (node:20-alpine)         │
│                                                   │
│  User: node (non-root)                            │
│                                                   │
│  /app/                                            │
│    package.json                                   │
│    package-lock.json                              │
│    node_modules/  (production deps only)          │
│    dist/          (compiled JS from builder)      │
│                                                   │
│  EXPOSE 3000                                      │
│  HEALTHCHECK: wget /api/health                    │
│  CMD: node dist/api/server.js                     │
└──────────────────────────────────────────────────┘
```

### 10.2 Multi-Stage Build

| Stage | Base Image | Purpose |
|-------|-----------|---------|
| `builder` | `node:20-alpine` | Install all deps (including devDeps), compile TypeScript |
| `production` | `node:20-alpine` | Install production deps only, copy compiled output |

This separation ensures:
- TypeScript compiler and dev tools are not in the final image
- Final image contains only `dist/`, `node_modules/` (prod), and `package.json`
- Image size is minimized (~150-200 MB vs ~400+ MB with dev deps)

### 10.3 Security

- **Non-root execution**: Container runs as the built-in `node` user
- **No secrets baked in**: All credentials passed via environment variables at runtime
- **Minimal attack surface**: Alpine-based image with only production dependencies
- **Health checks**: Built-in Docker HEALTHCHECK for orchestrator integration

### 10.4 Configuration Strategy

All configuration is passed exclusively via environment variables in Docker:

- Config files (`.repo-sync.json`) are excluded via `.dockerignore`
- `.env` file is loaded by Docker Compose at runtime (not baked into the image)
- The `docker-compose.yml` sets Docker-specific overrides (`NODE_ENV=development`, `AZURE_FS_API_HOST=0.0.0.0`, `AUTO_SELECT_PORT=false`)
- `PUBLIC_URL` can be set when the container is behind a reverse proxy

### 10.5 Docker Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage production image |
| `.dockerignore` | Excludes unnecessary files from build context |
| `docker-compose.yml` | Local dev/testing with health checks and restart policy |
| `.env.docker.example` | Docker-specific env template with production defaults |

### 10.6 Deployment Commands

```bash
# Build image
docker build -t repo-sync-api .

# Run standalone
docker run --env-file .env -p 3000:3000 repo-sync-api

# Docker Compose (recommended)
docker compose up          # foreground
docker compose up -d       # detached
docker compose up --build  # rebuild after code changes
docker compose down        # stop and remove
```

### 10.7 Production Readiness Checklist

- [x] Binds to `0.0.0.0` (configurable via `AZURE_FS_API_HOST`)
- [x] Health check endpoints (`/api/health` and `/api/health/ready`)
- [x] Graceful shutdown on `SIGTERM`/`SIGINT`
- [x] All configuration via environment variables
- [x] No file system dependencies for runtime state
- [x] Container-aware Swagger URL detection (`DOCKER_HOST_URL`, `PUBLIC_URL`)
- [x] Console hotkeys auto-disabled in production (`NODE_ENV=production`)
- [x] Hotkey API endpoints for remote access in Docker/cloud environments (`/api/dev/hotkeys/*`)

---

## 11. Repository Replication (Direct Streaming Design)

### 11.1 Feature Overview

The repository replication feature is the core functionality of `repo-sync`. It clones complete GitHub and Azure DevOps repositories into Azure Blob Storage folders. The design uses a **direct streaming** approach: archive content is piped from the source platform directly into Azure Blob Storage with **zero intermediate local disk usage**. For GitHub, a tarball stream is parsed entry-by-entry using `tar-stream`, with each file entry piped directly to `BlockBlobClient.uploadStream()`. For Azure DevOps, a zip stream is parsed using `unzipper`, with each file entry similarly streamed to blob storage.

This streaming approach eliminates the need for temporary directories, avoids the 2x disk space overhead of download-then-extract, and enables processing in memory-constrained containers (e.g., Docker, Kubernetes pods, Azure App Service).

The feature is exposed through both the CLI (`repo clone-github`, `repo clone-devops`) and the REST API (`POST /api/v1/repo/github`, `POST /api/v1/repo/devops`).

**Prerequisite documents:**
- Plan: `docs/design/plan-007-repo-replication-to-azure-storage.md`
- Investigation: `docs/reference/investigation-repo-replication.md`

### 11.2 Component Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     Entry Points                                          │
│                                                                          │
│  CLI: repo.commands.ts                 API: repo.routes.ts               │
│  ┌─────────────────────────┐          ┌──────────────────────────────┐   │
│  │ repo clone-github       │          │ POST /api/v1/repo/github     │   │
│  │   --repo --dest --ref   │          │ POST /api/v1/repo/devops     │   │
│  │ repo clone-devops       │          │ POST /api/v1/repo/sync       │   │
│  │   --org --project --repo│          │                              │   │
│  │   --dest --ref          │          │ repo.controller.ts           │   │
│  │   --version-type        │          │   cloneGitHub()              │   │
│  │   --resolve-lfs         │          │   cloneDevOps()              │   │
│  │ repo sync               │          │   syncPairs()                │   │
│  │   --sync-config <path>  │          │                              │   │
│  └───────────┬─────────────┘          └──────────────┬───────────────┘   │
│              │                                       │                   │
│              └───────────────┬────────────────────────┘                   │
│                              │                                           │
│                              v                                           │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │              RepoReplicationService                               │    │
│  │              src/services/repo-replication.service.ts              │    │
│  │                                                                  │    │
│  │  replicateGitHub(params: GitHubRepoParams)                       │    │
│  │    1. Validate config (GitHub token for private repos)           │    │
│  │    2. Resolve ref (default branch if omitted)                    │    │
│  │    3. Get tarball stream from GitHubClientService                │    │
│  │    4. Pipe stream -> gunzip -> tar-stream extract                │    │
│  │    5. For each tar entry: pipe to BlockBlobClient.uploadStream() │    │
│  │    6. NO temp files, NO cleanup needed                           │    │
│  │                                                                  │    │
│  │  replicateDevOps(params: DevOpsRepoParams)                       │    │
│  │    1. Validate config (PAT or Azure AD)                          │    │
│  │    2. Get zip stream from DevOpsClientService                    │    │
│  │    3. Pipe stream -> unzipper.Parse()                            │    │
│  │    4. For each zip entry: pipe to BlockBlobClient.uploadStream() │    │
│  │    5. NO temp files, NO cleanup needed                           │    │
│  │                                                                  │    │
│  │  replicateFromSyncConfig(syncConfig: SyncPairConfig)             │    │
│  │    1. Sequential processing of each sync pair                    │    │
│  │    2. Per-pair credential injection and ContainerClient creation  │    │
│  │    3. Fail-open: remaining pairs continue if one fails           │    │
│  └──────┬──────────────────────┬────────────────────────────────────┘    │
│         │                      │                                         │
│         v                      v                                         │
│  ┌──────────────┐  ┌───────────────────┐                                │
│  │ GitHubClient │  │ DevOpsClient      │                                │
│  │ Service      │  │ Service           │                                │
│  │              │  │                   │                                │
│  │ getRepoInfo()│  │ validateAuth()    │                                │
│  │ getArchive  │  │ getArchiveStream()│                                │
│  │   Stream()  │  │                   │                                │
│  │ validateAuth│  │                   │                                │
│  └──────┬───────┘  └──────┬────────────┘                                │
│         │                 │                                              │
│         v                 v                                              │
│  ┌──────────────┐  ┌──────────────────┐                                  │
│  │ @octokit/rest│  │ Native fetch     │                                  │
│  │ (npm pkg)    │  │ (Node 18+)       │                                  │
│  │              │  │                  │                                  │
│  │ GitHub API   │  │ Azure DevOps API │                                  │
│  └──────────────┘  └──────────────────┘                                  │
│                                                                          │
│  Streaming Data Flow (GitHub tarball):                                   │
│  ┌──────────┐    ┌──────────┐    ┌────────────┐    ┌─────────────────┐  │
│  │ GitHub   │───>│ gunzip   │───>│ tar-stream │───>│ BlockBlobClient │  │
│  │ HTTP resp│    │ (zlib)   │    │ .extract() │    │ .uploadStream() │  │
│  │ stream   │    │          │    │ per-entry  │    │ per-file        │  │
│  └──────────┘    └──────────┘    └────────────┘    └─────────────────┘  │
│                                                                          │
│  Streaming Data Flow (Azure DevOps zip):                                 │
│  ┌──────────┐    ┌──────────────┐    ┌─────────────────┐                │
│  │ DevOps   │───>│ unzipper     │───>│ BlockBlobClient │                │
│  │ HTTP resp│    │ .Parse()     │    │ .uploadStream() │                │
│  │ stream   │    │ per-entry    │    │ per-file        │                │
│  └──────────┘    └──────────────┘    └─────────────────┘                │
│                                                                          │
│  Cross-Cutting:                                                          │
│  ┌────────────────┐ ┌──────────────────┐                                 │
│  │ Logger         │ │ Token Expiry     │                                 │
│  │                │ │ Check Utility    │                                 │
│  └────────────────┘ └──────────────────┘                                 │
│                                                                          │
│  Streaming Archive Libraries:                                            │
│  ┌────────────────┐ ┌──────────────┐                                     │
│  │ tar-stream     │ │ unzipper     │                                     │
│  │ (npm pkg)      │ │ (npm pkg)    │                                     │
│  │ GitHub tarball │ │ DevOps zip   │                                     │
│  │ + zlib gunzip  │ │ streaming    │                                     │
│  └────────────────┘ └──────────────┘                                     │
└──────────────────────────────────────────────────────────────────────────┘
```

### 11.3 Dependency Graph

```
src/commands/repo.commands.ts
  ├── src/config/config.loader.ts           (existing)
  ├── src/config/sync-pair.loader.ts         (sync pair config)
  ├── src/services/repo-replication.service.ts
  │     ├── src/services/github-client.service.ts
  │     │     ├── @octokit/rest
  │     │     ├── src/utils/token-expiry.utils.ts
  │     │     ├── src/errors/repo-replication.error.ts
  │     │     └── src/errors/config.error.ts
  │     ├── src/services/devops-client.service.ts
  │     │     ├── @azure/identity
  │     │     ├── src/utils/token-expiry.utils.ts
  │     │     ├── src/errors/repo-replication.error.ts
  │     │     └── src/errors/config.error.ts
  │     ├── src/services/auth.service.ts
  │     ├── src/services/path.service.ts
  │     ├── tar-stream (streaming tar extraction)
  │     ├── zlib (Node.js built-in, gunzip)
  │     └── unzipper (streaming zip extraction)
  ├── src/utils/output.utils.ts
  └── src/utils/logger.utils.ts

src/api/routes/repo.routes.ts
  └── src/api/controllers/repo.controller.ts
        └── src/services/repo-replication.service.ts

src/api/routes/index.ts
  └── imports repo.routes.ts, adds RepoReplicationService to ApiServices

src/api/server.ts
  └── instantiates RepoReplicationService, passes to route registration

src/api/middleware/error-handler.middleware.ts
  └── imports RepoReplicationError for HTTP status mapping
```

### 11.4 New Type Definitions

#### 11.4.1 `src/types/repo-replication.types.ts`

```typescript
/**
 * Type definitions for the repository replication feature.
 * Covers both GitHub and Azure DevOps platforms.
 */

/** Source platform for the repository */
export type RepoPlatform = "github" | "azure-devops";

/** Version type for Azure DevOps (GitHub uses ref directly) */
export type DevOpsVersionType = "branch" | "tag" | "commit";

/** Auth method for Azure DevOps repository access */
export type DevOpsAuthMethod = "pat" | "azure-ad";

// ---------------------------------------------------------------------------
// Input Parameters
// ---------------------------------------------------------------------------

/** Parameters for a GitHub replication request (shared by CLI and API) */
export interface GitHubRepoParams {
  /** Repository in "owner/repo" format */
  repo: string;
  /** Git ref: branch name, tag, or commit SHA. If omitted, default branch is used. */
  ref?: string;
  /** Destination folder path in Azure Blob Storage */
  destPath: string;
}

/** Parameters for an Azure DevOps replication request (shared by CLI and API) */
export interface DevOpsRepoParams {
  /** Azure DevOps organization name */
  organization: string;
  /** Project name */
  project: string;
  /** Repository name or GUID */
  repository: string;
  /** Version identifier (branch name, tag, commit SHA) */
  ref?: string;
  /** How to interpret the ref. Defaults to "branch" if ref is provided. */
  versionType?: DevOpsVersionType;
  /** Destination folder path in Azure Blob Storage */
  destPath: string;
  /** Whether to resolve LFS pointers (Azure DevOps only) */
  resolveLfs?: boolean;
}

// ---------------------------------------------------------------------------
// Result Types
// ---------------------------------------------------------------------------

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
  /** Source repository identifier (e.g., "owner/repo" or "org/project/repo") */
  source: string;
  /** Git ref that was replicated */
  ref: string;
  /** Destination folder path in Azure Blob Storage */
  destPath: string;
  /** Total number of files discovered in the archive stream */
  totalFiles: number;
  /** Number of files successfully uploaded */
  successCount: number;
  /** Number of files that failed to upload */
  failedCount: number;
  /** Total bytes uploaded */
  totalBytes: number;
  /** Duration of the streaming operation (stream + upload combined) in milliseconds */
  streamingDurationMs: number;
  /** Total wall-clock duration in milliseconds (includes metadata fetch, auth, etc.) */
  totalDurationMs: number;
  /** Per-file results (only included if there were failures, to avoid huge payloads) */
  failedFiles?: RepoFileUploadResult[];
}

// ---------------------------------------------------------------------------
// GitHub-Specific Types
// ---------------------------------------------------------------------------

/** Repository metadata returned by the GitHub API */
export interface GitHubRepoInfo {
  /** Default branch name (e.g., "main") */
  defaultBranch: string;
  /** Whether the repository is private */
  isPrivate: boolean;
  /** Full repository name (e.g., "owner/repo") */
  fullName: string;
}

// ---------------------------------------------------------------------------
// Configuration Types (Repo-Specific Sections)
// ---------------------------------------------------------------------------

/** GitHub-specific configuration (from env vars only, never config file) */
export interface GitHubRepoConfig {
  /** GitHub Personal Access Token */
  token?: string;
  /** Token expiry date in ISO 8601 format */
  tokenExpiry?: string;
}

/** Azure DevOps-specific configuration (from env vars + optional config file) */
export interface DevOpsRepoConfig {
  /** Personal Access Token */
  pat?: string;
  /** PAT expiry date in ISO 8601 format */
  patExpiry?: string;
  /** Authentication method: "pat" or "azure-ad" */
  authMethod?: DevOpsAuthMethod;
  /** Default organization URL (e.g., "https://dev.azure.com/myorg") */
  orgUrl?: string;
}
```

#### 11.4.2 Extension to `src/types/config.types.ts`

The config file interface includes optional `github` and `devops` sections:

```typescript
export interface RepoSyncConfigFile {
  storage?: { /* accountUrl, containerName, authMethod */ };
  logging?: { /* level, logRequests */ };
  retry?: { /* strategy, maxRetries, initialDelayMs, maxDelayMs */ };
  api?: { /* port, host, corsOrigins, swaggerEnabled, requestTimeoutMs */ };
  github?: {
    tokenExpiry?: string;
  };
  devops?: {
    authMethod?: string;  // "pat" | "azure-ad"
    orgUrl?: string;
    patExpiry?: string;
  };
}
```

Note: `github.token` and `devops.pat` are **never** stored in the config file per the project's security policy. They come exclusively from environment variables `GITHUB_TOKEN` and `AZURE_DEVOPS_PAT`.

The `ResolvedConfig` interface includes optional repo config sections:

```typescript
export interface ResolvedConfig {
  storage: { /* resolved storage config */ };
  logging: { /* resolved logging config */ };
  retry: { /* resolved retry config */ };
  api?: { /* resolved API config */ };
  github?: {
    token?: string;
    tokenExpiry?: string;
  };
  devops?: {
    pat?: string;
    patExpiry?: string;
    authMethod?: DevOpsAuthMethod;
    orgUrl?: string;
  };
}
```

#### 11.4.3 Extension to `src/types/errors.types.ts`

```typescript
/** Repository replication error codes */
export enum RepoErrorCode {
  REPO_NOT_FOUND = "REPO_NOT_FOUND",
  REPO_AUTH_MISSING = "REPO_AUTH_MISSING",
  REPO_ARCHIVE_DOWNLOAD_FAILED = "REPO_ARCHIVE_DOWNLOAD_FAILED",
  REPO_EXTRACTION_FAILED = "REPO_EXTRACTION_FAILED",
  REPO_UPLOAD_FAILED = "REPO_UPLOAD_FAILED",
  REPO_RATE_LIMITED = "REPO_RATE_LIMITED",
  REPO_PATH_TRAVERSAL = "REPO_PATH_TRAVERSAL",
  REPO_MISSING_PARAMS = "REPO_MISSING_PARAMS",
  REPO_SYNC_CONFIG_INVALID = "REPO_SYNC_CONFIG_INVALID",
  REPO_SYNC_CONFIG_LOAD_FAILED = "REPO_SYNC_CONFIG_LOAD_FAILED",
}
```

### 11.5 Error Hierarchy

#### 11.5.1 `src/errors/repo-replication.error.ts`

```typescript
import { AzureFsError } from "./base.error";

/**
 * Error thrown during repository replication operations.
 * Covers archive download failures, extraction errors, auth issues,
 * and repository-not-found scenarios.
 */
export class RepoReplicationError extends AzureFsError {
  constructor(
    code: string,
    message: string,
    statusCode?: number,
    details?: unknown,
  ) {
    super(code, message, statusCode, details);
    this.name = "RepoReplicationError";
  }

  static notFound(platform: string, repoIdentifier: string): RepoReplicationError { /* ... */ }
  static authMissing(platform: string, envVarName: string, reason: string): RepoReplicationError { /* ... */ }
  static downloadFailed(platform: string, repoIdentifier: string, reason: string): RepoReplicationError { /* ... */ }
  static extractionFailed(platform: string, repoIdentifier: string, reason: string): RepoReplicationError { /* ... */ }
  static rateLimited(platform: string, retryAfterSeconds?: number): RepoReplicationError { /* ... */ }
  static missingParams(missingFields: string[]): RepoReplicationError { /* ... */ }
  static syncConfigInvalid(reason: string): RepoReplicationError { /* ... */ }
  static syncConfigLoadFailed(filePath: string, reason: string): RepoReplicationError { /* ... */ }
}
```

#### 11.5.2 Error-to-HTTP Status Mapping

| Error Code | HTTP Status | Condition |
|---|---|---|
| `REPO_NOT_FOUND` | 404 | Repository does not exist or is inaccessible |
| `REPO_AUTH_MISSING` | 401 | Token/PAT not configured but required |
| `REPO_ARCHIVE_DOWNLOAD_FAILED` | 502 | Network/HTTP error downloading archive |
| `REPO_EXTRACTION_FAILED` | 500 | Archive extraction failure |
| `REPO_UPLOAD_FAILED` | 500 | Batch upload failure (partial or total) |
| `REPO_RATE_LIMITED` | 429 | GitHub 403/rate-limit or Azure DevOps 429 |
| `REPO_MISSING_PARAMS` | 400 | Missing required fields in API request body |
| `REPO_SYNC_CONFIG_INVALID` | 400 | Invalid sync pair configuration structure |
| `REPO_SYNC_CONFIG_LOAD_FAILED` | 500 | Failed to load sync config file |
| `CONFIG_MISSING_REQUIRED` | 500 | Missing `AZURE_DEVOPS_AUTH_METHOD` or similar |

`RepoReplicationError` messages are **not sanitized** in the error handler (unlike `ConfigError` and `AuthError`), because they contain user-actionable information about repository access and parameters.

### 11.6 Service Design

#### 11.6.1 Token Expiry Utility: `src/utils/token-expiry.utils.ts`

A shared utility for checking token/PAT expiry dates:

```typescript
import { ConfigError } from "../errors/config.error";
import { Logger } from "./logger.utils";

const EXPIRY_WARNING_DAYS = 7;

export function checkTokenExpiry(
  expiryDateStr: string,
  tokenName: string,
  logger: Logger,
): void {
  // 1. Parse ISO 8601 date, throw ConfigError if unparseable
  // 2. If expired: throw ConfigError
  // 3. If within 7 days of expiry: log warning
  // 4. If more than 7 days away: no action
}
```

#### 11.6.2 `GitHubClientService`: `src/services/github-client.service.ts`

- Creates an `Octokit` instance in the constructor, optionally authenticated
- Token expiry is checked at construction time (warn/throw)
- `getArchiveStream()` returns a Node.js `ReadableStream` (not downloaded to disk)
- Uses `parseSuccessResponseBody: false` to avoid Octokit buffering the entire archive
- All GitHub API errors are translated to typed `RepoReplicationError`
- Reads `GITHUB_TOKEN` and `GITHUB_TOKEN_EXPIRY` directly from `process.env`
- Supports union constructor for sync pair credentials injection

#### 11.6.3 `DevOpsClientService`: `src/services/devops-client.service.ts`

- Two auth methods: PAT (Base64 Basic header) and Azure AD (Bearer token via `DefaultAzureCredential`)
- Uses native `fetch` (Node 18+), avoiding heavy Azure DevOps SDK dependency
- `getArchiveStream()` returns a Node.js `ReadableStream` via `Readable.fromWeb()`
- `zipForUnix=true` is always set for Unix permission preservation
- Config validation is performed in the constructor (fail-fast)
- Supports union constructor for sync pair credentials injection

#### 11.6.4 `RepoReplicationService`: `src/services/repo-replication.service.ts`

**Key Design Decisions:**
- **Zero local disk usage**: No temp directories, no temp files, no `os.tmpdir()`
- Platform-specific client services are instantiated inside the `replicate*` methods (lazy validation)
- **Sequential entry processing**: Both tar and zip streaming formats require sequential processing
- **Small file optimization**: Files under 4 MB are buffered and uploaded via `blockBlobClient.upload()`. Files 4 MB and larger are streamed via `blockBlobClient.uploadStream()`
- **Path traversal protection**: Archive entries containing `..` are skipped with a warning log
- Individual file upload failures do not abort the entire operation
- The `containerClient` is used directly for streaming upload via `BlockBlobClient` instances created on-the-fly

**Orchestration Flow (`replicateGitHub`):**

```
1. Parse "owner/repo" from params.repo
2. Resolve ref (default branch if omitted via getRepoInfo())
3. Get tarball stream from GitHubClientService
4. Pipeline: archiveStream -> gunzip -> tar-stream extract
5. For each tar entry: strip first component, validate path, upload to blob
6. Return RepoReplicationResult
7. NO cleanup needed
```

**Orchestration Flow (`replicateDevOps`):**

```
1. Get zip stream from DevOpsClientService
2. Pipeline: archiveStream -> unzipper.Parse()
3. For each zip entry: validate path, upload to blob
4. Return RepoReplicationResult
5. NO cleanup needed
```

### 11.7 Configuration

#### 11.7.1 Environment Variables

| Variable | Required When | Type | Purpose |
|---|---|---|---|
| `GITHUB_TOKEN` | Private repo access via `repo clone-github` | string | GitHub Personal Access Token (PAT) |
| `GITHUB_TOKEN_EXPIRY` | Optional (recommended) | ISO 8601 | Token expiry date for proactive warning |
| `AZURE_DEVOPS_PAT` | `AZURE_DEVOPS_AUTH_METHOD=pat` | string | Azure DevOps Personal Access Token |
| `AZURE_DEVOPS_PAT_EXPIRY` | Optional (recommended) | ISO 8601 | PAT expiry date for proactive warning |
| `AZURE_DEVOPS_AUTH_METHOD` | `repo clone-devops` is invoked | `pat` or `azure-ad` | DevOps authentication method selection |
| `AZURE_DEVOPS_ORG_URL` | Optional (can use `--org` flag) | URL | Default Azure DevOps organization URL |

#### 11.7.2 Configuration Loading

Changes to `src/config/config.loader.ts`:

1. `loadEnvConfig()` loads `github` and `devops` sections from environment variables
2. `buildMergedConfig()` includes `github` and `devops` in the merge logic
3. The `github` and `devops` sections are **not validated at config load time** -- validated lazily by client services

#### 11.7.3 Config File

The `.repo-sync.json` config file can optionally include `github` and `devops` sections for non-secret values:

```json
{
  "storage": { "..." : "..." },
  "github": {
    "tokenExpiry": "2026-12-31T00:00:00Z"
  },
  "devops": {
    "authMethod": "pat",
    "orgUrl": "https://dev.azure.com/myorg",
    "patExpiry": "2026-06-30T00:00:00Z"
  }
}
```

**Security rule**: `github.token` and `devops.pat` are never read from config files. Tokens/PATs must come from environment variables exclusively.

#### 11.7.4 Token Expiry Warning Logic

Both `GITHUB_TOKEN_EXPIRY` and `AZURE_DEVOPS_PAT_EXPIRY` follow this logic (implemented in `token-expiry.utils.ts`):

1. Parse the ISO 8601 date string
2. If unparseable: throw `ConfigError` with `CONFIG_INVALID_VALUE`
3. If expired (date < now): throw `ConfigError` with message `"{TOKEN_NAME} has expired"`
4. If within 7 days of expiry: log a warning `"{TOKEN_NAME} expires in N day(s)"`
5. If more than 7 days away: no action

### 11.8 CLI Command Design

#### 11.8.1 `src/commands/repo.commands.ts`

```bash
# GitHub replication
repo-sync repo clone-github \
  --repo owner/repo \
  --dest repos/my-project \
  [--ref main] \
  [--json] [--verbose]

# Azure DevOps replication
repo-sync repo clone-devops \
  --org myorg \
  --project myproject \
  --repo myrepo \
  --dest repos/my-devops-project \
  [--ref main] \
  [--version-type branch|tag|commit] \
  [--resolve-lfs] \
  [--json] [--verbose]

# Sync pair batch replication
repo-sync repo sync \
  --sync-config ./sync-pairs.yaml \
  [--json] [--verbose]

# List configured sync pairs
repo-sync repo list-sync-pairs \
  --sync-config ./sync-pairs.yaml \
  [--json] [--verbose]
```

**Exit Code Mapping:**

| Scenario | Exit Code |
|---|---|
| Success | 0 |
| Repo not found, download/extraction/upload error | 1 |
| Config/auth error (missing token, expired token) | 2 |
| Validation error (missing required CLI option) | 3 |

### 11.9 API Endpoint Design

#### 11.9.1 Routes and Controllers

| Endpoint | Method | Timeout | Description |
|---|---|---|---|
| `POST /api/v1/repo/github` | POST | 5 min | Replicate a GitHub repository |
| `POST /api/v1/repo/devops` | POST | 5 min | Replicate an Azure DevOps repository |
| `POST /api/v1/repo/sync` | POST | 30 min | Execute sync pair batch replication |
| `GET /api/v1/repo/sync-pairs` | GET | 5 min | List configured sync pairs with token status |

#### 11.9.2 Timeout Handling

Repository replication is a long-running operation. The `overrideTimeout` middleware replaces the global timeout with route-specific timeouts:
- 5 minutes (300,000ms) for single-repo endpoints
- 30 minutes (1,800,000ms) for sync pair batch endpoint

#### 11.9.3 Swagger Schema

```yaml
components:
  schemas:
    RepoReplicationResponse:
      type: object
      properties:
        success:
          type: boolean
        data:
          type: object
          properties:
            platform:
              type: string
              enum: [github, azure-devops]
            source:
              type: string
            ref:
              type: string
            destPath:
              type: string
            totalFiles:
              type: integer
            successCount:
              type: integer
            failedCount:
              type: integer
            totalBytes:
              type: integer
            streamingDurationMs:
              type: integer
            totalDurationMs:
              type: integer
            failedFiles:
              type: array
              items:
                type: object
                properties:
                  repoPath:
                    type: string
                  blobPath:
                    type: string
                  size:
                    type: integer
                  success:
                    type: boolean
                  error:
                    type: string
        metadata:
          type: object
          properties:
            command:
              type: string
            timestamp:
              type: string
            durationMs:
              type: integer
```

### 11.10 npm Dependencies

| Package | Type | Purpose |
|---|---|---|
| `@octokit/rest` | production | GitHub REST API client |
| `tar-stream` | production | Low-level streaming tar extraction (entry-by-entry) |
| `@types/tar-stream` | dev | TypeScript types for `tar-stream` |
| `unzipper` | production | Streaming zip extraction from HTTP response stream |
| `js-yaml` | production | YAML parsing for sync pair config files |
| `@types/js-yaml` | dev | TypeScript types for `js-yaml` |

---

## 12. Sync Pair Configuration and Batch Replication

### 12.1 Overview

The sync pair feature extends the repository replication module to support configuration-driven batch replication. A sync pair configuration file (JSON or YAML) defines multiple repository-to-Azure-Storage mapping pairs. Each pair is self-contained with its own source credentials and storage destination.

**Key design decisions:**
- `folder` is REQUIRED in each destination (no default/fallback -- consistent with project no-fallback rule)
- Pairs are processed sequentially (predictable resource usage and error reporting)
- Failure mode is fail-open (remaining pairs continue if one fails)
- DevOps sync pairs use PAT authentication only (no azure-ad, which is a machine-level credential)
- Sync pair config is a separate file, not part of `.repo-sync.json`

### 12.2 Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│ CLI: repo-sync repo sync --sync-config <path>                               │
│ API: POST /api/v1/repo/sync { syncPairs: [...] }                      │
└──────────────────────────┬────────────────────────────────────────────┘
                           │
                           v
┌───────────────────────────────────────────────────────────────────────┐
│ sync-pair.loader.ts                                                    │
│                                                                       │
│  loadSyncPairConfig(filePath)     -- read file, detect format         │
│  validateSyncPairConfig(raw)      -- validate structure + fields      │
│  checkSyncPairTokenExpiry(config) -- check all token expiries         │
└──────────────────────────┬────────────────────────────────────────────┘
                           │
                           v
┌───────────────────────────────────────────────────────────────────────┐
│ RepoReplicationService.replicateFromSyncConfig(syncConfig)             │
│                                                                       │
│  for each pair (sequential):                                          │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ executeSyncPair(pair)                                            │  │
│  │   │                                                              │  │
│  │   ├── createSyncPairContainerClient(accountUrl, container, sas) │  │
│  │   │                                                              │  │
│  │   ├── [github]  new GitHubClientService(credentials, logger)     │  │
│  │   │             streamTarToBlob(stream, folder, id, client)      │  │
│  │   │                                                              │  │
│  │   ├── [devops]  new DevOpsClientService(credentials, logger)     │  │
│  │   │             streamZipToBlob(stream, folder, id, client)      │  │
│  │   │                                                              │  │
│  │   └── SyncPairItemResult { name, success, result/error }         │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  SyncPairBatchResult { totalPairs, succeeded, failed, results }       │
└───────────────────────────────────────────────────────────────────────┘
```

### 12.3 Key Patterns

**Per-pair credential injection:** Client services (`GitHubClientService`, `DevOpsClientService`) accept either a `ResolvedConfig` (existing behavior) or a direct credentials object. Discrimination is via `'storage' in configOrCredentials`.

**Per-pair ContainerClient:** `createSyncPairContainerClient(accountUrl, container, sasToken)` creates a SAS-authenticated `ContainerClient` per sync pair, bypassing the global config.

**Parameterized streaming methods:** `streamTarToBlob()` and `streamZipToBlob()` accept an optional `containerClient` parameter. When omitted, they use `this.containerClient` (backward compatible). When provided, they use the per-pair client.

**Fail-open execution:** Each pair is wrapped in try/catch. Errors are captured in `SyncPairItemResult` and processing continues with the next pair.

### 12.4 API Response Codes

| HTTP Status | Condition |
|-------------|-----------|
| 200 | All pairs succeeded |
| 207 (Multi-Status) | Some pairs succeeded, some failed |
| 400 | Invalid sync pair configuration |
| 500 | All pairs failed |

---

## 13. Project Structure

```
src/
  index.ts                          - CLI entry point
  api/
    server.ts                       - Express app factory and HTTP server startup
    swagger/
      config.ts                     - OpenAPI 3.0 spec generation (swagger-jsdoc)
      schemas.ts                    - Reusable OpenAPI component schemas
    routes/
      index.ts                      - Route registration barrel
      health.routes.ts              - GET /api/health, GET /api/health/ready
      repo.routes.ts                - /api/v1/repo/github, /api/v1/repo/devops, /api/v1/repo/sync
      dev.routes.ts                 - /api/dev/env development-only routes
      hotkeys.routes.ts             - /api/dev/hotkeys remote console hotkey routes
    controllers/
      repo.controller.ts            - Repo replication request handlers
      dev.controller.ts             - Development diagnostic endpoint handlers
      hotkeys.controller.ts         - Remote console hotkey action handlers
    middleware/
      error-handler.middleware.ts    - Global error handling middleware
      request-logger.middleware.ts   - HTTP request logging
      timeout.middleware.ts          - Request timeout enforcement
  commands/
    index.ts                        - Command registration barrel
    config.commands.ts              - config init | show | validate
    repo.commands.ts                - repo clone-github | clone-devops | sync | list-sync-pairs
  services/
    auth.service.ts                 - Authentication factory (3 methods + sync pair client)
    path.service.ts                 - Path normalization and validation
    github-client.service.ts        - GitHub API client (archive stream download)
    devops-client.service.ts        - Azure DevOps API client (archive stream download)
    repo-replication.service.ts     - Streaming archive-to-blob orchestration (single repo + sync pairs)
  config/
    config.loader.ts                - Layered config loading (CLI > env > file)
    config.schema.ts                - Config validation (no fallbacks)
    sync-pair.loader.ts             - Sync pair config loader (JSON/YAML via js-yaml)
  types/
    index.ts                        - Barrel export
    config.types.ts                 - RepoSyncConfigFile, AuthMethod, ResolvedConfig, ConfigSourceTracker
    api-config.types.ts             - ApiConfig, ApiResolvedConfig, NodeEnvironment
    command-result.types.ts         - CommandResult<T>
    errors.types.ts                 - Error code enums
    repo-replication.types.ts       - RepoReplicationResult, GitHubRepoParams, DevOpsRepoParams, SyncPair*, SyncPairConfig, SyncPairBatchResult
  errors/
    base.error.ts                   - AzureFsError base class
    config.error.ts                 - ConfigError
    auth.error.ts                   - AuthError
    repo-replication.error.ts       - RepoReplicationError
  utils/
    output.utils.ts                 - JSON/human-readable output formatting
    exit-codes.utils.ts             - Process exit code constants and resolver
    logger.utils.ts                 - Logger with verbose mode
    retry.utils.ts                  - Retry logic
    token-expiry.utils.ts           - Token expiry checking utility
    port-checker.utils.ts           - TCP port availability check and process identification
    console-commands.utils.ts       - Interactive console hotkeys for development/debugging
```

---

## 14. Known Limitations

1. **No submodule support**: Neither GitHub tarballs nor Azure DevOps zips include submodule content.
2. **No Git LFS for GitHub**: GitHub tarballs contain only LFS pointer files. Azure DevOps supports LFS resolution via `resolveLfs=true`.
3. **No incremental sync**: Each replication is a full copy. There is no state tracking for differential updates.
4. **Sequential entry processing**: Because tar and zip are sequential streaming formats, files are uploaded one at a time within a single archive.
5. **No git history**: Only the working tree at the specified ref is replicated. The `.git` directory and commit history are not included.
6. **No progress streaming**: The API returns a single response after the entire operation completes. There is no Server-Sent Events or WebSocket progress stream.
7. **Zip streaming correctness**: The `unzipper` library parses zip files sequentially using Local File Headers rather than the authoritative Central Directory. For Azure DevOps-generated zips this is reliable, but corrupted or malicious zips may produce incorrect results.
8. **Memory usage for small files**: Files under 4 MB are buffered entirely in memory before upload. Peak memory usage is bounded by the 4 MB buffer + upload overhead per file (processed sequentially).
9. **No resume capability**: If the streaming operation fails mid-way, already-uploaded files remain in blob storage but the operation must be restarted from the beginning.
10. **Sequential sync pair processing only**: Pairs are processed one at a time. Parallel processing may be added in a future version.
11. **PAT-only for DevOps sync pairs**: azure-ad is not supported in sync pairs because it uses machine-level `DefaultAzureCredential`.
12. **SAS token auth only for sync pair destinations**: Connection string and Azure AD are not supported for sync pair destinations.
13. **30-minute API timeout for sync**: Long-running sync operations may still exceed this for very large batches.
