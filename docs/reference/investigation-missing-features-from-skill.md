# Investigation: 5 Missing Features from create-api-base Skill

**Date**: 2026-02-23
**Investigator**: Claude Code
**Scope**: Technical investigation of 5 features present in the `create-api-base` skill but missing from the Azure FS REST API implementation
**Input Sources**: Skill file `01-model-api-option.md`, deviation analysis `api-skill-deviation-analysis.md`, current project source code

---

## Executive Summary

This document provides a thorough technical investigation of 5 features that exist in the `create-api-base` skill blueprint but are not yet implemented in the Azure FS REST API. For each feature, we document the skill's reference implementation, identify the current project files that need modification, propose an exact integration approach, and assess conflicts and tradeoffs.

**Features investigated:**

| # | Feature | Complexity | Files Impacted |
|---|---------|-----------|----------------|
| 1 | Container-Aware Swagger URLs | Medium | 2 files modified, 0 new |
| 2 | NODE_ENV Support | Medium | 4-5 files modified, 0 new |
| 3 | PortChecker Utility | Medium | 1 new file, 1 modified |
| 4 | Development Routes | Medium | 2 new files, 2 modified |
| 5 | Config Source Tracking | Medium-High | 3-4 files modified |

**Key finding**: All 5 features can be integrated without breaking changes to the existing architecture. The main adaptation challenge is that the skill uses a two-class configuration pattern (`EnvironmentManager` + `AppConfigurationManager`) while the current project uses a single layered loader (`config.loader.ts`). Features 4 and 5 are tightly coupled -- development routes depend on config source tracking to show where each variable originated.

---

## Feature 1: Container-Aware Swagger URLs

### 1.1 Skill Reference Implementation

The skill's `src/config/swagger.ts` contains two key components:

#### 1.1.1 `getBaseUrl()` -- Environment Detection Chain

The skill detects the runtime environment via a priority-ordered chain of environment variable checks:

```typescript
// From skill: src/config/swagger.ts, createSwaggerSpec()
const getBaseUrl = (): string => {
  // Priority 1: Azure App Service (auto-detected)
  if (process.env.WEBSITE_HOSTNAME) {
    const protocol = process.env.WEBSITE_SITE_NAME ? 'https' : 'http';
    return `${protocol}://${process.env.WEBSITE_HOSTNAME}`;
  }

  // Priority 2: Explicit public URL override
  if (process.env.PUBLIC_URL) {
    return process.env.PUBLIC_URL;
  }

  // Priority 3: Kubernetes service (auto-detected)
  if (process.env.K8S_SERVICE_HOST && process.env.K8S_SERVICE_PORT) {
    const protocol = process.env.USE_HTTPS === 'true' ? 'https' : 'http';
    return `${protocol}://${process.env.K8S_SERVICE_HOST}:${process.env.K8S_SERVICE_PORT}`;
  }

  // Priority 4: Docker container
  if (process.env.DOCKER_HOST_URL) {
    return process.env.DOCKER_HOST_URL;
  }

  // Priority 5: Local development (fallback)
  return `http://${host}:${port}`;
};
```

**Detection logic**:
- **Azure App Service**: Azure auto-sets `WEBSITE_HOSTNAME` (e.g., `myapp.azurewebsites.net`) and `WEBSITE_SITE_NAME`. If `WEBSITE_SITE_NAME` is present, the protocol is forced to HTTPS (App Service always has HTTPS).
- **PUBLIC_URL**: A user-provided override that takes precedence over auto-detection of Docker/K8s. Useful for reverse proxies, custom domains, or any environment where the public URL differs from the internal URL.
- **Kubernetes**: K8s auto-injects `K8S_SERVICE_HOST` and `K8S_SERVICE_PORT` into pods. The `USE_HTTPS` flag controls the protocol.
- **Docker**: `DOCKER_HOST_URL` is manually set when the container's external URL differs from internal (e.g., `http://host.docker.internal:3000`).

#### 1.1.2 `ENABLE_SERVER_VARIABLES` -- Swagger UI Interactivity

When `ENABLE_SERVER_VARIABLES=true`, the Swagger spec includes OpenAPI 3.0 server variables that let users modify the server URL components directly in the Swagger UI:

