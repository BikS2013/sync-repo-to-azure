# API Implementation vs create-api-base Skill - Deviation Analysis

**Date**: 2026-02-23 (Updated after skill v3 update)
**Scope**: Comparison of `src/api/` implementation against the `create-api-base` skill blueprint (v3)
**Purpose**: Capture all architectural, structural, and behavioral differences

---

## Change Log

| Date | Description |
|------|-------------|
| 2026-02-23 (v1) | Initial deviation analysis |
| 2026-02-23 (v2) | Updated after skill received 5 features from current implementation: granular error handling, request logging middleware, timeout middleware, detailed config error messages, controller separation. Also added: Logger utility, standardized response envelope, route barrel with 404 handler, error sanitization, corrected middleware chain order. |
| 2026-02-23 (v3) | Updated after skill received 2 additional features: conditional Swagger (enable/disable via `SWAGGER_ENABLED`), double-signal force-exit in graceful shutdown. Also added: `SWAGGER_ENABLED` env var, `getSwaggerEnabled()` method, `.unref()` on shutdown timeout. |

---

## Executive Summary

Following the v3 update to the `create-api-base` skill, the gap between the skill blueprint and the current Azure FS REST API implementation has narrowed further. The two are now **aligned on middleware architecture, error handling, response format, logging, controller separation, configuration error messages, conditional Swagger, and graceful shutdown with double-signal handling**. The remaining deviations fall into two categories: (1) features present in the skill but not yet adopted by the current implementation (container-aware Swagger, port checker, dev routes, feature flags), and (2) domain-specific features in the current implementation that don't belong in a generic skill (Azure auth, blob operations, ETag concurrency, layered config with CLI flags).

### Deviations Resolved by Skill v2 Update

The following deviations from v1 have been **eliminated** - the skill now includes these features:

| # | Feature | Status |
|---|---------|--------|
| 1 | Granular error classification (error types to HTTP codes) | **RESOLVED** - Skill now has `AppError` hierarchy with `mapErrorToHttpStatus()` |
| 2 | Error sanitization (hiding config/auth details) | **RESOLVED** - Skill now has `getSanitizedMessage()` |
| 3 | Request logging middleware with timing | **RESOLVED** - Skill now has `createRequestLoggerMiddleware(logger)` |
| 4 | Timeout middleware with 408 response | **RESOLVED** - Skill now has `createTimeoutMiddleware(timeoutMs)` |
| 5 | Detailed config error messages with remediation | **RESOLVED** - Skill now uses `ConfigError.missingRequired()` with per-variable guidance |
| 6 | Controller layer separation | **RESOLVED** - Skill now has `src/controllers/` with factory pattern |
| 7 | Standardized response envelope | **RESOLVED** - Skill now has `{ success, data/error, metadata: { timestamp, durationMs } }` |
| 8 | Structured logging with levels | **RESOLVED** - Skill now has `Logger` class with debug/info/warn/error |
| 9 | Route barrel with centralized registration | **RESOLVED** - Skill now has `registerApiRoutes()` with `ApiServices` interface |
| 10 | 404 catch-all handler | **RESOLVED** - Skill now has JSON 404 handler in route barrel |
| 11 | Correct middleware chain order (CORS first) | **RESOLVED** - Skill now applies CORS before body parsers |
| 12 | Conditional Swagger (enable/disable via config) | **RESOLVED** - Skill now has `SWAGGER_ENABLED` env var with `getSwaggerEnabled()` and conditional mounting |
| 13 | Double-signal force-exit in graceful shutdown | **RESOLVED** - Skill now has `shutdownInProgress` flag, signal name logging, and `.unref()` on timeout |

---

## 1. Configuration Architecture

### 1.1 Configuration Manager Pattern

