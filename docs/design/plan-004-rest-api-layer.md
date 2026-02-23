# Plan 004: REST API Layer for azure-fs

**Date**: 2026-02-23
**Status**: Approved
**Dependencies**: Investigation findings (`docs/reference/investigation-rest-api-layer.md`)

---

## 1. Objective

Add an Express 5.x REST API layer to the `azure-fs` CLI tool, exposing all existing file system, metadata, and tag operations over HTTP. The API is an **additional interface alongside the CLI**, not a replacement. Both the CLI and API share the same service layer (`BlobFileSystemService`, `MetadataService`, `AuthService`) and the same configuration system (extended with API-specific settings).

---

## 2. Implementation Phases

### Phase 1: Configuration Extension

**Goal**: Extend the existing config system with API-specific settings. No Express code yet.

**Dependencies**: None (foundation for all other phases)

#### Files to Create

| File | Purpose |
|------|---------|
| `src/types/api-config.types.ts` | `ApiConfig` interface, `ApiResolvedConfig` type |

#### Files to Modify

| File | Change |
|------|--------|
| `src/types/config.types.ts` | Add optional `api` section to `AzureFsConfigFile`; add `api` section to `ResolvedConfig` (optional, only required when running API mode) |
| `src/config/config.loader.ts` | Add `loadApiEnvConfig()` to read `AZURE_FS_API_*` env vars; extend `mergeConfigSection` to include `api` section; add `loadApiConfig()` exported function for API entry point |
| `src/config/config.schema.ts` | Add `validateApiConfig()` function that validates API-specific fields (port, host, corsOrigins, swaggerEnabled, uploadMaxSizeMb, requestTimeoutMs); no fallback values per project rules |
| `src/types/index.ts` | Re-export new API config types |

#### New Configuration Parameters

| Parameter | Config File Key | Env Var | Required | Description |
|-----------|----------------|---------|----------|-------------|
| Port | `api.port` | `AZURE_FS_API_PORT` | Yes | TCP port for the HTTP server |
| Host | `api.host` | `AZURE_FS_API_HOST` | Yes | Bind address (e.g., `0.0.0.0`, `127.0.0.1`) |
| CORS Origins | `api.corsOrigins` | `AZURE_FS_API_CORS_ORIGINS` | Yes | Comma-separated allowed origins |
| Swagger Enabled | `api.swaggerEnabled` | `AZURE_FS_API_SWAGGER_ENABLED` | Yes | `true` or `false` to enable Swagger UI |
| Upload Max Size MB | `api.uploadMaxSizeMb` | `AZURE_FS_API_UPLOAD_MAX_SIZE_MB` | Yes | Maximum upload file size in megabytes |
| Request Timeout Ms | `api.requestTimeoutMs` | `AZURE_FS_API_REQUEST_TIMEOUT_MS` | Yes | Per-request timeout in milliseconds |

**Priority**: CLI Flags > Environment Variables > Config File (unchanged)

**Important**: All six API parameters are **required** when running in API mode. Missing values throw `ConfigError`. The existing CLI commands do **not** require the `api` section -- it is only validated when the API server is started. The `api` section is entirely ignored by CLI commands.

#### New Types

```typescript
// src/types/api-config.types.ts
export interface ApiConfig {
  port: number;
  host: string;
  corsOrigins: string[];
  swaggerEnabled: boolean;
  uploadMaxSizeMb: number;
  requestTimeoutMs: number;
}
```

The `ResolvedConfig` type gains an optional `api?: ApiConfig` field. A separate `ApiResolvedConfig` type (which extends `ResolvedConfig` with a required `api: ApiConfig`) is used by the API server entry point.

#### Acceptance Criteria

- [ ] `AzureFsConfigFile` includes an optional `api` section
- [ ] Six new environment variables are read by `loadEnvConfig()`
- [ ] `validateApiConfig()` throws `ConfigError` for every missing API field (no defaults)
- [ ] `AZURE_FS_API_CORS_ORIGINS` parsed as comma-separated string into `string[]`
- [ ] Existing CLI commands continue to work without any `api` config present
- [ ] A new `loadApiConfig()` function validates both the base config AND the API section
- [ ] Unit test script in `test_scripts/` validates config loading with API section

---

### Phase 2: Express Application Scaffold & Health Check

**Goal**: Minimal Express 5 app with health check, CORS, JSON body parser, and error middleware. Proves the server starts and can talk to Azure Storage.

