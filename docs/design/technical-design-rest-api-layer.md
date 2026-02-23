# Technical Design: REST API Layer for azure-fs

**Date**: 2026-02-23
**Status**: Draft
**References**: `plan-004-rest-api-layer.md`, `investigation-rest-api-layer.md`

---

## 1. Updated Architecture Diagram

The following diagram shows the dual entry point architecture. Both the CLI (Commander.js) and the REST API (Express 5) are thin presentation layers that delegate to a shared service layer. Neither entry point is aware of the other.

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
         │             ┌────────┴─────────────┐        │
         │             │  Express Middleware    │        │
         │             │                      │        │
         │             │  1. CORS             │        │
         │             │  2. JSON Body Parser │        │
         │             │  3. Request Logger   │        │
         │             │  4. Timeout          │        │
         │             │  5. Routes           │        │
         │             │  6. 404 Handler      │        │
         │             │  7. Error Handler    │        │
         │             └────────┬─────────────┘        │
         │                      │                      │
┌────────┴─────────┐   ┌───────┴──────────────┐       │
│  CLI Commands     │   │  API Controllers     │       │
│                  │   │                      │       │
│  file.commands   │   │  file.controller     │       │
│  folder.commands │   │  folder.controller   │       │
│  edit.commands   │   │  edit.controller     │       │
│  meta.commands   │   │  meta.controller     │       │
│  tags.commands   │   │  tags.controller     │       │
│  config.commands │   │                      │       │
└────────┬─────────┘   └───────┬──────────────┘       │
         │                      │                      │
         └──────────┬───────────┘                      │
                    │                                  │
                    v                                  │
┌────────────────────────────────────────────────┐     │
│              Shared Service Layer               │     │
│                                                │     │
│  ┌──────────────────────────────────────────┐  │     │
│  │  BlobFileSystemService                    │  │     │
│  │    uploadFile()     downloadFile()        │  │     │
│  │    deleteFile()     replaceFile()         │  │     │
│  │    fileExists()     getFileInfo()         │  │     │
│  │    createFolder()   listFolder()          │  │     │
│  │    deleteFolder()   folderExists()        │  │     │
│  │    editFile()       editFileUpload()      │  │     │
│  │    patchFile()      appendToFile()        │  │     │
│  └──────────────────────────────────────────┘  │     │
│  ┌──────────────────────────────────────────┐  │     │
│  │  MetadataService                          │  │     │
│  │    setMetadata()    getMetadata()         │  │     │
│  │    updateMetadata() deleteMetadata()      │  │     │
│  │    setTags()        getTags()             │  │     │
│  │    queryByTags()                          │  │     │
│  └──────────────────────────────────────────┘  │     │
│  ┌──────────────────────────────────────────┐  │     │
│  │  AuthService                              │  │     │
│  │    createBlobServiceClient()              │  │     │
│  │    createContainerClient()                │  │     │
│  │    validateConnection()                   │  │     │
│  └──────────────────────────────────────────┘  │     │
│  ┌──────────────────────────────────────────┐  │     │
│  │  ConfigLoader (extended)                  │  │     │
│  │    loadConfig()       loadApiConfig()     │  │     │
│  │    validateConfig()   validateApiConfig() │  │     │
│  └──────────────────────────────────────────┘  │     │
└────────────────────┬───────────────────────────┘     │
                     │                                 │
┌────────────────────┴───────────────────────────┐     │
│             Cross-Cutting Utilities             │     │
│                                                │     │
│  RetryUtil  Logger  Validators  StreamUtils     │     │
│  ContentTypeUtils   PathService                │     │
│  ConcurrencyUtils   ExitCodes                  │     │
└────────────────────┬───────────────────────────┘     │
                     │                                 │
┌────────────────────┴───────────────────────────┐     │
│              Azure SDK Layer                    │     │
│                                                │     │
│  @azure/storage-blob    @azure/identity        │     │
│  BlobServiceClient      DefaultAzureCredential │     │
│  ContainerClient        (+ SAS, ConnString)    │     │
└────────────────────┬───────────────────────────┘     │
                     │                                 │
                     v                                 │
              Azure Blob Storage                       │
                                                       │
