/**
 * test-auth.ts — Authentication tests
 *
 * Tests:
 *   - Test connection with configured auth method
 *   - Test config validate with invalid credentials produces AuthError
 */

import { execSync } from "child_process";

const CLI = "npx ts-node src/index.ts";

let passCount = 0;
let failCount = 0;

function run(args: string): { success: boolean; data?: any; error?: any; metadata?: any } {
  try {
    const output = execSync(`${CLI} ${args} --json`, {
      encoding: "utf-8",
      timeout: 30000,
      cwd: process.cwd(),
    });
    return JSON.parse(output);
  } catch (err: any) {
    if (err.stdout) {
      try {
        return JSON.parse(err.stdout);
      } catch {
        /* fall through */
      }
    }
    throw err;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failCount++;
    process.exitCode = 1;
  } else {
    console.log(`  PASS: ${message}`);
    passCount++;
  }
}

function checkEnvConfigured(): boolean {
  const required = [
    "AZURE_STORAGE_ACCOUNT_URL",
    "AZURE_STORAGE_CONTAINER_NAME",
    "AZURE_FS_AUTH_METHOD",
  ];
  for (const key of required) {
    if (!process.env[key]) {
      return false;
    }
  }
  return true;
}

async function main(): Promise<void> {
  console.log("\n=== test-auth.ts ===\n");

  if (!checkEnvConfigured()) {
    console.log("SKIP: Azure environment not configured. Set required env vars to run these tests.");
    return;
  }

  // Test 1: Connection with configured auth method succeeds
  console.log("Test 1: Connection with configured auth method");
  try {
    const result = run("config validate");
    assert(result.success === true, "config validate returns success=true");
    assert(result.data?.success === true, "Connection test succeeded");
    assert(
      result.data?.authMethod === process.env.AZURE_FS_AUTH_METHOD,
      `Auth method matches configured method (${result.data?.authMethod})`,
    );
    assert(
      result.data?.containerExists === true,
      "Container exists",
    );
  } catch (err: any) {
    assert(false, `Connection test threw unexpectedly: ${err.message}`);
  }

  // Test 2: Invalid credentials produce AuthError
  console.log("Test 2: Invalid credentials produce auth error");
  try {
    // Build env with an invalid account URL to force auth/connection failure
    const envOverrides: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        envOverrides[key] = value;
      }
    }
    // Override with an invalid account URL
    envOverrides["AZURE_STORAGE_ACCOUNT_URL"] = "https://nonexistentaccount99999.blob.core.windows.net";

    // For connection-string auth, we need to also set an invalid connection string
    if (process.env.AZURE_FS_AUTH_METHOD === "connection-string") {
      envOverrides["AZURE_STORAGE_CONNECTION_STRING"] =
        "DefaultEndpointsProtocol=https;AccountName=nonexistentaccount99999;AccountKey=aW52YWxpZGtleQ==;EndpointSuffix=core.windows.net";
    }

    try {
      const output = execSync(`${CLI} config validate --json`, {
        encoding: "utf-8",
        timeout: 30000,
        cwd: process.cwd(),
        env: envOverrides,
      });
      // It might return success=true with containerExists=false, or might fail
      const parsed = JSON.parse(output);
      if (parsed.success && parsed.data) {
        // Some auth methods might connect but report container not found
        assert(
          parsed.data.containerExists === false || parsed.data.success === false,
          "Invalid account returns containerExists=false or connection failure",
        );
      } else {
        assert(parsed.success === false, "Invalid credentials returns success=false");
      }
    } catch (err: any) {
      const exitCode = err.status ?? 0;
      assert(exitCode !== 0, `Non-zero exit code for invalid credentials (got ${exitCode})`);

      let parsed: any = null;
      if (err.stdout) {
        try {
          parsed = JSON.parse(err.stdout);
        } catch {
          /* ignore */
        }
      }
      if (parsed) {
        assert(parsed.success === false, "Result has success=false for invalid credentials");
        assert(
          typeof parsed.error?.code === "string",
          `Error code is present (got ${parsed.error?.code})`,
        );
      } else {
        assert(true, "Invalid credentials produced non-zero exit");
      }
    }
  } catch (err: any) {
    assert(false, `Invalid credentials test threw unexpectedly: ${err.message}`);
  }

  // Summary
  console.log(`\n--- Auth Tests Summary: ${passCount} passed, ${failCount} failed ---\n`);
}

main().catch((err) => {
  console.error("Unhandled error in test-auth.ts:", err);
  process.exitCode = 1;
});
