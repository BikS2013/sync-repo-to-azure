import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  RepoSyncConfigFile,
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
 *   2. Current working directory (./.repo-sync.json)
 *   3. User home directory (~/.repo-sync.json)
 *
 * Returns the parsed file content, or an empty object if no config file is found.
 * Throws ConfigError if the explicit --config path does not exist or is not valid JSON.
 */
function loadConfigFile(configPath?: string): RepoSyncConfigFile {
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
    searchPaths.push(path.join(process.cwd(), ".repo-sync.json"));
    searchPaths.push(path.join(os.homedir(), ".repo-sync.json"));
  }

  for (const filePath of searchPaths) {
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(content) as RepoSyncConfigFile;
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
 * Result of loading environment variables: the config values + a reverse map from
 * config property keys to their originating env var names (for source tracking in dev routes).
 */
interface EnvConfigResult {
  values: Record<string, Record<string, unknown>>;
  envVarNames: Record<string, Record<string, string>>;
}

/**
 * Load configuration from environment variables.
 * Returns config values and env-var-name mappings for each section.
 */
function loadEnvConfig(): EnvConfigResult {
  const values: Record<string, Record<string, unknown>> = {
    storage: {},
    logging: {},
    retry: {},
    api: {},
    github: {},
    devops: {},
  };
  const envVarNames: Record<string, Record<string, string>> = {
    storage: {},
    logging: {},
    retry: {},
    api: {},
    github: {},
    devops: {},
  };

  // Helper: set value and record env var name
  function setEnv(section: string, key: string, value: unknown, envVar: string): void {
    values[section][key] = value;
    envVarNames[section][key] = envVar;
  }

  if (process.env.AZURE_STORAGE_ACCOUNT_URL) {
    setEnv("storage", "accountUrl", process.env.AZURE_STORAGE_ACCOUNT_URL, "AZURE_STORAGE_ACCOUNT_URL");
  }
  if (process.env.AZURE_STORAGE_CONTAINER_NAME) {
    setEnv("storage", "containerName", process.env.AZURE_STORAGE_CONTAINER_NAME, "AZURE_STORAGE_CONTAINER_NAME");
  }
  if (process.env.AZURE_FS_AUTH_METHOD) {
    setEnv("storage", "authMethod", process.env.AZURE_FS_AUTH_METHOD, "AZURE_FS_AUTH_METHOD");
  }
  if (process.env.AZURE_STORAGE_SAS_TOKEN_EXPIRY) {
    setEnv("storage", "sasTokenExpiry", process.env.AZURE_STORAGE_SAS_TOKEN_EXPIRY, "AZURE_STORAGE_SAS_TOKEN_EXPIRY");
  }
  if (process.env.AZURE_FS_LOG_LEVEL) {
    setEnv("logging", "level", process.env.AZURE_FS_LOG_LEVEL, "AZURE_FS_LOG_LEVEL");
  }
  if (process.env.AZURE_FS_LOG_REQUESTS !== undefined && process.env.AZURE_FS_LOG_REQUESTS !== "") {
    setEnv("logging", "logRequests", process.env.AZURE_FS_LOG_REQUESTS === "true", "AZURE_FS_LOG_REQUESTS");
  }
  if (process.env.AZURE_FS_RETRY_STRATEGY) {
    setEnv("retry", "strategy", process.env.AZURE_FS_RETRY_STRATEGY, "AZURE_FS_RETRY_STRATEGY");
  }
  if (process.env.AZURE_FS_RETRY_MAX_RETRIES) {
    setEnv("retry", "maxRetries", Number(process.env.AZURE_FS_RETRY_MAX_RETRIES), "AZURE_FS_RETRY_MAX_RETRIES");
  }
  if (process.env.AZURE_FS_RETRY_INITIAL_DELAY_MS) {
    setEnv("retry", "initialDelayMs", Number(process.env.AZURE_FS_RETRY_INITIAL_DELAY_MS), "AZURE_FS_RETRY_INITIAL_DELAY_MS");
  }
  if (process.env.AZURE_FS_RETRY_MAX_DELAY_MS) {
    setEnv("retry", "maxDelayMs", Number(process.env.AZURE_FS_RETRY_MAX_DELAY_MS), "AZURE_FS_RETRY_MAX_DELAY_MS");
  }

  // --- API-specific environment variables ---
  if (process.env.AZURE_FS_API_PORT) {
    setEnv("api", "port", Number(process.env.AZURE_FS_API_PORT), "AZURE_FS_API_PORT");
  }
  if (process.env.AZURE_FS_API_HOST) {
    setEnv("api", "host", process.env.AZURE_FS_API_HOST, "AZURE_FS_API_HOST");
  }
  if (process.env.AZURE_FS_API_CORS_ORIGINS) {
    setEnv("api", "corsOrigins", process.env.AZURE_FS_API_CORS_ORIGINS.split(",").map((s) => s.trim()).filter((s) => s.length > 0), "AZURE_FS_API_CORS_ORIGINS");
  }
  if (process.env.AZURE_FS_API_SWAGGER_ENABLED !== undefined && process.env.AZURE_FS_API_SWAGGER_ENABLED !== "") {
    setEnv("api", "swaggerEnabled", process.env.AZURE_FS_API_SWAGGER_ENABLED === "true", "AZURE_FS_API_SWAGGER_ENABLED");
  }
  if (process.env.AZURE_FS_API_REQUEST_TIMEOUT_MS) {
    setEnv("api", "requestTimeoutMs", Number(process.env.AZURE_FS_API_REQUEST_TIMEOUT_MS), "AZURE_FS_API_REQUEST_TIMEOUT_MS");
  }

  // NODE_ENV: standard Node.js convention, no AZURE_FS_ prefix
  if (process.env.NODE_ENV) {
    setEnv("api", "nodeEnv", process.env.NODE_ENV, "NODE_ENV");
  }

  // AUTO_SELECT_PORT: standard utility pattern, no AZURE_FS_ prefix
  if (process.env.AUTO_SELECT_PORT !== undefined && process.env.AUTO_SELECT_PORT !== "") {
    setEnv("api", "autoSelectPort", process.env.AUTO_SELECT_PORT === "true", "AUTO_SELECT_PORT");
  }

  // AZURE_FS_API_SWAGGER_ADDITIONAL_SERVERS: comma-separated list of additional Swagger server URLs
  if (process.env.AZURE_FS_API_SWAGGER_ADDITIONAL_SERVERS) {
    setEnv("api", "swaggerAdditionalServers", process.env.AZURE_FS_API_SWAGGER_ADDITIONAL_SERVERS.split(",").map((s) => s.trim()).filter((s) => s.length > 0), "AZURE_FS_API_SWAGGER_ADDITIONAL_SERVERS");
  }

  // AZURE_FS_API_SWAGGER_SERVER_VARIABLES: enable Swagger server variables
  if (process.env.AZURE_FS_API_SWAGGER_SERVER_VARIABLES !== undefined && process.env.AZURE_FS_API_SWAGGER_SERVER_VARIABLES !== "") {
    setEnv("api", "swaggerServerVariables", process.env.AZURE_FS_API_SWAGGER_SERVER_VARIABLES === "true", "AZURE_FS_API_SWAGGER_SERVER_VARIABLES");
  }

  // --- Repository replication: GitHub environment variables ---
  if (process.env.GITHUB_TOKEN) {
    setEnv("github", "token", process.env.GITHUB_TOKEN, "GITHUB_TOKEN");
  }
  if (process.env.GITHUB_TOKEN_EXPIRY) {
    setEnv("github", "tokenExpiry", process.env.GITHUB_TOKEN_EXPIRY, "GITHUB_TOKEN_EXPIRY");
  }

  // --- Repository replication: Azure DevOps environment variables ---
  if (process.env.AZURE_DEVOPS_PAT) {
    setEnv("devops", "pat", process.env.AZURE_DEVOPS_PAT, "AZURE_DEVOPS_PAT");
  }
  if (process.env.AZURE_DEVOPS_PAT_EXPIRY) {
    setEnv("devops", "patExpiry", process.env.AZURE_DEVOPS_PAT_EXPIRY, "AZURE_DEVOPS_PAT_EXPIRY");
  }
  if (process.env.AZURE_DEVOPS_AUTH_METHOD) {
    setEnv("devops", "authMethod", process.env.AZURE_DEVOPS_AUTH_METHOD, "AZURE_DEVOPS_AUTH_METHOD");
  }
  if (process.env.AZURE_DEVOPS_ORG_URL) {
    setEnv("devops", "orgUrl", process.env.AZURE_DEVOPS_ORG_URL, "AZURE_DEVOPS_ORG_URL");
  }

  return { values, envVarNames };
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
    api: {},
    github: {},
    devops: {},
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
  /** Maps config property keys to their originating env var names (for reverse lookup by dev routes). */
  envVarNames?: Record<string, string>;
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
          // Also track by env var name for reverse lookup by dev routes
          if (override.envVarNames && override.envVarNames[key]) {
            tracker.set(override.envVarNames[key], override.source);
          }
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
  const envResult = loadEnvConfig();
  const cliConfig = loadCliConfig(cliOptions);

  const sections = ["storage", "logging", "retry", "api", "github", "devops"] as const;
  const merged: Record<string, unknown> = {};

  for (const section of sections) {
    merged[section] = mergeConfigSection(
      (fileConfig[section] as Record<string, unknown>) || {},
      [
        { values: envResult.values[section], source: "environment-variable", envVarNames: envResult.envVarNames[section] },
        { values: cliConfig[section], source: "cli-flag" },
      ],
      tracker,
      section,
    );
  }

  return merged;
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

  // Validate base config (storage, logging, retry) -- throws ConfigError for any missing required field
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