┌──────────────────────────────────────────────────────┘
│  Configuration Priority (unchanged):
│  CLI Flags > Environment Variables > Config File
└──────────────────────────────────────────────────────
```

---

## 2. API Module Structure

Every file under `src/api/` and its responsibility:

### 2.1 File Inventory

```
src/api/
  server.ts                              - Express app factory and HTTP server lifecycle
  routes/
    index.ts                             - Route registration barrel (mounts all routers)
    health.routes.ts                     - GET /api/health, GET /api/health/ready
    file.routes.ts                       - POST/GET/DELETE/PUT/HEAD /api/v1/files/*
    folder.routes.ts                     - GET/POST/DELETE/HEAD /api/v1/folders/*
    edit.routes.ts                       - PATCH/POST/PUT /api/v1/files/*/patch|append|edit
    meta.routes.ts                       - GET/PUT/PATCH/DELETE /api/v1/meta/*
    tags.routes.ts                       - GET/PUT /api/v1/tags/*, GET /api/v1/tags
  controllers/
    file.controller.ts                   - File operation request handlers
    folder.controller.ts                 - Folder operation request handlers
    edit.controller.ts                   - Edit/patch/append request handlers
    meta.controller.ts                   - Metadata CRUD request handlers
    tags.controller.ts                   - Tag CRUD and query request handlers
  middleware/
    error-handler.middleware.ts           - Centralized error-to-HTTP mapping
    request-logger.middleware.ts          - HTTP request/response logging
    timeout.middleware.ts                 - Per-request timeout enforcement
    upload.middleware.ts                  - Multer configuration for file uploads
  swagger/
    config.ts                            - swagger-jsdoc configuration and options
    schemas.ts                           - Reusable OpenAPI component schemas
```

### 2.2 Module Responsibilities

| Module | Responsibility |
|--------|----------------|
| `server.ts` | Creates Express application, registers middleware in order, starts HTTP server, handles graceful shutdown, handles port-in-use errors. Exports `createApp()` (testable) and `startServer()` (production). |
| `routes/index.ts` | Barrel that accepts all injected service instances and mounts each router on its base path. Single place to see all route prefixes. |
| `routes/health.routes.ts` | Liveness probe (`/api/health`) and readiness probe (`/api/health/ready`). Readiness calls `validateConnection()`. |
| `routes/file.routes.ts` | Defines Express Router for file operations. Each route is a one-liner calling the corresponding controller function. Contains `@openapi` JSDoc annotations. |
| `routes/folder.routes.ts` | Express Router for folder operations. Same pattern as file routes. |
| `routes/edit.routes.ts` | Express Router for edit, patch, append operations. |
| `routes/meta.routes.ts` | Express Router for metadata CRUD operations. |
| `routes/tags.routes.ts` | Express Router for tag CRUD and query operations. |
| `controllers/file.controller.ts` | Extracts params from `req`, calls `BlobFileSystemService` methods, formats response with `CommandResult<T>`. Never passes `req` or `res` to service layer. |
| `controllers/folder.controller.ts` | Same pattern for folder operations. |
| `controllers/edit.controller.ts` | Same pattern for edit operations. Enforces `If-Match` header requirement. |
| `controllers/meta.controller.ts` | Same pattern for metadata operations. Calls `MetadataService`. |
| `controllers/tags.controller.ts` | Same pattern for tag operations. Calls `MetadataService`. |
| `middleware/error-handler.middleware.ts` | Express 4-argument error handler. Maps `AzureFsError` subclasses to HTTP status codes. Handles `MulterError`. Hides internal details for unknown errors. |
| `middleware/request-logger.middleware.ts` | Logs method, URL, status code, response time. Uses existing `Logger` class. Never logs request or response bodies. |
| `middleware/timeout.middleware.ts` | Aborts requests exceeding `api.requestTimeoutMs` with HTTP 408 Request Timeout. |
| `middleware/upload.middleware.ts` | Configures multer with memory storage and file size limit from `api.uploadMaxSizeMb`. Exports a pre-configured middleware function. |
| `swagger/config.ts` | swagger-jsdoc options object: OpenAPI 3.0 definition, API info, server URL, glob for route files. |
| `swagger/schemas.ts` | Reusable OpenAPI component schemas: `CommandResult`, `ErrorResponse`, `FileInfo`, `UploadResult`, `ListFolderResult`, `PatchResult`, `AppendResult`, `MetadataResult`, `TagResult`, `TagQueryResult`, `HealthResponse`. |

### 2.3 Dependency Graph (API modules)

```
src/api/server.ts
  ├── src/api/routes/index.ts
  │     ├── src/api/routes/health.routes.ts
  │     │     └── src/services/auth.service.ts (validateConnection)
  │     ├── src/api/routes/file.routes.ts
  │     │     ├── src/api/controllers/file.controller.ts
  │     │     │     └── src/services/blob-filesystem.service.ts
  │     │     └── src/api/middleware/upload.middleware.ts
  │     ├── src/api/routes/folder.routes.ts
  │     │     └── src/api/controllers/folder.controller.ts
  │     │           └── src/services/blob-filesystem.service.ts
  │     ├── src/api/routes/edit.routes.ts
  │     │     ├── src/api/controllers/edit.controller.ts
  │     │     │     └── src/services/blob-filesystem.service.ts
  │     │     └── src/api/middleware/upload.middleware.ts
  │     ├── src/api/routes/meta.routes.ts
  │     │     └── src/api/controllers/meta.controller.ts
  │     │           └── src/services/metadata.service.ts
  │     └── src/api/routes/tags.routes.ts
  │           └── src/api/controllers/tags.controller.ts
  │                 └── src/services/metadata.service.ts
  ├── src/api/middleware/error-handler.middleware.ts
  │     └── src/errors/*.ts
  ├── src/api/middleware/request-logger.middleware.ts
  │     └── src/utils/logger.utils.ts
  ├── src/api/middleware/timeout.middleware.ts
  └── src/api/swagger/config.ts
        └── src/api/swagger/schemas.ts
```

---

## 3. Route Definitions

### 3.1 Complete Route Table

| # | Method | Path | Controller Function | Service Method | Request Input | Response Shape | ETag Behavior | Error Codes |
|---|--------|------|---------------------|----------------|---------------|----------------|---------------|-------------|
| 1 | `GET` | `/api/health` | (inline) | -- | None | `HealthResponse` | None | -- |
| 2 | `GET` | `/api/health/ready` | (inline) | `validateConnection()` | None | `HealthReadyResponse` | None | 503 if unhealthy |
| 3 | `POST` | `/api/v1/files` | `uploadFile` | `BlobFileSystemService.uploadFile()` | Multipart: `file` (binary), `remotePath` (string), `metadata` (optional JSON string) | `CommandResult<UploadResult>` | Returns `ETag` header | 400, 413, 500 |
| 4 | `GET` | `/api/v1/files/:path(*)` | `downloadFile` | `BlobFileSystemService.downloadFile()` | Path param: `path` | Raw binary with `Content-Type`, `Content-Length`, `ETag` headers | Returns `ETag`; supports `If-None-Match` (304) | 404, 500 |
| 5 | `DELETE` | `/api/v1/files/:path(*)` | `deleteFile` | `BlobFileSystemService.deleteFile()` | Path param: `path`; optional `If-Match` header | `CommandResult<DeleteResult>` | Optional `If-Match` | 404, 412, 500 |
| 6 | `PUT` | `/api/v1/files/:path(*)` | `replaceFile` | `BlobFileSystemService.replaceFile()` | Multipart: `file` (binary); required `If-Match` header | `CommandResult<UploadResult>` | **Required** `If-Match`; returns new `ETag` | 404, 412, 428, 500 |
| 7 | `GET` | `/api/v1/files/:path(*)/info` | `getFileInfo` | `BlobFileSystemService.getFileInfo()` | Path param: `path` | `CommandResult<FileInfo>` | Returns `ETag` | 404, 500 |
| 8 | `HEAD` | `/api/v1/files/:path(*)` | `fileExists` | `BlobFileSystemService.fileExists()` | Path param: `path` | Empty body; 200 with `ETag` or 404 | Returns `ETag` if exists | 500 |
| 9 | `GET` | `/api/v1/folders/:path(*)` | `listFolder` | `BlobFileSystemService.listFolder()` | Path param: `path`; query: `recursive=true\|false` | `CommandResult<ListFolderResult>` | None | 400, 500 |
| 10 | `POST` | `/api/v1/folders/:path(*)` | `createFolder` | `BlobFileSystemService.createFolder()` | Path param: `path` | `CommandResult<CreateFolderResult>` | None | 400, 500 |
| 11 | `DELETE` | `/api/v1/folders/:path(*)` | `deleteFolder` | `BlobFileSystemService.deleteFolder()` | Path param: `path` | `CommandResult<DeleteFolderResult>` | None | 400, 500 |
| 12 | `HEAD` | `/api/v1/folders/:path(*)` | `folderExists` | `BlobFileSystemService.folderExists()` | Path param: `path` | Empty body; 200 or 404 | None | 500 |
| 13 | `PATCH` | `/api/v1/files/:path(*)/patch` | `patchFile` | `BlobFileSystemService.patchFile()` | Path param: `path`; JSON body: `{ patches: PatchInstruction[] }`; required `If-Match` header | `CommandResult<PatchResult>` | **Required** `If-Match`; returns new `ETag` | 400, 404, 412, 428, 500 |
| 14 | `PATCH` | `/api/v1/files/:path(*)/append` | `appendToFile` | `BlobFileSystemService.appendToFile()` | Path param: `path`; JSON body: `{ content: string, position?: "start"\|"end" }`; required `If-Match` header | `CommandResult<AppendResult>` | **Required** `If-Match`; returns new `ETag` | 400, 404, 412, 428, 500 |
| 15 | `POST` | `/api/v1/files/:path(*)/edit` | `editFile` | `BlobFileSystemService.editFile()` | Path param: `path` | `CommandResult<EditResult>` (includes `etag`) | Returns `ETag` | 404, 500 |
| 16 | `PUT` | `/api/v1/files/:path(*)/edit` | `editFileUpload` | `BlobFileSystemService.editFileUpload()` | Multipart: `file` (binary); required `If-Match` header | `CommandResult<EditUploadResult>` | **Required** `If-Match`; returns new `ETag` | 400, 404, 412, 428, 500 |
| 17 | `GET` | `/api/v1/meta/:path(*)` | `getMetadata` | `MetadataService.getMetadata()` | Path param: `path` | `CommandResult<MetadataResult>` | None | 404, 500 |
| 18 | `PUT` | `/api/v1/meta/:path(*)` | `setMetadata` | `MetadataService.setMetadata()` | Path param: `path`; JSON body: `{ metadata: Record<string,string> }` | `CommandResult<MetadataResult>` | None | 400, 404, 500 |
| 19 | `PATCH` | `/api/v1/meta/:path(*)` | `updateMetadata` | `MetadataService.updateMetadata()` | Path param: `path`; JSON body: `{ metadata: Record<string,string> }` | `CommandResult<MetadataResult>` | None | 400, 404, 500 |
| 20 | `DELETE` | `/api/v1/meta/:path(*)` | `deleteMetadata` | `MetadataService.deleteMetadata()` | Path param: `path`; JSON body: `{ keys: string[] }` | `CommandResult<MetadataResult>` | None | 400, 404, 500 |
| 21 | `GET` | `/api/v1/tags/:path(*)` | `getTags` | `MetadataService.getTags()` | Path param: `path` | `CommandResult<TagResult>` | None | 404, 500 |
| 22 | `PUT` | `/api/v1/tags/:path(*)` | `setTags` | `MetadataService.setTags()` | Path param: `path`; JSON body: `{ tags: Record<string,string> }` | `CommandResult<TagResult>` | None | 400, 404, 500 |
| 23 | `GET` | `/api/v1/tags` | `queryByTags` | `MetadataService.queryByTags()` | Query param: `filter` (OData expression) | `CommandResult<TagQueryResult>` | None | 400, 500 |
| 24 | `GET` | `/api/docs` | swagger-ui-express | -- | None | HTML (Swagger UI) | None | 404 if disabled |
| 25 | `GET` | `/api/docs.json` | swagger-jsdoc | -- | None | OpenAPI 3.0 JSON | None | 404 if disabled |

### 3.2 Path Parameter Extraction

Express 5 uses `path-to-regexp` v8. The wildcard pattern `/:path(*)` captures everything after the route prefix, including slashes. The `req.params.path` value is an **array of segments** in Express 5.

Each controller must join the segments into a single string before passing to the service layer:

```
// Pseudocode (not implementation)
const remotePath = Array.isArray(req.params.path)
  ? req.params.path.join('/')
  : req.params.path;
```

### 3.3 Disambiguation: File Routes vs Info/Edit/Patch/Append Sub-Routes

The following routes share the `/api/v1/files/` prefix but are disambiguated by suffix:

- `GET /api/v1/files/:path(*)` -- downloads the file (raw binary response)
- `GET /api/v1/files/:path(*)/info` -- returns file properties as JSON

Express will match `/info` suffix before the bare wildcard because Express 5 matches more specific routes first. The routes must be registered in order: specific suffixes (`/info`, `/patch`, `/append`, `/edit`) before the bare wildcard.

---

## 4. Config Extension Design

### 4.1 New Type: ApiConfig

To be placed in `src/types/api-config.types.ts`:

```typescript
export interface ApiConfig {
  port: number;
  host: string;
  corsOrigins: string[];
  swaggerEnabled: boolean;
  uploadMaxSizeMb: number;
  requestTimeoutMs: number;
}
```

### 4.2 Extension to AzureFsConfigFile

The `api` section is optional in the config file because CLI commands never use it:

```typescript
export interface AzureFsConfigFile {
  storage?: { ... };    // unchanged
  logging?: { ... };    // unchanged
  retry?: { ... };      // unchanged
  batch?: { ... };      // unchanged
  api?: {               // NEW - optional, only used by API server
    port?: number;
    host?: string;
    corsOrigins?: string[];
    swaggerEnabled?: boolean;
    uploadMaxSizeMb?: number;
    requestTimeoutMs?: number;
  };
}
```

### 4.3 Extension to ResolvedConfig

The `api` section is optional in `ResolvedConfig` so that CLI commands continue to work without API configuration:

```typescript
export interface ResolvedConfig {
  storage: { ... };     // unchanged
  logging: { ... };     // unchanged
  retry: { ... };       // unchanged
  batch: { ... };       // unchanged
  api?: ApiConfig;      // NEW - optional
}
```

### 4.4 New Type: ApiResolvedConfig

A stricter variant used exclusively by the API server entry point, guaranteeing the `api` section is present:

```typescript
export interface ApiResolvedConfig extends ResolvedConfig {
  api: ApiConfig;       // required, not optional
}
```

### 4.5 New Environment Variables

| Variable | Type | Maps to |
|----------|------|---------|
| `AZURE_FS_API_PORT` | number | `api.port` |
| `AZURE_FS_API_HOST` | string | `api.host` |
| `AZURE_FS_API_CORS_ORIGINS` | comma-separated string | `api.corsOrigins` (parsed to `string[]`) |
| `AZURE_FS_API_SWAGGER_ENABLED` | `"true"` or `"false"` | `api.swaggerEnabled` |
| `AZURE_FS_API_UPLOAD_MAX_SIZE_MB` | number | `api.uploadMaxSizeMb` |
| `AZURE_FS_API_REQUEST_TIMEOUT_MS` | number | `api.requestTimeoutMs` |

### 4.6 Validation Rules

All six API parameters are **required** when running in API mode. Missing values throw `ConfigError.missingRequired()`. No defaults, no fallbacks.

Additional validations:
- `port`: must be integer between 1 and 65535
- `host`: must be non-empty string
- `corsOrigins`: must be non-empty array; each origin must be a valid URL or `*`
- `swaggerEnabled`: must be boolean
- `uploadMaxSizeMb`: must be positive number
- `requestTimeoutMs`: must be positive integer

### 4.7 Config Loading Changes

The existing `loadConfig()` function remains unchanged. A new `loadApiConfig()` function:

1. Calls `loadConfig()` to resolve the base configuration.
2. Loads API-specific environment variables via `loadApiEnvConfig()`.
3. Merges CLI flags > env vars > config file for the `api` section.
4. Calls `validateApiConfig()` to validate all six API fields.
5. Returns `ApiResolvedConfig`.

---

## 5. Error Mapping Table

### 5.1 Complete Error-to-HTTP Mapping

| Error Class | Error Code | HTTP Status | Response Body `error.code` | Rationale |
|-------------|-----------|-------------|---------------------------|-----------|
| `ConfigError` | `CONFIG_MISSING_REQUIRED` | 500 | `CONFIG_MISSING_REQUIRED` | Server misconfiguration; client cannot fix |
| `ConfigError` | `CONFIG_INVALID_VALUE` | 500 | `CONFIG_INVALID_VALUE` | Server misconfiguration |
| `ConfigError` | `CONFIG_FILE_NOT_FOUND` | 500 | `CONFIG_FILE_NOT_FOUND` | Server misconfiguration |
| `ConfigError` | `CONFIG_FILE_PARSE_ERROR` | 500 | `CONFIG_FILE_PARSE_ERROR` | Server misconfiguration |
| `AuthError` | `AUTH_MISSING_CONNECTION_STRING` | 500 | `AUTH_CONFIGURATION_ERROR` | Server auth misconfiguration; message sanitized |
| `AuthError` | `AUTH_MISSING_SAS_TOKEN` | 500 | `AUTH_CONFIGURATION_ERROR` | Server auth misconfiguration; message sanitized |
| `AuthError` | `AUTH_SAS_TOKEN_EXPIRED` | 500 | `AUTH_CONFIGURATION_ERROR` | Server auth expired; message sanitized |
| `AuthError` | `AUTH_AZURE_AD_FAILED` | 500 | `AUTH_CONFIGURATION_ERROR` | Server auth failure; message sanitized |
| `AuthError` | `AUTH_INVALID_AUTH_METHOD` | 500 | `AUTH_CONFIGURATION_ERROR` | Server auth misconfiguration; message sanitized |
| `AuthError` | `AUTH_ACCESS_DENIED` | 403 | `AUTH_ACCESS_DENIED` | Actual Azure access denial |
| `AuthError` | `AUTH_CONNECTION_FAILED` | 502 | `AUTH_CONNECTION_FAILED` | Azure unreachable |
| `BlobNotFoundError` | `BLOB_NOT_FOUND` | 404 | `BLOB_NOT_FOUND` | Resource not found |
| `PathError` | `PATH_EMPTY` | 400 | `PATH_EMPTY` | Client sent empty path |
| `PathError` | `PATH_INVALID` | 400 | `PATH_INVALID` | Client sent invalid path |
| `PathError` | `PATH_TOO_LONG` | 400 | `PATH_TOO_LONG` | Client sent overlong path |
| `PathError` | `PATH_LOCAL_FILE_NOT_FOUND` | 400 | `PATH_LOCAL_FILE_NOT_FOUND` | Temp file missing (edit workflow) |
| `MetadataError` | `META_INVALID_KEY` | 400 | `META_INVALID_KEY` | Client sent invalid metadata key |
| `MetadataError` | `META_SIZE_EXCEEDED` | 400 | `META_SIZE_EXCEEDED` | Metadata too large |
| `MetadataError` | `META_MAX_TAGS_EXCEEDED` | 400 | `META_MAX_TAGS_EXCEEDED` | Too many tags |
| `ConcurrentModificationError` | `CONCURRENT_MODIFICATION` | 412 | `CONCURRENT_MODIFICATION` | ETag mismatch (optimistic lock failure) |
| `MulterError` | `LIMIT_FILE_SIZE` | 413 | `UPLOAD_FILE_TOO_LARGE` | File exceeds `uploadMaxSizeMb` |
| `MulterError` | (other) | 400 | `UPLOAD_ERROR` | Malformed upload |
| -- (missing `If-Match`) | -- | 428 | `PRECONDITION_REQUIRED` | Controller detects missing header before calling service |
| Unknown `Error` | -- | 500 | `INTERNAL_ERROR` | Never expose internal details |

### 5.2 Error Response Format

All error responses use the same structure as `CommandResult<never>`:

```json
{
  "success": false,
  "error": {
    "code": "BLOB_NOT_FOUND",
    "message": "Blob not found: \"documents/report.pdf\". Verify the path and ensure the file exists.",
    "details": { "path": "documents/report.pdf" }
  },
  "metadata": {
    "command": "api:download",
    "timestamp": "2026-02-23T10:00:00.000Z",
    "durationMs": 45
  }
}
```

### 5.3 Security: Error Sanitization

For server-side errors (`ConfigError`, `AuthError` with `AUTH_MISSING_*`), the error middleware must **not** forward the original error message to the client. These messages contain information about environment variables, CLI flags, and configuration file paths. Instead, the middleware returns a generic message:

- `ConfigError`: `"Server configuration error. Contact the administrator."`
- `AuthError` (non-403): `"Server authentication error. Contact the administrator."`

The original error is logged at `error` level for debugging.

---

## 6. Middleware Chain

### 6.1 Middleware Registration Order

The Express application registers middleware in the following strict order:

```
# Middleware registration order in createApp()

1. cors(corsOptions)
   - First middleware: handles preflight OPTIONS requests immediately
   - Config: { origin: api.corsOrigins, methods: [...], allowedHeaders: [...] }

2. express.json({ limit: '10mb' })
   - Parses application/json request bodies
   - The 10mb limit is for JSON payloads (metadata, patches)
   - Multipart uploads bypass this; they use multer

3. requestLoggerMiddleware(logger)
   - Logs: method, url, status code, response time in ms
   - Uses res.on('finish') to capture status code
   - Logs to stderr via the existing Logger class
   - Never logs request or response bodies

4. timeoutMiddleware(api.requestTimeoutMs)
   - Starts a timer on each request
   - If timer fires before response is sent, responds with 408 Request Timeout
   - Clears timer on response finish

5. Routes (mounted via routes/index.ts)
   - /api/health             -> health.routes.ts
   - /api/v1/files           -> file.routes.ts
   - /api/v1/folders         -> folder.routes.ts
   - /api/v1/meta            -> meta.routes.ts
   - /api/v1/tags            -> tags.routes.ts
   - /api/docs               -> swagger-ui-express (conditional)
   - /api/docs.json           -> swagger-jsdoc spec (conditional)
   NOTE: edit routes are sub-routes within file.routes.ts or registered
         alongside, sharing the /api/v1/files prefix

6. 404 Handler (catch-all)
   - Matches any route not handled above
   - Returns: { success: false, error: { code: "NOT_FOUND", message: "..." } }
   - HTTP status: 404

7. errorHandlerMiddleware(logger)
   - Express 4-argument signature: (err, req, res, next)
   - Checks err instanceof AzureFsError -> maps to HTTP status
   - Checks err instanceof MulterError -> maps to 400/413
   - Otherwise -> 500 with generic message
   - Always logs the full error to Logger
   - Always returns CommandResult<never> JSON structure
```

### 6.2 Multer Placement

Multer is **not** global middleware. It is applied per-route on upload endpoints only:

- `POST /api/v1/files` -- `upload.single('file')`
- `PUT /api/v1/files/:path(*)` -- `upload.single('file')`
- `PUT /api/v1/files/:path(*)/edit` -- `upload.single('file')`

This prevents multipart parsing overhead on non-upload routes.

---

## 7. Service Lifecycle

### 7.1 Service Instantiation

Services are created **once** at server startup and shared across all requests via closure or dependency injection. The lifecycle is:

```
startServer()
    │
    ├── 1. loadApiConfig()
    │       -> ApiResolvedConfig (validated, all fields present)
    │
    ├── 2. Create Logger
    │       new Logger(config.logging.level, false)
    │
    ├── 3. Create Services (one instance each)
    │       const blobService = new BlobFileSystemService(config, logger)
    │       const metadataService = new MetadataService(config, logger)
    │
    ├── 4. Create Express App
    │       const app = createApp(config, blobService, metadataService, logger)
    │
    └── 5. Start Listening
            app.listen(config.api.port, config.api.host)
```

### 7.2 Service Injection into Routes

The `createApp()` function receives service instances and passes them to the route registration function. The routes/index.ts barrel passes the services to individual route modules, which create controller closures:

```
createApp(config, blobService, metadataService, logger)
    └── registerRoutes(app, { blobService, metadataService, config, logger })
            ├── createFileRoutes(blobService)      -> Router
            ├── createFolderRoutes(blobService)     -> Router
            ├── createEditRoutes(blobService)       -> Router
            ├── createMetaRoutes(metadataService)   -> Router
            ├── createTagRoutes(metadataService)    -> Router
            └── createHealthRoutes(config)          -> Router
```

Each route factory function returns an `express.Router`. Controllers are functions (not classes) that close over the service instance:

```
// Pseudocode pattern (not implementation code)
function createFileRoutes(blobService: BlobFileSystemService): Router {
    const router = Router();
    router.post('/', uploadMiddleware, async (req, res) => {
        // extract from req, call blobService, respond
    });
    return router;
}
```

### 7.3 Why This Pattern

- Services contain Azure SDK clients (`ContainerClient`) which are expensive to create -- creating them per-request would be wasteful.
- The `ContainerClient` from `@azure/storage-blob` is safe for concurrent use across requests.
- This pattern makes the Express app testable: inject mock services in tests.

---

## 8. File Upload Design

### 8.1 Multer Configuration

```
Storage:       multer.memoryStorage()
Field name:    "file" (single file upload)
Size limit:    api.uploadMaxSizeMb * 1024 * 1024 bytes
File filter:   None (accept all file types; Azure handles content)
```

### 8.2 Upload Data Flow

```
HTTP Client
    │
    │  POST /api/v1/files
    │  Content-Type: multipart/form-data
    │  Fields: file (binary), remotePath (string), metadata (JSON string)
    │
    v
┌──────────────────────────────────────────┐
│  Multer Middleware                         │
│                                          │
│  1. Parse multipart form data            │
│  2. Store file in memory (req.file.buffer)│
│  3. Parse text fields (req.body)         │
│  4. If file > uploadMaxSizeMb:           │
│     throw MulterError('LIMIT_FILE_SIZE') │
│     -> error middleware -> 413            │
└────────────┬─────────────────────────────┘
             │
             v
┌──────────────────────────────────────────┐
│  File Controller (uploadFile)             │
│                                          │
│  1. Extract remotePath from req.body     │
│  2. Extract metadata from req.body       │
│     (JSON.parse if string)               │
│  3. Extract buffer from req.file.buffer  │
│  4. Validate remotePath is present       │
│  5. Call blobService.uploadFile(         │
│       remotePath, buffer, metadata       │
│     )                                    │
│  6. Wrap result in CommandResult         │
│  7. Set ETag header from result.etag     │
│  8. res.status(201).json(result)         │
└────────────┬─────────────────────────────┘
             │
             v
┌──────────────────────────────────────────┐
│  BlobFileSystemService.uploadFile()       │
│                                          │
│  - source is Buffer -> takes the buffer  │
│    upload path (not the file-path path)  │
│  - Calls blockBlobClient.upload(buffer)  │
│  - Returns UploadResult with etag        │
└──────────────────────────────────────────┘
```

### 8.3 Replace Upload Data Flow (PUT)

The replace flow is identical to upload but:
- Uses `PUT /api/v1/files/:path(*)` instead of `POST /api/v1/files`
- Requires `If-Match` header (returns 428 if missing)
- The remotePath comes from the URL path parameter, not form data
- Calls `blobService.replaceFile()` instead of `uploadFile()`

### 8.4 Size Limits Rationale

Memory storage is acceptable because:
1. The `api.uploadMaxSizeMb` config limits the maximum file size.
2. Multer rejects oversized files before loading them fully.
3. Node.js can handle buffers up to ~2GB; practical API limits are well below this.
4. The service layer's `uploadFile()` already accepts `Buffer` as a source parameter.

---

## 9. ETag Flow

### 9.1 ETag Conventions

- ETags are always wrapped in double quotes in HTTP headers: `ETag: "0x8DC1234567890AB"`
- The Azure SDK returns ETags with or without quotes depending on the operation.
- Controllers must ensure consistent quoting when setting response headers.
- When reading `If-Match`, controllers strip surrounding quotes before passing to the service layer.

### 9.2 Per-Operation ETag Behavior

#### Upload (POST /api/v1/files)

```
Client                          API                         Azure
  │                              │                            │
  │  POST /api/v1/files          │                            │
  │  (no If-Match)               │                            │
  │  ─────────────────────────>  │                            │
  │                              │  uploadFile(path, buffer)  │
  │                              │  ────────────────────────> │
  │                              │           etag: "0x1234"   │
  │                              │  <──────────────────────── │
  │  201 Created                 │                            │
  │  ETag: "0x1234"              │                            │
  │  { success: true, data: {} } │                            │
  │  <───────────────────────────│                            │
```

#### Download (GET /api/v1/files/:path)

```
Client                          API                         Azure
  │                              │                            │
  │  GET /api/v1/files/doc.txt   │                            │
  │  ─────────────────────────>  │                            │
  │                              │  getFileInfo(path)         │
  │                              │  ────────────────────────> │
  │                              │        etag: "0x1234"      │
  │                              │  <──────────────────────── │
  │  200 OK                      │                            │
  │  ETag: "0x1234"              │                            │
  │  Content-Type: text/plain    │                            │
  │  <binary content>            │                            │
  │  <───────────────────────────│                            │
```

#### Download with If-None-Match (conditional GET)

```
Client                          API                         Azure
  │                              │                            │
  │  GET /api/v1/files/doc.txt   │                            │
  │  If-None-Match: "0x1234"     │                            │
  │  ─────────────────────────>  │                            │
  │                              │  getFileInfo(path)         │
  │                              │  ────────────────────────> │
  │                              │        etag: "0x1234"      │
  │                              │  <──────────────────────── │
  │                              │                            │
  │                              │  etag matches If-None-Match│
  │  304 Not Modified            │                            │
  │  (no body)                   │                            │
  │  <───────────────────────────│                            │
```

#### Replace (PUT /api/v1/files/:path) -- ETag Required

```
Client                          API                         Azure
  │                              │                            │
  │  PUT /api/v1/files/doc.txt   │                            │
  │  If-Match: "0x1234"          │                            │
  │  <file content>              │                            │
  │  ─────────────────────────>  │                            │
  │                              │  1. Check If-Match present │
  │                              │  2. replaceFile(path,      │
  │                              │       buffer, {etag})      │
  │                              │  ────────────────────────> │
  │                              │                            │
  │                              │  Azure checks If-Match     │
  │                              │        new etag: "0x5678"  │
  │                              │  <──────────────────────── │
  │  200 OK                      │                            │
  │  ETag: "0x5678"              │                            │
  │  <───────────────────────────│                            │
```

#### Replace with stale ETag (412)

```
Client                          API                         Azure
  │                              │                            │
  │  PUT /api/v1/files/doc.txt   │                            │
  │  If-Match: "0x1234"          │  (blob now has "0xAAAA")   │
  │  ─────────────────────────>  │                            │
  │                              │  replaceFile(...)          │
  │                              │  ────────────────────────> │
  │                              │  Azure returns 412         │
  │                              │  <──────────────────────── │
  │                              │                            │
  │                              │  Service throws            │
  │                              │  ConcurrentModificationErr │
  │                              │                            │
  │                              │  Error middleware catches   │
  │  412 Precondition Failed     │                            │
  │  { success: false, error: {  │                            │
  │    code: "CONCURRENT_MOD..." │                            │
  │  }}                          │                            │
  │  <───────────────────────────│                            │
```

#### Replace without If-Match (428)

```
Client                          API
  │                              │
  │  PUT /api/v1/files/doc.txt   │
  │  (no If-Match header)        │
  │  ─────────────────────────>  │
  │                              │
  │                              │  Controller checks header  │
  │                              │  -> missing -> 428         │
  │  428 Precondition Required   │                            │
  │  { success: false, error: {  │                            │
  │    code: "PRECONDITION_REQ.."│                            │
  │  }}                          │                            │
  │  <───────────────────────────│
```

#### Patch and Append (PATCH) -- Same as Replace

Same `If-Match` required flow. The service layer (`patchFile`, `appendToFile`) already uses ETag internally. The controller passes the client's `If-Match` value to override the internal ETag.

**Design note**: The existing `patchFile()` and `appendToFile()` methods read the blob, get the ETag from the download, and use it for conditional re-upload. For the API flow, the client provides an ETag via `If-Match`. The controller must verify that the client's ETag matches the blob's current ETag before proceeding. This is achieved by:
1. Controller reads `If-Match` from the request header.
2. The service method downloads the blob and gets its current ETag internally.
3. If the client's ETag does not match the downloaded ETag, the controller should return 412 immediately (before the patch/append logic runs).
4. If they match, the service proceeds with the read-modify-write cycle using the blob's ETag for the conditional upload.

This means an additional ETag comparison step is needed in the controller or a service method variant that accepts an external ETag for pre-validation.

---

## 10. Health Check Design

### 10.1 Liveness Probe: `GET /api/health`

**Purpose**: Confirms the process is running and can handle HTTP requests. Used by container orchestrators (Kubernetes liveness probe).

**Checks performed**: None (always returns 200 if the process is alive).

**Response (HTTP 200)**:

```json
{
  "status": "ok",
  "timestamp": "2026-02-23T10:00:00.000Z",
  "uptime": 3600.123
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Always `"ok"` |
| `timestamp` | string | ISO 8601 timestamp |
| `uptime` | number | Process uptime in seconds (`process.uptime()`) |

### 10.2 Readiness Probe: `GET /api/health/ready`

**Purpose**: Confirms the server can handle real requests by verifying connectivity to Azure Blob Storage. Used by container orchestrators (Kubernetes readiness probe) and load balancers.

**Checks performed**:
1. Call `validateConnection(config)` from `auth.service.ts`
2. This calls `containerClient.exists()` on the configured container

**Response (HTTP 200) -- healthy**:

```json
{
  "status": "ready",
  "timestamp": "2026-02-23T10:00:00.000Z",
  "uptime": 3600.123,
  "checks": {
    "azureStorage": {
      "status": "connected",
      "containerName": "my-container",
      "containerExists": true,
      "responseTimeMs": 45
    }
  }
}
```

**Response (HTTP 503) -- unhealthy**:

```json
{
  "status": "not_ready",
  "timestamp": "2026-02-23T10:00:00.000Z",
  "uptime": 3600.123,
  "checks": {
    "azureStorage": {
      "status": "disconnected",
      "error": "Connection timed out",
      "responseTimeMs": 5000
    }
  }
}
```

### 10.3 HTTP Status Codes

| Endpoint | Healthy | Unhealthy |
|----------|---------|-----------|
| `GET /api/health` | 200 | (never unhealthy) |
| `GET /api/health/ready` | 200 | 503 Service Unavailable |

---

## 11. Swagger Design

### 11.1 OpenAPI Spec Structure

```yaml
openapi: '3.0.0'
info:
  title: Azure FS REST API
  version: '1.0.0'
  description: REST API for Azure Blob Storage virtual file system operations
  contact:
    name: Azure FS
servers:
  - url: /api
    description: API base URL

tags:
  - name: Health
    description: Health check endpoints
  - name: Files
    description: File upload, download, delete, replace, info, exists
  - name: Folders
    description: Folder listing, creation, deletion, exists
  - name: Edit
    description: File editing (patch, append, two-phase edit)
  - name: Metadata
    description: Blob metadata CRUD operations
  - name: Tags
    description: Blob index tag operations and queries

paths:
  /health: ...
  /health/ready: ...
  /v1/files: ...
  /v1/files/{path}: ...
  /v1/files/{path}/info: ...
  /v1/files/{path}/patch: ...
  /v1/files/{path}/append: ...
  /v1/files/{path}/edit: ...
  /v1/folders/{path}: ...
  /v1/meta/{path}: ...
  /v1/tags/{path}: ...
  /v1/tags: ...

components:
  schemas:
    CommandResult: ...
    ErrorResponse: ...
    UploadResult: ...
    DownloadHeaders: ...
    DeleteResult: ...
    FileInfo: ...
    ExistsResult: ...
    ListFolderResult: ...
    CreateFolderResult: ...
    DeleteFolderResult: ...
    PatchInstruction: ...
    PatchResult: ...
    AppendResult: ...
    EditResult: ...
    EditUploadResult: ...
    MetadataResult: ...
    TagResult: ...
    TagQueryResult: ...
    HealthResponse: ...
    HealthReadyResponse: ...
  parameters:
    PathParam: ...
    RecursiveQuery: ...
    FilterQuery: ...
  headers:
    ETag: ...
    IfMatch: ...
    IfNoneMatch: ...
```

### 11.2 Tag Groups

| Tag | Routes | Description |
|-----|--------|-------------|
| Health | `/api/health`, `/api/health/ready` | Liveness and readiness probes |
| Files | `POST/GET/DELETE/PUT/HEAD /api/v1/files/*` | Core file CRUD |
| Folders | `GET/POST/DELETE/HEAD /api/v1/folders/*` | Folder operations |
| Edit | `PATCH/POST/PUT /api/v1/files/*/patch\|append\|edit` | Content modification |
| Metadata | `GET/PUT/PATCH/DELETE /api/v1/meta/*` | Blob metadata |
| Tags | `GET/PUT /api/v1/tags/*`, `GET /api/v1/tags` | Blob index tags |

### 11.3 Annotation Organization

Each route handler function has an `@openapi` JSDoc block directly above it in the route file. This keeps the documentation co-located with the route definition:

```
// Pattern (not implementation code):
/**
 * @openapi
 * /v1/files:
 *   post:
 *     tags: [Files]
 *     summary: Upload a new file
 *     ...
 */