```typescript
// From skill: server variables in swagger spec
variables: process.env.ENABLE_SERVER_VARIABLES === 'true' ? {
  protocol: {
    enum: ['http', 'https'],
    default: baseUrl.startsWith('https') ? 'https' : 'http'
  },
  host: {
    default: baseUrl.replace(/^https?:\/\//, '').replace(/:[0-9]+$/, ''),
    description: 'Server hostname'
  },
  port: {
    default: baseUrl.match(/:([0-9]+)$/)?.[1] || (baseUrl.startsWith('https') ? '443' : '80'),
    description: 'Server port'
  }
} : undefined
```

#### 1.1.3 `SWAGGER_ADDITIONAL_SERVERS` -- Multi-Server Support

```typescript
// From skill: getSwaggerServers()
if (process.env.SWAGGER_ADDITIONAL_SERVERS) {
  const additionalServers = process.env.SWAGGER_ADDITIONAL_SERVERS.split(',');
  additionalServers.forEach((serverUrl, index) => {
    servers.push({
      url: serverUrl.trim(),
      description: `Additional server ${index + 1}`
    });
  });
}
```

#### 1.1.4 `actualPort` Parameter

The skill's `createSwaggerSpec()` accepts an optional `actualPort` parameter to handle the case where the port auto-selector chose a different port than configured:

```typescript
export function createSwaggerSpec(appConfig: AppConfigurationManager, actualPort?: number) {
  const port = actualPort || appConfig.getPort();
  // ...
}
```

### 1.2 Current Project Code

**File**: `/Users/giorgosmarinos/aiwork/agent-platform/azure-storage-tool/src/api/swagger/config.ts`

```typescript
export function createSwaggerSpec(apiConfig: ApiConfig): object {
  const serverUrl = `http://${apiConfig.host}:${apiConfig.port}`;

  const options: swaggerJsdoc.Options = {
    definition: {
      openapi: "3.0.0",
      info: { /* ... */ },
      servers: [
        {
          url: serverUrl,
          description: "Azure FS API Server",
        },
      ],
      // ...
    },
    apis: ["./src/api/routes/*.ts", "./dist/api/routes/*.js"],
  };

  return swaggerJsdoc(options);
}
```

Current behavior: always generates a single server entry using `http://{host}:{port}`. No environment detection, no additional servers, no server variables.

### 1.3 Integration Approach

**Files to modify**:
- `src/api/swagger/config.ts` -- Add `getBaseUrl()` helper, `getSwaggerServers()` helper, `actualPort` parameter
- `src/api/server.ts` -- Pass `actualPort` when calling `createSwaggerSpec()` (needed for Feature 3: PortChecker)

**Changes to `createSwaggerSpec()`**:

1. Change signature to `createSwaggerSpec(apiConfig: ApiConfig, actualPort?: number): object`
2. Add a private `getBaseUrl(host, port)` function that implements the environment detection chain
3. Add a private `buildSwaggerServers(baseUrl, apiConfig)` function that builds the servers array
4. Support `ENABLE_SERVER_VARIABLES` via env var check
5. Support `SWAGGER_ADDITIONAL_SERVERS` via env var check

