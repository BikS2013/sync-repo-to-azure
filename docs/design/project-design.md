# Azure Blob Storage File System CLI Tool - Project Design

**Project Name**: azure-fs
**Date**: 2026-02-22
**Version**: 1.0.0

---

## 1. Overview

`azure-fs` is a TypeScript CLI tool that presents Azure Blob Storage as a virtual file system. It is designed to be consumed by AI agents (specifically Claude Code) and human developers alike. The tool supports full CRUD operations on files and folders, three file-editing strategies, metadata management, and blob index tag querying -- all with structured JSON output.

### 1.1 Goals

- Provide a file-system-like interface over Azure Blob Storage flat namespace
- Support multiple authentication methods (Azure AD, SAS Token, Connection String)
- Output structured JSON for reliable agent parsing
- Enforce strict configuration with no silent fallbacks
- Be modular, testable, and extensible

### 1.2 Non-Goals

- Page blobs and append blobs (block blobs only)
- Azure Data Lake Storage Gen2 ACLs or POSIX permissions
- Blob versioning and soft-delete management
- Multi-cloud abstraction
- GUI or web interface

---

## 2. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        CLI Layer (Commander.js)                   │
│                                                                  │
│  azure-fs <command> [args] [--json] [--verbose] [--config path]  │
│                                                                  │
│  Commands: config | ls | mkdir | rmdir | exists | upload |       │
│            download | delete | replace | info | edit | patch |   │
│            append | meta | tags                                  │
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
│  │              BlobFileSystemService                         │   │
│  │                                                           │   │
│  │  File Ops:    uploadFile, downloadFile, deleteFile,       │   │
│  │               replaceFile, fileExists, getFileInfo        │   │
│  │                                                           │   │
│  │  Folder Ops:  createFolder, listFolder, deleteFolder,     │   │
│  │               folderExists                                │   │
│  │                                                           │   │
│  │  Edit Ops:    editFile, patchFile, appendToFile           │   │
│  │                                                           │   │
│  │  Metadata:    set/get/update/deleteMetadata               │   │
│  │               set/get Tags, queryByTags                   │   │
│  └─────────────────────────┬─────────────────────────────────┘   │
│                            │                                     │
│  ┌─────────────────────────┼─────────────────────────────────┐   │
│  │  Cross-Cutting Concerns │                                 │   │
│  │                         │                                 │   │
│  │  RetryUtil    Logger    OutputFormatter    Validators      │   │
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
│  BlobClient                                                      │
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
        ├── src/services/auth.service.ts
        │     ├── src/types/config.types.ts
        │     └── src/errors/auth.error.ts
        ├── src/services/blob-filesystem.service.ts
        │     ├── src/services/auth.service.ts
        │     ├── src/services/path.service.ts
        │     │     └── src/errors/path.error.ts
        │     ├── src/utils/stream.utils.ts
        │     ├── src/utils/content-type.utils.ts
        │     ├── src/utils/retry.utils.ts
        │     └── src/errors/blob-not-found.error.ts
        ├── src/services/metadata.service.ts
        │     ├── src/services/auth.service.ts
        │     ├── src/services/path.service.ts
        │     ├── src/utils/validation.utils.ts
        │     │     └── src/errors/metadata.error.ts
        │     ├── src/utils/retry.utils.ts
        │     └── src/errors/blob-not-found.error.ts
        │     ├── src/utils/retry.utils.ts
        │     ├── src/utils/logger.utils.ts
        │     ├── src/utils/validation.utils.ts
        │     ├── src/types/filesystem.types.ts
        │     ├── src/types/patch.types.ts
        │     └── src/errors/blob-not-found.error.ts
        └── src/utils/output.utils.ts
              └── src/types/command-result.types.ts
