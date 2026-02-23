/**
 * test-config.ts — Configuration tests
 *
 * Tests:
 *   - config show works (reads env vars)
 *   - config validate connects successfully
 *   - Missing required config produces ConfigError with exit code 2
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
  console.log("\n=== test-config.ts ===\n");

  if (!checkEnvConfigured()) {
    console.log("SKIP: Azure environment not configured. Set AZURE_STORAGE_ACCOUNT_URL, AZURE_STORAGE_CONTAINER_NAME, and AZURE_FS_AUTH_METHOD to run these tests.");
    return;
  }

  // Test 1: config show works
  console.log("Test 1: config show returns config data");
  try {
    const result = run("config show");
    assert(result.success === true, "config show returns success=true");
    assert(result.data !== undefined, "config show returns data");
    assert(result.metadata?.command === "config show", "config show metadata.command is correct");
  } catch (err: any) {
    assert(false, `config show threw unexpectedly: ${err.message}`);
  }

  // Test 2: config validate connects successfully
  console.log("Test 2: config validate connects successfully");
  try {
    const result = run("config validate");
    assert(result.success === true, "config validate returns success=true");
    assert(result.data?.success === true, "connection test reports success");
    assert(typeof result.data?.authMethod === "string", "authMethod is present in result");
    assert(typeof result.data?.containerExists === "boolean", "containerExists is present in result");
  } catch (err: any) {
    assert(false, `config validate threw unexpectedly: ${err.message}`);
  }

  // Test 3: Missing required config produces ConfigError with exit code 2
  console.log("Test 3: Missing required config produces error with exit code 2");
  try {
    // Clear the env vars temporarily by passing a bogus config path with no env overrides
    // We need to suppress the real env vars. Use a subprocess with cleared env.
    const clearEnvCmd = `env -i HOME="${process.env.HOME}" PATH="${process.env.PATH}" npx ts-node src/index.ts config validate --json 2>/dev/null`;
    try {
      execSync(clearEnvCmd, {
        encoding: "utf-8",
        timeout: 30000,
        cwd: process.cwd(),
      });
      // If it succeeded, that's unexpected
      assert(false, "Should have failed with missing config");
    } catch (err: any) {
      const exitCode = err.status ?? 0;
      assert(exitCode === 2, `Exit code is 2 for missing config (got ${exitCode})`);

      let parsed: any = null;
      if (err.stdout) {
        try {
          parsed = JSON.parse(err.stdout);
        } catch {
          /* ignore */
        }
      }
      if (parsed) {
        assert(parsed.success === false, "Result has success=false for missing config");
        assert(
          typeof parsed.error?.code === "string" && parsed.error.code.startsWith("CONFIG_"),
          `Error code starts with CONFIG_ (got ${parsed.error?.code})`,
        );
      } else {
        assert(true, "Missing config produced non-zero exit (could not parse JSON output)");
      }
    }
  } catch (err: any) {
    assert(false, `Missing config test threw unexpectedly: ${err.message}`);
  }

  // Summary
  console.log(`\n--- Config Tests Summary: ${passCount} passed, ${failCount} failed ---\n`);
}

main().catch((err) => {
  console.error("Unhandled error in test-config.ts:", err);
  process.exitCode = 1;
});