router.post('/', uploadMiddleware, fileController.uploadFile);
```

Reusable schemas are defined once in `swagger/schemas.ts` using `@openapi` blocks and referenced via `$ref: '#/components/schemas/CommandResult'`.

### 11.4 Conditional Mounting

Swagger UI and the JSON spec endpoint are only mounted when `api.swaggerEnabled` is `true`:

- `GET /api/docs` -> Swagger UI HTML
- `GET /api/docs.json` -> Raw OpenAPI 3.0 JSON

When disabled, these routes are not registered and return 404.

---

## 12. Graceful Shutdown

### 12.1 Signal Handling

The `startServer()` function registers handlers for two signals:

| Signal | Source | Action |
|--------|--------|--------|
| `SIGTERM` | Container orchestrator (Kubernetes), `kill` command | Graceful shutdown |
| `SIGINT` | Ctrl+C in terminal | Graceful shutdown |

### 12.2 Shutdown Sequence

```
Signal received (SIGTERM or SIGINT)
    │
    ├── 1. Log: "Received {signal}, shutting down..."
    │
    ├── 2. server.close()
    │       - Stops accepting new TCP connections
    │       - In-flight requests continue processing
    │
    ├── 3. Wait for in-flight requests
    │       - server.close() callback fires when all
    │         connections are closed
    │       - Maximum wait: 10 seconds
    │
    ├── 4. Cleanup
    │       - Flush logger (if buffered)
    │       - No explicit Azure SDK cleanup needed
    │         (ContainerClient has no close() method)
    │
    └── 5. Exit
            - If all connections drained: process.exit(0)
            - If timeout reached (10s): log warning, process.exit(1)