| Aspect | Skill Blueprint (v2) | Current Implementation |
|--------|----------------------|----------------------|
| **Config loading** | Two classes: `EnvironmentManager` + `AppConfigurationManager` | Single layered loader: `config.loader.ts` with `resolveConfig()` / `resolveApiConfig()` |
| **Config source** | `.env` files only (via `dotenv`) | Three sources: config file (`.azure-fs.json`) + env vars + CLI flags |
| **Priority order** | `.env` < `.env.{NODE_ENV}` < env vars | Config file < env vars < CLI flags |
| **Config source tracking** | `Map<string, string>` tracking where each var came from | No source tracking - config is merged silently |
| **Config display** | `printConfigSources()` with per-variable audit trail | `config show` CLI command with masked values (no source tracking) |
| **Sensitive value masking** | Automatic masking of keys containing SECRET/PASSWORD/TOKEN | Masks connection strings and SAS tokens in `config show` |
| **Type access** | Getter methods: `getPort()`, `getHost()`, `getCorsOrigins()` | Direct property access on typed `ResolvedConfig` / `ApiResolvedConfig` objects |
| **Validation errors** | **ALIGNED**: `ConfigError.missingRequired()` with per-variable remediation guidance | **ALIGNED**: `ConfigError.missingRequired()` with per-variable remediation guidance |

**Impact**: The skill's two-class pattern provides better separation and debugging visibility. The current implementation consolidates into a single loader which is simpler but loses source-tracking. **Both now use detailed remediation messages for missing config.**

### 1.2 Missing: Environment-Specific .env Files

| Aspect | Skill Blueprint | Current Implementation |
|--------|----------------|----------------------|
| **Multi-env support** | Loads `.env` then `.env.{NODE_ENV}` | No environment-specific file loading |
| **NODE_ENV** | Required environment variable | Not used at all |

### 1.3 Missing: Feature Flags

| Aspect | Skill Blueprint | Current Implementation |
|--------|----------------|----------------------|
| **Feature flags** | `FEATURE_*` env vars with `getFeatureFlags()` method | Not implemented |
| **Feature flags endpoint** | `GET /api/config/features` | Not implemented |

### 1.4 Configuration Variables Differences

**Present in Skill but MISSING in Current Implementation:**

| Variable | Skill Purpose |
|----------|--------------|
| `NODE_ENV` | Environment mode (development/production) |
| `AUTO_SELECT_PORT` | Automatic port selection on conflict |
| `API_RATE_LIMIT_PER_MINUTE` | Rate limiting |
| `API_MAX_REQUEST_SIZE` | Max body size (current uses `AZURE_FS_API_UPLOAD_MAX_SIZE_MB` for uploads only) |
| `FEATURE_DARK_MODE` | Feature flag |
| `FEATURE_BETA_UI` | Feature flag |
| `PUBLIC_URL` | Container runtime public URL |
| `DOCKER_HOST_URL` | Docker host URL |
| `SWAGGER_ADDITIONAL_SERVERS` | Additional Swagger server URLs |
| `ENABLE_SERVER_VARIABLES` | Swagger server variables toggle |
| `USE_HTTPS` | Force HTTPS in K8s |
| `WEBSITE_HOSTNAME` | Azure App Service hostname (auto-set) |
| `WEBSITE_SITE_NAME` | Azure App Service name (auto-set) |
| `K8S_SERVICE_HOST` | Kubernetes service host (auto-set) |
| `K8S_SERVICE_PORT` | Kubernetes service port (auto-set) |

**Present in Current Implementation but NOT in Skill (domain-specific):**

| Variable | Current Purpose |
|----------|----------------|
| `AZURE_STORAGE_ACCOUNT_URL` | Azure Storage account URL |
| `AZURE_STORAGE_CONTAINER_NAME` | Default container name |
| `AZURE_FS_AUTH_METHOD` | Auth method selection |
| `AZURE_STORAGE_CONNECTION_STRING` | Connection string auth |
| `AZURE_STORAGE_SAS_TOKEN` | SAS token auth |
| `AZURE_STORAGE_SAS_TOKEN_EXPIRY` | SAS token expiry tracking |
| `AZURE_FS_LOG_REQUESTS` | Azure SDK request logging |
| `AZURE_FS_RETRY_*` | Retry configuration |
| `AZURE_FS_BATCH_CONCURRENCY` | Parallel upload limiter |
| `AZURE_FS_API_UPLOAD_MAX_SIZE_MB` | Upload size limit (API-specific) |
| `AZURE_FS_API_REQUEST_TIMEOUT_MS` | Request timeout |

