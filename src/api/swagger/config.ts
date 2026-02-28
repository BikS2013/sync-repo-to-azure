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
 */
function buildSwaggerServers(baseUrl: string, apiConfig: ApiConfig): object[] {
  const servers: object[] = [];

  // Primary server entry
  const serverEntry: Record<string, unknown> = {
    url: baseUrl,
    description: apiConfig.nodeEnv === "production" ? "Production server" : "Development server",
  };

  // Optional server variables (for Swagger UI interactivity)
  if (apiConfig.swaggerServerVariables === true) {
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

  // Additional servers from config (already parsed by config loader)
  const additionalServers = apiConfig.swaggerAdditionalServers;
  if (additionalServers && additionalServers.length > 0) {
    additionalServers.forEach((url, index) => {
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
        title: "Repo Sync API",
        version: "1.0.0",
        description: "REST API for repository synchronization from GitHub and Azure DevOps to Azure Blob Storage",
      },
      servers,
      tags: [
        { name: "Health", description: "Health check endpoints" },
        { name: "Repository", description: "Repository replication and sync pair operations" },
        { name: "Development", description: "Development-only diagnostic endpoints (only available when NODE_ENV=development)" },
        { name: "Hotkeys", description: "Remote console hotkey actions (only available when NODE_ENV=development)" },
      ],
    },
    apis: ["./src/api/routes/*.ts", "./dist/api/routes/*.js"],
  };

  return swaggerJsdoc(options);
}