**Dependencies**: Phase 1 (API config)

#### Files to Create

| File | Purpose |
|------|---------|
| `src/api/server.ts` | Express app factory (`createApp()`), `startServer()` function, graceful shutdown |
| `src/api/middleware/error-handler.middleware.ts` | Centralized error middleware mapping `AzureFsError` subclasses to HTTP status codes |
| `src/api/middleware/request-logger.middleware.ts` | Request/response logging middleware using existing `Logger` |
| `src/api/middleware/timeout.middleware.ts` | Per-request timeout enforcement (from `api.requestTimeoutMs`) |
| `src/api/routes/health.routes.ts` | `GET /api/health` (liveness) and `GET /api/health/ready` (readiness with Azure Storage check) |
| `src/api/routes/index.ts` | Route registration barrel |

#### Files to Modify

| File | Change |
|------|--------|
| `package.json` | Add production deps (`express@5`, `cors`, `@types/express@5`, `@types/cors`); add `api` and `api:start` scripts |
| `tsconfig.json` | Ensure `src/api/**` is included in compilation |

#### npm Dependencies to Add

| Package | Version | Type | Purpose |
|---------|---------|------|---------|
| `express` | `^5.0.0` | production | HTTP framework |
| `cors` | `^2.8.5` | production | CORS middleware |
| `@types/express` | `^5.0.0` | dev | TypeScript types for Express 5 |
| `@types/cors` | `^2.8.17` | dev | TypeScript types for cors |

#### Error-to-HTTP Status Code Mapping

| Error Class | Error Code Pattern | HTTP Status |
|---|---|---|
| `ConfigError` | `CONFIG_*` | 500 Internal Server Error |
| `AuthError` | `AUTH_ACCESS_DENIED` | 403 Forbidden |
| `AuthError` | `AUTH_MISSING_*` | 500 Internal Server Error |
| `AuthError` | `AUTH_CONNECTION_FAILED` | 502 Bad Gateway |
| `BlobNotFoundError` | `BLOB_NOT_FOUND` | 404 Not Found |
| `BlobNotFoundError` | `BLOB_CONTAINER_NOT_FOUND` | 500 Internal Server Error |
| `PathError` | `PATH_INVALID`, `PATH_EMPTY` | 400 Bad Request |
| `PathError` | `PATH_TOO_LONG` | 400 Bad Request |
| `PathError` | `PATH_LOCAL_FILE_NOT_FOUND` | 400 Bad Request |
| `MetadataError` | `META_*` | 400 Bad Request |
| `ConcurrentModificationError` | `BLOB_PRECONDITION_FAILED` | 412 Precondition Failed |
| `MulterError` | (any) | 400 Bad Request |
| Unknown errors | - | 500 Internal Server Error (details hidden) |

#### Graceful Shutdown

The `startServer()` function registers handlers for `SIGTERM` and `SIGINT`:
1. Stop accepting new connections (`server.close()`)
2. Wait for in-flight requests (10 second timeout)
3. Exit the process

#### Port Conflict Detection

The `server.on('error')` handler detects `EADDRINUSE` and exits with a clear error message and exit code 1.

#### npm Scripts to Add

```json
{
  "api": "ts-node src/api/server.ts",
  "api:start": "node dist/api/server.js"
}
```

#### Acceptance Criteria

- [ ] `npm run api` starts Express server on configured port/host
- [ ] `GET /api/health` returns `{ status: "ok", timestamp, uptime }`
- [ ] `GET /api/health/ready` verifies Azure Storage connectivity via `containerClient.exists()`
- [ ] CORS middleware rejects requests from non-configured origins
- [ ] Unknown routes return 404 with structured JSON error
- [ ] `AzureFsError` subclasses are mapped to correct HTTP status codes
- [ ] Non-AzureFsError exceptions return 500 with generic message (no internal details)
- [ ] Server shuts down gracefully on SIGTERM/SIGINT
- [ ] Port-in-use produces a clear error message
- [ ] Request logging records method, URL, status code, and duration (no body content)
- [ ] Request timeout middleware aborts long-running requests

---

### Phase 3: File Operation Routes

**Goal**: All file CRUD operations exposed as REST endpoints.

**Dependencies**: Phase 2 (Express scaffold), Phase 1 (config)

#### Files to Create

| File | Purpose |
|------|---------|
| `src/api/routes/file.routes.ts` | File operation route definitions with swagger-jsdoc annotations |
| `src/api/controllers/file.controller.ts` | Thin controller functions calling `BlobFileSystemService` |
| `src/api/middleware/upload.middleware.ts` | Multer configuration for file uploads |

