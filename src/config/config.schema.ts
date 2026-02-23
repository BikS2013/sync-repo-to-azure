import { AuthMethod, LogLevel, ResolvedConfig, RetryStrategy } from "../types/config.types";
import { ConfigError } from "../errors/config.error";

const VALID_AUTH_METHODS: AuthMethod[] = ["connection-string", "sas-token", "azure-ad"];
const VALID_LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];
const VALID_RETRY_STRATEGIES: RetryStrategy[] = ["none", "exponential", "fixed"];

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
