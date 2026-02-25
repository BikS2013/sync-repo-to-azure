/**
 * test-config-source-tracking.ts -- Config source tracking integration tests
 *
 * Tests the ConfigSourceTracker functionality in resolveApiConfig().
 *
 * Tests:
 *   1. resolveApiConfig() returns a sourceTracker on the result
 *   2. Tracked sources contain expected env var names (dotted keys)
 *   3. getSource() returns "environment-variable" for env-var-sourced keys
 *   4. getAllSources() returns a non-empty record
 *   5. Env var names (like NODE_ENV) are tracked for reverse lookup
 *   6. Config file values are tracked as "config-file"
 *   7. resolveConfig() (CLI path) does NOT have sourceTracker
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { resolveApiConfig } from "../src/config/config.loader";
import { resolveConfig } from "../src/config/config.loader";

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

/** Env var keys we set during tests. We save and restore them. */
const TEST_ENV_KEYS = [
  "AZURE_STORAGE_ACCOUNT_URL",
  "AZURE_STORAGE_CONTAINER_NAME",
  "AZURE_FS_AUTH_METHOD",
  "AZURE_STORAGE_CONNECTION_STRING",
  "AZURE_FS_LOG_LEVEL",
  "AZURE_FS_LOG_REQUESTS",
  "AZURE_FS_RETRY_STRATEGY",
  "AZURE_FS_RETRY_MAX_RETRIES",
  "AZURE_FS_BATCH_CONCURRENCY",
  "AZURE_FS_API_PORT",
  "AZURE_FS_API_HOST",
  "AZURE_FS_API_CORS_ORIGINS",
  "AZURE_FS_API_SWAGGER_ENABLED",
  "AZURE_FS_API_UPLOAD_MAX_SIZE_MB",
  "AZURE_FS_API_REQUEST_TIMEOUT_MS",
  "NODE_ENV",
  "AUTO_SELECT_PORT",
];

function saveEnv(): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const key of TEST_ENV_KEYS) {
    saved[key] = process.env[key];
  }
  return saved;
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const key of TEST_ENV_KEYS) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
}

function setTestEnvVars(): void {
  process.env.AZURE_STORAGE_ACCOUNT_URL = "https://testaccount.blob.core.windows.net";
  process.env.AZURE_STORAGE_CONTAINER_NAME = "test-container";
  process.env.AZURE_FS_AUTH_METHOD = "connection-string";
  process.env.AZURE_STORAGE_CONNECTION_STRING = "DefaultEndpointsProtocol=https;AccountName=test;AccountKey=dGVzdA==;EndpointSuffix=core.windows.net";
  process.env.AZURE_FS_LOG_LEVEL = "info";
  process.env.AZURE_FS_LOG_REQUESTS = "false";
  process.env.AZURE_FS_RETRY_STRATEGY = "none";
  process.env.AZURE_FS_RETRY_MAX_RETRIES = "0";
  process.env.AZURE_FS_BATCH_CONCURRENCY = "5";
  process.env.AZURE_FS_API_PORT = "3000";
  process.env.AZURE_FS_API_HOST = "0.0.0.0";
  process.env.AZURE_FS_API_CORS_ORIGINS = "*";
  process.env.AZURE_FS_API_SWAGGER_ENABLED = "true";
  process.env.AZURE_FS_API_UPLOAD_MAX_SIZE_MB = "100";
  process.env.AZURE_FS_API_REQUEST_TIMEOUT_MS = "30000";
  process.env.NODE_ENV = "development";
  process.env.AUTO_SELECT_PORT = "false";
}