#### Files to Modify

| File | Change |
|------|--------|
| `src/api/routes/index.ts` | Register file routes |
| `package.json` | Add `multer` + `@types/multer` dependencies |

#### npm Dependencies to Add

| Package | Version | Type | Purpose |
|---------|---------|------|---------|
| `multer` | `^1.4.5-lts.1` | production | Multipart file upload handling |
| `@types/multer` | `^1.4.12` | dev | TypeScript types for multer |

#### API Route Definitions

| Method | Path | Service Method | Description |
|--------|------|----------------|-------------|
| `POST` | `/api/v1/files` | `BlobFileSystemService.uploadFile()` | Upload a new file (multipart form: `file` + `remotePath` + optional `metadata` JSON) |
| `GET` | `/api/v1/files/:path(*)` | `BlobFileSystemService.downloadFile()` | Download a file; returns file content with appropriate Content-Type |
| `DELETE` | `/api/v1/files/:path(*)` | `BlobFileSystemService.deleteFile()` | Delete a file; optional `If-Match` header |
| `PUT` | `/api/v1/files/:path(*)` | `BlobFileSystemService.replaceFile()` | Replace file content (multipart form); **requires `If-Match` header** |
| `GET` | `/api/v1/files/:path(*)/info` | `BlobFileSystemService.getFileInfo()` | Get file properties, metadata, and tags |
| `HEAD` | `/api/v1/files/:path(*)` | `BlobFileSystemService.fileExists()` | Check if file exists (200 if exists, 404 if not) |

#### Upload Handling (Multer)

- Storage: `multer.memoryStorage()` for files up to the configured `api.uploadMaxSizeMb`
- Field name: `file` (single file)
- Additional form fields: `remotePath` (required string), `metadata` (optional JSON string)
- The controller extracts `req.file.buffer` and passes it to `BlobFileSystemService.uploadFile(remotePath, buffer, metadata)`
- File size limit enforced by multer's `limits.fileSize` (derived from `api.uploadMaxSizeMb`)

#### ETag Handling

- **All GET responses**: Include `ETag` header from Azure blob ETag
- **PUT (replace)**: `If-Match` header **required** -- return 428 Precondition Required if missing
- **DELETE**: `If-Match` header **optional** -- honor if present, skip if absent
- **POST (upload)**: `If-Match` not applicable (new resource)
- **Download (GET)**: Support `If-None-Match` header -- return 304 Not Modified if ETag matches

#### Response Format

All responses use the existing `CommandResult<T>` structure:

```json
{
  "success": true,
  "data": { ... },
  "metadata": {
    "command": "api:upload",
    "timestamp": "2026-02-23T10:00:00Z",
    "durationMs": 234
  }
}
```

For file downloads, the response is the raw file content with appropriate `Content-Type`, `Content-Length`, and `ETag` headers (not wrapped in `CommandResult`).

#### Acceptance Criteria

- [ ] `POST /api/v1/files` accepts multipart upload and creates blob
- [ ] `GET /api/v1/files/docs/readme.txt` returns file content with correct Content-Type
- [ ] `DELETE /api/v1/files/docs/readme.txt` deletes the blob
- [ ] `PUT /api/v1/files/docs/readme.txt` replaces the blob (requires `If-Match`)
- [ ] `PUT` without `If-Match` returns 428 Precondition Required
- [ ] `PUT` with stale `If-Match` returns 412 Precondition Failed
- [ ] `GET /api/v1/files/docs/readme.txt/info` returns file properties and metadata
- [ ] `HEAD /api/v1/files/docs/readme.txt` returns 200 with ETag or 404
- [ ] Upload rejects files exceeding `api.uploadMaxSizeMb`
- [ ] ETag header present on all success responses
- [ ] `If-None-Match` on GET returns 304 when ETag matches
- [ ] All error responses use structured JSON format

---

### Phase 4: Folder Operation Routes

**Goal**: Folder listing, creation, deletion, and existence checks.

**Dependencies**: Phase 2 (Express scaffold)

#### Files to Create

| File | Purpose |
|------|---------|
| `src/api/routes/folder.routes.ts` | Folder operation route definitions |
| `src/api/controllers/folder.controller.ts` | Controller functions calling `BlobFileSystemService` folder methods |

#### Files to Modify

