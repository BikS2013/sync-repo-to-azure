# Plan 005: Missing Features from create-api-base Skill

**Date**: 2026-02-23
**Author**: Claude Code
**Status**: Ready for Implementation
**Input**: `docs/reference/investigation-missing-features-from-skill.md`, `docs/design/api-skill-deviation-analysis.md`

---

## Overview

This plan details the implementation of 5 features from the `create-api-base` skill blueprint that are missing from the Azure FS REST API. The features are ordered by dependency and each specification includes exact files, types, environment variables, and acceptance criteria.

---

## Implementation Order and Dependencies

```
Feature 1: NODE_ENV Support
    |
    +---> Feature 2: Config Source Tracking  (parallel after F1)
    |         |
    |         +---> Feature 5: Development Routes  (depends on F1 + F2)
    |
    +---> Feature 3: Container-Aware Swagger URLs  (parallel after F1)
    |
    +---> Feature 4: PortChecker Utility  (parallel after F1)
```

**Parallelization**:
- Feature 1 must come first (foundation for all others)
- Features 2, 3, 4 can be implemented in parallel after Feature 1
- Feature 5 depends on Features 1 and 2

---

## Feature 1: NODE_ENV Support

### Objective

Add `NODE_ENV` as a required configuration parameter for the API server, controlling environment-specific behaviors: error stack traces in responses, server description in Swagger, and gating of development-only routes.

### New Environment Variables

| Variable | Required | Valid Values | Prefix Convention |
|----------|----------|-------------|-------------------|
| `NODE_ENV` | Yes (API mode only) | `development`, `production`, `test` | No prefix (standard Node.js convention) |

### New Types/Interfaces

**File**: `src/types/api-config.types.ts`

```typescript
/** Valid NODE_ENV values for the API server */
export type NodeEnvironment = "development" | "production" | "test";
```

Add to `ApiConfig` interface:
```typescript
export interface ApiConfig {
  // ... existing fields ...
  nodeEnv: NodeEnvironment;
}
```

### Files Modified

#### 1. `src/types/api-config.types.ts`

- **Add**: `NodeEnvironment` type alias
- **Modify**: `ApiConfig` interface -- add `nodeEnv: NodeEnvironment` field

#### 2. `src/config/config.loader.ts` -- `loadEnvConfig()` function

- **Add**: Read `NODE_ENV` from `process.env` and map it to `api.nodeEnv`:
  ```typescript
  if (process.env.NODE_ENV) {
    env["api"]["nodeEnv"] = process.env.NODE_ENV;
  }
  ```

#### 3. `src/config/config.schema.ts` -- `validateApiConfig()` function

- **Add**: Validation block for `api.nodeEnv` (after existing validations):
  - Must be present (throw `ConfigError.missingRequired()` if missing)
  - Must be one of `development`, `production`, `test` (throw `ConfigError.invalidValue()` if invalid)
  - Remediation guidance:
    - CLI: `(not available as CLI flag, use env var or config file)`
    - Env: `export NODE_ENV=development`
    - Config file: `{ "api": { "nodeEnv": "development" } }`
- **Add**: `VALID_NODE_ENVIRONMENTS` constant: `["development", "production", "test"]`
- **Modify**: Return object to include `nodeEnv`

#### 4. `src/api/server.ts` -- `startServer()` function

- **Modify**: Replace `process.env.NODE_ENV || "development"` on line 114 with `config.api.nodeEnv`
- **Modify**: Pass `config.api.nodeEnv` to `createErrorHandlerMiddleware()`:
  ```typescript
  app.use(createErrorHandlerMiddleware(logger, config.api.nodeEnv));
  ```

#### 5. `src/api/server.ts` -- `createApp()` function

- **Modify**: Update call to `createErrorHandlerMiddleware` to pass `nodeEnv`:
  ```typescript
  app.use(createErrorHandlerMiddleware(logger, config.api.nodeEnv));
  ```

#### 6. `src/api/middleware/error-handler.middleware.ts` -- `createErrorHandlerMiddleware()` function

- **Modify**: Change signature from `createErrorHandlerMiddleware(logger: Logger)` to `createErrorHandlerMiddleware(logger: Logger, nodeEnv: string)`
- **Modify**: In the "Unknown errors" section, conditionally include stack trace in development mode:
  ```typescript
  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "An internal server error occurred.",
      ...(nodeEnv === "development" && errorStack ? { stack: errorStack } : {}),
    },
    metadata: { timestamp },
  });
  ```

