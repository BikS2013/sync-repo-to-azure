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

      const rawKey = req.params.key as string | string[];
      const keyStr = Array.isArray(rawKey) ? rawKey.join("/") : String(rawKey);
      const key = keyStr.toUpperCase();
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
