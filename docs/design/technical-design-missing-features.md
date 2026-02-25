# Technical Design: 5 Missing Features from create-api-base Skill

**Date**: 2026-02-23
**Author**: Claude Code
**Status**: Ready for Implementation
**Input**: `plan-005-missing-features-from-skill.md`, `investigation-missing-features-from-skill.md`, `01-model-api-option.md`
**Target**: `docs/design/technical-design-missing-features.md`

---

## Table of Contents

1. [Feature 1: NODE_ENV Support](#feature-1-node_env-support)
2. [Feature 2: Config Source Tracking](#feature-2-config-source-tracking)
3. [Feature 3: Container-Aware Swagger URLs](#feature-3-container-aware-swagger-urls)
4. [Feature 4: PortChecker Utility](#feature-4-portchecker-utility)
5. [Feature 5: Development Routes](#feature-5-development-routes)
6. [Updated .env.example](#updated-envexample)
7. [Updated .azure-fs.json.example](#updated-azure-fsjsonexample)
8. [Updated Types Barrel Export](#updated-types-barrel-export)

---

## Feature 1: NODE_ENV Support

### 1.1 `src/types/api-config.types.ts` -- FULL FILE (AFTER)

```typescript
import { ResolvedConfig } from "./config.types";
import { ConfigSourceTracker } from "./config.types";

/**
 * Valid NODE_ENV values for the API server.
 */
export type NodeEnvironment = "development" | "production" | "test";

/**
 * API-specific configuration settings.
 * All fields are required when running in API mode.
 * No fallback/default values -- every missing field throws ConfigError.
 */
export interface ApiConfig {
  port: number;
  host: string;
  corsOrigins: string[];
  swaggerEnabled: boolean;
  uploadMaxSizeMb: number;
  requestTimeoutMs: number;
  nodeEnv: NodeEnvironment;
  autoSelectPort: boolean;
}

/**
 * Resolved configuration with a required API section.
 * Used exclusively by the API server entry point (src/api/server.ts).
 * Guarantees the `api` section is present and fully validated.
 */
export interface ApiResolvedConfig extends ResolvedConfig {
  api: ApiConfig;
  sourceTracker?: ConfigSourceTracker;
}
```

**Changes from BEFORE**:
- Added `import { ConfigSourceTracker } from "./config.types"` (also serves Feature 2)
- Added `NodeEnvironment` type alias
- Added `nodeEnv: NodeEnvironment` to `ApiConfig`
- Added `autoSelectPort: boolean` to `ApiConfig` (also serves Feature 4)
- Added `sourceTracker?: ConfigSourceTracker` to `ApiResolvedConfig` (also serves Feature 2)

### 1.2 `src/types/config.types.ts` -- FULL FILE (AFTER)

```typescript
import { ApiConfig } from "./api-config.types";

/**
 * Authentication methods supported by azure-fs.
 *
 * - "connection-string": Uses AZURE_STORAGE_CONNECTION_STRING env var
 * - "sas-token": Uses AZURE_STORAGE_SAS_TOKEN env var appended to account URL
 * - "azure-ad": Uses DefaultAzureCredential (recommended)
 */
export type AuthMethod = "connection-string" | "sas-token" | "azure-ad";

/**
 * Log level for the logger utility.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Retry strategy for transient Azure errors.
 */
export type RetryStrategy = "none" | "exponential" | "fixed";

/**
 * Labels identifying where a configuration value originated.
 */
export type ConfigSourceLabel = "config-file" | "environment-variable" | "cli-flag";

/**
 * Tracks the source of each resolved configuration key.
 * Used by the API server to provide an audit trail of where each
 * config value came from (consumed by development routes).
 */
export interface ConfigSourceTracker {
  /** Record the source of a config key */
  set(key: string, source: ConfigSourceLabel): void;
  /** Get the source of a specific config key */
  getSource(key: string): ConfigSourceLabel | undefined;
  /** Get all tracked sources as a plain record */
  getAllSources(): Record<string, ConfigSourceLabel>;
}

/**
 * The structure of the .azure-fs.json configuration file.
 * All fields are optional in the file because they can be provided
 * via environment variables or CLI flags.
 */
export interface AzureFsConfigFile {
  storage?: {
    accountUrl?: string;
    containerName?: string;
    authMethod?: AuthMethod;
    sasTokenExpiry?: string;
  };
  logging?: {
    level?: LogLevel;
    logRequests?: boolean;
  };
  retry?: {
    strategy?: RetryStrategy;
    maxRetries?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
  };
  batch?: {
    concurrency?: number;
  };
  api?: {
    port?: number;
    host?: string;
    corsOrigins?: string[];
    swaggerEnabled?: boolean;
    uploadMaxSizeMb?: number;
    requestTimeoutMs?: number;
    nodeEnv?: string;
    autoSelectPort?: boolean;
  };
}

/**
 * CLI options that can override configuration values.
 */
export interface CliOptions {
  accountUrl?: string;
  container?: string;
  authMethod?: string;
  config?: string;
  json?: boolean;
  verbose?: boolean;
}

/**
 * Fully resolved and validated configuration.
 * Every required field is guaranteed to be present.
 * No fallback/default values are used -- every field must be explicitly provided.
 */
export interface ResolvedConfig {
  storage: {
    accountUrl: string;
    containerName: string;
    authMethod: AuthMethod;
    sasTokenExpiry?: string;
  };
  logging: {
    level: LogLevel;
    logRequests: boolean;
  };
  retry: {
    strategy: RetryStrategy;
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
  };
  batch: {
    concurrency: number;
  };
  api?: ApiConfig;
}
```

**Changes from BEFORE**:
- Added `ConfigSourceLabel` type alias (Feature 2)
- Added `ConfigSourceTracker` interface (Feature 2)
- Added `nodeEnv?: string` to `AzureFsConfigFile.api`
- Added `autoSelectPort?: boolean` to `AzureFsConfigFile.api` (Feature 4)

### 1.3 `src/config/config.schema.ts` -- FULL FILE (AFTER)

```typescript
import { AuthMethod, LogLevel, ResolvedConfig, RetryStrategy } from "../types/config.types";
import { ApiConfig, NodeEnvironment } from "../types/api-config.types";
import { ConfigError } from "../errors/config.error";

const VALID_AUTH_METHODS: AuthMethod[] = ["connection-string", "sas-token", "azure-ad"];
const VALID_LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];
const VALID_RETRY_STRATEGIES: RetryStrategy[] = ["none", "exponential", "fixed"];
const VALID_NODE_ENVIRONMENTS: NodeEnvironment[] = ["development", "production", "test"];

/**
 * Validates that a merged configuration object has all required fields.
 * Throws ConfigError with detailed instructions for any missing field.
 *
 * CRITICAL: No fallback/default values. Every missing required field throws.
 */
export function validateConfig(merged: Record<string, unknown>): ResolvedConfig {
  const storage = (merged["storage"] as Record<string, unknown>) || {};
  const logging = (merged["logging"] as Record<string, unknown>) || {};
  const retry = (merged["retry"] as Record<string, unknown>) || {};
  const batch = (merged["batch"] as Record<string, unknown>) || {};

  // --- Storage section ---
  if (!storage["accountUrl"]) {
    throw ConfigError.missingRequired(
      "storage.accountUrl",
      "--account-url https://myaccount.blob.core.windows.net",
      "export AZURE_STORAGE_ACCOUNT_URL=https://myaccount.blob.core.windows.net",
      '{ "storage": { "accountUrl": "https://myaccount.blob.core.windows.net" } }',
    );
  }

  if (!storage["containerName"]) {
    throw ConfigError.missingRequired(
      "storage.containerName",
      "--container my-container",
      "export AZURE_STORAGE_CONTAINER_NAME=my-container",
      '{ "storage": { "containerName": "my-container" } }',
    );
  }

  if (!storage["authMethod"]) {
    throw ConfigError.missingRequired(
      "storage.authMethod",
      "--auth-method azure-ad",
      "export AZURE_FS_AUTH_METHOD=azure-ad",
      '{ "storage": { "authMethod": "azure-ad" } }',
    );
  }

  const authMethod = storage["authMethod"] as string;
  if (!VALID_AUTH_METHODS.includes(authMethod as AuthMethod)) {
    throw ConfigError.invalidValue("storage.authMethod", authMethod, VALID_AUTH_METHODS);
  }

  // --- SAS token expiry (required when authMethod is sas-token) ---
  let sasTokenExpiry: string | undefined;
  if (authMethod === "sas-token") {
    if (!storage["sasTokenExpiry"]) {
      throw ConfigError.missingRequired(
        "storage.sasTokenExpiry",
        "(not available as CLI flag, use env var or config file)",
        "export AZURE_STORAGE_SAS_TOKEN_EXPIRY=2026-12-31T00:00:00Z",
        '{ "storage": { "sasTokenExpiry": "2026-12-31T00:00:00Z" } }',
      );
    }

    sasTokenExpiry = storage["sasTokenExpiry"] as string;
    const parsedDate = new Date(sasTokenExpiry);
    if (isNaN(parsedDate.getTime())) {
      throw ConfigError.invalidValue(
        "storage.sasTokenExpiry",
        sasTokenExpiry,
        ["ISO 8601 date string (e.g., 2026-12-31T00:00:00Z)"],
      );
    }
  }

  // --- Logging section ---
  if (logging["level"] === undefined || logging["level"] === null || logging["level"] === "") {
    throw ConfigError.missingRequired(
      "logging.level",
      "(not available as CLI flag, use env var or config file)",
      "export AZURE_FS_LOG_LEVEL=info",
      '{ "logging": { "level": "info" } }',
    );
  }

  const logLevel = logging["level"] as string;
  if (!VALID_LOG_LEVELS.includes(logLevel as LogLevel)) {
    throw ConfigError.invalidValue("logging.level", logLevel, VALID_LOG_LEVELS);
  }

  if (logging["logRequests"] === undefined || logging["logRequests"] === null) {
    throw ConfigError.missingRequired(
      "logging.logRequests",
      "(not available as CLI flag, use env var or config file)",
      "export AZURE_FS_LOG_REQUESTS=true",
      '{ "logging": { "logRequests": true } }',
    );
  }

  // --- Retry section ---
  if (
    retry["strategy"] === undefined ||
    retry["strategy"] === null ||
    retry["strategy"] === ""
  ) {
    throw ConfigError.missingRequired(
      "retry.strategy",
      "(not available as CLI flag, use env var or config file)",
      "export AZURE_FS_RETRY_STRATEGY=exponential",
      '{ "retry": { "strategy": "exponential" } }',
    );
  }

  const retryStrategy = retry["strategy"] as string;
  if (!VALID_RETRY_STRATEGIES.includes(retryStrategy as RetryStrategy)) {
    throw ConfigError.invalidValue("retry.strategy", retryStrategy, VALID_RETRY_STRATEGIES);
  }

  if (retry["maxRetries"] === undefined || retry["maxRetries"] === null) {
    throw ConfigError.missingRequired(
      "retry.maxRetries",
      "(not available as CLI flag, use env var or config file)",
      "export AZURE_FS_RETRY_MAX_RETRIES=3",
      '{ "retry": { "maxRetries": 3 } }',
    );
  }

  const maxRetries = Number(retry["maxRetries"]);
  if (isNaN(maxRetries) || maxRetries < 0) {
    throw ConfigError.invalidValue(
      "retry.maxRetries",
      retry["maxRetries"],
      ["non-negative integer"],
    );
  }

  // initialDelayMs and maxDelayMs are required when strategy is not "none"
  if (retryStrategy !== "none") {
    if (retry["initialDelayMs"] === undefined || retry["initialDelayMs"] === null) {
      throw ConfigError.missingRequired(
        "retry.initialDelayMs",
        "(not available as CLI flag, use env var or config file)",
        "export AZURE_FS_RETRY_INITIAL_DELAY_MS=1000",
        '{ "retry": { "initialDelayMs": 1000 } }',
      );
    }

    const initialDelayMs = Number(retry["initialDelayMs"]);
    if (isNaN(initialDelayMs) || initialDelayMs < 0) {
      throw ConfigError.invalidValue(
        "retry.initialDelayMs",
        retry["initialDelayMs"],
        ["non-negative integer"],
      );
    }

    if (retry["maxDelayMs"] === undefined || retry["maxDelayMs"] === null) {
      throw ConfigError.missingRequired(
        "retry.maxDelayMs",
        "(not available as CLI flag, use env var or config file)",
        "export AZURE_FS_RETRY_MAX_DELAY_MS=30000",
        '{ "retry": { "maxDelayMs": 30000 } }',
      );
    }

    const maxDelayMs = Number(retry["maxDelayMs"]);
    if (isNaN(maxDelayMs) || maxDelayMs < 0) {
      throw ConfigError.invalidValue(
        "retry.maxDelayMs",
        retry["maxDelayMs"],
        ["non-negative integer"],
      );
    }
  }

  // --- Batch section ---
  if (batch["concurrency"] === undefined || batch["concurrency"] === null) {
    throw ConfigError.missingRequired(
      "batch.concurrency",
      "(not available as CLI flag, use env var or config file)",
      "export AZURE_FS_BATCH_CONCURRENCY=10",
      '{ "batch": { "concurrency": 10 } }',
    );
  }

  const batchConcurrency = Number(batch["concurrency"]);
  if (isNaN(batchConcurrency) || batchConcurrency < 1) {
    throw ConfigError.invalidValue(
      "batch.concurrency",
      batch["concurrency"],
      ["positive integer (e.g., 5, 10, 20)"],
    );
  }

  // Build the validated config object
  const resolvedConfig: ResolvedConfig = {
    storage: {
      accountUrl: storage["accountUrl"] as string,
      containerName: storage["containerName"] as string,
      authMethod: authMethod as AuthMethod,
    },
    logging: {
      level: logLevel as LogLevel,
      logRequests: Boolean(logging["logRequests"]),
    },
    retry: {
      strategy: retryStrategy as RetryStrategy,
      maxRetries: maxRetries,
      initialDelayMs: retryStrategy === "none" ? 0 : Number(retry["initialDelayMs"]),
      maxDelayMs: retryStrategy === "none" ? 0 : Number(retry["maxDelayMs"]),
    },
    batch: {
      concurrency: batchConcurrency,
    },
  };

  if (sasTokenExpiry) {
    resolvedConfig.storage.sasTokenExpiry = sasTokenExpiry;
  }

  return resolvedConfig;
}

/**
 * Validates that all required API configuration fields are present and valid.
 * Throws ConfigError for any missing or invalid field (no defaults, no fallbacks).
 *
 * This is called only when starting the API server -- CLI commands never call this.
 */
export function validateApiConfig(api: Record<string, unknown>): ApiConfig {
  // --- port ---
  if (api["port"] === undefined || api["port"] === null) {
    throw ConfigError.missingRequired(
      "api.port",
      "(not available as CLI flag, use env var or config file)",
      "export AZURE_FS_API_PORT=3000",
      '{ "api": { "port": 3000 } }',
    );
  }

  const port = Number(api["port"]);
  if (isNaN(port) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw ConfigError.invalidValue(
      "api.port",
      api["port"],
      ["integer between 1 and 65535"],
    );
  }

  // --- host ---
  if (!api["host"] || (typeof api["host"] === "string" && api["host"].trim() === "")) {
    throw ConfigError.missingRequired(
      "api.host",
      "(not available as CLI flag, use env var or config file)",
      "export AZURE_FS_API_HOST=0.0.0.0",
      '{ "api": { "host": "0.0.0.0" } }',
    );
  }

  const host = String(api["host"]).trim();

  // --- corsOrigins ---
  if (api["corsOrigins"] === undefined || api["corsOrigins"] === null) {
    throw ConfigError.missingRequired(
      "api.corsOrigins",
      "(not available as CLI flag, use env var or config file)",
      "export AZURE_FS_API_CORS_ORIGINS=http://localhost:3000",
      '{ "api": { "corsOrigins": ["http://localhost:3000"] } }',
    );
  }

  let corsOrigins: string[];
  if (typeof api["corsOrigins"] === "string") {
    corsOrigins = api["corsOrigins"]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  } else if (Array.isArray(api["corsOrigins"])) {
    corsOrigins = api["corsOrigins"] as string[];
  } else {
    throw ConfigError.invalidValue(
      "api.corsOrigins",
      api["corsOrigins"],
      ["comma-separated string or string array"],
    );
  }

  if (corsOrigins.length === 0) {
    throw ConfigError.invalidValue(
      "api.corsOrigins",
      api["corsOrigins"],
      ["non-empty comma-separated string or non-empty string array"],
    );
  }

  // --- swaggerEnabled ---
  if (api["swaggerEnabled"] === undefined || api["swaggerEnabled"] === null) {
    throw ConfigError.missingRequired(
      "api.swaggerEnabled",
      "(not available as CLI flag, use env var or config file)",
      "export AZURE_FS_API_SWAGGER_ENABLED=true",
      '{ "api": { "swaggerEnabled": true } }',
    );
  }

  if (typeof api["swaggerEnabled"] !== "boolean") {
    throw ConfigError.invalidValue(
      "api.swaggerEnabled",
      api["swaggerEnabled"],
      ["true", "false"],
    );
  }

  const swaggerEnabled = api["swaggerEnabled"] as boolean;

  // --- uploadMaxSizeMb ---
  if (api["uploadMaxSizeMb"] === undefined || api["uploadMaxSizeMb"] === null) {
    throw ConfigError.missingRequired(
      "api.uploadMaxSizeMb",
      "(not available as CLI flag, use env var or config file)",
      "export AZURE_FS_API_UPLOAD_MAX_SIZE_MB=100",
      '{ "api": { "uploadMaxSizeMb": 100 } }',
    );
  }

  const uploadMaxSizeMb = Number(api["uploadMaxSizeMb"]);
  if (isNaN(uploadMaxSizeMb) || uploadMaxSizeMb <= 0) {
    throw ConfigError.invalidValue(
      "api.uploadMaxSizeMb",
      api["uploadMaxSizeMb"],
      ["positive number (e.g., 50, 100, 256)"],
    );
  }

  // --- requestTimeoutMs ---
  if (api["requestTimeoutMs"] === undefined || api["requestTimeoutMs"] === null) {
    throw ConfigError.missingRequired(
      "api.requestTimeoutMs",
      "(not available as CLI flag, use env var or config file)",
      "export AZURE_FS_API_REQUEST_TIMEOUT_MS=30000",
      '{ "api": { "requestTimeoutMs": 30000 } }',
    );
  }

  const requestTimeoutMs = Number(api["requestTimeoutMs"]);
  if (isNaN(requestTimeoutMs) || !Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1000) {
    throw ConfigError.invalidValue(
      "api.requestTimeoutMs",
      api["requestTimeoutMs"],
      ["positive integer >= 1000 (e.g., 5000, 30000, 60000)"],
    );
  }

  // --- nodeEnv (NEW: Feature 1) ---
  if (api["nodeEnv"] === undefined || api["nodeEnv"] === null || api["nodeEnv"] === "") {
    throw ConfigError.missingRequired(
      "api.nodeEnv",
      "(not available as CLI flag, use env var or config file)",
      "export NODE_ENV=development",
      '{ "api": { "nodeEnv": "development" } }',
    );
  }

  const nodeEnv = String(api["nodeEnv"]);
  if (!VALID_NODE_ENVIRONMENTS.includes(nodeEnv as NodeEnvironment)) {
    throw ConfigError.invalidValue("api.nodeEnv", nodeEnv, VALID_NODE_ENVIRONMENTS);
  }

  // --- autoSelectPort (NEW: Feature 4) ---
  if (api["autoSelectPort"] === undefined || api["autoSelectPort"] === null) {
    throw ConfigError.missingRequired(
      "api.autoSelectPort",
      "(not available as CLI flag, use env var or config file)",
      "export AUTO_SELECT_PORT=false",
      '{ "api": { "autoSelectPort": false } }',
    );
  }

  if (typeof api["autoSelectPort"] !== "boolean") {
    throw ConfigError.invalidValue(
      "api.autoSelectPort",
      api["autoSelectPort"],
      ["true", "false"],
    );
  }

  const autoSelectPort = api["autoSelectPort"] as boolean;

  return {
    port,
    host,
    corsOrigins,
    swaggerEnabled,
    uploadMaxSizeMb,
    requestTimeoutMs,
    nodeEnv: nodeEnv as NodeEnvironment,
    autoSelectPort,
  };
}
```

**Changes from BEFORE** (in `validateApiConfig()`):
- Added `import { NodeEnvironment } from "../types/api-config.types"`
- Added `VALID_NODE_ENVIRONMENTS` constant
- Added `nodeEnv` validation block after `requestTimeoutMs`
- Added `autoSelectPort` validation block after `nodeEnv` (Feature 4)
- Updated return object to include `nodeEnv` and `autoSelectPort`

### 1.4 `src/config/config.loader.ts` -- `loadEnvConfig()` additions

**BEFORE** (lines 104-127):
```typescript
  // --- API-specific environment variables ---
  if (process.env.AZURE_FS_API_PORT) {
    env["api"]["port"] = Number(process.env.AZURE_FS_API_PORT);
  }
  if (process.env.AZURE_FS_API_HOST) {
    env["api"]["host"] = process.env.AZURE_FS_API_HOST;
  }
  if (process.env.AZURE_FS_API_CORS_ORIGINS) {
    env["api"]["corsOrigins"] = process.env.AZURE_FS_API_CORS_ORIGINS
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (process.env.AZURE_FS_API_SWAGGER_ENABLED !== undefined && process.env.AZURE_FS_API_SWAGGER_ENABLED !== "") {
    env["api"]["swaggerEnabled"] = process.env.AZURE_FS_API_SWAGGER_ENABLED === "true";
  }
  if (process.env.AZURE_FS_API_UPLOAD_MAX_SIZE_MB) {
    env["api"]["uploadMaxSizeMb"] = Number(process.env.AZURE_FS_API_UPLOAD_MAX_SIZE_MB);
  }
  if (process.env.AZURE_FS_API_REQUEST_TIMEOUT_MS) {
    env["api"]["requestTimeoutMs"] = Number(process.env.AZURE_FS_API_REQUEST_TIMEOUT_MS);
  }

  return env;
}
```

**AFTER** (lines 104-141):
```typescript
  // --- API-specific environment variables ---
  if (process.env.AZURE_FS_API_PORT) {
    env["api"]["port"] = Number(process.env.AZURE_FS_API_PORT);
  }
  if (process.env.AZURE_FS_API_HOST) {
    env["api"]["host"] = process.env.AZURE_FS_API_HOST;
  }
  if (process.env.AZURE_FS_API_CORS_ORIGINS) {
    env["api"]["corsOrigins"] = process.env.AZURE_FS_API_CORS_ORIGINS
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (process.env.AZURE_FS_API_SWAGGER_ENABLED !== undefined && process.env.AZURE_FS_API_SWAGGER_ENABLED !== "") {
    env["api"]["swaggerEnabled"] = process.env.AZURE_FS_API_SWAGGER_ENABLED === "true";
  }
  if (process.env.AZURE_FS_API_UPLOAD_MAX_SIZE_MB) {
    env["api"]["uploadMaxSizeMb"] = Number(process.env.AZURE_FS_API_UPLOAD_MAX_SIZE_MB);
  }
  if (process.env.AZURE_FS_API_REQUEST_TIMEOUT_MS) {
    env["api"]["requestTimeoutMs"] = Number(process.env.AZURE_FS_API_REQUEST_TIMEOUT_MS);
  }

  // NODE_ENV: standard Node.js convention, no AZURE_FS_ prefix
  if (process.env.NODE_ENV) {
    env["api"]["nodeEnv"] = process.env.NODE_ENV;
  }

  // AUTO_SELECT_PORT: standard utility pattern, no AZURE_FS_ prefix
  if (process.env.AUTO_SELECT_PORT !== undefined && process.env.AUTO_SELECT_PORT !== "") {
    env["api"]["autoSelectPort"] = process.env.AUTO_SELECT_PORT === "true";
  }

  return env;
}
```

### 1.5 `src/api/middleware/error-handler.middleware.ts` -- FULL FILE (AFTER)

```typescript
import { Request, Response, NextFunction } from "express";
import { AzureFsError } from "../../errors/base.error";
import { ConfigError } from "../../errors/config.error";
import { AuthError } from "../../errors/auth.error";
import { BlobNotFoundError } from "../../errors/blob-not-found.error";
import { PathError } from "../../errors/path.error";
import { MetadataError } from "../../errors/metadata.error";
import { ConcurrentModificationError } from "../../errors/concurrent-modification.error";
import { Logger } from "../../utils/logger.utils";

/**
 * Map an AzureFsError subclass to an HTTP status code.
 * See technical design Section 5.1 for the full mapping table.
 */
function mapErrorToHttpStatus(err: AzureFsError): number {
  if (err instanceof ConfigError) {
    return 500;
  }

  if (err instanceof AuthError) {
    switch (err.code) {
      case "AUTH_ACCESS_DENIED":
        return 403;
      case "AUTH_CONNECTION_FAILED":
        return 502;
      default:
        // AUTH_MISSING_*, AUTH_SAS_TOKEN_EXPIRED, AUTH_AZURE_AD_FAILED, AUTH_INVALID_AUTH_METHOD
        return 500;
    }
  }

  if (err instanceof BlobNotFoundError) {
    return 404;
  }

  if (err instanceof PathError) {
    return 400;
  }

  if (err instanceof MetadataError) {
    return 400;
  }

  if (err instanceof ConcurrentModificationError) {
    return 412;
  }

  // Fallback for any other AzureFsError subclass
  return err.statusCode || 500;
}

/**
 * Determine if the error message should be sanitized (not forwarded to the client).
 * Server-side configuration and authentication errors must not leak internal details.
 */
function getSanitizedMessage(err: AzureFsError): string | null {
  if (err instanceof ConfigError) {
    return "Server configuration error. Contact the administrator.";
  }

  if (err instanceof AuthError) {
    // Only AUTH_ACCESS_DENIED and AUTH_CONNECTION_FAILED are safe to forward
    if (err.code === "AUTH_ACCESS_DENIED" || err.code === "AUTH_CONNECTION_FAILED") {
      return null; // Use original message
    }
    return "Server authentication error. Contact the administrator.";
  }

  return null; // Use original message
}

/**
 * Create the centralized Express error handling middleware.
 * Must be registered LAST in the middleware chain.
 *
 * Maps AzureFsError subclasses to HTTP status codes.
 * Handles MulterError for upload failures.
 * Returns a generic 500 for unknown errors (no internal details leaked).
 *
 * When nodeEnv is "development", unknown error responses include the stack trace
 * to aid debugging. In production and test modes, stack traces are never sent.
 *
 * @param logger - The application logger instance.
 * @param nodeEnv - The current NODE_ENV value (controls stack trace inclusion).
 */
export function createErrorHandlerMiddleware(logger: Logger, nodeEnv: string) {
  return function errorHandlerMiddleware(
    err: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
  ): void {
    const timestamp = new Date().toISOString();

    // --- AzureFsError subclasses ---
    if (err instanceof AzureFsError) {
      const httpStatus = mapErrorToHttpStatus(err);
      const sanitizedMessage = getSanitizedMessage(err);

      // Always log the full error internally
      logger.error(`[${err.code}] ${err.message}`, {
        code: err.code,
        httpStatus,
        ...(err.details ? { details: err.details as Record<string, unknown> } : {}),
      });

      const errorBody = sanitizedMessage
        ? { code: err.code, message: sanitizedMessage }
        : err.toJSON();

      res.status(httpStatus).json({
        success: false,
        error: errorBody,
        metadata: { timestamp },
      });
      return;
    }

    // --- MulterError (file upload errors) ---
    if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "MulterError") {
      const multerErr = err as unknown as { code: string; message: string; field?: string };

      logger.error(`MulterError: ${multerErr.code} - ${multerErr.message}`, {
        code: multerErr.code,
        field: multerErr.field,
      });

      const httpStatus = multerErr.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      const errorCode = multerErr.code === "LIMIT_FILE_SIZE" ? "UPLOAD_FILE_TOO_LARGE" : "UPLOAD_ERROR";

      res.status(httpStatus).json({
        success: false,
        error: {
          code: errorCode,
          message: multerErr.message,
        },
        metadata: { timestamp },
      });
      return;
    }

    // --- Unknown errors ---
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;

    logger.error(`Unhandled error: ${errorMessage}`, {
      stack: errorStack,
    });

    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "An internal server error occurred.",
        ...(nodeEnv === "development" && errorStack ? { stack: errorStack } : {}),
      },
      metadata: { timestamp },
    });
  };
}
```

**Changes from BEFORE**:
- Changed `createErrorHandlerMiddleware(logger: Logger)` to `createErrorHandlerMiddleware(logger: Logger, nodeEnv: string)`
- Added JSDoc for the `nodeEnv` parameter
- Added conditional stack trace inclusion in the unknown errors section:
  `...(nodeEnv === "development" && errorStack ? { stack: errorStack } : {})`

### 1.6 `src/api/swagger/config.ts` -- NODE_ENV server description change

This change is combined with Feature 3 below. The key change for Feature 1 is that the server description uses `apiConfig.nodeEnv`:

```typescript
description: apiConfig.nodeEnv === "production" ? "Production server" : "Development server",
```

### 1.7 `src/api/server.ts` -- NODE_ENV usage changes

The changes for `server.ts` are extensive (Features 1, 2, 3, 4 all modify it). See the combined file in [Section: Combined server.ts](#combined-serverts).

Key Feature 1 changes:
- Replace `process.env.NODE_ENV || "development"` with `config.api.nodeEnv`
- Pass `config.api.nodeEnv` to `createErrorHandlerMiddleware()`

---

## Feature 2: Config Source Tracking

### 2.1 `src/config/config.loader.ts` -- FULL FILE (AFTER)

This is the most impacted file. The source tracking is woven into the merge logic.

```typescript
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  AzureFsConfigFile,
  CliOptions,
  ResolvedConfig,
  ConfigSourceLabel,
  ConfigSourceTracker,
} from "../types/config.types";
import { ApiResolvedConfig } from "../types/api-config.types";
import { ConfigError } from "../errors/config.error";
import { validateConfig, validateApiConfig } from "./config.schema";

/**
 * Create a ConfigSourceTracker instance.
 * Wraps a Map<string, ConfigSourceLabel> with the ConfigSourceTracker interface.
 */
function createSourceTracker(): ConfigSourceTracker {
  const sources = new Map<string, ConfigSourceLabel>();

  return {
    set(key: string, source: ConfigSourceLabel): void {
      sources.set(key, source);
    },
    getSource(key: string): ConfigSourceLabel | undefined {
      return sources.get(key);
    },
    getAllSources(): Record<string, ConfigSourceLabel> {
      const result: Record<string, ConfigSourceLabel> = {};
      sources.forEach((value, key) => {
        result[key] = value;
      });
      return result;
    },
  };
}

/**
 * Load the configuration file from disk.
 * Search order:
 *   1. Explicit --config path (if provided)
 *   2. Current working directory (./.azure-fs.json)
 *   3. User home directory (~/.azure-fs.json)
 *
 * Returns the parsed file content, or an empty object if no config file is found.
 * Throws ConfigError if the explicit --config path does not exist or is not valid JSON.
 */
function loadConfigFile(configPath?: string): AzureFsConfigFile {
  const searchPaths: string[] = [];

  if (configPath) {
    // Explicit path: must exist
    const resolvedPath = path.resolve(configPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new ConfigError(
        "CONFIG_FILE_NOT_FOUND",
        `Configuration file not found at specified path: ${resolvedPath}`,
        { path: resolvedPath },
      );
    }
    searchPaths.push(resolvedPath);
  } else {
    // Search: CWD then HOME
    searchPaths.push(path.join(process.cwd(), ".azure-fs.json"));
    searchPaths.push(path.join(os.homedir(), ".azure-fs.json"));
  }

  for (const filePath of searchPaths) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(content) as AzureFsConfigFile;
      } catch (err) {
        throw new ConfigError(
          "CONFIG_FILE_PARSE_ERROR",
          `Failed to parse configuration file at ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
          { path: filePath },
        );
      }
    }
  }

  return {};
}

/**
 * Load configuration from environment variables.
 * Returns a partial config object with only the values that are set in the environment.
 */
function loadEnvConfig(): Record<string, Record<string, unknown>> {
  const env: Record<string, Record<string, unknown>> = {
    storage: {},
    logging: {},
    retry: {},
    batch: {},
    api: {},
  };

  if (process.env.AZURE_STORAGE_ACCOUNT_URL) {
    env["storage"]["accountUrl"] = process.env.AZURE_STORAGE_ACCOUNT_URL;
  }
  if (process.env.AZURE_STORAGE_CONTAINER_NAME) {
    env["storage"]["containerName"] = process.env.AZURE_STORAGE_CONTAINER_NAME;
  }
  if (process.env.AZURE_FS_AUTH_METHOD) {
    env["storage"]["authMethod"] = process.env.AZURE_FS_AUTH_METHOD;
  }
  if (process.env.AZURE_STORAGE_SAS_TOKEN_EXPIRY) {
    env["storage"]["sasTokenExpiry"] = process.env.AZURE_STORAGE_SAS_TOKEN_EXPIRY;
  }
  if (process.env.AZURE_FS_LOG_LEVEL) {
    env["logging"]["level"] = process.env.AZURE_FS_LOG_LEVEL;
  }
  if (process.env.AZURE_FS_LOG_REQUESTS !== undefined && process.env.AZURE_FS_LOG_REQUESTS !== "") {
    env["logging"]["logRequests"] = process.env.AZURE_FS_LOG_REQUESTS === "true";
  }
  if (process.env.AZURE_FS_RETRY_STRATEGY) {
    env["retry"]["strategy"] = process.env.AZURE_FS_RETRY_STRATEGY;
  }
  if (process.env.AZURE_FS_RETRY_MAX_RETRIES) {
    env["retry"]["maxRetries"] = Number(process.env.AZURE_FS_RETRY_MAX_RETRIES);
  }
  if (process.env.AZURE_FS_RETRY_INITIAL_DELAY_MS) {
    env["retry"]["initialDelayMs"] = Number(process.env.AZURE_FS_RETRY_INITIAL_DELAY_MS);
  }
  if (process.env.AZURE_FS_RETRY_MAX_DELAY_MS) {
    env["retry"]["maxDelayMs"] = Number(process.env.AZURE_FS_RETRY_MAX_DELAY_MS);
  }
  if (process.env.AZURE_FS_BATCH_CONCURRENCY) {
    env["batch"]["concurrency"] = Number(process.env.AZURE_FS_BATCH_CONCURRENCY);
  }

  // --- API-specific environment variables ---
  if (process.env.AZURE_FS_API_PORT) {
    env["api"]["port"] = Number(process.env.AZURE_FS_API_PORT);
  }
  if (process.env.AZURE_FS_API_HOST) {
    env["api"]["host"] = process.env.AZURE_FS_API_HOST;
  }
  if (process.env.AZURE_FS_API_CORS_ORIGINS) {
    env["api"]["corsOrigins"] = process.env.AZURE_FS_API_CORS_ORIGINS
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (process.env.AZURE_FS_API_SWAGGER_ENABLED !== undefined && process.env.AZURE_FS_API_SWAGGER_ENABLED !== "") {
    env["api"]["swaggerEnabled"] = process.env.AZURE_FS_API_SWAGGER_ENABLED === "true";
  }
  if (process.env.AZURE_FS_API_UPLOAD_MAX_SIZE_MB) {
    env["api"]["uploadMaxSizeMb"] = Number(process.env.AZURE_FS_API_UPLOAD_MAX_SIZE_MB);
  }
  if (process.env.AZURE_FS_API_REQUEST_TIMEOUT_MS) {
    env["api"]["requestTimeoutMs"] = Number(process.env.AZURE_FS_API_REQUEST_TIMEOUT_MS);
  }

  // NODE_ENV: standard Node.js convention, no AZURE_FS_ prefix
  if (process.env.NODE_ENV) {
    env["api"]["nodeEnv"] = process.env.NODE_ENV;
  }

  // AUTO_SELECT_PORT: standard utility pattern, no AZURE_FS_ prefix
  if (process.env.AUTO_SELECT_PORT !== undefined && process.env.AUTO_SELECT_PORT !== "") {
    env["api"]["autoSelectPort"] = process.env.AUTO_SELECT_PORT === "true";
  }

  return env;
}

/**
 * Load configuration from CLI options.
 * Returns a partial config object with only the values that are explicitly provided.
 */
function loadCliConfig(cliOptions: CliOptions): Record<string, Record<string, unknown>> {
  const cli: Record<string, Record<string, unknown>> = {
    storage: {},
    logging: {},
    retry: {},
    batch: {},
    api: {},
  };

  if (cliOptions.accountUrl) {
    cli["storage"]["accountUrl"] = cliOptions.accountUrl;
  }
  if (cliOptions.container) {
    cli["storage"]["containerName"] = cliOptions.container;
  }
  if (cliOptions.authMethod) {
    cli["storage"]["authMethod"] = cliOptions.authMethod;
  }

  return cli;
}

/**
 * Source-labeled override entry for tracked merging.
 */
interface SourcedOverride {
  values: Record<string, unknown>;
  source: ConfigSourceLabel;
}

/**
 * Deep-merge configuration objects with optional source tracking.
 * Later sources override earlier ones. Only non-undefined values from overrides are applied.
 *
 * When a tracker is provided, each "winning" key is recorded with its source label
 * using the sectionPrefix for namespacing (e.g., "storage.accountUrl").
 */
function mergeConfigSection(
  base: Record<string, unknown>,
  overrides: SourcedOverride[],
  tracker?: ConfigSourceTracker,
  sectionPrefix?: string,
): Record<string, unknown> {
  const result = { ...base };

  // Track keys that came from the base (config file)
  if (tracker && sectionPrefix) {
    for (const key of Object.keys(base)) {
      if (base[key] !== undefined) {
        tracker.set(`${sectionPrefix}.${key}`, "config-file");
      }
    }
  }

  for (const override of overrides) {
    for (const key of Object.keys(override.values)) {
      if (override.values[key] !== undefined) {
        result[key] = override.values[key];
        if (tracker && sectionPrefix) {
          tracker.set(`${sectionPrefix}.${key}`, override.source);
        }
      }
    }
  }

  return result;
}

/**
 * Build the merged configuration from all sources (file, env, CLI).
 * Does NOT validate -- returns the raw merged object.
 *
 * When a tracker is provided, each config key is recorded with the source
 * that provided its final value.
 */
function buildMergedConfig(
  cliOptions: CliOptions,
  tracker?: ConfigSourceTracker,
): Record<string, unknown> {
  const fileConfig = loadConfigFile(cliOptions.config);
  const envConfig = loadEnvConfig();
  const cliConfig = loadCliConfig(cliOptions);

  return {
    storage: mergeConfigSection(
      (fileConfig.storage as Record<string, unknown>) || {},
      [
        { values: envConfig["storage"], source: "environment-variable" },
        { values: cliConfig["storage"], source: "cli-flag" },
      ],
      tracker,
      "storage",
    ),
    logging: mergeConfigSection(
      (fileConfig.logging as Record<string, unknown>) || {},
      [
        { values: envConfig["logging"], source: "environment-variable" },
        { values: cliConfig["logging"], source: "cli-flag" },
      ],
      tracker,
      "logging",
    ),
    retry: mergeConfigSection(
      (fileConfig.retry as Record<string, unknown>) || {},
      [
        { values: envConfig["retry"], source: "environment-variable" },
        { values: cliConfig["retry"], source: "cli-flag" },
      ],
      tracker,
      "retry",
    ),
    batch: mergeConfigSection(
      (fileConfig.batch as Record<string, unknown>) || {},
      [
        { values: envConfig["batch"], source: "environment-variable" },
        { values: cliConfig["batch"], source: "cli-flag" },
      ],
      tracker,
      "batch",
    ),
    api: mergeConfigSection(
      (fileConfig.api as Record<string, unknown>) || {},
      [
        { values: envConfig["api"], source: "environment-variable" },
        { values: cliConfig["api"], source: "cli-flag" },
      ],
      tracker,
      "api",
    ),
  };
}

/**
 * Load, merge, and validate configuration from all sources.
 * Priority: CLI flags > environment variables > config file.
 *
 * Throws ConfigError if any required field is missing (no fallback/default values).
 * NOTE: The `api` section is NOT validated here -- it is optional for CLI commands.
 * NOTE: No source tracking for CLI commands (performance optimization).
 */
export function loadConfig(cliOptions: CliOptions): ResolvedConfig {
  const merged = buildMergedConfig(cliOptions);

  // Validate base config (storage, logging, retry, batch) -- throws ConfigError for any missing required field
  return validateConfig(merged);
}

/**
 * Resolve configuration for a command.
 * This is the primary entry point used by command handlers.
 */
export function resolveConfig(globalOptions: Record<string, unknown>): ResolvedConfig {
  const cliOptions: CliOptions = {
    accountUrl: globalOptions["accountUrl"] as string | undefined,
    container: globalOptions["container"] as string | undefined,
    authMethod: globalOptions["authMethod"] as string | undefined,
    config: globalOptions["config"] as string | undefined,
    json: globalOptions["json"] as boolean | undefined,
    verbose: globalOptions["verbose"] as boolean | undefined,
  };

  return loadConfig(cliOptions);
}

/**
 * Resolve configuration for the API server.
 * Validates BOTH the base config AND the API section.
 * All API parameters are required -- missing values throw ConfigError.
 *
 * Creates a ConfigSourceTracker to record which source provided each config value.
 * The tracker is attached to the returned ApiResolvedConfig for use by dev routes.
 *
 * Returns ApiResolvedConfig with a required `api` section and optional `sourceTracker`.
 */
export function resolveApiConfig(cliOptions?: CliOptions): ApiResolvedConfig {
  const opts = cliOptions || {};
  const tracker = createSourceTracker();
  const merged = buildMergedConfig(opts, tracker);

  // 1. Validate base config
  const baseConfig = validateConfig(merged);

  // 2. Validate API-specific config
  const apiSection = (merged["api"] as Record<string, unknown>) || {};
  const apiConfig = validateApiConfig(apiSection);

  return {
    ...baseConfig,
    api: apiConfig,
    sourceTracker: tracker,
  };
}

/**
 * Build a merged config object WITHOUT validation, for display purposes (config show).
 * Returns the raw merged values so the user can see what is resolved from each source.
 */
export function loadConfigRaw(cliOptions: CliOptions): Record<string, unknown> {
  return buildMergedConfig(cliOptions);
}
```

**Key changes summary**:
1. New `createSourceTracker()` factory function
2. New `SourcedOverride` interface
3. `mergeConfigSection()` signature changed from variadic `...overrides: Record<string, unknown>[]` to `overrides: SourcedOverride[], tracker?, sectionPrefix?`
4. `buildMergedConfig()` accepts optional `tracker` parameter
5. `resolveApiConfig()` creates and attaches a tracker
6. `loadConfig()` (CLI path) does NOT use source tracking -- no overhead
7. All calls to `mergeConfigSection()` in `buildMergedConfig()` now pass structured arrays with source labels

---

## Feature 3: Container-Aware Swagger URLs

### 3.1 `src/api/swagger/config.ts` -- FULL FILE (AFTER)

```typescript
import swaggerJsdoc from "swagger-jsdoc";
import { ApiConfig } from "../../types/api-config.types";

/**
 * Detect the base URL for the API server by checking container/cloud
 * environment variables in priority order.
 *
 * Priority chain:
 *   1. PUBLIC_URL - Explicit public URL override (any environment)
 *   2. WEBSITE_HOSTNAME - Azure App Service (auto-set by platform)
 *   3. K8S_SERVICE_HOST + K8S_SERVICE_PORT - Kubernetes (auto-injected)
 *   4. DOCKER_HOST_URL - Docker container (manually set)
 *   5. Local development fallback: http://{host}:{port}
 *
 * All environment variables are optional detection signals. Missing values
 * simply mean that environment is not detected. This is NOT a config fallback --
 * it is correct base behavior for local development.
 */
function getBaseUrl(host: string, port: number): string {
  // Priority 1: Explicit public URL override
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

/**
 * Build the OpenAPI servers array with optional additional servers
 * and optional server variables.
 *
 * Additional servers: AZURE_FS_API_SWAGGER_ADDITIONAL_SERVERS (comma-separated URLs)
 * Server variables: AZURE_FS_API_SWAGGER_SERVER_VARIABLES=true enables
 *   protocol/host/port variables in Swagger UI for interactive URL editing.
 */
function buildSwaggerServers(baseUrl: string, apiConfig: ApiConfig): object[] {
  const servers: object[] = [];

  // Primary server entry
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

  // Additional servers from env var (comma-separated)
  const additionalServersEnv = process.env.AZURE_FS_API_SWAGGER_ADDITIONAL_SERVERS;
  if (additionalServersEnv) {
    const additionalUrls = additionalServersEnv
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    additionalUrls.forEach((url, index) => {
      servers.push({
        url,
        description: `Additional server ${index + 1}`,
      });
    });
  }

  return servers;
}

/**
 * Create the OpenAPI 3.0 specification from JSDoc annotations.
 *
 * @param apiConfig - The resolved API configuration (used for dynamic server URL and nodeEnv).
 * @param actualPort - Optional override port (used when PortChecker auto-selected a different port).
 * @returns The generated OpenAPI specification object.
 */
export function createSwaggerSpec(apiConfig: ApiConfig, actualPort?: number): object {
  const effectivePort = actualPort || apiConfig.port;
  const baseUrl = getBaseUrl(apiConfig.host, effectivePort);
  const servers = buildSwaggerServers(baseUrl, apiConfig);

  const options: swaggerJsdoc.Options = {
    definition: {
      openapi: "3.0.0",
      info: {
        title: "Azure FS REST API",
        version: "1.0.0",
        description: "REST API for Azure Blob Storage virtual file system",
      },
      servers,
      tags: [
        { name: "Health", description: "Health check endpoints" },
        { name: "Files", description: "File upload, download, delete, replace, info, and existence checks" },
        { name: "Folders", description: "Folder listing, creation, deletion, and existence checks" },
        { name: "Edit", description: "In-place edit, patch (find-replace), and append operations" },
        { name: "Metadata", description: "Blob user-defined metadata operations" },
        { name: "Tags", description: "Blob index tag operations and queries" },
        { name: "Development", description: "Development-only diagnostic endpoints (only available when NODE_ENV=development)" },
      ],
    },
    apis: ["./src/api/routes/*.ts", "./dist/api/routes/*.js"],
  };

  return swaggerJsdoc(options);
}
```

**Changes from BEFORE**:
- Added `getBaseUrl()` private function with 5-level priority chain
- Added `buildSwaggerServers()` private function with additional servers and server variables support
- Changed `createSwaggerSpec()` signature to accept optional `actualPort` parameter
- Replaced static `servers` array with dynamic `buildSwaggerServers()` call
- Server description now uses `apiConfig.nodeEnv` instead of static string
- Added "Development" tag for dev routes

---

## Feature 4: PortChecker Utility

### 4.1 `src/utils/port-checker.utils.ts` -- NEW FILE

```typescript
import * as net from "net";
import { exec } from "child_process";

/**
 * Result of a port availability check.
 */
export interface PortCheckResult {
  /** Whether the port is available for binding. */
  available: boolean;
  /** The port number that was checked (or the first available port found). */
  port: number;
  /** Error message if the port search failed. */
  error?: string;
}

/**
 * Utility class for checking TCP port availability and identifying
 * processes using a port. Used by the API server startup to proactively
 * detect port conflicts before Express attempts to listen.
 *
 * All methods are static -- no instantiation needed.
 * No dependencies on project config or services (standalone utility).
 */
export class PortChecker {
  /**
   * Check if a TCP port is available by attempting to bind a temporary server.
   *
   * Creates a `net.Server`, attempts to bind to the port. If binding succeeds,
   * the port is available (the server is immediately closed). If `EADDRINUSE`
   * fires, the port is taken.
   *
   * @param port - The port number to check.
   * @param host - The host to bind to (default: "localhost").
   * @returns true if the port is available, false if it is in use.
   */
  static async isPortAvailable(port: number, host: string = "localhost"): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();

      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          resolve(false);
        } else {
          // Other errors (permission denied, etc.) -- treat as unavailable
          resolve(false);
        }
      });

      server.once("listening", () => {
        server.close(() => {
          resolve(true);
        });
      });

      server.listen(port, host);
    });
  }

  /**
   * Sequentially scan ports starting from startPort to find an available one.
   *
   * Tests each port in order: startPort, startPort+1, ..., startPort+maxAttempts-1.
   * Returns the first available port found, or an error if none are available.
   *
   * @param startPort - The first port to try.
   * @param maxAttempts - Maximum number of ports to scan (default: 10).
   * @param host - The host to bind to (default: "localhost").
   * @returns A PortCheckResult with the first available port or an error.
   */
  static async findAvailablePort(
    startPort: number,
    maxAttempts: number = 10,
    host: string = "localhost",
  ): Promise<PortCheckResult> {
    let currentPort = startPort;

    for (let i = 0; i < maxAttempts; i++) {
      const isAvailable = await PortChecker.isPortAvailable(currentPort, host);
      if (isAvailable) {
        return { available: true, port: currentPort };
      }
      currentPort++;
    }

    return {
      available: false,
      port: startPort,
      error: `Could not find an available port after ${maxAttempts} attempts (${startPort}-${startPort + maxAttempts - 1})`,
    };
  }

  /**
   * Use lsof to identify which process is using a port.
   *
   * macOS/Linux only. Returns null on Windows, on failure, or if no process
   * is found listening on the port. This is purely informational -- failure
   * does not affect the port check logic.
   *
   * @param port - The port to look up.
   * @returns A string like "node (PID: 12345)" or null.
   */
  static async getProcessUsingPort(port: number): Promise<string | null> {
    // lsof is not available on Windows
    if (process.platform === "win32") {
      return null;
    }

    return new Promise((resolve) => {
      exec(
        `lsof -i :${port} | grep LISTEN | head -1`,
        { timeout: 5000 },
        (error, stdout) => {
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
        },
      );
    });
  }
}
```

### 4.2 Combined `src/api/server.ts` -- FULL FILE (AFTER) {#combined-serverts}

This file incorporates changes from Features 1, 2, 3, and 4.

```typescript
import * as dotenv from "dotenv";
dotenv.config();

