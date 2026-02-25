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
  swaggerAdditionalServers?: string[];
  swaggerServerVariables?: boolean;
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