| File | Change |
|------|--------|
| `src/api/routes/index.ts` | Register folder routes |

#### API Route Definitions

| Method | Path | Service Method | Description |
|--------|------|----------------|-------------|
| `GET` | `/api/v1/folders/:path(*)` | `BlobFileSystemService.listFolder()` | List folder contents; `?recursive=true` for recursive listing |
| `POST` | `/api/v1/folders/:path(*)` | `BlobFileSystemService.createFolder()` | Create a virtual folder |
| `DELETE` | `/api/v1/folders/:path(*)` | `BlobFileSystemService.deleteFolder()` | Delete folder and all contents recursively |
| `HEAD` | `/api/v1/folders/:path(*)` | `BlobFileSystemService.folderExists()` | Check if folder exists (200 or 404) |

#### Acceptance Criteria

- [ ] `GET /api/v1/folders/docs/` returns list of files and subfolders
- [ ] `GET /api/v1/folders/docs/?recursive=true` returns flat recursive listing
- [ ] `GET /api/v1/folders/` (root) lists top-level items
- [ ] `POST /api/v1/folders/new-folder/` creates a virtual folder marker
- [ ] `DELETE /api/v1/folders/old-data/` deletes all blobs under the prefix
- [ ] `HEAD /api/v1/folders/docs/` returns 200 if folder exists, 404 if not
- [ ] Path normalization works correctly (trailing slashes, leading slashes)

---

### Phase 5: Edit Operation Routes (Patch, Append)

**Goal**: Expose text patching and content appending over HTTP.

**Dependencies**: Phase 3 (file routes, for ETag patterns)

#### Files to Create

| File | Purpose |
|------|---------|
| `src/api/routes/edit.routes.ts` | Edit operation route definitions |
| `src/api/controllers/edit.controller.ts` | Controller functions for patch and append |

#### Files to Modify

| File | Change |
|------|--------|
| `src/api/routes/index.ts` | Register edit routes |

#### API Route Definitions

| Method | Path | Service Method | Description |
|--------|------|----------------|-------------|
| `PATCH` | `/api/v1/files/:path(*)/patch` | `BlobFileSystemService.patchFile()` | Apply find-replace patches; **requires `If-Match`** |
| `PATCH` | `/api/v1/files/:path(*)/append` | `BlobFileSystemService.appendToFile()` | Append/prepend content; **requires `If-Match`** |
| `POST` | `/api/v1/files/:path(*)/edit` | `BlobFileSystemService.editFile()` | Download for editing (returns temp info + ETag) |
| `PUT` | `/api/v1/files/:path(*)/edit` | `BlobFileSystemService.editFileUpload()` | Re-upload edited file; **requires `If-Match`** |

#### Request Body Formats

**PATCH .../patch**:
```json
{
  "patches": [
    { "find": "old text", "replace": "new text", "isRegex": false },
    { "find": "v1\\.\\d+", "replace": "v2.0", "isRegex": true, "flags": "g" }
  ]
}
```

**PATCH .../append**:
```json
{
  "content": "New line to add\n",
  "position": "end"
}
```

**PUT .../edit** (multipart form):
- Field `file`: the edited file content
- The `If-Match` header carries the ETag from the original `POST .../edit` response

#### Acceptance Criteria

- [ ] `PATCH /api/v1/files/docs/readme.txt/patch` applies find-replace with ETag enforcement
- [ ] `PATCH /api/v1/files/docs/readme.txt/append` appends/prepends content with ETag enforcement
- [ ] `POST /api/v1/files/docs/readme.txt/edit` returns temp file info and ETag
- [ ] `PUT /api/v1/files/docs/readme.txt/edit` re-uploads with ETag concurrency check
- [ ] Missing `If-Match` on PATCH and PUT returns 428
- [ ] Stale `If-Match` returns 412

---

### Phase 6: Metadata & Tag Operation Routes

**Goal**: Expose metadata and tag CRUD plus tag querying.

**Dependencies**: Phase 2 (Express scaffold)

#### Files to Create

| File | Purpose |
|------|---------|
| `src/api/routes/meta.routes.ts` | Metadata route definitions |
| `src/api/routes/tags.routes.ts` | Tag route definitions |
| `src/api/controllers/meta.controller.ts` | Controller functions calling `MetadataService` metadata methods |
| `src/api/controllers/tags.controller.ts` | Controller functions calling `MetadataService` tag methods |

#### Files to Modify

| File | Change |
|------|--------|
| `src/api/routes/index.ts` | Register meta and tags routes |