import express, { Express } from "express";
import cors from "cors";
import * as http from "http";
import { ApiResolvedConfig } from "../types/api-config.types";
import { ConfigSourceTracker } from "../types/config.types";
import { resolveApiConfig } from "../config/config.loader";
import { BlobFileSystemService } from "../services/blob-filesystem.service";
import { MetadataService } from "../services/metadata.service";
import { Logger } from "../utils/logger.utils";
import { PortChecker } from "../utils/port-checker.utils";
import swaggerUi from "swagger-ui-express";
import { createErrorHandlerMiddleware } from "./middleware/error-handler.middleware";
import { createRequestLoggerMiddleware } from "./middleware/request-logger.middleware";
import { createTimeoutMiddleware } from "./middleware/timeout.middleware";
import { registerApiRoutes, ApiServices } from "./routes/index";
import { createSwaggerSpec } from "./swagger/config";

/**
 * Create the Express application with all middleware and routes.
 * This is a pure factory function -- it does not start listening.
 * Exported separately so it can be used in tests.
 *
 * @param config - The fully resolved API configuration.
 * @param blobService - Shared blob filesystem service instance.
 * @param metadataService - Shared metadata service instance.
 * @param logger - Application logger.
 * @param actualPort - Optional override port (when PortChecker auto-selected a different port).
 */
