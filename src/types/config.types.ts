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
    swaggerAdditionalServers?: string[];
    swaggerServerVariables?: boolean;
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
