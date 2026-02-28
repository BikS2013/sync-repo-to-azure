/**
 * Type declarations for the azure-venv ESM module.
 * Required because this project uses CommonJS and azure-venv is ESM-only.
 * The module is loaded via dynamic import() at runtime.
 */
declare module "azure-venv" {
  export interface SyncResult {
    attempted: boolean;
    totalBlobs: number;
    downloaded: number;
    skipped: number;
    failed: number;
    failedBlobs: string[];
    duration: number;
    remoteEnvLoaded: boolean;
  }

  export interface AzureVenvOptions {
    rootDir?: string;
    envPath?: string;
    syncMode?: "full" | "incremental";
    failOnError?: boolean;
    concurrency?: number;
    timeout?: number;
    logLevel?: "debug" | "info" | "warn" | "error";
  }

  export class ConfigurationError extends Error {}
  export class AuthenticationError extends Error {}

  export function initAzureVenv(options?: AzureVenvOptions): Promise<SyncResult>;
}