```

### 3.2 Module Responsibilities

| Module | Responsibility | Key Exports |
|--------|---------------|-------------|
| `config.loader` | Load config from CLI flags, env vars, config file; merge; validate | `loadConfig()`, `resolveConfig()` |
| `config.schema` | Config interfaces and Zod-like validation schemas | `AzureFsConfigFile`, `ResolvedConfig` |
| `auth.service` | Create Azure SDK clients for each auth method | `createBlobServiceClient()`, `createContainerClient()`, `validateConnection()` |
| `blob-filesystem.service` | All file system operations against Azure Blob Storage | `BlobFileSystemService` class |
| `path.service` | Path normalization, validation, folder/file distinction | `normalizePath()`, `normalizeFolderPath()`, `validateBlobPath()` |
| `metadata.service` | Metadata and tag operations with validation | `MetadataService` class |
| `output.utils` | Format CommandResult as JSON or human-readable text | `formatOutput()` |
| `retry.utils` | Configurable retry wrapper (none/exponential/fixed) | `withRetry()` |
| `logger.utils` | Request logging (parameters only, no file content) | `Logger` class |
| `stream.utils` | Convert Node.js streams to strings/buffers | `streamToString()`, `streamToBuffer()` |
| `content-type.utils` | Map file extensions to MIME types | `detectContentType()` |
| `validation.utils` | Validate metadata keys, sizes, blob names, tag counts | `validateMetadataKey()`, `estimateMetadataSize()`, `validateBlobName()` |
| `concurrency.utils` | Promise-based parallel execution limiter (no deps) | `parallelLimit()` |
| `console-commands.utils` | Interactive console hotkeys for API server development/debugging | `ConsoleCommands` class |

---

## 4. Data Flow Diagrams

### 4.1 Command Execution Flow

```
User/Agent invokes: azure-fs upload ./local.txt docs/readme.txt --json

    ┌───────────┐
    │ Commander  │  Parse args: command=upload, local=./local.txt,
    │  Parser    │  remote=docs/readme.txt, json=true
    └─────┬─────┘
          │
          v
    ┌───────────┐
    │  Config    │  1. Load CLI flags (--account-url, --container, etc.)
    │  Loader    │  2. Load env vars (AZURE_STORAGE_*)
    └─────┬─────┘  3. Load .azure-fs.json
          │        4. Merge (CLI > env > file)
          │        5. Validate (throw if missing)
          v
    ┌───────────┐
    │   Auth     │  Create BlobServiceClient using configured authMethod
    │  Service   │  -> ContainerClient for the configured container
    └─────┬─────┘
          │
          v
    ┌───────────┐
    │  Path      │  Normalize: "docs/readme.txt"
    │  Service   │  (strip leading slash, collapse //, resolve ..)
    └─────┬─────┘
          │
          v
    ┌───────────┐
    │  BlobFS    │  1. Detect content type from extension (.txt -> text/plain)
    │  Service   │  2. Read local file (stream if > 100MB)
    └─────┬─────┘  3. Upload to Azure (with retry)
          │        4. Return UploadResult { path, size, etag, contentType }
          v
    ┌───────────┐
    │  Output    │  Format as CommandResult JSON:
    │  Formatter │  { success: true, data: UploadResult, metadata: { ... } }
    └─────┬─────┘
          │
          v
    stdout (JSON)
```

### 4.2 Edit (Patch) Flow

```
azure-fs patch docs/readme.txt --find "old" --replace "new" --json

    ┌───────────┐
    │  Config +  │  (same as above)
    │  Auth      │
    └─────┬─────┘
          │
          v
    ┌───────────────────────────────────────────┐
    │  BlobFileSystemService.patchFile()         │
    │                                           │
    │  1. Download blob content as string       │
    │     (store ETag from response)            │
    │                                           │
    │  2. Apply PatchInstruction:               │
    │     content.replaceAll("old", "new")      │
    │     -> count matches                      │
    │                                           │
    │  3. Upload modified content               │
    │     conditions: { ifMatch: storedETag }   │
    │     (fails with 412 if modified           │
    │      by another process)                  │
    │                                           │
    │  4. Return PatchResult with details       │
    └─────┬─────────────────────────────────────┘
          │
          v
    { success: true, data: { patchesApplied: 1, matchesFound: 3, ... } }
```

### 4.3 Configuration Resolution Flow

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
    │  Step 3: Config File (.azure-fs.json)            │
    │    Search: --config path > CWD > HOME            │
    │                 │                                │
    │                 v                                │
    │  Step 4: Validation                              │
    │    Missing required -> throw ConfigError         │
    │    Invalid values  -> throw ConfigError          │
    │    All present     -> return ResolvedConfig      │
    └──────────────────────────────────────────────────┘
```

### 4.4 Authentication Flow

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
| Runtime | Node.js 18+ | LTS, required for Azure SDK features (uploadFile, downloadToFile) |
| CLI Framework | Commander.js 12+ | Lightweight, TypeScript-first, mature ecosystem (research recommendation) |
| Azure SDK | @azure/storage-blob 12.31+ | Official Microsoft SDK, comprehensive TypeScript types |
| Auth SDK | @azure/identity 4+ | DefaultAzureCredential support for passwordless auth |
| Env loading | dotenv 16+ | Load .env files for local development |
| Module system | CommonJS | Best compatibility with Commander.js and Azure SDK |
| Build tool | tsc (TypeScript compiler) | Simple, no bundler needed for CLI tool |
| Blob type | Block blobs only | Most common, sufficient for file system use case |
| Folder strategy | Zero-byte marker blobs | Explicit folders, metadata support, ADLS Gen2 compatible (research recommendation) |
| Output format | JSON (default) | Agent-consumable, consistent structure |
| Config format | JSON (.azure-fs.json) | Simple, human-editable, no additional parser needed |
| Error handling | Custom error classes | Structured error codes for agent parsing |
| Retry strategy | Configurable (none/exponential/fixed) | User-controlled recovery per research clarifications |
| Logging | Custom logger (request params, no content) | Per research clarification: log everything except file content |

---

## 6. Key Architectural Decisions

### 6.1 No Fallback/Default Values for Configuration

**Decision**: Every required configuration parameter must be explicitly provided. Missing values throw `ConfigError` with detailed instructions on how to provide the value.

**Rationale**: Per project conventions. Prevents silent misconfiguration where a default value causes the tool to connect to the wrong resource.

### 6.2 Service Layer Abstraction

**Decision**: All Azure SDK operations are wrapped in `BlobFileSystemService`, never called directly from command handlers.

**Rationale**:
- Commands stay thin (parse args, call service, format output)
- Service layer is testable independently
- Service layer can be used as a library by other tools
- Retry logic and logging are applied consistently at the service level

### 6.3 ETag-Based Concurrency Control for Edit Operations

**Decision**: All edit operations (edit, patch, append) use ETag-based conditional writes to prevent data loss from concurrent modifications.

**Rationale**: Per research findings, blobs are immutable. The read-modify-write pattern is inherently vulnerable to race conditions. ETag checks (HTTP `If-Match` header) detect when the blob has been modified between read and write.

### 6.4 Structured JSON Output for Every Command

**Decision**: Every command returns `CommandResult<T>` with `success`, `data`, `error`, and `metadata` fields.

**Rationale**: AI agents need consistent, parseable output. The `success` boolean allows quick pass/fail checking. The `error.code` field allows agents to handle specific error types programmatically.

### 6.5 Three Authentication Methods

**Decision**: Support azure-ad (recommended), sas-token, and connection-string. Selection is explicit via `authMethod` config parameter.

**Rationale**: Different environments need different auth methods. Azure AD for development/production, SAS for temporary access, connection string for quick prototyping. Explicit selection prevents ambiguity (per research recommendation against implicit fallback chains).

---

## 7. Security Considerations

1. **No secrets in config files**: Connection strings and SAS tokens must come from environment variables, never from `.azure-fs.json`
2. **Azure AD as primary auth**: DefaultAzureCredential provides the strongest security model
3. **Request logging omits content**: Logger records request parameters but never file content or credentials
4. **Config file in .gitignore**: The `.azure-fs.json` file should be gitignored; only `.azure-fs.json.example` is committed
5. **Process exit on error**: Failed operations exit with non-zero codes to prevent agents from continuing with stale state

---

## 8. Scalability and Extensibility

### Future Extensions (not in scope for v1.0)

1. **Batch operations**: Upload/download multiple files in parallel
2. **Container management**: Create/delete containers
3. **Recursive upload/download**: Mirror local directory to/from blob storage
4. **Watch mode**: Monitor local directory and sync changes
5. **Plugin system**: Allow custom commands via plugins
6. **Multiple container support**: Operations across containers in one command

### Extension Points in Current Design

- **AuthService**: New auth methods can be added by extending the factory pattern
- **BlobFileSystemService**: New operations added as methods
- **Commands**: New command files registered in `commands/index.ts`
- **Output formatters**: Additional output formats (YAML, table) can be added alongside JSON
- **Retry strategies**: New strategies added to the retry utility

---

## 9. REST API Layer

The REST API layer exposes all `azure-fs` operations over HTTP using Express 5.x. It is an **additional interface alongside the CLI**, not a replacement. Both entry points share the same service layer. Full technical design is in `docs/design/technical-design-rest-api-layer.md`.

### 9.1 Dual Entry Point Architecture

```
                              azure-fs
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
│  BlobFileSystemService   MetadataService       │     │
│  AuthService             ConfigLoader          │     │
│  PathService             RetryUtil / Logger     │     │
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
    file.routes.ts             - File CRUD (POST/GET/DELETE/PUT/HEAD /api/v1/files/*)
    folder.routes.ts           - Folder operations (GET/POST/DELETE/HEAD /api/v1/folders/*)
    edit.routes.ts             - Edit/patch/append (PATCH/POST/PUT /api/v1/files/*/patch|append|edit)
    meta.routes.ts             - Metadata CRUD (GET/PUT/PATCH/DELETE /api/v1/meta/*)
    tags.routes.ts             - Tag CRUD + query (GET/PUT /api/v1/tags/*, GET /api/v1/tags)
    hotkeys.routes.ts          - Remote console hotkey actions (POST/GET /api/dev/hotkeys/*)
  controllers/
    file.controller.ts         - File operation handlers -> BlobFileSystemService
    folder.controller.ts       - Folder operation handlers -> BlobFileSystemService
    edit.controller.ts         - Edit operation handlers -> BlobFileSystemService
    meta.controller.ts         - Metadata handlers -> MetadataService
    tags.controller.ts         - Tag handlers -> MetadataService
    hotkeys.controller.ts      - Remote console hotkey action handlers
  middleware/
    error-handler.middleware.ts - AzureFsError -> HTTP status code mapping
    request-logger.middleware.ts- Request/response logging (no body content)
    timeout.middleware.ts       - Per-request timeout enforcement
    upload.middleware.ts        - Multer memory storage for file uploads
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
    │       ├── Extract params from req.params / req.query / req.body / req.file
    │       ├── Call shared service method (plain TypeScript args, never req/res)
    │       ├── Set ETag response header from service result
    │       └── Return CommandResult<T> as JSON response
    │
    ├── 6. 404 handler (unmatched routes)
    └── 7. Error handler middleware
            ├── AzureFsError -> mapped HTTP status + toJSON()
            ├── MulterError -> 400/413
            └── Unknown -> 500 (generic message, details hidden)
```

### 9.4 Service Lifecycle

Services are instantiated **once** at server startup and injected into controllers via closures:

1. `loadApiConfig()` resolves and validates configuration (base + API section)
2. `new Logger(config.logging.level)` creates a shared logger
3. `new BlobFileSystemService(config, logger)` creates the file system service (holds `ContainerClient`)
4. `new MetadataService(config, logger)` creates the metadata service
5. If `NODE_ENV !== "production"`: `ConsoleCommands` is instantiated with a config inspector
6. `createApp(config, blobService, metadataService, logger, actualPort, consoleCommands)` builds the Express app with services injected (including `consoleCommands` for hotkey routes)
7. `app.listen(config.api.port, config.api.host)` starts the HTTP server
8. After `server.listen()`: `ConsoleCommands.setup()` is called to start the readline interface
9. On graceful shutdown: `ConsoleCommands.cleanup()` restores console methods and closes the readline interface

### 9.5 Configuration Extension

The existing config system is extended with an optional `api` section:

- **Config file**: `.azure-fs.json` gains `api: { port, host, corsOrigins, swaggerEnabled, uploadMaxSizeMb, requestTimeoutMs }`
- **Environment variables**: `AZURE_FS_API_PORT`, `AZURE_FS_API_HOST`, `AZURE_FS_API_CORS_ORIGINS`, `AZURE_FS_API_SWAGGER_ENABLED`, `AZURE_FS_API_UPLOAD_MAX_SIZE_MB`, `AZURE_FS_API_REQUEST_TIMEOUT_MS`
- **Priority**: CLI Flags > Environment Variables > Config File (unchanged)
- **Validation**: All six API parameters are required when running in API mode; missing values throw `ConfigError`. CLI commands ignore the `api` section entirely.

### 9.6 Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| HTTP Framework | Express 5.x | Built-in async error handling eliminates boilerplate |
| API Documentation | swagger-jsdoc + swagger-ui-express | Lowest friction, no architectural changes needed |
| File Upload | Multer memory storage | Service layer already accepts Buffer; size-limited by config |
| ETag Enforcement | Required on PUT/PATCH; optional on DELETE | Balances data safety with client usability |
| Error Mapping | Centralized middleware | Single location; leverages existing AzureFsError.toJSON() |
| Auth Error Sanitization | Generic messages to API clients | Prevents leaking env var names and config paths |

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

**Config Inspector**: The static factory method `ConsoleCommands.createInspector(config)` builds a `ConfigInspectorFn` from the resolved `ApiResolvedConfig`. It masks sensitive values (`AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_SAS_TOKEN`) and displays all resolved config keys including the runtime verbose state.

**Lifecycle**:
1. `ConsoleCommands` constructor stores references to original `console.log/error/warn` methods
2. Instance is created before `createApp()` and injected into `ApiServices` so hotkey routes can use it
3. `setup()` creates a `readline.Interface` on `process.stdin` and registers the `line` and `SIGINT` handlers (called after `server.listen()`)
4. `cleanup()` closes the readline interface and restores the original console methods

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

The public methods (`executeClear()`, `executeFreeze()`, `executeVerbose()`, `executeInspect()`, `getStatus()`, `getHelp()`) return structured data objects, allowing both the console hotkeys and API endpoints to share the same logic.

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

- Config files (`.azure-fs.json`) are excluded via `.dockerignore`
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
docker build -t azure-fs-api .

# Run standalone
docker run --env-file .env -p 3000:3000 azure-fs-api

# Docker Compose (recommended)
docker compose up          # foreground
docker compose up -d       # detached
docker compose up --build  # rebuild after code changes
docker compose down        # stop and remove
```

### 10.7 Production Readiness Checklist

The codebase is already well-prepared for containerization:

- [x] Binds to `0.0.0.0` (configurable via `AZURE_FS_API_HOST`)
- [x] Health check endpoints (`/api/health` and `/api/health/ready`)
- [x] Graceful shutdown on `SIGTERM`/`SIGINT`
- [x] All configuration via environment variables
- [x] No file system dependencies for runtime state
- [x] Container-aware Swagger URL detection (`DOCKER_HOST_URL`, `PUBLIC_URL`)
- [x] Console hotkeys auto-disabled in production (`NODE_ENV=production`)
- [x] Hotkey API endpoints for remote access in Docker/cloud environments (`/api/dev/hotkeys/*`)