#### API Route Definitions -- Metadata

| Method | Path | Service Method | Description |
|--------|------|----------------|-------------|
| `GET` | `/api/v1/meta/:path(*)` | `MetadataService.getMetadata()` | Get all metadata for a blob |
| `PUT` | `/api/v1/meta/:path(*)` | `MetadataService.setMetadata()` | Set (replace all) metadata |
| `PATCH` | `/api/v1/meta/:path(*)` | `MetadataService.updateMetadata()` | Merge metadata |
| `DELETE` | `/api/v1/meta/:path(*)` | `MetadataService.deleteMetadata()` | Delete specific metadata keys |

**PUT /api/v1/meta/:path** request body:
```json
{ "metadata": { "author": "john", "version": "2.0" } }
```

**PATCH /api/v1/meta/:path** request body:
```json
{ "metadata": { "version": "3.0" } }
```

**DELETE /api/v1/meta/:path** request body:
```json
{ "keys": ["version", "draft"] }
```

#### API Route Definitions -- Tags

| Method | Path | Service Method | Description |
|--------|------|----------------|-------------|
| `GET` | `/api/v1/tags/:path(*)` | `MetadataService.getTags()` | Get all tags for a blob |
| `PUT` | `/api/v1/tags/:path(*)` | `MetadataService.setTags()` | Set (replace all) tags |
| `GET` | `/api/v1/tags` | `MetadataService.queryByTags()` | Query blobs by tag filter (`?filter=...`) |

**PUT /api/v1/tags/:path** request body:
```json
{ "tags": { "env": "prod", "status": "active" } }
```

**GET /api/v1/tags?filter=** query parameter:
```
GET /api/v1/tags?filter=env%20%3D%20'prod'%20AND%20status%20%3D%20'active'
```

#### Acceptance Criteria

- [ ] `GET /api/v1/meta/docs/readme.txt` returns blob metadata
- [ ] `PUT /api/v1/meta/docs/readme.txt` replaces all metadata
- [ ] `PATCH /api/v1/meta/docs/readme.txt` merges partial metadata
- [ ] `DELETE /api/v1/meta/docs/readme.txt` removes specified keys
- [ ] Metadata validation errors (invalid key, size exceeded) return 400
- [ ] `GET /api/v1/tags/docs/readme.txt` returns blob tags
- [ ] `PUT /api/v1/tags/docs/readme.txt` replaces all tags
- [ ] `GET /api/v1/tags?filter=env='prod'` returns matching blobs
- [ ] Tag validation errors (max 10 tags, key/value length) return 400

---

### Phase 7: Swagger/OpenAPI Documentation

**Goal**: Interactive API documentation via Swagger UI at `/api/docs`.

**Dependencies**: Phases 3-6 (all routes must be defined to document them)

#### Files to Create

| File | Purpose |
|------|---------|
| `src/api/swagger/config.ts` | swagger-jsdoc configuration (OpenAPI 3.0 definition, API info, server URLs, apis glob) |
| `src/api/swagger/schemas.ts` | Reusable OpenAPI component schemas (`CommandResult`, `ErrorResponse`, `FileInfo`, `ListFolderResult`, etc.) |

#### Files to Modify

| File | Change |
|------|--------|
| `src/api/server.ts` | Conditionally mount swagger-ui-express at `/api/docs` when `api.swaggerEnabled` is true; serve OpenAPI JSON at `/api/docs.json` |
| `src/api/routes/file.routes.ts` | Add `@openapi` JSDoc annotations to all route handlers |
| `src/api/routes/folder.routes.ts` | Add `@openapi` JSDoc annotations |
| `src/api/routes/edit.routes.ts` | Add `@openapi` JSDoc annotations |
| `src/api/routes/meta.routes.ts` | Add `@openapi` JSDoc annotations |
| `src/api/routes/tags.routes.ts` | Add `@openapi` JSDoc annotations |
| `src/api/routes/health.routes.ts` | Add `@openapi` JSDoc annotations |
| `package.json` | Add `swagger-jsdoc` + `swagger-ui-express` + types |

#### npm Dependencies to Add

| Package | Version | Type | Purpose |
|---------|---------|------|---------|
| `swagger-jsdoc` | `^6.2.8` | production | Parse JSDoc annotations into OpenAPI spec |
| `swagger-ui-express` | `^5.0.1` | production | Serve interactive Swagger UI |
| `@types/swagger-jsdoc` | `^6.0.4` | dev | TypeScript types |
| `@types/swagger-ui-express` | `^4.1.7` | dev | TypeScript types |