```

### 12.3 Implementation Notes

- The 10-second timeout is hardcoded (not configurable) to keep the shutdown simple.
- Double-signal handling: if the user sends SIGINT twice, force-exit immediately.
- The `server.close()` callback is the trigger for clean exit; the `setTimeout()` is the safety net.
- During shutdown, new requests that arrive on already-established keep-alive connections will receive HTTP 503 with a `Connection: close` header.

### 12.4 Port Conflict Detection

Before shutdown can happen, the server must start. If the configured port is in use, `server.on('error')` catches `EADDRINUSE` and exits with code 1 immediately (no retry, no fallback port).

---

## 13. Implementation Units

The following units can be built and tested independently. Dependencies are noted.

### 13.1 Parallel-Ready Units (no inter-dependencies)

These units depend only on Phase 1 (Config Extension) and Phase 2 (Express Scaffold), which must be built first as the foundation.

| Unit | Files | Dependencies | Estimated Effort |
|------|-------|--------------|-----------------|
| **U1: Config Extension** | `api-config.types.ts`, changes to `config.types.ts`, `config.loader.ts`, `config.schema.ts`, `index.ts` | None | Small |
| **U2: Express Scaffold** | `server.ts`, `error-handler.middleware.ts`, `request-logger.middleware.ts`, `timeout.middleware.ts`, `routes/index.ts` | U1 | Medium |
| **U3: Health Routes** | `health.routes.ts` | U2 | Small |
| **U4: File Routes** | `file.routes.ts`, `file.controller.ts`, `upload.middleware.ts` | U2 | Large |
| **U5: Folder Routes** | `folder.routes.ts`, `folder.controller.ts` | U2 | Medium |
| **U6: Meta Routes** | `meta.routes.ts`, `meta.controller.ts` | U2 | Medium |
| **U7: Tag Routes** | `tags.routes.ts`, `tags.controller.ts` | U2 | Medium |

### 13.2 Dependent Units

| Unit | Files | Dependencies | Estimated Effort |
|------|-------|--------------|-----------------|
| **U8: Edit Routes** | `edit.routes.ts`, `edit.controller.ts` | U4 (for ETag patterns and upload middleware) | Medium |
| **U9: Swagger** | `swagger/config.ts`, `swagger/schemas.ts`, modifications to `server.ts` | U3-U8 (all routes must exist) | Medium |
| **U10: Integration Tests** | `test_scripts/test-api-integration.ts`, `test_scripts/test-api-config.ts` | All above | Large |
| **U11: Documentation** | `CLAUDE.md`, `project-design.md`, `.azure-fs.json.example`, `.env.example` | All above | Small |

### 13.3 Dependency Graph

```
U1 (Config Extension)
  │
  └──> U2 (Express Scaffold)
         │
         ├──> U3 (Health Routes)
         │
         ├──> U4 (File Routes)
         │      │
         │      └──> U8 (Edit Routes)
         │
         ├──> U5 (Folder Routes)
         │
         ├──> U6 (Meta Routes)
         │
         └──> U7 (Tag Routes)
                │
                └──> U9 (Swagger)  [requires U3-U8]
                       │
                       └──> U10 (Integration Tests)
                              │
                              └──> U11 (Documentation)