**Environment variables to add** (all optional, no validation needed -- they only enhance Swagger docs):
- `AZURE_FS_API_PUBLIC_URL` -- Public URL override (maps to skill's `PUBLIC_URL`)
- `AZURE_FS_API_SWAGGER_ADDITIONAL_SERVERS` -- Comma-separated additional servers (maps to skill's `SWAGGER_ADDITIONAL_SERVERS`)
- `AZURE_FS_API_SWAGGER_SERVER_VARIABLES` -- Enable server variables (maps to skill's `ENABLE_SERVER_VARIABLES`)

**Note on env var naming**: The project prefixes all API env vars with `AZURE_FS_API_`. The auto-detected vars (`WEBSITE_HOSTNAME`, `WEBSITE_SITE_NAME`, `K8S_SERVICE_HOST`, `K8S_SERVICE_PORT`) are NOT prefixed because they are set by the platform, not by the user. `USE_HTTPS` should become `AZURE_FS_API_USE_HTTPS` for consistency.

**Important**: These environment variables are all optional. They enhance Swagger behavior but do not affect core functionality. Per the project's "no fallback" rule, this is acceptable because these are NOT required configuration -- they are optional enhancements. Missing values simply mean the environment is not detected, and the fallback to `http://{host}:{port}` is the correct default behavior (not a "fallback" in the configuration sense).

### 1.4 Conflicts and Tradeoffs

| Concern | Assessment |
|---------|-----------|
| Breaking change | None -- existing behavior is the fallback case |
| New dependencies | None |
| Config schema validation | These env vars should NOT be added to the required config schema. They are purely optional enhancements. |
| Testing | Difficult to test Azure/K8s env detection locally. Should use unit tests that mock `process.env`. |

---

## Feature 2: NODE_ENV Support

### 2.1 Skill Reference Implementation

The skill uses `NODE_ENV` in 5 distinct places:

#### 2.1.1 Configuration Loading Priority

```typescript
// From skill: EnvironmentManager.initialize()
const env = process.env.NODE_ENV || 'development';
const envFile = `.env.${env}`;
const envResult = dotenv.config({ path: envFile });
```

Loads `.env` first, then `.env.{NODE_ENV}` (overrides base). Values from the environment-specific file override the base `.env` file.

#### 2.1.2 Configuration Validation (Required Variable)

```typescript
// From skill: EnvironmentManager.validateConfiguration()
if (!process.env.NODE_ENV) {
  throw ConfigError.missingRequired(
    'NODE_ENV',
    'export NODE_ENV=development',
    '(set NODE_ENV in your .env file)',
  );
}
```

The skill treats `NODE_ENV` as a required variable with no default.

#### 2.1.3 Swagger Server Description

```typescript
// From skill: swagger.ts
description: process.env.NODE_ENV === 'production' ? 'Production server' : 'Development server',
```

#### 2.1.4 Development Route Gating

```typescript
// From skill: routes/index.ts
if (process.env.NODE_ENV === 'development') {
  app.use('/api/dev', createDevelopmentRoutes(services.appConfigManager));
}

// From skill: developmentRoutes.ts (double-check inside handler)
if (process.env.NODE_ENV !== 'development') {
  return res.status(403).json({
    error: 'This endpoint is only available in development mode'
  });
}
```

Two layers of protection: routes are not even mounted in non-development mode, AND the handlers check again as a safety net.

#### 2.1.5 Error Stack Traces

```typescript
// From skill: server.ts catch block
if (error.stack && process.env.NODE_ENV === 'development') {
  console.error(error.stack);
}
```

Stack traces are only logged in development mode.

### 2.2 Current Project Code

The project currently has exactly one reference to `NODE_ENV`:

```typescript
// From: src/api/server.ts, line 115
environment: process.env.NODE_ENV || "development",
```

This is used only for a log message during startup. No other code reads or depends on `NODE_ENV`.

### 2.3 Integration Approach

**Decision: Should `NODE_ENV` be required or optional?**

The project's rule is "no fallbacks." However, `NODE_ENV` is a Node.js ecosystem convention, not a project-specific configuration variable. There are two options:

- **Option A (Strict)**: Make `NODE_ENV` required in the API config schema. Throw `ConfigError` if missing. This is consistent with the project's philosophy and the skill's approach.
- **Option B (Pragmatic)**: Read `NODE_ENV` from `process.env` directly wherever needed, without adding it to the config schema. This avoids coupling a Node.js convention to the project's config validation.

**Recommended: Option A** -- Add `NODE_ENV` as a required env var for API mode. This is consistent with both the project's no-fallback rule and the skill's approach. It must be set explicitly.

**Files to modify**:

1. **`src/types/api-config.types.ts`** -- Add `nodeEnv: string` to `ApiConfig`
2. **`src/config/config.loader.ts`** -- Read `NODE_ENV` from process.env in `loadEnvConfig()`
3. **`src/config/config.schema.ts`** -- Add `NODE_ENV` validation in `validateApiConfig()` (valid values: `development`, `production`, `test`)
4. **`src/api/server.ts`** -- Use `config.api.nodeEnv` instead of `process.env.NODE_ENV`
5. **`src/api/swagger/config.ts`** -- Use `nodeEnv` for server description
6. **`src/api/middleware/error-handler.middleware.ts`** -- Conditionally include stack traces in development mode
7. **`.env.example`** -- Add `NODE_ENV=` entry

**Impact on error handler**:

Currently, the error handler never includes stack traces in the response. With `NODE_ENV` support, when `NODE_ENV=development`, the error response for unknown errors could include the stack trace to aid debugging. The change would be:

```typescript
// In error-handler.middleware.ts, unknown errors section:
res.status(500).json({
  success: false,
  error: {
    code: "INTERNAL_ERROR",
    message: "An internal server error occurred.",
    // NEW: include stack in development only
    ...(nodeEnv === 'development' && errorStack ? { stack: errorStack } : {}),
  },
  metadata: { timestamp },
});
```

**Note**: The `nodeEnv` value must be passed to the error handler factory. This means changing the factory signature from `createErrorHandlerMiddleware(logger)` to `createErrorHandlerMiddleware(logger, nodeEnv)`.

### 2.4 Conflicts and Tradeoffs

| Concern | Assessment |
|---------|-----------|
| Breaking change | Yes (minor) -- `NODE_ENV` becomes required for API startup. Users must add it to `.env` or environment. |
| Environment-specific .env files | NOT adopting this feature. The project already has a richer config system (file + env + CLI). Adding `.env.{NODE_ENV}` files would create confusion. |
| Impact on CLI | None -- `NODE_ENV` is only validated in `validateApiConfig()`, not in `validateConfig()`. |
| `dotenv` dependency | The project already uses `dotenv` (imported in `server.ts` line 1). No new dependency needed. |

---

## Feature 3: PortChecker Utility

### 3.1 Skill Reference Implementation

The skill provides a `PortChecker` class in `src/utils/portChecker.ts` with three static methods:

#### 3.1.1 `isPortAvailable(port, host)` -- TCP Probe

```typescript
// From skill: src/utils/portChecker.ts
static async isPortAvailable(port: number, host: string = 'localhost'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close();
      resolve(true);
    });

    server.listen(port, host);
  });
}
```

**How it works**: Creates a temporary `net.Server`, attempts to bind to the port. If binding succeeds, the port is available (the server is immediately closed). If `EADDRINUSE` fires, the port is taken. This is a proactive check BEFORE the actual Express server tries to listen.

#### 3.1.2 `findAvailablePort(startPort, maxAttempts, host)` -- Sequential Scan

```typescript
// From skill: src/utils/portChecker.ts
static async findAvailablePort(
  startPort: number,
  maxAttempts: number = 10,
  host: string = 'localhost'
): Promise<PortCheckResult> {
  let currentPort = startPort;
  for (let i = 0; i < maxAttempts; i++) {
    const isAvailable = await this.isPortAvailable(currentPort, host);
    if (isAvailable) {
      return { available: true, port: currentPort };
    }
    if (i === 0) {
      console.log(chalk.yellow(`Port ${currentPort} is already in use`));
    }
    currentPort++;
  }
  return {
    available: false,
    port: startPort,
    error: `Could not find an available port after ${maxAttempts} attempts (${startPort}-${startPort + maxAttempts - 1})`
  };
}
```

Iterates from `startPort` to `startPort + maxAttempts - 1`, testing each port sequentially. Returns the first available port or an error result.

#### 3.1.3 `getProcessUsingPort(port)` -- lsof Lookup

```typescript
// From skill: src/utils/portChecker.ts
static async getProcessUsingPort(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    exec(`lsof -i :${port} | grep LISTEN | head -1`, (error: any, stdout: string) => {
      if (error || !stdout.trim()) {
        resolve(null);
        return;
      }
      const parts = stdout.trim().split(/\s+/);
      const command = parts[0];
      const pid = parts[1];
      if (command && pid) {
        resolve(`${command} (PID: ${pid})`);
      } else {
        resolve(null);
      }
    });
  });
}
```

**Platform limitation**: `lsof` is macOS/Linux only. On Windows, this would fail silently (returns `null`), which is acceptable behavior.

#### 3.1.4 `AUTO_SELECT_PORT` Env Var

The skill's `server.ts` implements a flow:

1. Check if configured port is available using `PortChecker.isPortAvailable()`
2. If NOT available:
   - Log which process is using the port (`getProcessUsingPort()`)
   - If `AUTO_SELECT_PORT=true`: call `findAvailablePort()` to find the next free port, then re-create the Express app with the new port (so Swagger URLs are correct)
   - If `AUTO_SELECT_PORT=false` (or unset): throw error and exit

### 3.2 Current Project Code

**File**: `/Users/giorgosmarinos/aiwork/agent-platform/azure-storage-tool/src/api/server.ts` (lines 97-105)

```typescript
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    logger.error(`Port ${config.api.port} is already in use. Choose a different port.`);
    process.exit(1);
  }
  logger.error(`Server error: ${err.message}`);
  process.exit(1);
});
```

Current behavior: only detects port conflict AFTER `server.listen()` fails. No process identification, no auto-selection.

### 3.3 Integration Approach

**New file**: `src/utils/port-checker.utils.ts`

The PortChecker utility should be created as a new utility file, following the project's naming convention (`*.utils.ts`). It is a standalone utility with no dependencies on the project's config or services.

**Adaptations from the skill**:
- Remove `chalk` dependency -- use the project's `Logger` instead
- Use `import { exec } from 'child_process'` instead of `require`
- Add proper TypeScript typing (no `any`)
- Export the `PortCheckResult` interface

**New env var**: `AZURE_FS_API_AUTO_SELECT_PORT` (maps to skill's `AUTO_SELECT_PORT`)

**Decision: Should `AUTO_SELECT_PORT` be required or optional?**

This is a behavioral toggle, not a required configuration value. However, per the project's strict no-fallback rule, we have two options:

- **Option A (Strict)**: Make it required in `validateApiConfig()`. User must explicitly set `true` or `false`.
- **Option B (Exception)**: Allow it to be optional with implicit `false` behavior (i.e., if not set, port conflicts cause exit).

**Recommended: Option A** -- Make it required for API mode. This is consistent with the project's philosophy that every configuration parameter must be explicitly set. The user must consciously decide whether to enable auto-selection.

**Changes to `src/api/server.ts`**:

The server startup sequence changes from:

```
1. Create HTTP server
2. Register error handler on server
3. Call server.listen()
```

To:

```
1. Check port availability with PortChecker.isPortAvailable()
2. If port is taken:
   a. Log process info via PortChecker.getProcessUsingPort()
   b. If AUTO_SELECT_PORT: find new port via PortChecker.findAvailablePort()
   c. If not: exit with error
3. Create Express app (with actualPort if different from configured)
4. Create HTTP server
5. Call server.listen(actualPort)
```

**Impact on Swagger**: When the port changes, `createSwaggerSpec()` must use the actual port, not the configured port. This ties directly into Feature 1 (the `actualPort` parameter).

### 3.4 Conflicts and Tradeoffs

| Concern | Assessment |
|---------|-----------|
| Breaking change | Yes (minor) -- `AZURE_FS_API_AUTO_SELECT_PORT` becomes required for API startup |
| Race condition | Between `isPortAvailable()` check and `server.listen()`, another process could grab the port. The existing `server.on('error')` handler should remain as a safety net. |
| Platform dependency | `getProcessUsingPort()` uses `lsof` (macOS/Linux only). Returns `null` on Windows -- acceptable degradation. |
| App re-creation | When auto-selecting a new port, the Express app must be re-created to get correct Swagger URLs. This means `createApp()` is called twice. |

---

## Feature 4: Development Routes

### 4.1 Skill Reference Implementation

The skill provides `src/routes/developmentRoutes.ts` with two endpoints:

#### 4.1.1 `GET /api/dev/env` -- List All Environment Variables

```typescript
// From skill: src/routes/developmentRoutes.ts
router.get('/env', (req, res) => {
  // Double-check we're in development mode
  if (process.env.NODE_ENV !== 'development') {
    return res.status(403).json({
      error: 'This endpoint is only available in development mode'
    });
  }

  const sensitiveKeys = ['SECRET', 'PASSWORD', 'TOKEN', 'KEY', 'PRIVATE', 'CREDENTIAL'];
  const envVars: Array<{ name: string; value: string; source: string; masked: boolean }> = [];
  const sourceCounts: Record<string, number> = {};

  Object.keys(process.env).sort().forEach(key => {
    const value = process.env[key] || '';
    const source = appConfigManager.getEnvironmentManager().getConfigSource(key) || 'Unknown';
    const isSensitive = sensitiveKeys.some(sensitive => key.toUpperCase().includes(sensitive));

    envVars.push({
      name: key,
      value: isSensitive ? '***MASKED***' : value,
      source: source,
      masked: isSensitive
    });
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  });

  res.json({
    environment: process.env.NODE_ENV,
    totalVariables: envVars.length,
    variables: envVars,
    sources: sourceCounts
  });
});
```

**Key behaviors**:
- Lists ALL `process.env` variables (not just project-specific ones), sorted alphabetically
- Masks values where the key contains any of: `SECRET`, `PASSWORD`, `TOKEN`, `KEY`, `PRIVATE`, `CREDENTIAL`
- Shows the source of each variable (`.env file`, `.env.development file`, `Environment variable`)
- Returns source counts summary
- Double-checks `NODE_ENV === 'development'` even inside the handler (defense in depth)

#### 4.1.2 `GET /api/dev/env/:key` -- Get Specific Variable

```typescript
// From skill: src/routes/developmentRoutes.ts
router.get('/env/:key', (req, res) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(403).json({ error: 'This endpoint is only available in development mode' });
  }

  const key = req.params.key.toUpperCase();
  const exists = key in process.env;

  if (!exists) {
    return res.status(404).json({ error: 'Environment variable not found', name: key });
  }

  const sensitiveKeys = ['SECRET', 'PASSWORD', 'TOKEN', 'KEY', 'PRIVATE', 'CREDENTIAL'];
  const isSensitive = sensitiveKeys.some(sensitive => key.includes(sensitive));

  res.json({
    name: key,
    value: isSensitive ? '***MASKED***' : process.env[key],
    source: appConfigManager.getEnvironmentManager().getConfigSource(key) || 'Unknown',
    exists: true,
    masked: isSensitive
  });
});
```

#### 4.1.3 Route Mounting (Gated by NODE_ENV)

```typescript
// From skill: routes/index.ts
if (process.env.NODE_ENV === 'development') {
  app.use('/api/dev', createDevelopmentRoutes(services.appConfigManager));
}
```

The routes are conditionally mounted. In production, `/api/dev/*` does not exist at all (404).

### 4.2 Current Project Code

**File**: `/Users/giorgosmarinos/aiwork/agent-platform/azure-storage-tool/src/api/routes/index.ts`

The route barrel currently registers: health, files, edit, folders, meta, tags, then the 404 catch-all. No development routes exist.

### 4.3 Integration Approach

**New files**:
- `src/api/routes/dev.routes.ts` -- Development route definitions
- `src/api/controllers/dev.controller.ts` -- Controller factory (to follow the project's existing pattern)

**Modified files**:
- `src/api/routes/index.ts` -- Add conditional mounting of dev routes before the 404 catch-all

**Adaptation from skill**:

The skill passes `AppConfigurationManager` to the dev routes. In our project, we need to pass the config source tracker (Feature 5). The routes should follow the project's existing patterns:

1. **Response envelope**: Use the project's `{ success, data, metadata }` format (not the raw format from the skill)
2. **Controller pattern**: Create a `createDevController()` factory that receives the config source tracker
3. **OpenAPI annotations**: Use `@openapi` tag (project convention) not `@swagger`
4. **Mount path**: `/api/dev` (same as skill)

**Source of config source data**: This depends on Feature 5. If source tracking is implemented, the dev routes can show source info. If not, the `source` field would show `'Unknown'` for all variables, which reduces the value of this feature significantly.

**Security considerations**:
- Two layers of protection (same as skill): route not mounted in non-development + 403 check inside handler
- `SENSITIVE_PATTERNS` array should be defined as a constant: `['SECRET', 'PASSWORD', 'TOKEN', 'KEY', 'PRIVATE', 'CREDENTIAL']`
- The masking applies to environment variable NAMES, not values -- if the key contains any sensitive pattern, the value is masked

### 4.4 Conflicts and Tradeoffs

| Concern | Assessment |
|---------|-----------|
| Dependency on Feature 2 (NODE_ENV) | **Hard dependency** -- dev routes are gated by `NODE_ENV=development`. Feature 2 must be implemented first. |
| Dependency on Feature 5 (Source Tracking) | **Soft dependency** -- dev routes work without source tracking, but with reduced value (`source: 'Unknown'` everywhere). Recommended to implement Feature 5 first. |
| Security risk | Mitigated by double-gating (mount check + handler check). In production, endpoints simply don't exist. |
| Swagger documentation | Dev routes should appear in Swagger only in development mode. Since Swagger spec is generated at startup, and the routes are only mounted in development, the JSDoc annotations will only be scanned when routes are mounted. |

---

## Feature 5: Config Source Tracking

### 5.1 Skill Reference Implementation

The skill uses a `Map<string, string>` in `EnvironmentManager` to track where each configuration variable was loaded from:

```typescript
// From skill: src/config/EnvironmentManager.ts
export class EnvironmentManager {
  private configSources: Map<string, string> = new Map();

  async initialize(): Promise<void> {
    // Step 1: Load base .env file
    const baseResult = dotenv.config();
    if (baseResult.parsed) {
      Object.keys(baseResult.parsed).forEach(key => {
        this.configSources.set(key, '.env file');
      });
    }

    // Step 2: Load environment-specific .env file (overrides base)
    const envFile = `.env.${env}`;
    const envResult = dotenv.config({ path: envFile });
    if (envResult.parsed) {
      Object.keys(envResult.parsed).forEach(key => {
        this.configSources.set(key, `${envFile} file`);
      });
    }

    // Step 3: Track actual environment variables
    Object.keys(process.env).forEach(key => {
      if (!this.configSources.has(key)) {
        this.configSources.set(key, 'Environment variable');
      }
    });
  }

  getConfigSource(key: string): string | undefined {
    return this.configSources.get(key);
  }
}
```

**Source labels used by the skill**:
- `.env file` -- loaded from the base `.env` file
- `.env.{NODE_ENV} file` -- loaded from environment-specific file
- `Environment variable` -- set in the OS/shell environment (not from any file)

The `printConfigSources()` method provides a summary:

```typescript
printConfigSources(): void {
  const sourceCounts: Record<string, number> = {};
  this.configSources.forEach((source, key) => {
    if (key.includes('SECRET') || key.includes('PASSWORD') || key.includes('TOKEN')) {
      // Print with "(hidden)" suffix
    }
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  });
  // Print total and source breakdown
}
```

### 5.2 Current Project Code

The project's `config.loader.ts` loads from three sources in this priority order:

1. **Config file** (`.azure-fs.json`) -- loaded by `loadConfigFile()`
2. **Environment variables** -- loaded by `loadEnvConfig()`
3. **CLI flags** -- loaded by `loadCliConfig()`

These are merged by `mergeConfigSection()` with later sources overriding earlier ones. However, **no tracking** is done. The merge is silent -- there is no record of which source provided which value.

### 5.3 Integration Approach

**Who should own the tracking?**

Option A: A new standalone class (like the skill's `EnvironmentManager`)
Option B: Extend the existing `config.loader.ts` with a tracking side-channel

**Recommended: Option B** -- Add tracking to the existing loader. The project's layered config system is different from the skill's two-class pattern, and introducing a new class would be over-engineering. Instead, we add a `ConfigSourceTracker` that is populated during the merge process.

**New type**:

```typescript
// In src/types/config.types.ts or a new src/types/config-source.types.ts
export type ConfigSourceLabel = 'config-file' | 'environment-variable' | 'cli-flag';

export interface ConfigSourceTracker {
  /** Get the source of a specific config key */
  getSource(key: string): ConfigSourceLabel | undefined;
  /** Get all tracked sources as a map */
  getAllSources(): Map<string, ConfigSourceLabel>;
}
```

**Changes to `config.loader.ts`**:

The `mergeConfigSection()` function currently does a simple merge. We need to track which source "won" for each key. The approach:

1. Create a `Map<string, ConfigSourceLabel>` before merging
2. During merge, when a value is applied from a source, record it: `tracker.set('storage.accountUrl', 'config-file')`
3. When a later source overrides, update the tracker: `tracker.set('storage.accountUrl', 'environment-variable')`
4. Return the tracker alongside the merged config

**Adaptation details**:

The skill tracks ALL environment variables (including OS-level ones like `PATH`, `HOME`, etc.). For the Azure FS project, we should track only the project-relevant configuration keys. This is both more useful and more secure.

The labels should reflect the project's actual sources:
- `config-file` -- value came from `.azure-fs.json`
- `environment-variable` -- value came from `process.env.AZURE_*` or `process.env.NODE_ENV`
- `cli-flag` -- value came from CLI arguments

**How to expose via dev routes (Feature 4)**:

The `ConfigSourceTracker` instance must be available to the dev routes. This means:
1. `resolveApiConfig()` returns the tracker alongside the config
2. The tracker is passed to `createApp()` and stored in the `ApiServices` interface
3. Dev routes receive it from `ApiServices`

**Alternative for dev routes**: Instead of tracking only project config keys, the dev routes could also show ALL `process.env` variables (like the skill does), using a simpler approach: any variable that appears in `.azure-fs.json` is labeled `config-file`, any that was explicitly loaded from `loadEnvConfig()` is labeled `environment-variable`, etc. Variables not in either category (OS-level vars) are labeled `system`.

### 5.4 Conflicts and Tradeoffs

| Concern | Assessment |
|---------|-----------|
| Complexity increase | Moderate -- `config.loader.ts` becomes more complex. The tracker adds a second output channel. |
| Return type change | `resolveApiConfig()` currently returns `ApiResolvedConfig`. It could return `{ config: ApiResolvedConfig, sources: ConfigSourceTracker }`, or the tracker could be attached to the config object. |
| Impact on CLI `config show` | The existing `config show` command could be enhanced to display source information, but this is out of scope for the current features. |
| Memory overhead | Negligible -- a Map with ~20 entries. |
| Feature 4 dependency | Without this feature, dev routes show `source: 'Unknown'` for everything. With it, dev routes provide a full audit trail. |

---

## Integration Strategy

### Implementation Order

The features have dependencies that dictate the implementation order:

```
Feature 2 (NODE_ENV) ──────────────────────────────┐
                                                     │
Feature 5 (Config Source Tracking) ─────────────────┤
                                                     ├──> Feature 4 (Dev Routes)
Feature 1 (Container-Aware Swagger) ──────────────┘│
                                                     │
Feature 3 (PortChecker) ───────────────────────────┘
```

**Recommended order**:

1. **Feature 2 (NODE_ENV)** -- Foundation. Needed by Features 3, 4, and impacts error handler.
2. **Feature 5 (Config Source Tracking)** -- Needed by Feature 4 for full value.
3. **Feature 1 (Container-Aware Swagger)** -- Independent of others, but pairs well with Feature 3's `actualPort`.
4. **Feature 3 (PortChecker)** -- Requires Feature 1's `actualPort` parameter in `createSwaggerSpec()`. Requires Feature 2's `NODE_ENV` for auto-select port config.
5. **Feature 4 (Dev Routes)** -- Last, because it depends on Features 2 and 5.

### Files Changed Summary

| File | Features |
|------|----------|
| `src/types/api-config.types.ts` | F2 (nodeEnv), F3 (autoSelectPort) |
| `src/config/config.loader.ts` | F2 (NODE_ENV loading), F5 (source tracking) |
| `src/config/config.schema.ts` | F2 (NODE_ENV validation), F3 (autoSelectPort validation) |
| `src/api/swagger/config.ts` | F1 (container detection, server variables, additional servers, actualPort) |
| `src/api/server.ts` | F2 (use nodeEnv), F3 (PortChecker integration, actualPort) |
| `src/api/middleware/error-handler.middleware.ts` | F2 (stack traces in dev) |
| `src/api/routes/index.ts` | F4 (mount dev routes) |
| `.env.example` | F1, F2, F3 (new env vars) |

| New File | Feature |
|----------|---------|
| `src/utils/port-checker.utils.ts` | F3 |
| `src/api/routes/dev.routes.ts` | F4 |
| `src/api/controllers/dev.controller.ts` | F4 |

---

## Risk Assessment

### High Risk

| Risk | Feature | Mitigation |
|------|---------|-----------|
| Breaking change: `NODE_ENV` and `AUTO_SELECT_PORT` become required | F2, F3 | Clear error messages with remediation. Update `.env.example` and docs. |
| Config loader return type change for source tracking | F5 | Could use a side-channel (module-level variable) instead of changing the return type, though that's less clean. |

### Medium Risk

| Risk | Feature | Mitigation |
|------|---------|-----------|
| Port checker race condition | F3 | Keep existing `server.on('error')` handler as safety net alongside the proactive check. |
| Dev routes security exposure | F4 | Double-gating (mount check + handler check). Sensitive value masking. |
| `lsof` platform dependency | F3 | `getProcessUsingPort()` returns `null` on failure -- informational only, not critical. |

### Low Risk

| Risk | Feature | Mitigation |
|------|---------|-----------|
| Container env var detection false positives | F1 | Priority chain ensures most specific detection wins. `PUBLIC_URL` override provides escape hatch. |
| Swagger server variables confusion | F1 | Disabled by default (`AZURE_FS_API_SWAGGER_SERVER_VARIABLES=false`). Only enabled by explicit opt-in. |
| Config source tracking memory | F5 | Negligible for ~20 keys. |