**Now ALIGNED between Skill and Implementation:**

| Variable | Purpose |
|----------|---------|
| `LOG_LEVEL` / `AZURE_FS_LOG_LEVEL` | Log level control (debug, info, warn, error) |
| `SWAGGER_ENABLED` / `AZURE_FS_API_SWAGGER_ENABLED` | Enable/disable Swagger UI and JSON endpoint |

---

## 2. Express App Structure

### 2.1 File Organization

| Aspect | Skill Blueprint (v2) | Current Implementation | Status |
|--------|----------------------|----------------------|--------|
| **App factory** | `src/app.ts` | `src/api/server.ts` (combined factory + startup) | Different |
| **Entry point** | `src/server.ts` (separate from app factory) | `src/api/server.ts` has both `createApp()` and `startServer()` | Different |
| **Controllers** | **ALIGNED**: `src/controllers/` with factory pattern | `src/api/controllers/` with factory pattern | **Aligned** |
| **Error hierarchy** | **ALIGNED**: `src/errors/` with `AppError` base | `src/errors/` with `AzureFsError` base | **Aligned** (different names) |
| **Middleware** | **ALIGNED**: `src/middleware/` (3 files: errorHandler, requestLogger, timeout) | `src/api/middleware/` (4 files: error-handler, request-logger, timeout, upload) | **Aligned** (impl has extra upload) |
| **Routes** | **ALIGNED**: `src/routes/` with `index.ts` barrel | `src/api/routes/` with `index.ts` barrel | **Aligned** |
| **Logger** | **ALIGNED**: `src/utils/logger.ts` | `src/utils/logger.utils.ts` | **Aligned** |
| **Response helpers** | **NEW**: `src/utils/response.ts` | Inline `buildResponse()` per controller | **Aligned** (different organization) |
| **Services** | `src/services/HealthCheckService.ts` | Shared services: `BlobFileSystemService`, `MetadataService` | Different (domain-specific) |
| **Config files** | `src/config/EnvironmentManager.ts` + `src/config/AppConfigurationManager.ts` | `src/config/config.loader.ts` + `src/config/config.schema.ts` | Different |
| **Swagger config** | `src/config/swagger.ts` | `src/api/swagger/config.ts` | Different path |
| **Utilities** | `src/utils/portChecker.ts` + `src/utils/logger.ts` + `src/utils/response.ts` | `src/utils/` (7 utility files) | Different scope |

### 2.2 App Factory Signature

| Aspect | Skill Blueprint (v2) | Current Implementation | Status |
|--------|----------------------|----------------------|--------|
| **Parameters** | `(appConfigManager, healthService, logger, actualPort?)` | `(config, blobService, metadataService, logger)` | **Aligned** on Logger injection |
| **Return type** | `Express` | `Express` | Aligned |
| **Service injection** | Config manager + health service + logger | Domain services + config + logger | **Aligned** on pattern |

### 2.3 Route Registration

| Aspect | Skill Blueprint (v2) | Current Implementation | Status |
|--------|----------------------|----------------------|--------|
| **Pattern** | **ALIGNED**: `registerApiRoutes(app, services)` | `registerApiRoutes(app, services)` | **Aligned** |
| **Service passing** | **ALIGNED**: Via `ApiServices` interface | Via `ApiServices` interface | **Aligned** |
| **404 handler** | **ALIGNED**: Standardized JSON error response | Standardized JSON error response | **Aligned** |

---

## 3. Middleware

### 3.1 Middleware Chain Order

| Order | Skill Blueprint (v2) | Current Implementation | Status |
|-------|----------------------|----------------------|--------|
| 1 | **ALIGNED**: CORS | CORS | **Aligned** |
| 2 | `express.json()` + `express.urlencoded()` | `express.json()` | Skill has urlencoded too |
| 3 | **ALIGNED**: Request Logger | Request Logger | **Aligned** |
| 4 | **ALIGNED**: Timeout middleware | Timeout middleware | **Aligned** |
| 5 | **ALIGNED**: Swagger UI (conditional via `SWAGGER_ENABLED`) | Swagger UI (conditional via `config.api.swaggerEnabled`) | **Aligned** |
| 6 | **ALIGNED**: Routes via `registerApiRoutes()` | Routes via `registerApiRoutes()` | **Aligned** |
| 7 | **ALIGNED**: Error handler (last) | Error handler (last) | **Aligned** |