```

Units U3, U4, U5, U6, and U7 can be built in parallel once U2 is complete. U8 depends on U4 for shared upload middleware and ETag handling patterns.

---

## 14. API Request Data Flow (End-to-End)

To illustrate the complete request lifecycle, here is the flow for an API upload request:

```
HTTP Client sends:
  POST /api/v1/files
  Content-Type: multipart/form-data
  Body: file=<binary>, remotePath="docs/report.pdf", metadata='{"author":"john"}'

    ┌──────────────────────────────────────────────────────────┐
    │  1. CORS Middleware                                       │
    │     Check Origin header against api.corsOrigins           │
    │     If rejected -> 403 (CORS error)                      │
    │     If accepted -> set Access-Control-Allow-* headers     │
    └──────────────────────┬───────────────────────────────────┘
                           │
    ┌──────────────────────┴───────────────────────────────────┐
    │  2. JSON Body Parser                                      │
    │     Content-Type is multipart -> parser is a no-op        │
    └──────────────────────┬───────────────────────────────────┘
                           │
    ┌──────────────────────┴───────────────────────────────────┐
    │  3. Request Logger Middleware                              │
    │     Log: "[POST] /api/v1/files" (start timer)             │
    │     Register res.on('finish') to log duration + status    │
    └──────────────────────┬───────────────────────────────────┘
                           │
    ┌──────────────────────┴───────────────────────────────────┐
    │  4. Timeout Middleware                                     │
    │     Start timeout timer (api.requestTimeoutMs)            │
    └──────────────────────┬───────────────────────────────────┘
                           │
    ┌──────────────────────┴───────────────────────────────────┐
    │  5. Route: POST /api/v1/files                             │
    │     5a. Multer middleware parses multipart                 │
    │         -> req.file.buffer (binary content)               │
    │         -> req.body.remotePath (string)                   │
    │         -> req.body.metadata (JSON string)                │
    │         If file > limit -> MulterError -> error middleware │
    │                                                           │
    │     5b. Controller: uploadFile()                           │
    │         - Extract remotePath from req.body.remotePath     │
    │         - Parse metadata: JSON.parse(req.body.metadata)   │
    │         - Validate remotePath is present                  │
    │         - Call blobService.uploadFile(remotePath,          │
    │                 req.file.buffer, metadata)                 │
    │         - Receive UploadResult { path, size, etag, ... }  │
    │         - Set response header: ETag: "{etag}"             │
    │         - res.status(201).json(CommandResult<UploadResult>)│
    └──────────────────────┬───────────────────────────────────┘
                           │
    ┌──────────────────────┴───────────────────────────────────┐
    │  6. Request Logger fires on response finish               │
    │     Log: "[POST] /api/v1/files -> 201 (234ms)"            │
    └──────────────────────┬───────────────────────────────────┘
                           │
                           v
    HTTP Response:
      201 Created
      ETag: "0x8DC1234567890AB"
      Content-Type: application/json
      {
        "success": true,
        "data": {
          "path": "docs/report.pdf",
          "size": 1048576,
          "contentType": "application/pdf",
          "etag": "0x8DC1234567890AB",
          "metadata": { "author": "john" }
        },
        "metadata": {
          "command": "api:upload",
          "timestamp": "2026-02-23T10:00:00.000Z",
          "durationMs": 234
        }
      }
