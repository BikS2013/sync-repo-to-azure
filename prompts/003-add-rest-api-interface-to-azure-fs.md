# 003 - Add REST API Interface to azure-fs CLI Tool

## Objective

Add a REST API layer to the existing azure-fs CLI tool, exposing the already-implemented Azure Blob Storage file system operations as HTTP endpoints. The API must be built following the **create-api-base** skill patterns (Express.js 5.x, Swagger/OpenAPI, health checks, CORS, strict validation, port conflict detection). The API must **reuse** the existing service classes -- no duplication of blob logic.

---

## Phase 1: Research and Analysis

### 1.1 Inventory Existing Services

Before writing any code, produce a mapping of every public method on the existing service classes to its future REST endpoint. The services to examine are:

- **BlobFileSystemService** (`src/services/blob-filesystem.service.ts`): Core file operations -- upload, download, delete, replace, getFileInfo, exists, listFolder, createFolder, deleteFolder, editDownload, editUpload, patch, append, uploadDirectory.
- **MetadataService** (`src/services/metadata.service.ts`): Metadata CRUD and blob index tag operations -- setMetadata, getMetadata, updateMetadata, deleteMetadataKeys, setTags, getTags, queryTags.
- **AuthService** (`src/services/auth.service.ts`): Factory function `createContainerClient` -- used internally by the services above; does NOT need its own endpoint.
- **ConfigService** (`src/config/config.loader.ts` + `src/config/config.schema.ts`): Layered config loading and validation.

Document for each service method:
- HTTP verb and route
- Request parameters (path params, query params, request body, multipart)
- Response shape (must conform to `CommandResult<T>`)
- Error codes and HTTP status mappings

### 1.2 Study the create-api-base Skill Patterns

Use the **create-api-base** skill to understand the required patterns. The API must comply with:

- **Express.js 5.x** (not 4.x) -- use the `express@5` package and its native async error handling
- **Swagger/OpenAPI 3.0** documentation served at `/api-docs`
- **Health check** endpoint at `GET /health` that returns service status including Azure Storage connectivity
- **CORS** configuration via environment variables
- **Strict input validation** (e.g., via express-validator, zod, or joi) -- every endpoint must validate its inputs
- **Port conflict detection** -- if the configured port is in use, the server must fail with a clear error, NOT silently pick another port
- **Graceful shutdown** on SIGTERM/SIGINT
- **Request ID** middleware for traceability
- **Structured JSON error responses** for all error cases

### 1.3 Configuration Integration

The API must extend the existing azure-fs configuration system. Research how to:

- Add API-specific environment variables alongside the existing `AZURE_*` env vars
- Validate all API config at startup (no fallback/default values for required settings -- this is a strict project rule)
- Load the existing azure-fs config (`ResolvedConfig`) to construct the service instances

New required environment variables to define:

| Variable | Purpose |
|----------|---------|
| `AZURE_FS_API_PORT` | TCP port the server listens on (required, no default) |
| `AZURE_FS_API_HOST` | Bind address (required, no default; e.g., `0.0.0.0` or `127.0.0.1`) |
| `AZURE_FS_API_CORS_ORIGINS` | Comma-separated list of allowed CORS origins (required, no default) |
| `AZURE_FS_API_REQUEST_BODY_LIMIT` | Max request body size (required, no default; e.g., `50mb`) |
| `AZURE_FS_API_LOG_REQUESTS` | Whether to log incoming HTTP requests: `true` or `false` (required) |

If any required env var is missing, the server must throw a `ConfigError` with clear instructions (matching the pattern in `config.schema.ts`).

---

## Phase 2: API Implementation Plan

Create a plan document at `docs/design/plan-003-rest-api-layer.md` covering:

### 2.1 New Files and Directory Structure

Propose the following structure under `src/api/`:

```
src/api/
  server.ts                  - Express app creation, middleware setup, graceful shutdown
  server.start.ts            - Entry point: config loading, port conflict check, server.listen()
  config/
    api-config.schema.ts     - Validation for API-specific env vars (no defaults)
    api-config.types.ts      - ApiConfig type definition
  middleware/
    error-handler.ts         - Global error handler mapping AzureFsError subtypes to HTTP codes
    request-id.ts            - Attach unique request ID to each request
    cors.ts                  - CORS configuration from env vars
    validation.ts            - Shared validation middleware factory
  routes/
    index.ts                 - Route registration barrel
    health.routes.ts         - GET /health (shallow + deep with Azure connectivity check)
    file.routes.ts           - File operations (upload, download, delete, replace, info, exists)
    folder.routes.ts         - Folder operations (ls, mkdir, rmdir)
    edit.routes.ts           - Edit operations (edit, patch, append)
    meta.routes.ts           - Metadata operations (set, get, update, delete)
    tags.routes.ts           - Tag operations (set, get, query)
  swagger/
    swagger.ts               - OpenAPI spec generation and swagger-ui-express setup
```

### 2.2 Route Design

Design every endpoint. The routes must mirror the CLI commands:

#### Health

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/health` | Shallow health check (server up) |
| GET | `/health/deep` | Deep health check: verifies Azure Storage container is reachable |

#### File Operations

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/v1/files/upload` | Upload a file (multipart/form-data with `file` field and `remotePath` field) |
| GET | `/api/v1/files/download` | Download a file (query param: `remotePath`; returns blob content or JSON) |
| DELETE | `/api/v1/files/:remotePath(*)` | Delete a single blob |
| PUT | `/api/v1/files/replace` | Replace an existing blob (multipart/form-data) |
| GET | `/api/v1/files/info/:remotePath(*)` | Get blob properties, metadata, and tags |
| GET | `/api/v1/files/exists/:remotePath(*)` | Check if file/folder exists (query param: `type`) |

#### Folder Operations

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/v1/folders/ls/:folderPath(*)` | List folder contents (query param: `recursive`) |
| POST | `/api/v1/folders/mkdir` | Create virtual folder (body: `{ path }`) |
| DELETE | `/api/v1/folders/rmdir/:folderPath(*)` | Delete folder recursively |

#### Edit Operations

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/v1/edit/download` | Phase 1: download blob for editing (body: `{ remotePath }`) |
| POST | `/api/v1/edit/upload` | Phase 2: re-upload edited content (multipart, requires `etag`) |
| POST | `/api/v1/edit/patch` | Apply find-replace patch (body: `{ remotePath, find, replace, regex?, flags? }`) |
| POST | `/api/v1/edit/append` | Append/prepend content (body: `{ remotePath, content, position? }`) |

#### Metadata Operations

| Method | Route | Description |
|--------|-------|-------------|
| PUT | `/api/v1/meta/:remotePath(*)` | Set (replace all) metadata (body: `{ metadata }`) |
| GET | `/api/v1/meta/:remotePath(*)` | Get all metadata |
| PATCH | `/api/v1/meta/:remotePath(*)` | Merge metadata (body: `{ metadata }`) |
| DELETE | `/api/v1/meta/:remotePath(*)` | Delete metadata keys (body: `{ keys }`) |

#### Tag Operations

| Method | Route | Description |
|--------|-------|-------------|
| PUT | `/api/v1/tags/:remotePath(*)` | Set (replace all) tags (body: `{ tags }`) |
| GET | `/api/v1/tags/:remotePath(*)` | Get all tags |
| GET | `/api/v1/tags/query` | Query blobs by tag filter (query param: `filter`) |

### 2.3 Error Handling Strategy

Map existing error classes to HTTP status codes:

| Error Class | HTTP Status |
|-------------|-------------|
| `ConfigError` | 500 (server misconfiguration) |
| `AuthError` | 401 / 403 |
| `BlobNotFoundError` | 404 |
| `PathError` | 400 |
| `MetadataError` | 400 |
| `ConcurrentModificationError` | 409 |
| Validation errors | 422 |
| Unknown errors | 500 |

All error responses must use the `CommandResult` shape:

```json
{
  "success": false,
  "error": {
    "code": "BLOB_NOT_FOUND",
    "message": "The blob 'documents/missing.pdf' does not exist.",
    "details": null
  },
  "metadata": {
    "command": "GET /api/v1/files/info/documents/missing.pdf",
    "timestamp": "2026-02-23T10:00:00.000Z",
    "durationMs": 45
  }
}
```

### 2.4 Service Lifecycle

Describe how the services are created and shared:

1. At startup, load `ResolvedConfig` using the existing `loadConfig()` + `validateConfig()`.
2. Create a single `Logger` instance.
3. Create a single `BlobFileSystemService` instance and a single `MetadataService` instance.
4. Pass these instances to the route handlers via Express `app.locals` or a dependency injection pattern.
5. The services are stateless beyond their `ContainerClient`, so a single instance per service is safe for concurrent HTTP requests.

### 2.5 New npm Script

Add an `npm run api` script to `package.json` that starts the REST API server:

```json
{
  "scripts": {
    "api": "ts-node src/api/server.start.ts",
    "api:build": "npm run build",
    "api:start": "node dist/api/server.start.js"
  }
}
```

---

## Phase 3: Implementation

### 3.1 Install Dependencies

The following packages are needed:

- `express@5` -- Express.js 5.x
- `@types/express` -- TypeScript types
- `swagger-ui-express` -- Serve Swagger UI
- `swagger-jsdoc` -- Generate OpenAPI spec from JSDoc annotations (or build spec programmatically)
- `@types/swagger-ui-express` -- TypeScript types
- `cors` -- CORS middleware
- `@types/cors` -- TypeScript types
- `multer` -- Multipart file upload handling
- `@types/multer` -- TypeScript types
- `uuid` -- Request ID generation (or use `crypto.randomUUID()`)
- `express-validator` or `zod` -- Input validation (choose one, document the choice)

### 3.2 Implementation Order

Implement in this order:

1. **API config types and validation** (`api-config.schema.ts`, `api-config.types.ts`)
2. **Express app factory** (`server.ts`) -- app creation, middleware stack, no routes yet
3. **Middleware** -- error handler, request ID, CORS, validation helpers
4. **Health routes** (`health.routes.ts`) -- shallow and deep checks
5. **Swagger setup** (`swagger.ts`) -- mount at `/api-docs`
6. **File routes** (`file.routes.ts`) -- upload, download, delete, replace, info, exists
7. **Folder routes** (`folder.routes.ts`) -- ls, mkdir, rmdir
8. **Edit routes** (`edit.routes.ts`) -- edit download/upload, patch, append
9. **Metadata routes** (`meta.routes.ts`) -- set, get, update, delete
10. **Tag routes** (`tags.routes.ts`) -- set, get, query
11. **Server entry point** (`server.start.ts`) -- config load, port check, listen, graceful shutdown
12. **npm scripts** -- add `api`, `api:start` to `package.json`

### 3.3 Key Implementation Rules

- **No logic duplication**: Every route handler must delegate to `BlobFileSystemService` or `MetadataService`. The route layer is responsible only for: parsing HTTP input, calling the service, and formatting the `CommandResult` response.
- **No fallback config values**: All API env vars are required. Missing values must throw `ConfigError`.
- **CommandResult wrapping**: Every successful response must return `CommandResult<T>` with `success: true`. Every error response must return `CommandResult` with `success: false`.
- **Content negotiation**: For file download, if `Accept: application/json` is set, return JSON with content. If `Accept: application/octet-stream` or not specified, stream the file bytes directly.
- **Multipart uploads**: Use `multer` for file upload endpoints. The file is received as a multipart field, the `remotePath` as a form field. Metadata key-value pairs can be passed as a JSON string in a form field.
- **ETag forwarding**: For edit and replace operations, the client must provide the ETag in the request (header `If-Match` or body field). The API must pass it through to the service for concurrency protection.
- **Swagger annotations**: Every route must have OpenAPI documentation (either via JSDoc annotations for `swagger-jsdoc` or via a programmatically built spec object).

---

## Phase 4: Test Suite

### 4.1 Test Strategy

Create tests in `test_scripts/api/` using a test framework (Jest or Vitest -- match what the project already uses, or use Vitest if no test framework is configured yet).

### 4.2 Test Categories

#### Unit Tests

- **API config validation**: Test that missing env vars throw `ConfigError`. Test that valid env vars produce a correct `ApiConfig` object.
- **Error handler middleware**: Test that each `AzureFsError` subclass maps to the correct HTTP status code and `CommandResult` shape.
- **Validation middleware**: Test that invalid inputs (missing fields, bad types) produce 422 responses.

#### Integration Tests

- **Health endpoints**: Mock the `ContainerClient.getProperties()` call. Verify `/health` returns 200. Verify `/health/deep` returns 200 when Azure is reachable and 503 when it is not.
- **File routes**: Mock `BlobFileSystemService` methods. Test each endpoint (upload, download, delete, replace, info, exists) for:
  - Successful operations (200/201)
  - Missing blob (404)
  - Validation failures (422)
  - Concurrent modification (409)
- **Folder routes**: Mock `BlobFileSystemService` folder methods. Test ls, mkdir, rmdir.
- **Edit routes**: Mock `BlobFileSystemService` edit methods. Test both phases of the edit workflow and the patch/append endpoints.
- **Metadata routes**: Mock `MetadataService` metadata methods. Test set, get, update, delete.
- **Tag routes**: Mock `MetadataService` tag methods. Test set, get, query.
- **CORS**: Test that requests from allowed origins succeed and others are rejected.

#### Port Conflict Test

- Test that starting the server on an already-occupied port produces a clear error and exits with exit code 2.

### 4.3 Test Utilities

Create shared test helpers:
- `createTestApp()` -- builds an Express app with mocked services for integration tests
- `mockBlobFileSystemService()` -- returns a Jest/Vitest mock of `BlobFileSystemService`
- `mockMetadataService()` -- returns a Jest/Vitest mock of `MetadataService`
- `assertCommandResult(response, expected)` -- validates the `CommandResult` structure in responses

---

## Phase 5: Documentation Updates

After implementation:

1. **Update CLAUDE.md** with a new tool entry `<azure-fs-api>` documenting the `npm run api` command, all endpoints, and configuration.
2. **Update `docs/design/project-design.md`** with the API layer architecture.
3. **Update `docs/design/project-functions.md`** with the new API feature description.
4. **Create `docs/design/configuration-guide.md`** (or update it) with the new API-specific environment variables, following the configuration guide conventions from the global instructions.
5. **Update `Issues - Pending Items.md`** if any issues are resolved or new ones are discovered.

---

## Constraints and Reminders

- TypeScript only -- all new code must be in TypeScript.
- No fallback/default values for any configuration parameter. This is a strict project rule.
- The API is an **additional interface** to the tool, not a replacement. The CLI must continue to work unchanged.
- The existing service classes (`BlobFileSystemService`, `MetadataService`) must NOT be modified to accommodate the API. If adaptation is needed, create adapter/wrapper functions in the API layer.
- Express.js **5.x** specifically -- not 4.x. This affects async error handling (Express 5 natively catches rejected promises from async route handlers).
- All plan documents go under `docs/design/`.
- All test scripts go under `test_scripts/`.