### 3.2 Middleware Comparison (Previously "Missing Middleware")

| Middleware | Skill Blueprint (v2) | Current Implementation | Status |
|-----------|----------------------|----------------------|--------|
| **Request Logger** | **ALIGNED**: `createRequestLoggerMiddleware(logger)` | `createRequestLoggerMiddleware(logger)` | **Aligned** |
| **Timeout** | **ALIGNED**: `createTimeoutMiddleware(timeoutMs)` | `createTimeoutMiddleware(timeoutMs)` | **Aligned** |
| **Upload (Multer)** | Not present (domain-specific) | `createUploadMiddleware(apiConfig)` | N/A (domain-specific) |
| **URL-encoded body parser** | `express.urlencoded({ extended: true })` | Not present | Skill has, impl doesn't |
| **Rate limiting** | Planned via `API_RATE_LIMIT_PER_MINUTE` | Not present | Neither implemented |

### 3.3 CORS Configuration

| Aspect | Skill Blueprint (v2) | Current Implementation |
|--------|----------------------|----------------------|
| **Implementation** | Custom origin callback function with `credentials: true` | Simple `cors()` with `origin` array |
| **Wildcard handling** | Explicit `allowedOrigins.includes('*')` check | Passed directly to `cors()` |
| **Methods** | Default (cors package defaults) | Explicitly listed: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS |
| **Allowed headers** | Default (cors package defaults) | Explicitly listed: Content-Type, Authorization, If-Match, If-None-Match |
| **Exposed headers** | Not configured | ETag, Content-Length, Content-Type |
| **Credentials** | `credentials: true` | Not configured |

### 3.4 Error Handler

| Aspect | Skill Blueprint (v2) | Current Implementation | Status |
|--------|----------------------|----------------------|--------|
| **Implementation** | **ALIGNED**: Factory function with Logger DI | Factory function with Logger DI | **Aligned** |
| **Error classification** | **ALIGNED**: Maps error types to HTTP codes (400, 403, 404, 409, 500, 502) | Maps error types to HTTP codes (400, 403, 404, 408, 412, 413, 500, 502) | **Aligned** (impl has more codes) |
| **Error sanitization** | **ALIGNED**: Sanitizes ConfigError and AuthError messages | Sanitizes ConfigError and AuthError messages | **Aligned** |
| **Multer errors** | **ALIGNED**: Duck-typed via `name === 'MulterError'` | Duck-typed via `name === 'MulterError'` | **Aligned** |
| **Response format** | **ALIGNED**: `{ success, error: { code, message }, metadata: { timestamp } }` | `{ success, error: { code, message }, metadata: { timestamp } }` | **Aligned** |
| **Stack trace** | **ALIGNED**: Never included in response | Never included in response | **Aligned** |
| **Logging** | **ALIGNED**: Structured Logger | Structured Logger | **Aligned** |

---

## 4. Health Checks

| Aspect | Skill Blueprint (v2) | Current Implementation |
|--------|----------------------|----------------------|
| **Mount path** | `/health` | `/api/health` |
| **Endpoints** | Single `GET /health` (uses controller pattern) | Two: `GET /api/health` (liveness) + `GET /api/health/ready` (readiness) |
| **Controller pattern** | **ALIGNED**: `createHealthController(healthService)` | Controller factory pattern | **Aligned on pattern** |
| **Checks performed** | `configuration: true, server: true` (static) | Liveness: always OK; Readiness: actual Azure Storage connectivity test |
| **Response format** | **ALIGNED**: Uses `buildSuccessResponse()` envelope | Uses `buildResponse()` envelope | **Aligned** |
| **Failure code** | 503 | Liveness: always 200; Readiness: 503 |
| **External dependency check** | No real dependency check | Validates Azure Storage container access with timing |
| **K8s patterns** | Not explicitly designed for K8s probes | Follows K8s liveness/readiness probe pattern |