export function createApp(
  config: ApiResolvedConfig,
  blobService: BlobFileSystemService,
  metadataService: MetadataService,
  logger: Logger,
  actualPort?: number,
): Express {
  const app = express();

  // 1. CORS middleware (first: handles preflight OPTIONS requests immediately)
  app.use(
    cors({
      origin: config.api.corsOrigins,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "If-Match", "If-None-Match"],
      exposedHeaders: ["ETag", "Content-Length", "Content-Type"],
    }),
  );

  // 2. JSON body parser (multipart uploads bypass this; they use multer)
  app.use(express.json({ limit: "10mb" }));

  // 3. Request logger (logs method, URL, status code, duration -- never bodies)
  app.use(createRequestLoggerMiddleware(logger));

  // 4. Timeout middleware (aborts long-running requests)
  app.use(createTimeoutMiddleware(config.api.requestTimeoutMs));

  // 5. Swagger documentation (must be before routes because routes include a 404 catch-all)
  if (config.api.swaggerEnabled) {
    const swaggerSpec = createSwaggerSpec(config.api, actualPort);
    app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
    app.get("/api/docs.json", (_req, res) => {
      res.json(swaggerSpec);
    });
  }

  // 6. Routes (includes 404 catch-all at the end)
  const services: ApiServices = {
    blobService,
    metadataService,
    config,
    logger,
    sourceTracker: config.sourceTracker,
  };
  registerApiRoutes(app, services);

  // 7. Error handler (MUST be registered last -- Express 4-argument signature)
  //    Pass nodeEnv to control stack trace inclusion in error responses
  app.use(createErrorHandlerMiddleware(logger, config.api.nodeEnv));

  return app;
}