#### 7. `src/api/swagger/config.ts` -- `createSwaggerSpec()` function

- **Modify**: Change signature to accept `nodeEnv` (or full ApiConfig already has it after the type change)
- **Modify**: Server description:
  ```typescript
  description: apiConfig.nodeEnv === "production" ? "Production server" : "Development server",
  ```

#### 8. `.env.example`

- **Add**: `NODE_ENV=` entry in the REST API section with comment explaining valid values

#### 9. `src/types/config.types.ts` -- `AzureFsConfigFile` interface

- **Modify**: Add `nodeEnv?: string` to the `api?` section of `AzureFsConfigFile`

### Files Created

None.

### Dependencies on Other Features

None. This is the foundation feature.

### Acceptance Criteria

- [ ] `NODE_ENV` is required when starting the API server; missing value throws `ConfigError` with remediation
- [ ] Only `development`, `production`, `test` are accepted; invalid values throw `ConfigError`
- [ ] Error responses include `stack` field only when `NODE_ENV=development` and error is unknown (not `AzureFsError`)
- [ ] Swagger server description changes based on `NODE_ENV`
- [ ] CLI commands (`azure-fs upload`, `azure-fs ls`, etc.) are NOT affected -- `NODE_ENV` is only validated in `validateApiConfig()`
- [ ] `.env.example` updated with `NODE_ENV` entry

---

## Feature 2: Config Source Tracking

### Objective

Track which configuration source (config file, environment variable, or CLI flag) provided each resolved configuration value. This enables the development routes (Feature 5) to show a full audit trail of where each config value originated.

### New Environment Variables

None.

### New Types/Interfaces

**File**: `src/types/config.types.ts` (add to existing file)

```typescript
/** Labels identifying where a configuration value originated */
export type ConfigSourceLabel = "config-file" | "environment-variable" | "cli-flag";

/** Tracks the source of each resolved configuration key */
export interface ConfigSourceTracker {
  /** Record the source of a config key */
  set(key: string, source: ConfigSourceLabel): void;
  /** Get the source of a specific config key */
  getSource(key: string): ConfigSourceLabel | undefined;
  /** Get all tracked sources as a record */
  getAllSources(): Record<string, ConfigSourceLabel>;
}
```

### Files Modified

#### 1. `src/types/config.types.ts`

- **Add**: `ConfigSourceLabel` type alias
- **Add**: `ConfigSourceTracker` interface

#### 2. `src/types/api-config.types.ts`

- **Modify**: `ApiResolvedConfig` -- add optional `sourceTracker?: ConfigSourceTracker` field
  - Optional because CLI config resolution (`resolveConfig()`) does not need source tracking
  - The `sourceTracker` is populated only when `resolveApiConfig()` is called (API server startup)

#### 3. `src/config/config.loader.ts`

This is the most impacted file. Multiple functions need changes:

- **Add**: New private function `createSourceTracker(): ConfigSourceTracker` that returns an object wrapping a `Map<string, ConfigSourceLabel>` with `set()`, `getSource()`, and `getAllSources()` methods.

- **Modify**: `mergeConfigSection()` -- Change signature to accept an optional `ConfigSourceTracker` and a `sourceLabel: ConfigSourceLabel`:
  ```typescript
  function mergeConfigSection(
    base: Record<string, unknown>,
    overrides: Array<{ values: Record<string, unknown>; source: ConfigSourceLabel }>,
    tracker?: ConfigSourceTracker,
    sectionPrefix?: string,
  ): Record<string, unknown>
  ```
  During iteration, when a value from an override is applied, call `tracker.set(sectionPrefix + '.' + key, source)`.

- **Modify**: `buildMergedConfig()` -- Accept an optional `ConfigSourceTracker` parameter. Pass it through to each `mergeConfigSection()` call with the appropriate section prefix (`"storage"`, `"logging"`, `"retry"`, `"batch"`, `"api"`).

- **Modify**: `resolveApiConfig()` -- Create a `ConfigSourceTracker` instance, pass it to `buildMergedConfig()`, and attach it to the returned `ApiResolvedConfig`:
  ```typescript
  export function resolveApiConfig(cliOptions?: CliOptions): ApiResolvedConfig {
    const tracker = createSourceTracker();
    const opts = cliOptions || {};
    const merged = buildMergedConfig(opts, tracker);
    // ... validation ...
    return {
      ...baseConfig,
      api: apiConfig,
      sourceTracker: tracker,
    };
  }
  ```