```

---

## 15. Design Decisions Summary

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | HTTP Framework | Express 5.x | Built-in async error handling; no Express 4 migration needed |
| D2 | API Documentation | swagger-jsdoc + swagger-ui-express | Lowest friction, no architectural changes |
| D3 | File Upload | Multer memory storage | Service layer already accepts Buffer; size-limited |
| D4 | Configuration | Extend existing ConfigLoader | Single source of truth; CLI ignores API section |
| D5 | ETag Enforcement | Required on PUT/PATCH, optional on DELETE | Balances safety with usability |
| D6 | Error Mapping | Centralized middleware with mapping table | Single place to update; leverages existing error hierarchy |
| D7 | Service Sharing | Singleton services injected via closures | Thread-safe, testable, no per-request overhead |
| D8 | Route Disambiguation | Suffix-based (`/info`, `/patch`, `/append`, `/edit`) | Avoids conflicts with wildcard path capture |
| D9 | Config Defaults | None (per project rules) | All API params required; throw ConfigError if missing |
| D10 | Swagger Conditional | Gated by `api.swaggerEnabled` config | Production can disable UI; security consideration |
| D11 | Shutdown Timeout | 10 seconds hardcoded | Simplicity; matches common container orchestrator expectations |
| D12 | Auth Error Sanitization | Generic messages to client | Prevent leaking env var names, config paths to API clients |
