# Issues - Pending Items

## Pending

### P3 - Sync Pair Feature: Design Deviation -- SyncPairItemResult Missing errorCode Field

**Detected**: 2026-02-28 (code review of Plan 008 sync pair implementation)
**Location**: `src/types/repo-replication.types.ts` (SyncPairItemResult), `src/services/repo-replication.service.ts` (executeSyncPair)

**Description**: The technical design (plan-008-sync-pair-technical-design.md, Section 2.1) specifies that `SyncPairItemResult` should include an `errorCode?: string` field. The implementation omits this field from both the interface and the `executeSyncPair` method's error catch block. This is internally consistent (no type errors) but diverges from the design. The error code would have been useful for programmatic error handling by API consumers.

---

---

## Completed

### Plan 009: Strip Generic Storage Features, Rename Project to repo-sync (COMPLETED)

**Detected**: 2026-02-28
**Completed**: 2026-02-28

**Resolution**: All generic storage files, commands, routes, controllers, services, types, and errors removed. Project renamed from azure-fs to repo-sync. This includes removal of file upload/download, folder operations, edit/patch/append, metadata, tags, and blob-filesystem features. The project now focuses exclusively on repo replication and sync pair functionality.

---

### P1 - Sync Pair Feature: Documentation Not Updated (FIXED)

**Detected**: 2026-02-28 (code review of Plan 008 sync pair implementation)
**Fixed**: 2026-02-28
**Location**: `CLAUDE.md`, `cli-instructions.md`, `api-instructions.md`, `docs/design/configuration-guide.md`

**Resolution**: Updated all four documentation files for the sync pair configuration feature (Plan 008):
1. **CLAUDE.md**: Added `src/config/sync-pair.loader.ts` to project structure, updated `repo.commands.ts` description to include `sync`, updated `repo.routes.ts` description to include `/sync` endpoint, updated `repo-replication.types.ts` to reference sync pair types.
2. **cli-instructions.md**: Added full `<repo-sync-repo-sync>` command documentation including syntax, options, JSON/YAML config examples, exit codes, and fail-open behavior.
3. **api-instructions.md**: Added `POST /api/v1/repo/sync` to endpoint table, documented 30-minute timeout, added curl examples, documented response codes (200, 207, 400, 500), and added example responses for success, partial failure, and invalid config.
4. **configuration-guide.md**: Added comprehensive "Sync Pair Configuration" section documenting file format detection, all fields for GitHub and DevOps sync pairs, destination fields, token expiry behavior, and complete example configs in both JSON and YAML.

---

### P2 - Swagger Priority Order Deviation from Plan (FIXED)

**Detected**: 2026-02-23 (code review of Plan 005 features)
**Fixed**: 2026-02-28
**Location**: `docs/design/plan-005-missing-features-from-skill.md` -- `getBaseUrl()` code sample

**Resolution**: Fixed the code sample in Plan 005 to match the acceptance criteria and actual implementation. `PUBLIC_URL` is now Priority 1 (overrides all container detection), Azure App Service is Priority 2. The plan's code sample previously had them inverted, contradicting its own acceptance criteria.

### P3 - Repo Replication Services Bypass Config System for Non-Secret Settings (FIXED)

**Detected**: 2026-02-28 (code review of Plan 007 implementation)
**Fixed**: 2026-02-28
**Location**: `src/services/github-client.service.ts`, `src/services/devops-client.service.ts`, `src/services/repo-replication.service.ts`

**Resolution**: Both client services read all configuration directly from `process.env` instead of from `ResolvedConfig`. This bypassed the layered config merge (CLI > env > config file), meaning config file values for `devops.authMethod` and `devops.orgUrl` were silently ignored. Fixed by changing constructors to accept `ResolvedConfig` and reading all settings from the resolved config object. `RepoReplicationService` now also accepts `ResolvedConfig` and forwards it to client services. CLI commands and API server updated to pass config through.

---

### P3 - Repo Replication: Large File Size Tracking Inaccuracy in uploadStream Path (FIXED)

**Detected**: 2026-02-28 (code review of Plan 007 implementation)
**Fixed**: 2026-02-28
**Location**: `src/services/repo-replication.service.ts` -- `uploadEntryToBlob()`

**Resolution**: When a file was uploaded via `uploadStream()`, the actual byte count was not tracked (fell back to `size ?? 0`). Fixed by wrapping the entry stream in a counting `Transform` that tallies `bytesWritten` as chunks flow through. The stream is piped through the counter into `blockBlobClient.uploadStream()`, giving an accurate byte count with zero overhead.

### P1 - Repo Replication: Zip Pipeline Race Condition (FIXED)

**Detected**: 2026-02-28 (code review of Plan 007 implementation)
**Fixed**: 2026-02-28
**Location**: `src/services/repo-replication.service.ts` -- `streamZipToBlob()`

**Resolution**: The `parser.on("close")` event fired when unzipper finished parsing the stream, but async upload promises could still be in flight. This meant `resolve(stats)` could be called with incomplete stats (missing the last file's success/failure). Fixed by tracking all upload promises in a `pendingUploads` array and calling `Promise.all(pendingUploads)` in the close handler before resolving.

---

### P1 - Repo Replication: Timeout Stacking Bug (FIXED)

**Detected**: 2026-02-28 (code review of Plan 007 implementation)
**Fixed**: 2026-02-28
**Location**: `src/api/middleware/timeout.middleware.ts`, `src/api/routes/repo.routes.ts`

**Resolution**: The repo routes applied a 5-minute timeout via `router.use(createTimeoutMiddleware(300000))`, but the global timeout middleware (e.g., 30s) from `server.ts` was still active. Both timers ran concurrently, and the global one would fire first, returning HTTP 408 before the route-specific timeout took effect. Fixed by storing the timer on the request object via a Symbol key; when a subsequent timeout middleware is applied, it clears the previous timer before setting a new one. This enables clean per-route timeout overrides.

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
