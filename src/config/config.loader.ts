import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { AzureFsConfigFile, CliOptions, ResolvedConfig } from "../types/config.types";
import { ApiResolvedConfig } from "../types/api-config.types";
import { ConfigError } from "../errors/config.error";
import { validateConfig, validateApiConfig } from "./config.schema";

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
 * Deep-merge configuration objects. Later sources override earlier ones.
 * Only non-undefined values from the override are applied.
 */
function mergeConfigSection(
  base: Record<string, unknown>,
  ...overrides: Record<string, unknown>[]
): Record<string, unknown> {
  const result = { ...base };
  for (const override of overrides) {
    for (const key of Object.keys(override)) {
      if (override[key] !== undefined) {
        result[key] = override[key];
      }
    }
  }
  return result;
}

/**
 * Build the merged configuration from all sources (file, env, CLI).
 * Does NOT validate -- returns the raw merged object.
 */
function buildMergedConfig(cliOptions: CliOptions): Record<string, unknown> {
  const fileConfig = loadConfigFile(cliOptions.config);
  const envConfig = loadEnvConfig();
  const cliConfig = loadCliConfig(cliOptions);

  return {
    storage: mergeConfigSection(
      (fileConfig.storage as Record<string, unknown>) || {},
      envConfig["storage"],
      cliConfig["storage"],
    ),
    logging: mergeConfigSection(
      (fileConfig.logging as Record<string, unknown>) || {},
      envConfig["logging"],
      cliConfig["logging"],
    ),
    retry: mergeConfigSection(
      (fileConfig.retry as Record<string, unknown>) || {},
      envConfig["retry"],
      cliConfig["retry"],
    ),
    batch: mergeConfigSection(
      (fileConfig.batch as Record<string, unknown>) || {},
      envConfig["batch"],
      cliConfig["batch"],
    ),
    api: mergeConfigSection(
      (fileConfig.api as Record<string, unknown>) || {},
      envConfig["api"],
      cliConfig["api"],
    ),
  };
}

/**
 * Load, merge, and validate configuration from all sources.
 * Priority: CLI flags > environment variables > config file.
 *
 * Throws ConfigError if any required field is missing (no fallback/default values).
 * NOTE: The `api` section is NOT validated here -- it is optional for CLI commands.
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
 * All six API parameters are required -- missing values throw ConfigError.
 *
 * Returns ApiResolvedConfig with a required `api` section.
 */
export function resolveApiConfig(cliOptions?: CliOptions): ApiResolvedConfig {
  const opts = cliOptions || {};
  const merged = buildMergedConfig(opts);

  // 1. Validate base config
  const baseConfig = validateConfig(merged);

  // 2. Validate API-specific config
  const apiSection = (merged["api"] as Record<string, unknown>) || {};
  const apiConfig = validateApiConfig(apiSection);

  return {
    ...baseConfig,
    api: apiConfig,
  };
}

/**
 * Build a merged config object WITHOUT validation, for display purposes (config show).
 * Returns the raw merged values so the user can see what is resolved from each source.
 */
export function loadConfigRaw(cliOptions: CliOptions): Record<string, unknown> {
  return buildMergedConfig(cliOptions);
}