**Remaining gap**: Current implementation has a two-tier health check (liveness + readiness) that the skill doesn't include. This is a production pattern worth considering for the skill.

---

## 5. Swagger / OpenAPI

### 5.1 Configuration

| Aspect | Skill Blueprint | Current Implementation |
|--------|----------------|----------------------|
| **Spec version** | OpenAPI 3.0.0 | OpenAPI 3.0.0 |
| **UI path** | `/api-docs` | `/api/docs` |
| **JSON path** | `/api/swagger.json` | `/api/docs.json` |
| **Conditionality** | **ALIGNED**: Conditional via `SWAGGER_ENABLED` env var and `getSwaggerEnabled()` | Conditional: only if `config.api.swaggerEnabled === true` |
| **JSDoc tag** | `@swagger` | `@openapi` |
| **API scan paths** | `./src/routes/*.ts`, `./dist/routes/*.js` | `./src/api/routes/*.ts`, `./dist/api/routes/*.js` |

### 5.2 Container-Aware URL Detection

| Aspect | Skill Blueprint | Current Implementation |
|--------|----------------|----------------------|
| **Azure App Service** | Auto-detects `WEBSITE_HOSTNAME` | Not implemented |
| **Docker** | Uses `DOCKER_HOST_URL` | Not implemented |
| **Kubernetes** | Uses `K8S_SERVICE_HOST` + `K8S_SERVICE_PORT` | Not implemented |
| **Public URL override** | `PUBLIC_URL` env var | Not implemented |
| **Server variables** | Optional via `ENABLE_SERVER_VARIABLES` | Not implemented |
| **Additional servers** | `SWAGGER_ADDITIONAL_SERVERS` (comma-separated) | Not implemented |
| **Server URL** | Dynamic based on runtime environment | Static from config: `http://{host}:{port}` |

**The skill's Swagger configuration is significantly more sophisticated** for cloud/container deployments.

### 5.3 Swagger Spec Generation

| Aspect | Skill Blueprint | Current Implementation |
|--------|----------------|----------------------|
| **Factory function** | `createSwaggerSpec(appConfig, actualPort?)` | `createSwaggerSpec(apiConfig)` where `apiConfig` is `ApiConfig` type |
| **Port override** | Accepts `actualPort` for port-conflict scenarios | No port override capability |
| **Helper function** | `getSwaggerServers()` for multi-server generation | Not present |

### 5.4 Example Values in Swagger Docs

| Aspect | Skill Blueprint | Current Implementation |
|--------|----------------|----------------------|
| **Example style** | Type-placeholder only: `"string"`, `0`, `false` | Not specified / varies by route |
| **Strict rule** | Explicitly forbids realistic sample data | No documented standard |

---

## 6. Port Handling

| Aspect | Skill Blueprint | Current Implementation |
|--------|----------------|----------------------|
| **Port checker utility** | `PortChecker` class with `isPortAvailable()`, `findAvailablePort()`, `getProcessUsingPort()` | Handles `EADDRINUSE` error on `server.listen()` |
| **Auto-select** | `AUTO_SELECT_PORT=true` finds next available port | Not implemented - fails on conflict |
| **Process identification** | Uses `lsof` to show which process holds the port | Not implemented |
| **Pre-start check** | Checks port BEFORE creating the server | Only catches EADDRINUSE after listen attempt |
| **Swagger re-mount** | Re-mounts Swagger with actual port after auto-select | Not needed (no auto-select) |

---

## 7. Development Routes

| Aspect | Skill Blueprint | Current Implementation |
|--------|----------------|----------------------|
| **Dev routes** | `GET /api/dev/env` - list all env vars with sources; `GET /api/dev/env/:key` - get specific var | Not implemented |
| **Protection** | Only available when `NODE_ENV=development` | N/A |
| **Sensitive masking** | Masks SECRET/PASSWORD/TOKEN/KEY/PRIVATE/CREDENTIAL | N/A |
| **Source tracking** | Shows where each var was loaded from | N/A |

---

## 8. Response Format

