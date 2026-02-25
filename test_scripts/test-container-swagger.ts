/**
 * test-container-swagger.ts -- Container-aware Swagger URL detection tests
 *
 * Tests the Swagger spec generation with various container environment variables.
 * Since getBaseUrl() and buildSwaggerServers() are private functions, we test them
 * indirectly through createSwaggerSpec() which is exported.
 *
 * Tests:
 *   1. No container env vars -> localhost URL
 *   2. PUBLIC_URL set -> uses that URL
 *   3. WEBSITE_HOSTNAME set -> uses Azure URL with HTTPS
 *   4. WEBSITE_HOSTNAME without WEBSITE_SITE_NAME -> uses HTTP
 *   5. K8S_SERVICE_HOST + K8S_SERVICE_PORT -> Kubernetes URL
 *   6. DOCKER_HOST_URL set -> uses Docker URL
 *   7. PUBLIC_URL takes priority over WEBSITE_HOSTNAME
 *   8. AZURE_FS_API_SWAGGER_ADDITIONAL_SERVERS adds extra servers
 *   9. swaggerServerVariables enables server variables
 *  10. actualPort overrides configured port in URL
 */

import { createSwaggerSpec } from "../src/api/swagger/config";
import { ApiConfig } from "../src/types/api-config.types";

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failCount++;
  } else {
    console.log(`  PASS: ${message}`);
    passCount++;
  }
}

/**
 * Container env var keys that we manipulate during tests.
 * We save and restore them to avoid pollution between tests.
 */
const CONTAINER_ENV_KEYS = [
  "PUBLIC_URL",
  "WEBSITE_HOSTNAME",
  "WEBSITE_SITE_NAME",
  "K8S_SERVICE_HOST",
  "K8S_SERVICE_PORT",
  "DOCKER_HOST_URL",
  "AZURE_FS_API_USE_HTTPS",
  "AZURE_FS_API_SWAGGER_ADDITIONAL_SERVERS",
  "AZURE_FS_API_SWAGGER_SERVER_VARIABLES",
];

/** Save current env vars for restoration */
function saveEnv(): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const key of CONTAINER_ENV_KEYS) {
    saved[key] = process.env[key];
  }
  return saved;
}

/** Restore saved env vars */
function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const key of CONTAINER_ENV_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
}

/** Clear all container env vars */
function clearContainerEnv(): void {
  for (const key of CONTAINER_ENV_KEYS) {
    delete process.env[key];
  }
}

/** Create a minimal ApiConfig for testing */
function createTestApiConfig(overrides?: Partial<ApiConfig>): ApiConfig {
  return {
    port: 3000,
    host: "localhost",
    corsOrigins: ["*"],
    swaggerEnabled: true,
    uploadMaxSizeMb: 100,
    requestTimeoutMs: 30000,
    nodeEnv: "development",
    autoSelectPort: false,
    ...overrides,
  };
}

/** Extract servers array from the swagger spec */
function getServers(spec: any): any[] {
  return spec?.servers || [];
}