/**
 * Start the HTTP server.
 * Loads API config, creates services, creates Express app, and starts listening.
 * Handles graceful shutdown on SIGTERM/SIGINT and port conflicts.
 *
 * Startup sequence:
 *   1. Load and validate configuration
 *   2. Create logger and shared services
 *   3. Check port availability (proactive -- before listen)
 *   4. Create Express app (with actualPort for correct Swagger URLs)
 *   5. Start HTTP server
 *   6. Register graceful shutdown handlers
 */
export async function startServer(): Promise<void> {
  // 1. Load and validate all configuration (base + API section)
  const config = resolveApiConfig();

  // 2. Create logger
  const logger = new Logger(config.logging.level, false);

  // 3. Create shared service instances (one-time creation, reused across all requests)
  const blobService = new BlobFileSystemService(config, logger);
  const metadataService = new MetadataService(config, logger);

  // 4. Check port availability (proactive port check)
  let actualPort = config.api.port;
  const isAvailable = await PortChecker.isPortAvailable(config.api.port, config.api.host);

  if (!isAvailable) {
    // Log which process is using the port (informational, may return null)
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
      logger.error(
        `Port ${config.api.port} is already in use. ` +
        `Set AUTO_SELECT_PORT=true to auto-select, or choose a different port.`,
      );
      process.exit(1);
    }
  }

  // 5. Create Express app (pass actualPort only when it differs from configured port)
  const app = createApp(
    config,
    blobService,
    metadataService,
    logger,
    actualPort !== config.api.port ? actualPort : undefined,
  );

  // 6. Start HTTP server
  const server = http.createServer(app);

  // Safety net: handle port conflict race condition (between isPortAvailable and listen)
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logger.error(`Port ${actualPort} is already in use (race condition). Choose a different port.`);
      process.exit(1);
    }
    logger.error(`Server error: ${err.message}`);
    process.exit(1);
  });

  server.listen(actualPort, config.api.host, () => {
    const serverUrl = `http://${config.api.host}:${actualPort}`;

    logger.info(`Azure FS API server started`, {
      url: serverUrl,
      healthUrl: `${serverUrl}/api/health`,
      docsUrl: config.api.swaggerEnabled ? `${serverUrl}/api/docs` : "(disabled)",
      environment: config.api.nodeEnv,
    });

    // Also output to stdout for visibility
    process.stdout.write(`\nAzure FS API server listening on ${serverUrl}\n`);
    process.stdout.write(`  Health:    ${serverUrl}/api/health\n`);
    process.stdout.write(`  Readiness: ${serverUrl}/api/health/ready\n`);
    if (config.api.swaggerEnabled) {
      process.stdout.write(`  Docs:      ${serverUrl}/api/docs\n`);
    }
    if (actualPort !== config.api.port) {
      process.stdout.write(`  Note:      Auto-selected port ${actualPort} (configured: ${config.api.port})\n`);
    }
    process.stdout.write(`\n`);
  });

  // --- Graceful shutdown ---
  const SHUTDOWN_TIMEOUT_MS = 10_000;
  let shutdownInProgress = false;

  function gracefulShutdown(signal: string): void {
    if (shutdownInProgress) {
      // Double-signal: force-exit immediately
      logger.warn(`Received ${signal} again during shutdown. Forcing exit.`);
      process.exit(1);
    }

    shutdownInProgress = true;
    logger.info(`Received ${signal}, shutting down gracefully...`);

    // Stop accepting new connections
    server.close(() => {
      logger.info("All connections drained. Exiting.");
      process.exit(0);
    });

    // Safety net: if connections don't drain in time, force exit
    setTimeout(() => {
      logger.warn(`Shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms. Forcing exit.`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

// --- Main entry point ---
// When this file is executed directly (not imported), start the server.
startServer().catch((err) => {
  process.stderr.write(`Failed to start API server: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
});
```

**Changes from BEFORE**:
- Added `import { ConfigSourceTracker } from "../types/config.types"`
- Added `import { PortChecker } from "../utils/port-checker.utils"`
- `createApp()` now accepts `actualPort?: number` parameter
- `createApp()` passes `actualPort` to `createSwaggerSpec()`
- `createApp()` passes `config.sourceTracker` to `ApiServices`
- `createApp()` passes `config.api.nodeEnv` to `createErrorHandlerMiddleware()`
- `startServer()` now has proactive port check logic before `createApp()`
- `startServer()` uses `actualPort` instead of `config.api.port` for listen and log messages
- Replaced `process.env.NODE_ENV || "development"` with `config.api.nodeEnv`
- Added "auto-selected port" note in stdout output
- Safety net `server.on("error")` handler updated to use `actualPort`

---

## Feature 5: Development Routes

### 5.1 `src/api/controllers/dev.controller.ts` -- NEW FILE

```typescript
import { Request, Response } from "express";
import { ApiServices } from "../routes/index";

/**
 * Sensitive key patterns. If an environment variable name contains any of these
 * substrings (case-insensitive), its value is masked in the response.
 */
const SENSITIVE_PATTERNS: string[] = [
  "SECRET",
  "PASSWORD",
  "TOKEN",
  "KEY",
  "PRIVATE",
  "CREDENTIAL",
];

/**
 * Check if an environment variable name contains a sensitive pattern.
 */
function isSensitiveKey(key: string): boolean {
  const upperKey = key.toUpperCase();
  return SENSITIVE_PATTERNS.some((pattern) => upperKey.includes(pattern));
}

/**
 * Masked value placeholder for sensitive environment variables.
 */
const MASKED_VALUE = "***MASKED***";

/**
 * Internal type for environment variable info in responses.
 */
interface EnvVarInfo {
  name: string;
  value: string;
  source: string;
  masked: boolean;
}

/**
 * Create the development controller with handlers for diagnostic endpoints.
 * These endpoints expose environment variable information for debugging.
 *
 * SECURITY: These handlers include a defense-in-depth NODE_ENV check.
 * Even though the routes should only be mounted in development mode,
 * the handlers verify this independently and return 403 if not in development.
 *
 * @param services - The shared API services (includes config and sourceTracker).
 */
export function createDevController(services: ApiServices) {
  const { config, sourceTracker } = services;

  return {
    /**
     * GET /api/dev/env
     *
     * List all environment variables sorted alphabetically.
     * Sensitive values are masked. Source information is included
     * when ConfigSourceTracker is available.
     *
     * @openapi
     * /api/dev/env:
     *   get:
     *     summary: List all environment variables
     *     description: |
     *       Returns all environment variables sorted alphabetically with their
     *       sources and masked sensitive values. Only available in development mode.
     *     tags: [Development]
     *     responses:
     *       200:
     *         description: Environment variables listed successfully
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                 data:
     *                   type: object
     *                   properties:
     *                     environment:
     *                       type: string
     *                     totalVariables:
     *                       type: integer
     *                     variables:
     *                       type: array
     *                       items:
     *                         type: object
     *                         properties:
     *                           name:
     *                             type: string
     *                           value:
     *                             type: string
     *                           source:
     *                             type: string
     *                           masked:
     *                             type: boolean
     *                     sources:
     *                       type: object
     *       403:
     *         description: Not available outside development mode
     */
    listEnvVars(_req: Request, res: Response): void {
      // Defense in depth: verify NODE_ENV even though routes should only be mounted in dev
      if (config.api.nodeEnv !== "development") {
        res.status(403).json({
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "This endpoint is only available in development mode.",
          },
          metadata: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const variables: EnvVarInfo[] = [];
      const sourceCounts: Record<string, number> = {};

      // Iterate all process.env keys sorted alphabetically
      const sortedKeys = Object.keys(process.env).sort();

      for (const key of sortedKeys) {
        const rawValue = process.env[key] || "";
        const masked = isSensitiveKey(key);
        const value = masked ? MASKED_VALUE : rawValue;

        // Look up source from the tracker; use "system" for non-tracked vars
        const source = sourceTracker?.getSource(key) || "system";

        variables.push({ name: key, value, source, masked });

        // Count sources
        sourceCounts[source] = (sourceCounts[source] || 0) + 1;
      }

      res.json({
        success: true,
        data: {
          environment: config.api.nodeEnv,
          totalVariables: variables.length,
          variables,
          sources: sourceCounts,
        },
        metadata: {
          timestamp: new Date().toISOString(),
        },
      });
    },

    /**
     * GET /api/dev/env/:key
     *
     * Get a specific environment variable by name.
     * The key is normalized to uppercase for lookup.
     *
     * @openapi
     * /api/dev/env/{key}:
     *   get:
     *     summary: Get a specific environment variable
     *     description: |
     *       Returns the value and source of a specific environment variable.
     *       The key is normalized to uppercase. Only available in development mode.
     *     tags: [Development]
     *     parameters:
     *       - in: path
     *         name: key
     *         required: true
     *         schema:
     *           type: string
     *         description: Environment variable name (case-insensitive)
     *     responses:
     *       200:
     *         description: Environment variable found
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 success:
     *                   type: boolean
     *                 data:
     *                   type: object
     *                   properties:
     *                     name:
     *                       type: string
     *                     value:
     *                       type: string
     *                     source:
     *                       type: string
     *                     exists:
     *                       type: boolean
     *                     masked:
     *                       type: boolean
     *       403:
     *         description: Not available outside development mode
     *       404:
     *         description: Environment variable not found
     */
    getEnvVar(req: Request, res: Response): void {
      // Defense in depth: verify NODE_ENV
      if (config.api.nodeEnv !== "development") {
        res.status(403).json({
          success: false,
          error: {
            code: "FORBIDDEN",
            message: "This endpoint is only available in development mode.",
          },
          metadata: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const key = req.params.key.toUpperCase();
      const exists = key in process.env;

      if (!exists) {
        res.status(404).json({
          success: false,
          error: {
            code: "NOT_FOUND",
            message: `Environment variable not found: ${key}`,
          },
          metadata: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const rawValue = process.env[key] || "";
      const masked = isSensitiveKey(key);
      const value = masked ? MASKED_VALUE : rawValue;
      const source = sourceTracker?.getSource(key) || "system";

      res.json({
        success: true,
        data: {
          name: key,
          value,
          source,
          exists: true,
          masked,
        },
        metadata: {
          timestamp: new Date().toISOString(),
        },
      });
    },
  };
}
```

### 5.2 `src/api/routes/dev.routes.ts` -- NEW FILE

```typescript
import { Router } from "express";
import { ApiServices } from "./index";
import { createDevController } from "../controllers/dev.controller";

/**
 * Create development-only routes.
 *
 * These routes are only mounted when NODE_ENV=development (checked in routes/index.ts).
 * Each handler also performs a defense-in-depth check and returns 403 if not in development.
 *
 * Endpoints:
 *   GET /api/dev/env       - List all environment variables
 *   GET /api/dev/env/:key  - Get a specific environment variable
 */
export function createDevRoutes(services: ApiServices): Router {
  const router = Router();
  const controller = createDevController(services);

  /**
   * @openapi
   * /api/dev/env:
   *   get:
   *     summary: List all environment variables
   *     tags: [Development]
   *     responses:
   *       200:
   *         description: All environment variables with sources
   *       403:
   *         description: Not available outside development mode
   */
  router.get("/env", controller.listEnvVars);

  /**
   * @openapi
   * /api/dev/env/{key}:
   *   get:
   *     summary: Get a specific environment variable
   *     tags: [Development]
   *     parameters:
   *       - in: path
   *         name: key
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Environment variable details
   *       403:
   *         description: Not available outside development mode
   *       404:
   *         description: Variable not found
   */
  router.get("/env/:key", controller.getEnvVar);

  return router;
}
```

### 5.3 `src/api/routes/index.ts` -- FULL FILE (AFTER)

```typescript
import { Express, Request, Response } from "express";
import { ApiResolvedConfig } from "../../types/api-config.types";
import { ConfigSourceTracker } from "../../types/config.types";
import { BlobFileSystemService } from "../../services/blob-filesystem.service";
import { MetadataService } from "../../services/metadata.service";
import { Logger } from "../../utils/logger.utils";
import { createHealthRoutes } from "./health.routes";
import { createFileRoutes } from "./file.routes";
import { createEditRoutes } from "./edit.routes";
import { createFolderRoutes } from "./folder.routes";
import { createMetaRoutes } from "./meta.routes";
import { createTagRoutes } from "./tags.routes";
import { createDevRoutes } from "./dev.routes";

/**
 * Services passed to the route registration function.
 */
export interface ApiServices {
  blobService: BlobFileSystemService;
  metadataService: MetadataService;
  config: ApiResolvedConfig;
  logger: Logger;
  /** Config source tracker (populated by resolveApiConfig, used by dev routes). */
  sourceTracker?: ConfigSourceTracker;
}

/**
 * Register all API routes on the Express application.
 *
 * Route mount points:
 *   /api/health     -> health.routes.ts
 *   /api/v1/files   -> file.routes.ts
 *   /api/v1/edit    -> edit.routes.ts
 *   /api/v1/folders -> folder.routes.ts
 *   /api/v1/meta   -> meta.routes.ts
 *   /api/v1/tags   -> tags.routes.ts
 *   /api/dev        -> dev.routes.ts (development only)
 */
export function registerApiRoutes(app: Express, services: ApiServices): void {
  const { config } = services;

  // Health check routes (liveness + readiness)
  app.use("/api/health", createHealthRoutes(config));

  // File operation routes
  app.use("/api/v1/files", createFileRoutes(services.blobService, config.api));

  // Edit operation routes (patch, append, edit workflow)
  app.use("/api/v1/edit", createEditRoutes(services.blobService, config.api));

  // Folder operation routes
  app.use("/api/v1/folders", createFolderRoutes(services.blobService));

  // Metadata operation routes
  app.use("/api/v1/meta", createMetaRoutes(services.metadataService));

  // Tag operation routes
  app.use("/api/v1/tags", createTagRoutes(services.metadataService));

  // Development-only routes (only mounted when NODE_ENV=development)
  if (config.api.nodeEnv === "development") {
    app.use("/api/dev", createDevRoutes(services));
  }

  // --- 404 handler for unmatched routes ---
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: `Route not found: ${_req.method} ${_req.originalUrl}`,
      },
      metadata: {
        timestamp: new Date().toISOString(),
      },
    });
  });
}
```

**Changes from BEFORE**:
- Added `import { ConfigSourceTracker } from "../../types/config.types"`
- Added `import { createDevRoutes } from "./dev.routes"`
- Added `sourceTracker?: ConfigSourceTracker` to `ApiServices` interface
- Added conditional dev route mounting before the 404 catch-all:
  `if (config.api.nodeEnv === "development") { app.use("/api/dev", createDevRoutes(services)); }`

---

## Updated .env.example

### FULL FILE (AFTER)

```bash
# Azure Storage Account URL (e.g., https://myaccount.blob.core.windows.net)
AZURE_STORAGE_ACCOUNT_URL=

# Default container name
AZURE_STORAGE_CONTAINER_NAME=

# Authentication method: "connection-string" | "sas-token" | "azure-ad"
AZURE_FS_AUTH_METHOD=

# Connection string (required when AZURE_FS_AUTH_METHOD=connection-string)
# Find in: Azure Portal > Storage Account > Access Keys
AZURE_STORAGE_CONNECTION_STRING=

# SAS token (required when AZURE_FS_AUTH_METHOD=sas-token)
# Generate in: Azure Portal > Storage Account > Shared Access Signature
AZURE_STORAGE_SAS_TOKEN=

# SAS token expiration date in ISO 8601 format (required when AZURE_FS_AUTH_METHOD=sas-token)
# Must match the expiry date set when generating the SAS token
# Example: 2026-12-31T00:00:00Z
AZURE_STORAGE_SAS_TOKEN_EXPIRY=

# Logging level: "debug" | "info" | "warn" | "error"
AZURE_FS_LOG_LEVEL=

# Whether to log Azure SDK requests (true/false)
AZURE_FS_LOG_REQUESTS=

# Retry strategy: "none" | "exponential" | "fixed"
AZURE_FS_RETRY_STRATEGY=

# Maximum number of retries
AZURE_FS_RETRY_MAX_RETRIES=

# Initial delay in milliseconds for retry
AZURE_FS_RETRY_INITIAL_DELAY_MS=

# Maximum delay in milliseconds for retry (exponential backoff cap)
AZURE_FS_RETRY_MAX_DELAY_MS=

# Maximum number of parallel uploads for batch operations (upload-dir)
# Must be a positive integer (e.g., 5, 10, 20)
AZURE_FS_BATCH_CONCURRENCY=

# ---- REST API Configuration ----

# Environment mode: "development" | "production" | "test"
# Required when starting the API server. Controls:
#   - Error stack traces in responses (development only)
#   - Swagger server description text
#   - Development-only route availability (/api/dev/*)
NODE_ENV=

# Port the API server listens on (e.g., 3000, 8080)
AZURE_FS_API_PORT=

# Host/IP the API server binds to (e.g., 0.0.0.0 for all interfaces, 127.0.0.1 for localhost only)
AZURE_FS_API_HOST=

# Comma-separated list of allowed CORS origins (e.g., "http://localhost:3000,https://myapp.com" or "*" for all)
AZURE_FS_API_CORS_ORIGINS=

# Enable Swagger UI documentation at /api/docs (true/false)
AZURE_FS_API_SWAGGER_ENABLED=

# Maximum upload file size in megabytes
AZURE_FS_API_UPLOAD_MAX_SIZE_MB=

# Request timeout in milliseconds (requests exceeding this are aborted)
AZURE_FS_API_REQUEST_TIMEOUT_MS=

# Automatically find an available port if the configured port is in use (true/false)
# Required when starting the API server. Set to "true" to auto-select the next
# available port on conflict, or "false" to abort startup.
AUTO_SELECT_PORT=

# ---- Swagger Server URL Detection (all optional) ----
# These environment variables enhance Swagger documentation with correct server URLs.
# They are all optional -- missing values simply mean that environment is not detected.

# Comma-separated additional Swagger server URLs
# Example: https://api.example.com,https://staging.api.example.com
# AZURE_FS_API_SWAGGER_ADDITIONAL_SERVERS=

# Enable Swagger server variables for interactive URL editing in Swagger UI (true/false)
# AZURE_FS_API_SWAGGER_SERVER_VARIABLES=

# Force HTTPS protocol in Kubernetes environments (true/false)
# AZURE_FS_API_USE_HTTPS=
```

**Changes from BEFORE**:
- Added `NODE_ENV=` with description (Feature 1)
- Added `AUTO_SELECT_PORT=` with description (Feature 4)
- Added Swagger Server URL Detection section with commented-out optional vars (Feature 3)

---

## Updated .azure-fs.json.example

The config file example should also be updated to include the new API fields.

**BEFORE**:
```json
{
  "api": {
    "port": 3000,
    "host": "0.0.0.0",
    "corsOrigins": ["*"],
    "swaggerEnabled": true,
    "uploadMaxSizeMb": 100,
    "requestTimeoutMs": 30000
  }
}
```

**AFTER** (api section only):
```json
{
  "api": {
    "port": 3000,
    "host": "0.0.0.0",
    "corsOrigins": ["*"],
    "swaggerEnabled": true,
    "uploadMaxSizeMb": 100,
    "requestTimeoutMs": 30000,
    "nodeEnv": "development",
    "autoSelectPort": false
  }
}
```

---

## Updated Types Barrel Export

### `src/types/index.ts` -- FULL FILE (AFTER)

```typescript
export {
  AuthMethod,
  LogLevel,
  RetryStrategy,
  ConfigSourceLabel,
  ConfigSourceTracker,
  AzureFsConfigFile,
  CliOptions,
  ResolvedConfig,
} from "./config.types";

export {
  NodeEnvironment,
  ApiConfig,
  ApiResolvedConfig,
} from "./api-config.types";

export {
  CommandResult,
  CommandError,
  CommandMetadata,
} from "./command-result.types";

export {
  ConfigErrorCode,
  AuthErrorCode,
  BlobErrorCode,
  PathErrorCode,
  MetadataErrorCode,
  NetworkErrorCode,
  GeneralErrorCode,
} from "./errors.types";

export {
  FileInfo,
  UploadResult,
  DownloadResult,
  DeleteResult,
  ExistsResult,
  ListItem,
  CreateFolderResult,
  ListFolderResult,
  DeleteFolderResult,
  UploadDirectoryResult,
  UploadDirectoryFileResult,
} from "./filesystem.types";

export {
  MetadataResult,
  TagResult,
  TagQueryResult,
  TagQueryMatch,
} from "./metadata.types";

export {
  PatchInstruction,
  PatchInstructionResult,
  PatchResult,
  EditResult,
  EditUploadResult,
  AppendResult,
} from "./patch.types";
```

**Changes from BEFORE**:
- Added `ConfigSourceLabel, ConfigSourceTracker` to config.types exports
- Added `NodeEnvironment` to api-config.types exports

---

## Summary: All Files

### New Files (3)

| File | Feature | Lines (approx) |
|------|---------|----------------|
| `src/utils/port-checker.utils.ts` | F4 | 115 |
| `src/api/controllers/dev.controller.ts` | F5 | 195 |
| `src/api/routes/dev.routes.ts` | F5 | 55 |

### Modified Files (9)

| File | Features | Key Changes |
|------|----------|-------------|
| `src/types/api-config.types.ts` | F1, F2, F4 | `NodeEnvironment` type, `nodeEnv` + `autoSelectPort` in `ApiConfig`, `sourceTracker` in `ApiResolvedConfig` |
| `src/types/config.types.ts` | F1, F2, F4 | `ConfigSourceLabel`, `ConfigSourceTracker`, `nodeEnv` + `autoSelectPort` in `AzureFsConfigFile.api` |
| `src/types/index.ts` | F1, F2 | Barrel export updates |
| `src/config/config.loader.ts` | F1, F2, F4 | `createSourceTracker()`, tracked `mergeConfigSection()`, `NODE_ENV` + `AUTO_SELECT_PORT` env reading |
| `src/config/config.schema.ts` | F1, F4 | `nodeEnv` + `autoSelectPort` validation blocks |
| `src/api/swagger/config.ts` | F1, F3 | `getBaseUrl()`, `buildSwaggerServers()`, `actualPort` parameter, `nodeEnv` description |
| `src/api/server.ts` | F1, F2, F3, F4 | `actualPort` param, `PortChecker` integration, `sourceTracker` pass-through, `nodeEnv` usage |
| `src/api/middleware/error-handler.middleware.ts` | F1 | `nodeEnv` parameter, conditional stack traces |
| `src/api/routes/index.ts` | F2, F5 | `sourceTracker` in `ApiServices`, conditional dev route mounting |
| `.env.example` | F1, F3, F4 | `NODE_ENV`, `AUTO_SELECT_PORT`, Swagger detection vars |
| `.azure-fs.json.example` | F1, F4 | `nodeEnv`, `autoSelectPort` in api section |

### New Environment Variables

| Variable | Required | Feature | Location |
|----------|----------|---------|----------|
| `NODE_ENV` | Yes (API) | F1 | `loadEnvConfig()` -> `api.nodeEnv` |
| `AUTO_SELECT_PORT` | Yes (API) | F4 | `loadEnvConfig()` -> `api.autoSelectPort` |
| `PUBLIC_URL` | No | F3 | Read in `swagger/config.ts` via `process.env` |
| `WEBSITE_HOSTNAME` | No | F3 | Read in `swagger/config.ts` via `process.env` |
| `WEBSITE_SITE_NAME` | No | F3 | Read in `swagger/config.ts` via `process.env` |
| `K8S_SERVICE_HOST` | No | F3 | Read in `swagger/config.ts` via `process.env` |
| `K8S_SERVICE_PORT` | No | F3 | Read in `swagger/config.ts` via `process.env` |
| `DOCKER_HOST_URL` | No | F3 | Read in `swagger/config.ts` via `process.env` |
| `AZURE_FS_API_USE_HTTPS` | No | F3 | Read in `swagger/config.ts` via `process.env` |
| `AZURE_FS_API_SWAGGER_ADDITIONAL_SERVERS` | No | F3 | Read in `swagger/config.ts` via `process.env` |
| `AZURE_FS_API_SWAGGER_SERVER_VARIABLES` | No | F3 | Read in `swagger/config.ts` via `process.env` |

### Implementation Order

```
Feature 1: NODE_ENV Support (foundation)
    |
    +---> Feature 2: Config Source Tracking (parallel after F1)
    |         |
    |         +---> Feature 5: Development Routes (depends on F1 + F2)
    |
    +---> Feature 3: Container-Aware Swagger URLs (parallel after F1)
    |
    +---> Feature 4: PortChecker Utility (parallel after F1)
```

### Design Constraints Followed

1. **No fallback config values**: `NODE_ENV` and `AUTO_SELECT_PORT` are required and throw `ConfigError` when missing.
2. **AZURE_FS_* prefix convention**: Project-specific vars use the prefix. `NODE_ENV` and `AUTO_SELECT_PORT` are exceptions (standard conventions). Container env vars are platform-injected, not prefixed.
3. **Container env vars not in schema**: `WEBSITE_HOSTNAME`, `K8S_*`, etc. are read directly from `process.env` in the Swagger module. They are optional detection signals, not required config.
4. **Existing patterns**: Factory functions (`createDevController`, `createDevRoutes`, `createSourceTracker`), DI via `ApiServices`, `ConfigError` hierarchy, `Logger` for all output.
5. **Strict TypeScript**: No `any` types. All interfaces fully typed. `PortCheckResult` exported. `NodeEnvironment` is a union type.
6. **CLI unaffected**: `loadConfig()` and `resolveConfig()` are unchanged. Source tracking and NODE_ENV validation only apply to `resolveApiConfig()`.