#### Swagger Configuration

```typescript
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Azure FS REST API',
      version: '1.0.0',
      description: 'REST API for Azure Blob Storage virtual file system operations',
    },
    servers: [{ url: '/api/v1', description: 'API v1' }],
  },
  apis: ['./src/api/routes/**/*.ts'],
};
```

#### Acceptance Criteria

- [ ] `GET /api/docs` serves Swagger UI when `api.swaggerEnabled` is true
- [ ] `GET /api/docs` returns 404 when `api.swaggerEnabled` is false
- [ ] `GET /api/docs.json` returns the raw OpenAPI 3.0 JSON specification
- [ ] All routes are documented with request/response schemas
- [ ] Component schemas are defined once and referenced via `$ref`
- [ ] Try-it-out functionality works for all endpoints

---

### Phase 8: Integration Testing & Documentation

**Goal**: End-to-end test scripts and documentation updates.

**Dependencies**: All previous phases

#### Files to Create

| File | Purpose |
|------|---------|
| `test_scripts/test-api-integration.ts` | Integration test script exercising all API endpoints |
| `test_scripts/test-api-config.ts` | Test script for API config loading/validation |

#### Files to Modify

| File | Change |
|------|--------|
| `CLAUDE.md` | Add `azure-fs-api` tool documentation with start command, all endpoints, and examples |
| `docs/design/project-design.md` | Update architecture diagram to show dual CLI/API entry points; add API module relationships |
| `docs/design/project-functions.md` | Already updated in this plan step (see Section 4 below) |
| `docs/design/configuration-guide.md` | Add all six API config parameters with descriptions (if guide exists) |
| `.azure-fs.json.example` | Add `api` section example |
| `.env.example` | Add `AZURE_FS_API_*` environment variables |
| `Issues - Pending Items.md` | Review and update pending items related to REST API |

#### Acceptance Criteria

- [ ] `test_scripts/test-api-integration.ts` covers: health check, file upload/download/delete/replace/info/exists, folder create/list/delete/exists, patch, append, metadata CRUD, tags CRUD/query
- [ ] `test_scripts/test-api-config.ts` covers: missing API config, invalid values, all env vars, config file merging
- [ ] `CLAUDE.md` documents `azure-fs-api` tool with command, parameters, and examples
- [ ] `.azure-fs.json.example` includes `api` section
- [ ] `.env.example` includes all `AZURE_FS_API_*` variables
- [ ] All tests pass against a live Azure Storage account

---

## 3. Complete File Inventory

### New Files (19 files)

```
src/
  types/
    api-config.types.ts              - API configuration type definitions
  api/
    server.ts                        - Express app factory, startup, graceful shutdown
    routes/
      index.ts                       - Route registration barrel
      health.routes.ts               - Health check endpoints
      file.routes.ts                 - File CRUD routes
      folder.routes.ts               - Folder operation routes
      edit.routes.ts                 - Edit/patch/append routes
      meta.routes.ts                 - Metadata routes
      tags.routes.ts                 - Tag routes
    controllers/
      file.controller.ts             - File operation controllers
      folder.controller.ts           - Folder operation controllers
      edit.controller.ts             - Edit operation controllers
      meta.controller.ts             - Metadata controllers
      tags.controller.ts             - Tag controllers
    middleware/
      error-handler.middleware.ts     - Centralized error-to-HTTP mapping
      request-logger.middleware.ts    - HTTP request/response logging
      timeout.middleware.ts           - Request timeout enforcement
      upload.middleware.ts            - Multer configuration for file uploads
    swagger/
      config.ts                      - swagger-jsdoc options
      schemas.ts                     - Reusable OpenAPI component schemas
test_scripts/
  test-api-integration.ts            - API integration tests
  test-api-config.ts                 - API config tests
```

### Modified Files (10 files)

```
src/types/config.types.ts            - Add api section
src/types/index.ts                   - Re-export API types
src/config/config.loader.ts          - Add API env var loading + loadApiConfig()
src/config/config.schema.ts          - Add validateApiConfig()
package.json                         - Add dependencies and scripts
tsconfig.json                        - Include api directory
CLAUDE.md                            - Document azure-fs-api tool
docs/design/project-design.md        - Update architecture
docs/design/project-functions.md     - Add REST API functional requirements
.azure-fs.json.example               - Add api section
.env.example                         - Add AZURE_FS_API_* variables
```

