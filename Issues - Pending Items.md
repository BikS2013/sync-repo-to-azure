# Issues - Pending Items

## Pending

### P1 - Root Folder Listing Fails on Azure App Service

**Detected**: 2026-02-26
**Location**: `src/api/routes/folder.routes.ts` -- `GET /api/v1/folders/*path`

**Description**: Listing the root folder (`/`) works locally and in Docker via `GET /api/v1/folders/%2F`, but fails on Azure App Service. App Service's reverse proxy (IIS/Kestrel) decodes `%2F` to `/` before the request reaches Express, collapsing the path to `/api/v1/folders/` which matches no route (the `/*path` pattern requires at least one segment). Workaround: list known top-level folders individually. Fix options: (a) add a dedicated `GET /api/v1/folders` route (no path param) that lists the container root, or (b) use double-encoding `%252F`.

---

### P2 - Swagger Priority Order Deviation from Plan (DOCUMENTED)

**Detected**: 2026-02-23 (code review of Plan 005 features)
**Location**: `src/api/swagger/config.ts` -- `getBaseUrl()`

**Description**: The plan (plan-005) specifies Azure App Service as Priority 1 and PUBLIC_URL as Priority 2 in `getBaseUrl()`. The implementation inverts this: PUBLIC_URL is Priority 1 and Azure App Service is Priority 2. The implementation is correct (PUBLIC_URL should be the explicit override), matching the plan's own acceptance criteria which states "PUBLIC_URL overrides all other container detection." The plan's code sample was inconsistent with its acceptance criteria. No code fix needed -- this is a documentation note.

---

---

## Completed

### P2 - Config Source Tracker Key Mismatch with Dev Routes (FIXED)

**Detected**: 2026-02-23 (code review of Plan 005 features)
**Fixed**: 2026-02-23
**Location**: `src/config/config.loader.ts`

**Resolution**: Added `EnvConfigResult` interface and `envVarNames` reverse-mapping to `loadEnvConfig()`. The `mergeConfigSection()` now tracks by both dot-notation keys AND env var names via the `envVarNames` field on `SourcedOverride`. Dev routes can now look up sources by env var name (e.g., `NODE_ENV`, `AZURE_FS_API_PORT`).

---

### P2 - Missing nodeEnv in AzureFsConfigFile.api Type (FIXED)

**Detected**: 2026-02-23 (code review of Plan 005 features)
**Fixed**: 2026-02-23
**Location**: `src/types/config.types.ts` -- `AzureFsConfigFile.api`

**Resolution**: The `nodeEnv?: string` field was missing from the `AzureFsConfigFile.api` optional type definition. While JSON parsing still captured the value at runtime (TypeScript types are compile-time only), this was a type safety gap. Added `nodeEnv?: string` to the interface.

---

### P2 - Swagger Config Reads process.env Instead of apiConfig (FIXED)

**Detected**: 2026-02-23 (code review of Plan 005 features)
**Fixed**: 2026-02-23
**Location**: `src/api/swagger/config.ts` -- `buildSwaggerServers()`

**Resolution**: `buildSwaggerServers()` was reading `process.env.AZURE_FS_API_SWAGGER_SERVER_VARIABLES` and `process.env.AZURE_FS_API_SWAGGER_ADDITIONAL_SERVERS` directly, even though these values are already loaded, validated, and available on the `apiConfig` object (as `apiConfig.swaggerServerVariables` and `apiConfig.swaggerAdditionalServers`). Changed to use `apiConfig` fields, eliminating the duplication and ensuring the config system is the single source of truth.

---

### Feature - REST API Layer (IMPLEMENTED)

**Detected**: 2026-02-23
**Implemented**: 2026-02-23
**Plan**: `docs/design/plan-004-rest-api-layer.md`

**Resolution**: Added Express-based REST API server exposing all Azure Blob Storage operations over HTTP. Includes file CRUD (upload, download, delete, replace, info, exists), folder operations (list, create, delete, exists), edit operations (patch, append, edit workflow with ETag concurrency), metadata CRUD, and tag operations with query support. Health endpoints (liveness + readiness) for container orchestration. Swagger UI documentation at `/api/docs` (configurable). Multer-based multipart file uploads, CORS support, request timeout middleware, structured error handling. Six new `AZURE_FS_API_*` configuration parameters added.

---

### Feature - Batch Upload with Parallel Uploads (IMPLEMENTED)

**Detected**: 2026-02-23 (performance testing revealed ~67s for 61 sequential uploads)
**Implemented**: 2026-02-23
**Plan**: `docs/design/plan-003-batch-upload-parallel.md`

**Resolution**: Added `upload-dir` CLI command with configurable parallelism (`batch.concurrency` / `AZURE_FS_BATCH_CONCURRENCY`). New `uploadDirectory()` method in `BlobFileSystemService` walks a local directory recursively, skips excluded patterns, and uploads files in parallel using a zero-dependency `parallelLimit()` utility. Expected 5x-13x speedup over sequential per-file CLI invocations.

---

### P2 - Unexported Utility: `streamToBuffer` (FIXED)

**Detected**: 2026-02-23 (Serena analysis)
**Fixed**: 2026-02-23
**Location**: `src/utils/stream.utils.ts`

**Resolution**: Removed `export` keyword from `streamToBuffer`. It is now a module-private function, only consumed internally by `streamToString` in the same file.

---

### P1 - Architectural Inconsistency: Service Constructor Patterns (FIXED)

**Detected**: 2026-02-23 (Serena analysis)
**Fixed**: 2026-02-23
**Location**: `src/services/metadata.service.ts`, `src/commands/meta.commands.ts`, `src/commands/tags.commands.ts`

**Resolution**: Refactored `MetadataService` constructor to accept `(config: ResolvedConfig, logger: Logger)` — matching the `BlobFileSystemService` pattern. The service now creates its own `ContainerClient` and `RetryConfig` internally. Removed boilerplate `createContainerClient()` and `retryConfigFromResolved()` calls from `meta.commands.ts` and `tags.commands.ts`. Updated dependency graph in `docs/design/project-design.md`.