async function main(): Promise<void> {
  console.log("\n=== test-container-swagger.ts ===\n");

  const savedEnv = saveEnv();

  try {
    // -------------------------------------------------------
    // Test 1: No container env vars -> localhost URL
    // -------------------------------------------------------
    console.log("Test 1: No container env vars -> localhost URL");
    clearContainerEnv();
    try {
      const config = createTestApiConfig({ port: 3000, host: "localhost" });
      const spec = createSwaggerSpec(config) as any;
      const servers = getServers(spec);
      assert(servers.length >= 1, `At least 1 server in spec (got ${servers.length})`);
      assert(
        servers[0].url === "http://localhost:3000",
        `Server URL is http://localhost:3000 (got "${servers[0].url}")`,
      );
      assert(
        servers[0].description === "Development server",
        `Description is "Development server" (got "${servers[0].description}")`,
      );
    } catch (err: any) {
      assert(false, `Test 1 threw unexpectedly: ${err.message}`);
    }

    // -------------------------------------------------------
    // Test 2: PUBLIC_URL set -> uses that URL
    // -------------------------------------------------------
    console.log("Test 2: PUBLIC_URL set -> uses that URL");
    clearContainerEnv();
    process.env.PUBLIC_URL = "https://my-custom-url.example.com";
    try {
      const config = createTestApiConfig();
      const spec = createSwaggerSpec(config) as any;
      const servers = getServers(spec);
      assert(
        servers[0].url === "https://my-custom-url.example.com",
        `Server URL is the PUBLIC_URL (got "${servers[0].url}")`,
      );
    } catch (err: any) {
      assert(false, `Test 2 threw unexpectedly: ${err.message}`);
    }

    // -------------------------------------------------------
    // Test 3: WEBSITE_HOSTNAME with WEBSITE_SITE_NAME -> HTTPS Azure URL
    // -------------------------------------------------------
    console.log("Test 3: WEBSITE_HOSTNAME + WEBSITE_SITE_NAME -> HTTPS Azure URL");
    clearContainerEnv();
    process.env.WEBSITE_HOSTNAME = "myapp.azurewebsites.net";
    process.env.WEBSITE_SITE_NAME = "myapp";
    try {
      const config = createTestApiConfig();
      const spec = createSwaggerSpec(config) as any;
      const servers = getServers(spec);
      assert(
        servers[0].url === "https://myapp.azurewebsites.net",
        `Server URL uses HTTPS and Azure hostname (got "${servers[0].url}")`,
      );
    } catch (err: any) {
      assert(false, `Test 3 threw unexpectedly: ${err.message}`);
    }

    // -------------------------------------------------------
    // Test 4: WEBSITE_HOSTNAME without WEBSITE_SITE_NAME -> HTTP
    // -------------------------------------------------------
    console.log("Test 4: WEBSITE_HOSTNAME without WEBSITE_SITE_NAME -> HTTP");
    clearContainerEnv();
    process.env.WEBSITE_HOSTNAME = "myapp.azurewebsites.net";
    // Do not set WEBSITE_SITE_NAME
    try {
      const config = createTestApiConfig();
      const spec = createSwaggerSpec(config) as any;
      const servers = getServers(spec);
      assert(
        servers[0].url === "http://myapp.azurewebsites.net",
        `Server URL uses HTTP (no WEBSITE_SITE_NAME) (got "${servers[0].url}")`,
      );
    } catch (err: any) {
      assert(false, `Test 4 threw unexpectedly: ${err.message}`);
    }

    // -------------------------------------------------------
    // Test 5: K8S_SERVICE_HOST + K8S_SERVICE_PORT -> Kubernetes URL
    // -------------------------------------------------------
    console.log("Test 5: K8S_SERVICE_HOST + K8S_SERVICE_PORT -> Kubernetes URL");
    clearContainerEnv();
    process.env.K8S_SERVICE_HOST = "10.0.0.50";
    process.env.K8S_SERVICE_PORT = "8080";
    try {
      const config = createTestApiConfig();
      const spec = createSwaggerSpec(config) as any;
      const servers = getServers(spec);
      assert(
        servers[0].url === "http://10.0.0.50:8080",
        `Server URL uses K8S host and port (got "${servers[0].url}")`,
      );
    } catch (err: any) {
      assert(false, `Test 5 threw unexpectedly: ${err.message}`);
    }

    // -------------------------------------------------------
    // Test 5b: K8S with AZURE_FS_API_USE_HTTPS=true -> HTTPS
    // -------------------------------------------------------
    console.log("Test 5b: K8S with AZURE_FS_API_USE_HTTPS=true -> HTTPS");
    clearContainerEnv();
    process.env.K8S_SERVICE_HOST = "10.0.0.50";
    process.env.K8S_SERVICE_PORT = "8443";
    process.env.AZURE_FS_API_USE_HTTPS = "true";
    try {
      const config = createTestApiConfig();
      const spec = createSwaggerSpec(config) as any;
      const servers = getServers(spec);
      assert(
        servers[0].url === "https://10.0.0.50:8443",
        `Server URL uses HTTPS for K8S (got "${servers[0].url}")`,
      );
    } catch (err: any) {
      assert(false, `Test 5b threw unexpectedly: ${err.message}`);
    }

    // -------------------------------------------------------
    // Test 6: DOCKER_HOST_URL set -> uses Docker URL
    // -------------------------------------------------------
    console.log("Test 6: DOCKER_HOST_URL set -> uses Docker URL");
    clearContainerEnv();
    process.env.DOCKER_HOST_URL = "http://host.docker.internal:3000";
    try {
      const config = createTestApiConfig();
      const spec = createSwaggerSpec(config) as any;
      const servers = getServers(spec);
      assert(
        servers[0].url === "http://host.docker.internal:3000",
        `Server URL uses DOCKER_HOST_URL (got "${servers[0].url}")`,
      );
    } catch (err: any) {
      assert(false, `Test 6 threw unexpectedly: ${err.message}`);
    }

    // -------------------------------------------------------
    // Test 7: PUBLIC_URL takes priority over WEBSITE_HOSTNAME
    // -------------------------------------------------------
    console.log("Test 7: PUBLIC_URL takes priority over WEBSITE_HOSTNAME");
    clearContainerEnv();
    process.env.PUBLIC_URL = "https://custom.example.com";
    process.env.WEBSITE_HOSTNAME = "myapp.azurewebsites.net";
    process.env.WEBSITE_SITE_NAME = "myapp";
    try {
      const config = createTestApiConfig();
      const spec = createSwaggerSpec(config) as any;
      const servers = getServers(spec);
      assert(
        servers[0].url === "https://custom.example.com",
        `PUBLIC_URL wins over WEBSITE_HOSTNAME (got "${servers[0].url}")`,
      );
    } catch (err: any) {
      assert(false, `Test 7 threw unexpectedly: ${err.message}`);
    }

    // -------------------------------------------------------
    // Test 8: swaggerAdditionalServers adds extra server entries
    // -------------------------------------------------------
    console.log("Test 8: swaggerAdditionalServers adds extra server entries");
    clearContainerEnv();
    try {
      const config = createTestApiConfig({
        swaggerAdditionalServers: [
          "https://staging.example.com",
          "https://prod.example.com",
        ],
      });
      const spec = createSwaggerSpec(config) as any;
      const servers = getServers(spec);
      assert(servers.length === 3, `3 servers in spec (got ${servers.length})`);
      assert(
        servers[1].url === "https://staging.example.com",
        `Second server is staging (got "${servers[1]?.url}")`,
      );
      assert(
        servers[1].description === "Additional server 1",
        `Second server description (got "${servers[1]?.description}")`,
      );
      assert(
        servers[2].url === "https://prod.example.com",
        `Third server is prod (got "${servers[2]?.url}")`,
      );
    } catch (err: any) {
      assert(false, `Test 8 threw unexpectedly: ${err.message}`);
    }

    // -------------------------------------------------------
    // Test 9: swaggerServerVariables enables server variables
    // -------------------------------------------------------
    console.log("Test 9: swaggerServerVariables enables server variables");
    clearContainerEnv();
    try {
      const config = createTestApiConfig({
        swaggerServerVariables: true,
        port: 3000,
        host: "localhost",
      });
      const spec = createSwaggerSpec(config) as any;
      const servers = getServers(spec);
      assert(
        servers[0].url === "{protocol}://{host}:{port}",
        `Server URL has variable template (got "${servers[0].url}")`,
      );
      assert(servers[0].variables !== undefined, "Server entry has variables");
      assert(
        servers[0].variables.protocol !== undefined,
        "Variables include protocol",
      );
      assert(
        servers[0].variables.host !== undefined,
        "Variables include host",
      );
      assert(
        servers[0].variables.port !== undefined,
        "Variables include port",
      );
    } catch (err: any) {
      assert(false, `Test 9 threw unexpectedly: ${err.message}`);
    }

    // -------------------------------------------------------
    // Test 10: actualPort overrides configured port in URL
    // -------------------------------------------------------
    console.log("Test 10: actualPort overrides configured port in URL");
    clearContainerEnv();
    try {
      const config = createTestApiConfig({ port: 3000, host: "localhost" });
      const spec = createSwaggerSpec(config, 3001) as any;
      const servers = getServers(spec);
      assert(
        servers[0].url === "http://localhost:3001",
        `Server URL uses actualPort 3001 (got "${servers[0].url}")`,
      );
    } catch (err: any) {
      assert(false, `Test 10 threw unexpectedly: ${err.message}`);
    }

    // -------------------------------------------------------
    // Test 11: Production nodeEnv changes server description
    // -------------------------------------------------------
    console.log("Test 11: Production nodeEnv changes server description");
    clearContainerEnv();
    try {
      const config = createTestApiConfig({ nodeEnv: "production" });
      const spec = createSwaggerSpec(config) as any;
      const servers = getServers(spec);
      assert(
        servers[0].description === "Production server",
        `Description is "Production server" (got "${servers[0].description}")`,
      );
    } catch (err: any) {
      assert(false, `Test 11 threw unexpectedly: ${err.message}`);
    }
  } finally {
    // Restore environment
    restoreEnv(savedEnv);
  }

  // Summary
  console.log(`\n--- Container Swagger Tests Summary: ${passCount} passed, ${failCount} failed ---\n`);
  if (failCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Unhandled error in test-container-swagger.ts:", err);
  process.exitCode = 1;
});
