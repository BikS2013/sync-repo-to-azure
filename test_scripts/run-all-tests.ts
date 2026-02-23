/**
 * run-all-tests.ts — Runs all 9 test scripts sequentially and reports overall pass/fail.
 */

import { execSync } from "child_process";
import * as path from "path";

const TEST_DIR = path.resolve(__dirname);

const testScripts = [
  "test-config.ts",
  "test-auth.ts",
  "test-file-operations.ts",
  "test-folder-operations.ts",
  "test-edit-operations.ts",
  "test-metadata.ts",
  "test-tags.ts",
  "test-error-scenarios.ts",
  "test-cli-integration.ts",
];

interface TestResult {
  script: string;
  exitCode: number;
  durationMs: number;
}

function runTest(script: string): TestResult {
  const scriptPath = path.join(TEST_DIR, script);
  const start = Date.now();
  let exitCode = 0;

  try {
    execSync(`npx ts-node "${scriptPath}"`, {
      encoding: "utf-8",
      timeout: 300000, // 5 minute timeout per test script
      cwd: path.resolve(TEST_DIR, ".."),
      stdio: "inherit",
    });
  } catch (err: any) {
    exitCode = err.status ?? 1;
  }

  return {
    script,
    exitCode,
    durationMs: Date.now() - start,
  };
}

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║     Azure FS — Test Suite Runner                    ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  const results: TestResult[] = [];
  const overallStart = Date.now();

  for (const script of testScripts) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`Running: ${script}`);
    console.log("─".repeat(60));

    const result = runTest(script);
    results.push(result);

    if (result.exitCode !== 0) {
      console.log(`\n>>> ${script} FAILED (exit code ${result.exitCode}, ${result.durationMs}ms)\n`);
    } else {
      console.log(`\n>>> ${script} PASSED (${result.durationMs}ms)\n`);
    }
  }

  // Overall summary
  const totalDuration = Date.now() - overallStart;
  const passed = results.filter((r) => r.exitCode === 0);
  const failed = results.filter((r) => r.exitCode !== 0);

  console.log("\n" + "═".repeat(60));
  console.log("OVERALL TEST SUITE RESULTS");
  console.log("═".repeat(60));
  console.log(`  Total:    ${results.length} test scripts`);
  console.log(`  Passed:   ${passed.length}`);
  console.log(`  Failed:   ${failed.length}`);
  console.log(`  Duration: ${(totalDuration / 1000).toFixed(1)}s`);
  console.log("");

  if (failed.length > 0) {
    console.log("Failed scripts:");
    for (const f of failed) {
      console.log(`  - ${f.script} (exit code ${f.exitCode})`);
    }
    console.log("");
  }

  for (const r of results) {
    const status = r.exitCode === 0 ? "PASS" : "FAIL";
    const duration = `${(r.durationMs / 1000).toFixed(1)}s`;
    console.log(`  [${status}] ${r.script.padEnd(35)} ${duration}`);
  }

  console.log("═".repeat(60));

  if (failed.length > 0) {
    console.log("\nRESULT: FAIL\n");
    process.exitCode = 1;
  } else {
    console.log("\nRESULT: PASS\n");
  }
}

main().catch((err) => {
  console.error("Unhandled error in run-all-tests.ts:", err);
  process.exitCode = 1;
});