| Aspect | Skill Blueprint (v2) | Current Implementation | Status |
|--------|----------------------|----------------------|--------|
| **Success envelope** | **ALIGNED**: `{ success: true, data, metadata: { command, timestamp, durationMs } }` | `{ success: true, data, metadata: { command, timestamp, durationMs } }` | **Aligned** |
| **Error envelope** | **ALIGNED**: `{ success: false, error: { code, message }, metadata: { timestamp } }` | `{ success: false, error: { code, message }, metadata: { timestamp } }` | **Aligned** |
| **Consistency** | **ALIGNED**: `buildSuccessResponse()` / `buildErrorResponse()` helpers | `buildResponse()` helper | **Aligned** |

---

## 9. Graceful Shutdown

| Aspect | Skill Blueprint (v3) | Current Implementation | Status |
|--------|----------------------|----------------------|--------|
| **Signal handling** | SIGTERM + SIGINT | SIGTERM + SIGINT | Aligned |
| **Force timeout** | 10 seconds (configurable `SHUTDOWN_TIMEOUT_MS`) | 10 seconds (configurable `SHUTDOWN_TIMEOUT_MS`) | **Aligned** |
| **Double-signal** | **ALIGNED**: `shutdownInProgress` flag, force-exit on second signal | `shutdownInProgress` flag, force-exit on second signal | **Aligned** |
| **Signal name logging** | **ALIGNED**: Logs which signal was received | Logs which signal was received | **Aligned** |
| **Timeout `.unref()`** | **ALIGNED**: `.unref()` on safety-net timeout | `.unref()` on safety-net timeout | **Aligned** |
| **Implementation** | Nested function in `startServer()` | Similar nested function pattern | Aligned |

---

## 10. Logging

| Aspect | Skill Blueprint (v2) | Current Implementation | Status |
|--------|----------------------|----------------------|--------|
| **Library** | **ALIGNED**: Custom `Logger` class (writes to stderr) | Custom `Logger` class (writes to stderr) | **Aligned** |
| **Request logging** | **ALIGNED**: `createRequestLoggerMiddleware(logger)` | `createRequestLoggerMiddleware(logger)` | **Aligned** |
| **Log levels** | **ALIGNED**: Configurable: debug, info, warn, error | Configurable: debug, info, warn, error | **Aligned** |
| **Console output** | `chalk` for colored startup messages | No chalk (plain output) | Different |
| **Azure SDK logging** | Not applicable | Optional via `AZURE_FS_LOG_REQUESTS` | Domain-specific |

---

## 11. Dependencies

### Present in Skill but NOT in Current Implementation

| Package | Skill Purpose |
|---------|--------------|
| `dotenv` | .env file loading |
| `chalk` | Colored console output |
| `yaml` | YAML processing |
| `nodemon` | Development auto-restart |

### Present in Current Implementation but NOT in Skill (domain-specific)

| Package | Current Purpose |
|---------|----------------|
| `multer` | File upload handling |
| `@azure/storage-blob` | Azure Blob Storage SDK |
| `@azure/identity` | Azure AD authentication |

---

## 12. TypeScript Configuration Differences

| Aspect | Skill Blueprint | Current Implementation |
|--------|----------------|----------------------|
| **noUnusedLocals** | `true` | Not specified / varies |
| **noUnusedParameters** | `true` | Not specified / varies |
| **noImplicitReturns** | `true` | Not specified / varies |
| **noFallthroughCasesInSwitch** | `true` | Not specified / varies |

---

## 13. Deployment Artifacts

### Present in Skill but MISSING in Current Implementation

| Artifact | Purpose |
|----------|---------|
| `Dockerfile` | Container image build |
| `k8s-deployment.yaml` | Kubernetes deployment manifest |
| `.env.example` | Configuration template (project has `.env.example` but for CLI, not API-specific) |
| `nodemon.json` config | Development auto-restart configuration |

---

## 14. Testing

| Aspect | Skill Blueprint | Current Implementation |
|--------|----------------|----------------------|
| **Unit tests** | `HealthCheckService.test.ts` example | No test files observed |
| **API tests** | `supertest` integration test example (uses `NullLogger`) | No test files observed |
| **Test framework** | Jest | Not configured |

---

## 15. Summary of Remaining Gaps

### Features in Skill Still Missing from Current Implementation