---

## 4. Complete API Route Table

| # | Method | Path | Service | ETag Required | Description |
|---|--------|------|---------|---------------|-------------|
| 1 | `GET` | `/api/health` | (inline) | No | Liveness check |
| 2 | `GET` | `/api/health/ready` | `validateConnection()` | No | Readiness check (verifies Azure Storage) |
| 3 | `POST` | `/api/v1/files` | `uploadFile()` | No | Upload new file (multipart) |
| 4 | `GET` | `/api/v1/files/:path(*)` | `downloadFile()` | No (supports If-None-Match) | Download file content |
| 5 | `DELETE` | `/api/v1/files/:path(*)` | `deleteFile()` | Optional | Delete file |
| 6 | `PUT` | `/api/v1/files/:path(*)` | `replaceFile()` | **Required** | Replace file content (multipart) |
| 7 | `GET` | `/api/v1/files/:path(*)/info` | `getFileInfo()` | No | Get file properties and metadata |
| 8 | `HEAD` | `/api/v1/files/:path(*)` | `fileExists()` | No | Check file existence |
| 9 | `GET` | `/api/v1/folders/:path(*)` | `listFolder()` | No | List folder contents |
| 10 | `POST` | `/api/v1/folders/:path(*)` | `createFolder()` | No | Create virtual folder |
| 11 | `DELETE` | `/api/v1/folders/:path(*)` | `deleteFolder()` | No | Delete folder recursively |
| 12 | `HEAD` | `/api/v1/folders/:path(*)` | `folderExists()` | No | Check folder existence |
| 13 | `PATCH` | `/api/v1/files/:path(*)/patch` | `patchFile()` | **Required** | Apply find-replace patches |
| 14 | `PATCH` | `/api/v1/files/:path(*)/append` | `appendToFile()` | **Required** | Append/prepend content |
| 15 | `POST` | `/api/v1/files/:path(*)/edit` | `editFile()` | No | Download for editing (phase 1) |
| 16 | `PUT` | `/api/v1/files/:path(*)/edit` | `editFileUpload()` | **Required** | Re-upload edited file (phase 2) |
| 17 | `GET` | `/api/v1/meta/:path(*)` | `getMetadata()` | No | Get blob metadata |
| 18 | `PUT` | `/api/v1/meta/:path(*)` | `setMetadata()` | No | Set (replace) metadata |
| 19 | `PATCH` | `/api/v1/meta/:path(*)` | `updateMetadata()` | No | Merge metadata |
| 20 | `DELETE` | `/api/v1/meta/:path(*)` | `deleteMetadata()` | No | Delete metadata keys |
| 21 | `GET` | `/api/v1/tags/:path(*)` | `getTags()` | No | Get blob tags |
| 22 | `PUT` | `/api/v1/tags/:path(*)` | `setTags()` | No | Set (replace) tags |
| 23 | `GET` | `/api/v1/tags` | `queryByTags()` | No | Query blobs by tag filter |
| 24 | `GET` | `/api/docs` | swagger-ui-express | No | Swagger UI (when enabled) |
| 25 | `GET` | `/api/docs.json` | swagger-jsdoc | No | OpenAPI JSON spec |

---

## 5. npm Dependency Summary

### Production Dependencies

| Package | Purpose |
|---------|---------|
| `express@^5.0.0` | HTTP framework (Express 5 with async error handling) |
| `cors@^2.8.5` | CORS middleware |
| `multer@^1.4.5-lts.1` | Multipart file upload handling |
| `swagger-jsdoc@^6.2.8` | OpenAPI spec generation from JSDoc annotations |
| `swagger-ui-express@^5.0.1` | Serve interactive Swagger UI |

### Dev Dependencies

| Package | Purpose |
|---------|---------|
| `@types/express@^5.0.0` | TypeScript types for Express 5 |
| `@types/cors@^2.8.17` | TypeScript types for cors |
| `@types/multer@^1.4.12` | TypeScript types for multer |
| `@types/swagger-jsdoc@^6.0.4` | TypeScript types for swagger-jsdoc |
| `@types/swagger-ui-express@^4.1.7` | TypeScript types for swagger-ui-express |

---

## 6. Architecture Diagram (Updated)