async function main(): Promise<void> {
  console.log("\n=== test-config-source-tracking.ts ===\n");

  const savedEnv = saveEnv();

  try {
    // -------------------------------------------------------
    // Test 1: resolveApiConfig() returns a sourceTracker
    // -------------------------------------------------------
    console.log("Test 1: resolveApiConfig() returns a sourceTracker");
    setTestEnvVars();
    try {
      const config = resolveApiConfig();
      assert(config.sourceTracker !== undefined, "sourceTracker is present on the result");
      assert(config.sourceTracker !== null, "sourceTracker is not null");
      assert(typeof config.sourceTracker!.set === "function", "sourceTracker has set() method");
      assert(typeof config.sourceTracker!.getSource === "function", "sourceTracker has getSource() method");
      assert(typeof config.sourceTracker!.getAllSources === "function", "sourceTracker has getAllSources() method");
    } catch (err: any) {
      assert(false, `Test 1 threw unexpectedly: ${err.message}`);
    }

    // -------------------------------------------------------
    // Test 2: Tracked sources contain expected dotted keys
    // -------------------------------------------------------
    console.log("Test 2: Tracked sources contain expected dotted keys");
    setTestEnvVars();
    try {
      const config = resolveApiConfig();
      const allSources = config.sourceTracker!.getAllSources();
      const keys = Object.keys(allSources);
      assert(keys.length > 0, `getAllSources() returned ${keys.length} entries`);

      // Check that storage.accountUrl is tracked
      assert(
        allSources["storage.accountUrl"] !== undefined,
        `"storage.accountUrl" is tracked (source: ${allSources["storage.accountUrl"]})`,
      );

      // Check that api.port is tracked
      assert(
        allSources["api.port"] !== undefined,
        `"api.port" is tracked (source: ${allSources["api.port"]})`,
      );

      // Check that logging.level is tracked
      assert(
        allSources["logging.level"] !== undefined,
        `"logging.level" is tracked (source: ${allSources["logging.level"]})`,
      );

      // Check that api.nodeEnv is tracked
      assert(
        allSources["api.nodeEnv"] !== undefined,
        `"api.nodeEnv" is tracked (source: ${allSources["api.nodeEnv"]})`,
      );
    } catch (err: any) {
      assert(false, `Test 2 threw unexpectedly: ${err.message}`);
    }

    // -------------------------------------------------------
    // Test 3: getSource() returns "environment-variable" for env-var-sourced keys
    // -------------------------------------------------------
    console.log("Test 3: getSource() returns 'environment-variable' for env-var-sourced keys");
    setTestEnvVars();
    try {
      const config = resolveApiConfig();
      const tracker = config.sourceTracker!;

      assert(
        tracker.getSource("storage.accountUrl") === "environment-variable",
        `storage.accountUrl source is "environment-variable" (got "${tracker.getSource("storage.accountUrl")}")`,
      );
      assert(
        tracker.getSource("api.port") === "environment-variable",
        `api.port source is "environment-variable" (got "${tracker.getSource("api.port")}")`,
      );
      assert(
        tracker.getSource("api.nodeEnv") === "environment-variable",
        `api.nodeEnv source is "environment-variable" (got "${tracker.getSource("api.nodeEnv")}")`,
      );
    } catch (err: any) {
      assert(false, `Test 3 threw unexpectedly: ${err.message}`);
    }

    // -------------------------------------------------------
    // Test 4: getAllSources() returns a non-empty record
    // -------------------------------------------------------
    console.log("Test 4: getAllSources() returns a non-empty record");
    setTestEnvVars();
    try {
      const config = resolveApiConfig();
      const allSources = config.sourceTracker!.getAllSources();
      assert(typeof allSources === "object", "getAllSources() returns an object");
      assert(allSources !== null, "getAllSources() is not null");
      const entryCount = Object.keys(allSources).length;
      assert(entryCount > 0, `getAllSources() has ${entryCount} entries (expected > 0)`);
      // We set at least 17 env vars, so should have at least that many tracked entries
      // (some may have both dotted key and env var name tracked)
      assert(entryCount >= 10, `At least 10 tracked entries (got ${entryCount})`);
    } catch (err: any) {
      assert(false, `Test 4 threw unexpectedly: ${err.message}`);
    }

    // -------------------------------------------------------
    // Test 5: Env var names are tracked for reverse lookup
    // -------------------------------------------------------
    console.log("Test 5: Env var names are tracked for reverse lookup");
    setTestEnvVars();
    try {
      const config = resolveApiConfig();
      const tracker = config.sourceTracker!;

      // The config loader should also track by env var name (e.g., "NODE_ENV")
      const nodeEnvSource = tracker.getSource("NODE_ENV");
      assert(
        nodeEnvSource === "environment-variable",
        `NODE_ENV (env var name) source is "environment-variable" (got "${nodeEnvSource}")`,
      );

      const portSource = tracker.getSource("AZURE_FS_API_PORT");
      assert(
        portSource === "environment-variable",
        `AZURE_FS_API_PORT (env var name) source is "environment-variable" (got "${portSource}")`,
      );
    } catch (err: any) {
      assert(false, `Test 5 threw unexpectedly: ${err.message}`);
    }

    // -------------------------------------------------------
    // Test 6: Config file values are tracked as "config-file"
    // -------------------------------------------------------
    console.log("Test 6: Config file values are tracked as 'config-file'");
    // Create a temp config file with some values, then call resolveApiConfig with a
    // subset of env vars, so the file values "win" for keys not in env.
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "azure-fs-test-"));
    const tempConfigPath = path.join(tempDir, ".azure-fs.json");
    try {
      // Write config file with a batch.concurrency value
      const configContent = {
        storage: {
          accountUrl: "https://fileaccount.blob.core.windows.net",
          containerName: "file-container",
          authMethod: "connection-string",
        },
        logging: {
          level: "debug",
          logRequests: true,
        },
        retry: {
          strategy: "none",
          maxRetries: 0,
        },
        batch: {
          concurrency: 15,
        },
        api: {
          port: 4000,
          host: "0.0.0.0",
          corsOrigins: ["*"],
          swaggerEnabled: true,
          uploadMaxSizeMb: 50,
          requestTimeoutMs: 15000,
          nodeEnv: "development",
          autoSelectPort: false,
        },
      };
      fs.writeFileSync(tempConfigPath, JSON.stringify(configContent, null, 2));

      // Clear env vars so config file wins
      for (const key of TEST_ENV_KEYS) {
        delete process.env[key];
      }

      const config = resolveApiConfig({ config: tempConfigPath });
      const tracker = config.sourceTracker!;

      // batch.concurrency should come from config file since we cleared env vars
      const batchSource = tracker.getSource("batch.concurrency");
      assert(
        batchSource === "config-file",
        `batch.concurrency source is "config-file" (got "${batchSource}")`,
      );

      const storageSource = tracker.getSource("storage.accountUrl");
      assert(
        storageSource === "config-file",
        `storage.accountUrl source is "config-file" (got "${storageSource}")`,
      );
    } catch (err: any) {
      assert(false, `Test 6 threw unexpectedly: ${err.message}`);
    } finally {
      // Clean up temp file
      try {
        fs.unlinkSync(tempConfigPath);
        fs.rmdirSync(tempDir);
      } catch {
        // Ignore cleanup errors
      }
    }

    // -------------------------------------------------------
    // Test 7: resolveConfig() (CLI path) does NOT have sourceTracker
    // -------------------------------------------------------
    console.log("Test 7: resolveConfig() (CLI path) does NOT have sourceTracker");
    setTestEnvVars();
    try {
      const config = resolveConfig({
        accountUrl: process.env.AZURE_STORAGE_ACCOUNT_URL,
        container: process.env.AZURE_STORAGE_CONTAINER_NAME,
        authMethod: process.env.AZURE_FS_AUTH_METHOD,
      });
      // ResolvedConfig does not have sourceTracker property (it is only on ApiResolvedConfig)
      assert(
        (config as any).sourceTracker === undefined,
        "resolveConfig() result does not have sourceTracker",
      );
    } catch (err: any) {
      assert(false, `Test 7 threw unexpectedly: ${err.message}`);
    }
  } finally {
    // Restore environment
    restoreEnv(savedEnv);
  }

  // Summary
  console.log(`\n--- Config Source Tracking Tests Summary: ${passCount} passed, ${failCount} failed ---\n`);
  if (failCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Unhandled error in test-config-source-tracking.ts:", err);
  process.exitCode = 1;
});