1. **EnvironmentManager** with source tracking and audit trail
2. **AppConfigurationManager** with typed getter pattern
3. **Container-aware Swagger URLs** (Azure, Docker, K8s)
4. **Auto port selection** (`AUTO_SELECT_PORT`)
5. **PortChecker utility** with process identification
6. **Development routes** (`/api/dev/env`)
7. **Feature flags** system
8. **Rate limiting** configuration
9. **NODE_ENV** environment variable usage
10. **Environment-specific .env files** (`.env.production`, etc.)
11. **Swagger server variables** toggle
12. **Additional Swagger servers** configuration
13. **Dockerfile** and **K8s manifests**
14. **Colored startup output** with chalk
15. **URL-encoded body parser**

### Features in Current Implementation Still Missing from Skill (domain-specific or edge cases)

1. **File upload middleware** (Multer) - domain-specific, not needed in generic skill
2. **Two-tier health checks** (liveness + readiness with real dependency validation) - production pattern worth adding
3. **Layered config** (file + env + CLI flags) - current impl is more flexible
4. **ETag/concurrency control headers** - domain-specific

### Features Now Aligned (Resolved by Skill v2 Update)

| # | Feature | Resolution |
|---|---------|-----------|
| 1 | Granular error classification | Skill now has `AppError` hierarchy with `mapErrorToHttpStatus()` |
| 2 | Error sanitization | Skill now has `getSanitizedMessage()` for ConfigError/AuthError |
| 3 | Request logging middleware | Skill now has `createRequestLoggerMiddleware(logger)` |
| 4 | Timeout middleware | Skill now has `createTimeoutMiddleware(timeoutMs)` |
| 5 | Detailed config error messages | Skill now uses `ConfigError.missingRequired()` with remediation |
| 6 | Controller separation | Skill now has `src/controllers/` with factory pattern |
| 7 | Standardized response envelope | Skill now has `{ success, data/error, metadata }` with helpers |
| 8 | Structured logging with levels | Skill now has `Logger` class with debug/info/warn/error |
| 9 | Route barrel with registration | Skill now has `registerApiRoutes()` with `ApiServices` |
| 10 | 404 catch-all handler | Skill now has JSON 404 in route barrel |
| 11 | Correct middleware order (CORS first) | Skill now applies CORS before body parsers |
| 12 | Conditional Swagger (enable/disable) | Skill now has `SWAGGER_ENABLED` env var with `getSwaggerEnabled()` and conditional mounting in `createApp()` |
| 13 | Double-signal force-exit in graceful shutdown | Skill now has `shutdownInProgress` flag, signal name logging, and `.unref()` on timeout |

---

## 16. Recommendations

### Adopt from Skill into Current Implementation

| Priority | Recommendation | Rationale |
|----------|---------------|-----------|
| High | Add container-aware Swagger URLs | Critical for cloud deployments |
| High | Add `NODE_ENV` support | Standard Node.js practice |
| Medium | Add PortChecker utility | Better DX for development |
| Medium | Add development routes for config debugging | Useful for troubleshooting |
| Low | Add config source tracking | Nice for audit/debugging |
| Low | Add feature flags | May not be needed for a CLI tool's API |

### Consider Adding to Skill (from Current Implementation)

| Priority | Recommendation | Rationale |
|----------|---------------|-----------|
| Medium | Add two-tier health checks (liveness + readiness) | Production K8s pattern worth including |

### Reconcile (Remaining Inconsistencies)

| Area | Skill | Current Implementation | Suggested Resolution |
|------|-------|----------------------|---------------------|
| Swagger UI path | `/api-docs` | `/api/docs` | Project-specific choice |
| Swagger JSON path | `/api/swagger.json` | `/api/docs.json` | Project-specific choice |
| JSDoc annotation tag | `@swagger` | `@openapi` | Both valid; `@openapi` is newer standard |
| Error class naming | `AppError` (generic) | `AzureFsError` (domain-specific) | Correct - each uses appropriate name |
| Config approach | `.env` files only | Layered (file + env + CLI) | Current impl is more flexible |
| Health check depth | Single endpoint | Liveness + readiness | Current impl is more production-ready; consider adding to skill |