- **Note**: `resolveConfig()` and `loadConfig()` remain unchanged -- no source tracking for CLI commands.

#### 4. `src/api/routes/index.ts` -- `ApiServices` interface

- **Modify**: Add `sourceTracker?: ConfigSourceTracker` to the `ApiServices` interface (optional, used only by dev routes)

#### 5. `src/api/server.ts` -- `createApp()` function

- **Modify**: Accept `sourceTracker` in function parameters (or extract from config since it's now on `ApiResolvedConfig`)
- **Modify**: Pass `sourceTracker` to the `ApiServices` object:
  ```typescript
  const services: ApiServices = {
    blobService,
    metadataService,
    config,
    logger,
    sourceTracker: config.sourceTracker,
  };
  ```

### Files Created

None.

### Dependencies on Other Features

- **Depends on**: Feature 1 (NODE_ENV) -- so that `NODE_ENV` is a tracked config key
- **Depended on by**: Feature 5 (Development Routes) -- dev routes consume source tracking data

### Acceptance Criteria

- [ ] `resolveApiConfig()` returns a `sourceTracker` that correctly records the source of each resolved config key
- [ ] For each config key, only the "winning" source is recorded (highest priority source that provided a value)
- [ ] Source labels are: `"config-file"`, `"environment-variable"`, `"cli-flag"`
- [ ] `resolveConfig()` (CLI path) is unaffected -- no source tracking overhead
- [ ] `ConfigSourceTracker` is accessible via `ApiServices` for downstream consumers (Feature 5)
- [ ] Keys are tracked with dot notation: `"storage.accountUrl"`, `"api.port"`, `"logging.level"`, etc.

---

## Feature 3: Container-Aware Swagger URLs

### Objective

Enhance the Swagger/OpenAPI specification generation to auto-detect the runtime environment (Azure App Service, Kubernetes, Docker, local development) and generate appropriate server URLs. Support additional server entries and interactive server variables in the Swagger UI.

### New Environment Variables

| Variable | Required | Description | Prefix Convention |
|----------|----------|-------------|-------------------|
| `WEBSITE_HOSTNAME` | No | Auto-set by Azure App Service (e.g., `myapp.azurewebsites.net`) | No prefix (platform-injected) |
| `WEBSITE_SITE_NAME` | No | Auto-set by Azure App Service | No prefix (platform-injected) |
| `K8S_SERVICE_HOST` | No | Auto-injected by Kubernetes into pods | No prefix (platform-injected) |
| `K8S_SERVICE_PORT` | No | Auto-injected by Kubernetes into pods | No prefix (platform-injected) |
| `DOCKER_HOST_URL` | No | Manually set for Docker containers (e.g., `http://host.docker.internal:3000`) | No prefix (runtime environment) |
| `PUBLIC_URL` | No | Explicit public URL override for any environment | No prefix (runtime environment) |
| `AZURE_FS_API_SWAGGER_ADDITIONAL_SERVERS` | No | Comma-separated additional Swagger server URLs | AZURE_FS_API_ prefix (project config) |
| `AZURE_FS_API_SWAGGER_SERVER_VARIABLES` | No | Enable Swagger server variables (true/false) | AZURE_FS_API_ prefix (project config) |

**Important**: All these environment variables are **optional**. They are NOT added to the config schema validation. They are purely optional enhancements read directly from `process.env` inside the Swagger config module. This does NOT violate the "no fallback" rule because these are not required configuration -- they are optional detection signals. The "fallback" to `http://{host}:{port}` is the correct base behavior, not a substitution for a missing required value.

### New Types/Interfaces

None needed. The Swagger config module uses these values internally without exposing new types.

### Files Modified

#### 1. `src/api/swagger/config.ts` -- `createSwaggerSpec()` function

- **Modify**: Change signature to accept an optional `actualPort` parameter:
  ```typescript
  export function createSwaggerSpec(apiConfig: ApiConfig, actualPort?: number): object
  ```

- **Add**: Private helper function `getBaseUrl(host: string, port: number): string`:
  ```typescript
  function getBaseUrl(host: string, port: number): string {
    // Priority 1: Explicit public URL (overrides all container detection)
    if (process.env.PUBLIC_URL) {
      return process.env.PUBLIC_URL;
    }
    // Priority 2: Azure App Service
    if (process.env.WEBSITE_HOSTNAME) {
      const protocol = process.env.WEBSITE_SITE_NAME ? "https" : "http";
      return `${protocol}://${process.env.WEBSITE_HOSTNAME}`;
    }
    // Priority 3: Kubernetes
    if (process.env.K8S_SERVICE_HOST && process.env.K8S_SERVICE_PORT) {
      const protocol = process.env.AZURE_FS_API_USE_HTTPS === "true" ? "https" : "http";
      return `${protocol}://${process.env.K8S_SERVICE_HOST}:${process.env.K8S_SERVICE_PORT}`;
    }
    // Priority 4: Docker
    if (process.env.DOCKER_HOST_URL) {
      return process.env.DOCKER_HOST_URL;
    }
    // Priority 5: Local development
    return `http://${host}:${port}`;
  }
  ```

- **Add**: Private helper function `buildSwaggerServers(baseUrl: string, apiConfig: ApiConfig): object[]`:
  ```typescript
  function buildSwaggerServers(baseUrl: string, apiConfig: ApiConfig): object[] {
    const servers: object[] = [];

    // Primary server
    const serverEntry: Record<string, unknown> = {
      url: baseUrl,
      description: apiConfig.nodeEnv === "production" ? "Production server" : "Development server",
    };

    // Optional server variables (for Swagger UI interactivity)
    if (process.env.AZURE_FS_API_SWAGGER_SERVER_VARIABLES === "true") {
      serverEntry.url = "{protocol}://{host}:{port}";
      serverEntry.variables = {
        protocol: {
          enum: ["http", "https"],
          default: baseUrl.startsWith("https") ? "https" : "http",
        },
        host: {
          default: baseUrl.replace(/^https?:\/\//, "").replace(/:[0-9]+$/, ""),
          description: "Server hostname",
        },
        port: {
          default: baseUrl.match(/:([0-9]+)$/)?.[1] || (baseUrl.startsWith("https") ? "443" : "80"),
          description: "Server port",
        },
      };
    }

    servers.push(serverEntry);

    // Additional servers from env var
    const additionalServersEnv = process.env.AZURE_FS_API_SWAGGER_ADDITIONAL_SERVERS;
    if (additionalServersEnv) {
      const additionalUrls = additionalServersEnv.split(",").map(s => s.trim()).filter(s => s.length > 0);
      additionalUrls.forEach((url, index) => {
        servers.push({
          url,
          description: `Additional server ${index + 1}`,
        });
      });
    }

    return servers;
  }
  ```

- **Modify**: Replace the static `servers` array with a call to `buildSwaggerServers()`:
  ```typescript
  const effectivePort = actualPort || apiConfig.port;
  const baseUrl = getBaseUrl(apiConfig.host, effectivePort);
  const servers = buildSwaggerServers(baseUrl, apiConfig);
  ```

#### 2. `src/api/server.ts` -- `createApp()` function

- **Modify**: Pass `actualPort` parameter through to `createSwaggerSpec()`:
  ```typescript
  export function createApp(
    config: ApiResolvedConfig,
    blobService: BlobFileSystemService,
    metadataService: MetadataService,
    logger: Logger,
    actualPort?: number,
  ): Express {
    // ...
    const swaggerSpec = createSwaggerSpec(config.api, actualPort);
    // ...
  }
  ```
  Note: `actualPort` is only set when PortChecker (Feature 4) auto-selects a different port.

#### 3. `.env.example`

- **Add** (in REST API section, after existing vars, with comment block):
  ```
  # ---- Swagger Server URL Detection (all optional) ----
  # Comma-separated additional Swagger server URLs
  # AZURE_FS_API_SWAGGER_ADDITIONAL_SERVERS=
  # Enable Swagger server variables for URL editing in Swagger UI (true/false)
  # AZURE_FS_API_SWAGGER_SERVER_VARIABLES=
  ```

### Files Created

None.

### Dependencies on Other Features

- **Depends on**: Feature 1 (NODE_ENV) -- uses `apiConfig.nodeEnv` for server description
- **Related to**: Feature 4 (PortChecker) -- the `actualPort` parameter is used when auto-port-selection chooses a different port

### Acceptance Criteria

- [ ] In Azure App Service (when `WEBSITE_HOSTNAME` is set), Swagger server URL uses HTTPS and the Azure hostname
- [ ] `PUBLIC_URL` overrides all other container detection
- [ ] In Kubernetes (when `K8S_SERVICE_HOST` + `K8S_SERVICE_PORT` are set), correct URL is generated
- [ ] In Docker (when `DOCKER_HOST_URL` is set), that URL is used
- [ ] When no container env vars are set, falls back to `http://{host}:{port}` (local development)
- [ ] `AZURE_FS_API_SWAGGER_ADDITIONAL_SERVERS` adds extra server entries to the Swagger spec
- [ ] `AZURE_FS_API_SWAGGER_SERVER_VARIABLES=true` enables protocol/host/port variables in Swagger UI
- [ ] `actualPort` parameter correctly overrides the configured port in the Swagger URL
- [ ] All new env vars are optional -- missing values do not cause errors
- [ ] Existing behavior (no container env vars set) is unchanged

---

## Feature 4: PortChecker Utility

### Objective

Add a proactive port availability check before the Express server attempts to listen. When the configured port is occupied, optionally auto-select the next available port, or exit with a helpful error identifying which process holds the port.

### New Environment Variables

| Variable | Required | Valid Values | Prefix Convention |
|----------|----------|-------------|-------------------|
| `AUTO_SELECT_PORT` | Yes (API mode) | `true`, `false` | No prefix (standard utility pattern, same as `NODE_ENV`) |

**Decision note**: `AUTO_SELECT_PORT` is required following the project's no-fallback rule. Users must explicitly decide whether to enable auto-port-selection. The variable follows the non-prefixed pattern (like `NODE_ENV`) because it is a standard server utility behavior, not Azure-FS-specific.

### New Types/Interfaces

**File**: `src/utils/port-checker.utils.ts` (new file)

```typescript
export interface PortCheckResult {
  available: boolean;
  port: number;
  error?: string;
}
```

Add to `ApiConfig` in `src/types/api-config.types.ts`:
```typescript
autoSelectPort: boolean;
```

### Files Modified

#### 1. `src/types/api-config.types.ts`

- **Modify**: `ApiConfig` interface -- add `autoSelectPort: boolean` field

#### 2. `src/types/config.types.ts` -- `AzureFsConfigFile` interface

- **Modify**: Add `autoSelectPort?: boolean` to the `api?` section

#### 3. `src/config/config.loader.ts` -- `loadEnvConfig()` function

- **Add**: Read `AUTO_SELECT_PORT` from `process.env`:
  ```typescript
  if (process.env.AUTO_SELECT_PORT !== undefined && process.env.AUTO_SELECT_PORT !== "") {
    env["api"]["autoSelectPort"] = process.env.AUTO_SELECT_PORT === "true";
  }
  ```

#### 4. `src/config/config.schema.ts` -- `validateApiConfig()` function

- **Add**: Validation block for `api.autoSelectPort`:
  - Must be present (throw `ConfigError.missingRequired()`)
  - Must be boolean (throw `ConfigError.invalidValue()`)
  - Remediation:
    - CLI: `(not available as CLI flag, use env var or config file)`
    - Env: `export AUTO_SELECT_PORT=false`
    - Config file: `{ "api": { "autoSelectPort": false } }`
- **Modify**: Return object to include `autoSelectPort`

#### 5. `src/api/server.ts` -- `startServer()` function

- **Modify**: Restructure server startup to perform proactive port check:

  Before the `const server = http.createServer(app);` block, add:
  ```typescript
  import { PortChecker } from "../utils/port-checker.utils";

  // ... inside startServer():

  // 4a. Check port availability
  let actualPort = config.api.port;
  const isAvailable = await PortChecker.isPortAvailable(config.api.port, config.api.host);

  if (!isAvailable) {
    // Log which process is using the port
    const processInfo = await PortChecker.getProcessUsingPort(config.api.port);
    if (processInfo) {
      logger.warn(`Port ${config.api.port} is in use by: ${processInfo}`);
    } else {
      logger.warn(`Port ${config.api.port} is already in use`);
    }

    if (config.api.autoSelectPort) {
      const result = await PortChecker.findAvailablePort(config.api.port + 1, 10, config.api.host);
      if (!result.available) {
        logger.error(result.error || "Could not find an available port");
        process.exit(1);
      }
      actualPort = result.port;
      logger.info(`Auto-selected port ${actualPort}`);
    } else {
      logger.error(`Port ${config.api.port} is already in use. Set AUTO_SELECT_PORT=true to auto-select, or choose a different port.`);
      process.exit(1);
    }
  }

  // 4b. Create Express app (with actualPort for correct Swagger URLs)
  const app = createApp(config, blobService, metadataService, logger, actualPort !== config.api.port ? actualPort : undefined);

  // 5. Start HTTP server
  const server = http.createServer(app);
  server.listen(actualPort, config.api.host, () => {
    // ... use actualPort in log messages ...
  });
  ```

- **Keep**: Existing `server.on("error")` handler as safety net (race condition protection)
- **Modify**: Use `actualPort` instead of `config.api.port` in the `server.listen()` call and startup log messages

#### 6. `.env.example`

- **Add**: `AUTO_SELECT_PORT=` entry in the REST API section

### Files Created

#### `src/utils/port-checker.utils.ts`

New utility file with:

```typescript
import * as net from "net";
import { exec } from "child_process";

export interface PortCheckResult {
  available: boolean;
  port: number;
  error?: string;
}

export class PortChecker {
  /**
   * Check if a TCP port is available by attempting to bind a temporary server.
   */
  static async isPortAvailable(port: number, host: string = "localhost"): Promise<boolean> { ... }

  /**
   * Sequentially scan ports starting from startPort to find an available one.
   */
  static async findAvailablePort(
    startPort: number,
    maxAttempts: number = 10,
    host: string = "localhost",
  ): Promise<PortCheckResult> { ... }

  /**
   * Use lsof to identify which process is using a port (macOS/Linux only).
   * Returns null on failure or unsupported platforms.
   */
  static async getProcessUsingPort(port: number): Promise<string | null> { ... }
}
```

Key implementation details:
- No `chalk` dependency -- use plain string messages (logger handles formatting)
- Use ES module `import` not `require`
- Full TypeScript typing (no `any`)
- `getProcessUsingPort()` returns `null` on Windows or on failure (non-critical informational)
- No dependencies on project config or services (standalone utility)

### Dependencies on Other Features

- **Depends on**: Feature 1 (NODE_ENV) -- `autoSelectPort` is validated alongside other API config
- **Related to**: Feature 3 (Container-Aware Swagger) -- when auto-selecting a port, `actualPort` is passed to `createSwaggerSpec()`

### Acceptance Criteria

- [ ] `AUTO_SELECT_PORT` is required when starting the API server; missing value throws `ConfigError`
- [ ] When configured port is available, server starts normally (no behavior change)
- [ ] When configured port is in use and `AUTO_SELECT_PORT=true`, the next available port is auto-selected and logged
- [ ] When configured port is in use and `AUTO_SELECT_PORT=false`, server exits with error code 1 and helpful message
- [ ] When a port is in use, the process occupying it is logged (on macOS/Linux)
- [ ] When auto-selecting a port, Swagger URLs reflect the actual port (not configured port)
- [ ] Existing `server.on("error")` handler remains as a safety net
- [ ] `PortChecker.isPortAvailable()` correctly detects both available and occupied ports
- [ ] `PortChecker.findAvailablePort()` scans up to `maxAttempts` ports sequentially
- [ ] `PortChecker.getProcessUsingPort()` returns `null` gracefully on unsupported platforms
- [ ] `.env.example` updated with `AUTO_SELECT_PORT` entry

---

## Feature 5: Development Routes

### Objective

Add development-only API endpoints (`/api/dev/env` and `/api/dev/env/:key`) that expose all environment variables with their configuration sources, masked sensitive values, and source statistics. These routes are only available when `NODE_ENV=development`.

### New Environment Variables

None.

### New Types/Interfaces

No new exported types needed. The controller internally uses:

```typescript
// Internal to dev.controller.ts
interface EnvVarInfo {
  name: string;
  value: string;
  source: string;
  masked: boolean;
}
```

### Files Modified

#### 1. `src/api/routes/index.ts` -- `registerApiRoutes()` function

- **Add**: Import `createDevRoutes` from `./dev.routes`
- **Modify**: Add conditional dev route mounting BEFORE the 404 catch-all:
  ```typescript
  // Development-only routes (only mounted in development mode)
  if (services.config.api.nodeEnv === "development") {
    app.use("/api/dev", createDevRoutes(services));
  }
  ```

#### 2. `src/api/routes/index.ts` -- `ApiServices` interface

- Already modified in Feature 2 to include `sourceTracker`

### Files Created

#### `src/api/routes/dev.routes.ts`

Route definitions file with:

```typescript
import { Router } from "express";
import { ApiServices } from "./index";
import { createDevController } from "../controllers/dev.controller";

export function createDevRoutes(services: ApiServices): Router {
  const router = Router();
  const controller = createDevController(services);

  router.get("/env", controller.listEnvVars);
  router.get("/env/:key", controller.getEnvVar);

  return router;
}
```

Include `@openapi` JSDoc annotations for both endpoints (these are only scanned when routes are mounted, so they appear in Swagger only in development mode).

#### `src/api/controllers/dev.controller.ts`

Controller factory file with:

```typescript
import { Request, Response } from "express";
import { ApiServices } from "../routes/index";

const SENSITIVE_PATTERNS = ["SECRET", "PASSWORD", "TOKEN", "KEY", "PRIVATE", "CREDENTIAL"];

export function createDevController(services: ApiServices) {
  return {
    listEnvVars(req: Request, res: Response): void { ... },
    getEnvVar(req: Request, res: Response): void { ... },
  };
}
```

**`GET /api/dev/env` handler behavior**:
1. Double-check `NODE_ENV === "development"` (defense in depth) -- return 403 if not
2. Iterate all `process.env` keys (sorted alphabetically)
3. For each key:
   - Check if key name contains any `SENSITIVE_PATTERNS` substring (case-insensitive) -- if so, mask value as `"***MASKED***"`
   - Look up source from `services.sourceTracker?.getSource(key)` -- use `"system"` label if not tracked (OS-level vars like `PATH`)
4. Build source counts summary
5. Return response in project envelope format:
   ```json
   {
     "success": true,
     "data": {
       "environment": "development",
       "totalVariables": 45,
       "variables": [
         { "name": "AZURE_FS_API_PORT", "value": "3000", "source": "environment-variable", "masked": false },
         { "name": "AZURE_STORAGE_SAS_TOKEN", "value": "***MASKED***", "source": "environment-variable", "masked": true }
       ],
       "sources": {
         "config-file": 5,
         "environment-variable": 12,
         "cli-flag": 2,
         "system": 26
       }
     },
     "metadata": {
       "timestamp": "2026-02-23T10:00:00Z"
     }
   }
   ```

**`GET /api/dev/env/:key` handler behavior**:
1. Double-check `NODE_ENV === "development"` -- return 403 if not
2. Normalize key to uppercase
3. Check if key exists in `process.env` -- return 404 if not
4. Apply sensitive masking logic
5. Return response:
   ```json
   {
     "success": true,
     "data": {
       "name": "AZURE_FS_API_PORT",
       "value": "3000",
       "source": "environment-variable",
       "exists": true,
       "masked": false
     },
     "metadata": {
       "timestamp": "2026-02-23T10:00:00Z"
     }
   }
   ```

### Dependencies on Other Features

- **Hard dependency on Feature 1 (NODE_ENV)**: Routes are gated by `NODE_ENV=development`. Without Feature 1, there is no `nodeEnv` field to check.
- **Soft dependency on Feature 2 (Config Source Tracking)**: Without source tracking, the `source` field shows `"system"` for all variables. With it, project-specific vars show their actual source (`"config-file"`, `"environment-variable"`, `"cli-flag"`).

### Acceptance Criteria

- [ ] `GET /api/dev/env` returns all environment variables sorted alphabetically when `NODE_ENV=development`
- [ ] `GET /api/dev/env/:key` returns a single environment variable when `NODE_ENV=development`
- [ ] Both endpoints return 403 when `NODE_ENV !== "development"` (defense in depth, even though routes should not be mounted)
- [ ] Routes are NOT mounted at all when `NODE_ENV !== "development"` (primary security layer)
- [ ] Sensitive values (keys containing SECRET, PASSWORD, TOKEN, KEY, PRIVATE, CREDENTIAL) are masked as `"***MASKED***"`
- [ ] Source tracking integration: when `ConfigSourceTracker` is available, shows correct source labels for project config keys
- [ ] Variables not tracked by `ConfigSourceTracker` show `"system"` as their source
- [ ] Source counts summary is included in the `/api/dev/env` response
- [ ] Responses use the project's standard envelope format (`{ success, data, metadata }`)
- [ ] `@openapi` JSDoc annotations are included (visible in Swagger only in development mode)
- [ ] `GET /api/dev/env/:key` returns 404 for non-existent environment variable keys

---

## Summary: All Files Changed

### Modified Files

| File | Features | Changes |
|------|----------|---------|
| `src/types/api-config.types.ts` | F1, F4 | Add `NodeEnvironment` type, add `nodeEnv` and `autoSelectPort` to `ApiConfig` |
| `src/types/config.types.ts` | F1, F2, F4 | Add `ConfigSourceLabel`, `ConfigSourceTracker`, update `AzureFsConfigFile.api` |
| `src/config/config.loader.ts` | F1, F2, F4 | Read `NODE_ENV`, `AUTO_SELECT_PORT`; add source tracking to merge logic |
| `src/config/config.schema.ts` | F1, F4 | Validate `nodeEnv` and `autoSelectPort` |
| `src/api/swagger/config.ts` | F1, F3 | Container-aware URL detection, server variables, additional servers, `actualPort` |
| `src/api/server.ts` | F1, F2, F3, F4 | Use `nodeEnv`, pass `sourceTracker`, port check logic, `actualPort` |
| `src/api/middleware/error-handler.middleware.ts` | F1 | Accept `nodeEnv`, conditional stack trace in dev |
| `src/api/routes/index.ts` | F2, F5 | Add `sourceTracker` to `ApiServices`, mount dev routes conditionally |
| `.env.example` | F1, F3, F4 | Add `NODE_ENV`, `AUTO_SELECT_PORT`, Swagger detection vars |

### New Files

| File | Feature | Purpose |
|------|---------|---------|
| `src/utils/port-checker.utils.ts` | F4 | `PortChecker` class with `isPortAvailable()`, `findAvailablePort()`, `getProcessUsingPort()` |
| `src/api/routes/dev.routes.ts` | F5 | Development route definitions (`/api/dev/env`, `/api/dev/env/:key`) |
| `src/api/controllers/dev.controller.ts` | F5 | Controller factory for development endpoints |

### New Environment Variables (Complete)

| Variable | Required | Feature | Prefix | Purpose |
|----------|----------|---------|--------|---------|
| `NODE_ENV` | Yes (API) | F1 | None (Node.js standard) | Environment mode: development, production, test |
| `AUTO_SELECT_PORT` | Yes (API) | F4 | None (standard utility) | Enable auto-port-selection on conflict |
| `WEBSITE_HOSTNAME` | No | F3 | None (Azure-injected) | Azure App Service hostname |
| `WEBSITE_SITE_NAME` | No | F3 | None (Azure-injected) | Azure App Service name |
| `K8S_SERVICE_HOST` | No | F3 | None (K8s-injected) | Kubernetes service host |
| `K8S_SERVICE_PORT` | No | F3 | None (K8s-injected) | Kubernetes service port |
| `DOCKER_HOST_URL` | No | F3 | None (runtime env) | Docker container public URL |
| `PUBLIC_URL` | No | F3 | None (runtime env) | Explicit public URL override |
| `AZURE_FS_API_USE_HTTPS` | No | F3 | AZURE_FS_API_ | Force HTTPS for K8s environments |
| `AZURE_FS_API_SWAGGER_ADDITIONAL_SERVERS` | No | F3 | AZURE_FS_API_ | Comma-separated additional Swagger servers |
| `AZURE_FS_API_SWAGGER_SERVER_VARIABLES` | No | F3 | AZURE_FS_API_ | Enable Swagger server variables (true/false) |

---

## Risk Assessment

| Risk | Impact | Feature | Mitigation |
|------|--------|---------|-----------|
| Breaking change: `NODE_ENV` and `AUTO_SELECT_PORT` become required | Medium | F1, F4 | Clear error messages with remediation. Update `.env.example`. |
| Config loader complexity increase from source tracking | Medium | F2 | Keep `resolveConfig()` (CLI) unchanged. Only API path gets tracking. |
| Port checker race condition | Low | F4 | Keep existing `server.on("error")` handler as safety net. |
| Dev routes security exposure | Low | F5 | Double-gating: routes not mounted in prod + 403 check in handlers. Sensitive value masking. |
| `lsof` platform dependency | Low | F4 | `getProcessUsingPort()` returns `null` on failure -- informational only. |
| Container env var false positives | Low | F3 | Priority chain ensures specificity. `PUBLIC_URL` escape hatch. |

---

## Estimated Effort

| Feature | Complexity | Estimated LOC (new + modified) |
|---------|-----------|-------------------------------|
| F1: NODE_ENV Support | Medium | ~80 lines modified across 8 files |
| F2: Config Source Tracking | Medium-High | ~120 lines modified across 5 files |
| F3: Container-Aware Swagger URLs | Medium | ~100 lines in swagger/config.ts |
| F4: PortChecker Utility | Medium | ~120 lines new file + ~60 lines modified in server.ts |
| F5: Development Routes | Medium | ~180 lines across 2 new files + ~15 lines in routes/index.ts |
| **Total** | | **~675 lines** |
