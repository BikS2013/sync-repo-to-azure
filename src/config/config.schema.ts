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

  // --- nodeEnv (required) ---
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

  // --- autoSelectPort (required) ---
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

  // --- swaggerAdditionalServers (optional) ---
  let swaggerAdditionalServers: string[] | undefined;
  if (api["swaggerAdditionalServers"] !== undefined && api["swaggerAdditionalServers"] !== null) {
    if (typeof api["swaggerAdditionalServers"] === "string") {
      swaggerAdditionalServers = api["swaggerAdditionalServers"]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    } else if (Array.isArray(api["swaggerAdditionalServers"])) {
      swaggerAdditionalServers = api["swaggerAdditionalServers"] as string[];
    } else {
      throw ConfigError.invalidValue(
        "api.swaggerAdditionalServers",
        api["swaggerAdditionalServers"],
        ["comma-separated string or string array"],
      );
    }
  }

  // --- swaggerServerVariables (optional) ---
  let swaggerServerVariables: boolean | undefined;
  if (api["swaggerServerVariables"] !== undefined && api["swaggerServerVariables"] !== null) {
    if (typeof api["swaggerServerVariables"] !== "boolean") {
      throw ConfigError.invalidValue(
        "api.swaggerServerVariables",
        api["swaggerServerVariables"],
        ["true", "false"],
      );
    }
    swaggerServerVariables = api["swaggerServerVariables"] as boolean;
  }

  const result: ApiConfig = {
    port,
    host,
    corsOrigins,
    swaggerEnabled,
    uploadMaxSizeMb,
    requestTimeoutMs,
    nodeEnv: nodeEnv as NodeEnvironment,
    autoSelectPort,
  };

  if (swaggerAdditionalServers !== undefined) {
    result.swaggerAdditionalServers = swaggerAdditionalServers;
  }

  if (swaggerServerVariables !== undefined) {
    result.swaggerServerVariables = swaggerServerVariables;
  }

  return result;
}