```
                    ┌─────────────────────┐   ┌─────────────────────┐
                    │  CLI Entry Point     │   │  API Entry Point     │
                    │  (Commander.js)      │   │  (Express 5)         │
                    │  src/index.ts        │   │  src/api/server.ts   │
                    └────────┬────────────┘   └────────┬────────────┘
                             │                          │
                    ┌────────┴────────────┐   ┌────────┴────────────┐
                    │  CLI Commands        │   │  API Controllers     │
                    │  (parse argv,        │   │  (parse req,         │
                    │   call services,     │   │   call services,     │
                    │   format output)     │   │   format response)   │
                    └────────┬────────────┘   └────────┬────────────┘
                             │                          │
                             └──────────┬───────────────┘
                                        │
                    ┌───────────────────────────────────────────┐
                    │          Shared Service Layer              │
                    │                                           │
                    │  BlobFileSystemService                    │
                    │  MetadataService                          │
                    │  AuthService                              │
                    │  PathService                              │
                    │  ConfigLoader (extended with API section) │
                    └───────────────────┬───────────────────────┘
                                        │
                    ┌───────────────────────────────────────────┐
                    │          Cross-Cutting Concerns            │
                    │                                           │
                    │  RetryUtil  Logger  Validators  Stream    │
                    └───────────────────┬───────────────────────┘
                                        │
                    ┌───────────────────────────────────────────┐
                    │          Azure SDK Layer                   │
                    │                                           │
                    │  @azure/storage-blob  @azure/identity     │
                    └───────────────────────────────────────────┘
```

---

## 7. Phase Dependency Graph

```
Phase 1 (Config Extension)
    │
    └──> Phase 2 (Express Scaffold + Health)
              │
              ├──> Phase 3 (File Routes)
              │         │
              │         └──> Phase 5 (Edit Routes)
              │
              ├──> Phase 4 (Folder Routes)
              │
              └──> Phase 6 (Metadata & Tag Routes)
                          │
                          └──> Phase 7 (Swagger Docs)
                                    │
                                    └──> Phase 8 (Testing & Documentation)
```

Phases 3, 4, and 6 can be worked on in parallel once Phase 2 is complete. Phase 5 depends on Phase 3 for the ETag middleware patterns. Phase 7 requires all route files to exist. Phase 8 is the final integration step.

---

## 8. Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Express 5 `@types/express` may have gaps | Low | Pin specific version; test with actual types before coding routes |
| Multer memory storage exhaustion on large uploads | Medium | Enforce `api.uploadMaxSizeMb` via multer `limits.fileSize`; return 413 for oversized files |
| Express 5 wildcard route syntax for blob paths with `/` | Medium | Use `/:path(*)` named wildcard parameter (Express 5 path-to-regexp v8 syntax); test with deeply nested paths |
| Swagger annotations drifting from code | Low | Include OpenAPI spec validation in test suite |
| CORS misconfiguration in production | Medium | Require explicit `api.corsOrigins` (no wildcards); validate origins are URLs |
| Concurrent edit operations via API | Low | Already handled by ETag-based concurrency in service layer |

---

## 9. Express 5 Route Syntax Notes

Express 5 uses path-to-regexp v8. Key patterns for this project:

- **Blob path wildcard**: `/:path(*)` captures everything after the prefix including slashes. `req.params.path` returns an array of segments that must be joined with `/`.
- **No bare `*`**: Express 5 requires named wildcards. `*` alone is invalid; use `{*splat}` or the named form `/:path(*)`.
- **Query params**: `req.query` is read-only in Express 5. Use it directly; do not attempt to modify.
- **Async handlers**: Express 5 auto-catches rejected promises. No `try/catch` needed in controllers; errors propagate to the centralized error middleware automatically.

---

## 10. Notes on Service Layer Compatibility

The existing service layer is fully compatible with the API layer. Key observations:

1. **`BlobFileSystemService.uploadFile()`** already accepts `Buffer` as the `source` parameter -- this maps directly to `req.file.buffer` from multer.
2. **`BlobFileSystemService.downloadFile()`** without `localPath` returns content as a string -- for the API, we will use the `localPath` variant to stream responses, or directly stream from Azure SDK for large files.
3. **All service methods** accept plain TypeScript arguments (strings, objects) and return typed result objects. Controllers extract parameters from `req` and pass them to services; they never pass `req` or `res` to services.
4. **Error classes** already have `toJSON()` and `statusCode` fields. The error middleware leverages these directly.
5. **The `edit` workflow** (two-phase) maps naturally to `POST` (download for editing) + `PUT` (re-upload with ETag).
