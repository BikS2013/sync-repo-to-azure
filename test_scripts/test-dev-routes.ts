/**
 * test-dev-routes.ts -- Development routes integration tests
 *
 * Starts the API server in development mode and tests:
 *   1. GET /api/dev/env returns 200 with expected JSON structure
 *   2. Response includes totalVariables, variables, sources
 *   3. Sensitive keys are masked
 *   4. GET /api/dev/env/NODE_ENV returns the value
 *   5. GET /api/dev/env/NONEXISTENT_VAR returns 404
 *   6. Variables array is sorted alphabetically
 *
 * This script sets up its own environment variables, starts the API server
 * as a child process, runs tests, then shuts it down.
 */

import { spawn, ChildProcess } from "child_process";
import * as http from "http";

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
 * Make an HTTP GET request and return the parsed JSON response.
 */
function httpGet(url: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const body = JSON.parse(data);
          resolve({ status: res.statusCode || 0, body });
        } catch {
          resolve({ status: res.statusCode || 0, body: data });
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
  });
}

/**
 * Wait for the server to be ready by polling the health endpoint.
 */
async function waitForServer(url: string, maxAttempts: number = 30, delayMs: number = 1000): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const result = await httpGet(url);
      if (result.status === 200) return true;
    } catch {
      // Server not ready yet
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

async function main(): Promise<void> {
  console.log("\n=== test-dev-routes.ts ===\n");

  // --- Set up environment for the API server ---
  const TEST_PORT = 49200;
  const PROJECT_ROOT = process.cwd();

  const envVars: Record<string, string> = {
    // Base config (required by validateConfig)
    AZURE_STORAGE_ACCOUNT_URL: "https://testaccount.blob.core.windows.net",
    AZURE_STORAGE_CONTAINER_NAME: "test-container",
    AZURE_FS_AUTH_METHOD: "connection-string",
    AZURE_STORAGE_CONNECTION_STRING: "DefaultEndpointsProtocol=https;AccountName=testaccount;AccountKey=dGVzdGtleQ==;EndpointSuffix=core.windows.net",
    AZURE_FS_LOG_LEVEL: "warn",
    AZURE_FS_LOG_REQUESTS: "false",
    AZURE_FS_RETRY_STRATEGY: "none",
    AZURE_FS_RETRY_MAX_RETRIES: "0",
    AZURE_FS_BATCH_CONCURRENCY: "5",
    // API config
    AZURE_FS_API_PORT: String(TEST_PORT),
    AZURE_FS_API_HOST: "127.0.0.1",
    AZURE_FS_API_CORS_ORIGINS: "*",
    AZURE_FS_API_SWAGGER_ENABLED: "false",
    AZURE_FS_API_UPLOAD_MAX_SIZE_MB: "50",
    AZURE_FS_API_REQUEST_TIMEOUT_MS: "30000",
    NODE_ENV: "development",
    AUTO_SELECT_PORT: "true",
    // Add a sensitive env var for masking test
    AZURE_STORAGE_SAS_TOKEN: "test-secret-token-value",
    // Standard env
    PATH: process.env.PATH || "",
    HOME: process.env.HOME || "",
  };

  const baseUrl = `http://127.0.0.1:${TEST_PORT}`;
  let serverProcess: ChildProcess | null = null;

  try {
    // --- Start the API server as a child process ---
    console.log(`Starting API server on port ${TEST_PORT}...`);
    serverProcess = spawn("npx", ["ts-node", "src/api/server.ts"], {
      cwd: PROJECT_ROOT,
      env: envVars,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Capture stderr for debugging
    let serverStderr = "";
    serverProcess.stderr?.on("data", (chunk) => {
      serverStderr += chunk.toString();
    });

    // Wait for server to be ready
    const ready = await waitForServer(`${baseUrl}/api/health`, 30, 1000);
    if (!ready) {
      console.error("Server failed to start. stderr:", serverStderr);
      assert(false, "API server started and is ready");
      return;
    }
    console.log("Server is ready.\n");

    // -------------------------------------------------------
    // Test 1: GET /api/dev/env returns 200 with expected JSON structure
    // -------------------------------------------------------
    console.log("Test 1: GET /api/dev/env returns 200 with expected structure");
    try {
      const result = await httpGet(`${baseUrl}/api/dev/env`);
      assert(result.status === 200, `Status is 200 (got ${result.status})`);
      assert(result.body.success === true, "Response has success=true");
      assert(result.body.data !== undefined, "Response has data field");
      assert(result.body.metadata !== undefined, "Response has metadata field");
      assert(typeof result.body.metadata.timestamp === "string", "metadata.timestamp is a string");
    } catch (err: any) {
      assert(false, `GET /api/dev/env threw unexpectedly: ${err.message}`);
    }

    // -------------------------------------------------------
    // Test 2: Response includes totalVariables, variables, sources
    // -------------------------------------------------------
    console.log("Test 2: Response includes totalVariables, variables, sources");
    try {
      const result = await httpGet(`${baseUrl}/api/dev/env`);
      const data = result.body.data;
      assert(typeof data.totalVariables === "number", `totalVariables is a number (got ${data.totalVariables})`);
      assert(data.totalVariables > 0, `totalVariables > 0 (got ${data.totalVariables})`);
      assert(Array.isArray(data.variables), "variables is an array");
      assert(data.variables.length === data.totalVariables, `variables.length matches totalVariables`);
      assert(typeof data.sources === "object" && data.sources !== null, "sources is an object");
      assert(data.environment === "development", `environment is "development" (got ${data.environment})`);
    } catch (err: any) {
      assert(false, `Test 2 threw unexpectedly: ${err.message}`);
    }

    // -------------------------------------------------------
    // Test 3: Sensitive keys are masked
    // -------------------------------------------------------
    console.log("Test 3: Sensitive keys are masked");
    try {
      const result = await httpGet(`${baseUrl}/api/dev/env`);
      const variables: Array<{ name: string; value: string; masked: boolean }> = result.body.data.variables;

      // Find the SAS token variable
      const sasVar = variables.find((v) => v.name === "AZURE_STORAGE_SAS_TOKEN");
      if (sasVar) {
        assert(sasVar.masked === true, "AZURE_STORAGE_SAS_TOKEN is masked");
        assert(sasVar.value === "***MASKED***", `Masked value is "***MASKED***" (got "${sasVar.value}")`);
        assert(
          sasVar.value !== "test-secret-token-value",
          "Masked value does not contain the actual secret",
        );
      } else {
        assert(false, "AZURE_STORAGE_SAS_TOKEN not found in variables");
      }

      // Check that a non-sensitive key is NOT masked
      const portVar = variables.find((v) => v.name === "AZURE_FS_API_PORT");
      if (portVar) {
        assert(portVar.masked === false, "AZURE_FS_API_PORT is not masked");
        assert(portVar.value === String(TEST_PORT), `AZURE_FS_API_PORT value is correct`);
      } else {
        assert(false, "AZURE_FS_API_PORT not found in variables");
      }
    } catch (err: any) {
      assert(false, `Test 3 threw unexpectedly: ${err.message}`);
    }

    // -------------------------------------------------------
    // Test 4: GET /api/dev/env/NODE_ENV returns the value
    // -------------------------------------------------------
    console.log("Test 4: GET /api/dev/env/NODE_ENV returns the value");
    try {
      const result = await httpGet(`${baseUrl}/api/dev/env/NODE_ENV`);
      assert(result.status === 200, `Status is 200 (got ${result.status})`);
      assert(result.body.success === true, "Response has success=true");
      assert(result.body.data.name === "NODE_ENV", `name is "NODE_ENV" (got "${result.body.data.name}")`);
      assert(result.body.data.value === "development", `value is "development" (got "${result.body.data.value}")`);
      assert(result.body.data.exists === true, "exists is true");
      assert(result.body.data.masked === false, "NODE_ENV is not masked");
      assert(typeof result.body.data.source === "string", `source is a string (got "${result.body.data.source}")`);
    } catch (err: any) {
      assert(false, `Test 4 threw unexpectedly: ${err.message}`);
    }

    // -------------------------------------------------------
    // Test 5: GET /api/dev/env/NONEXISTENT_VAR returns 404
    // -------------------------------------------------------
    console.log("Test 5: GET /api/dev/env/NONEXISTENT_VAR returns 404");
    try {
      const result = await httpGet(`${baseUrl}/api/dev/env/NONEXISTENT_VAR_THAT_DOES_NOT_EXIST_12345`);
      assert(result.status === 404, `Status is 404 (got ${result.status})`);
      assert(result.body.success === false, "Response has success=false");
      assert(result.body.error.code === "NOT_FOUND", `Error code is "NOT_FOUND" (got "${result.body.error.code}")`);
    } catch (err: any) {
      assert(false, `Test 5 threw unexpectedly: ${err.message}`);
    }

    // -------------------------------------------------------
    // Test 6: Variables array is sorted alphabetically
    // -------------------------------------------------------
    console.log("Test 6: Variables array is sorted alphabetically");
    try {
      const result = await httpGet(`${baseUrl}/api/dev/env`);
      const variables: Array<{ name: string }> = result.body.data.variables;
      const names = variables.map((v) => v.name);
      const sortedNames = [...names].sort();
      const isSorted = names.every((n, i) => n === sortedNames[i]);
      assert(isSorted, "Variables are sorted alphabetically by name");
    } catch (err: any) {
      assert(false, `Test 6 threw unexpectedly: ${err.message}`);
    }
  } finally {
    // --- Shut down the server ---
    if (serverProcess) {
      console.log("\nShutting down API server...");
      serverProcess.kill("SIGTERM");
      // Give it a moment to shut down
      await new Promise((r) => setTimeout(r, 2000));
      if (!serverProcess.killed) {
        serverProcess.kill("SIGKILL");
      }
    }
  }

  // Summary
  console.log(`\n--- Dev Routes Tests Summary: ${passCount} passed, ${failCount} failed ---\n`);
  if (failCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Unhandled error in test-dev-routes.ts:", err);
  process.exitCode = 1;
});
