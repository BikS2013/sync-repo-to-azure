/**
 * test-cli-integration.ts — CLI integration tests
 *
 * Tests:
 *   - Verify `azure-fs --help` exits 0 and contains expected text
 *   - Verify `azure-fs upload --help` shows usage
 *   - Verify `azure-fs config show --json` returns valid JSON
 *   - Verify unknown command returns non-zero exit
 */

import { execSync } from "child_process";

const CLI = "npx ts-node src/index.ts";

let passCount = 0;
let failCount = 0;

function runRaw(args: string): { exitCode: number; stdout: string; stderr: string } {
  try {
    const stdout = execSync(`${CLI} ${args}`, {
      encoding: "utf-8",
      timeout: 30000,
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { exitCode: 0, stdout, stderr: "" };
  } catch (err: any) {
    return {
      exitCode: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
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

async function main(): Promise<void> {
  console.log("\n=== test-cli-integration.ts ===\n");

  // Test 1: --help exits 0 and contains expected text
  console.log("Test 1: azure-fs --help");
  const helpResult = runRaw("--help");
  assert(helpResult.exitCode === 0, "--help exits with code 0");
  const helpOutput = helpResult.stdout + helpResult.stderr;
  assert(helpOutput.includes("azure-fs"), "--help output contains 'azure-fs'");
  assert(
    helpOutput.includes("upload") || helpOutput.includes("Upload"),
    "--help output mentions upload command",
  );
  assert(
    helpOutput.includes("download") || helpOutput.includes("Download"),
    "--help output mentions download command",
  );
  assert(
    helpOutput.includes("--json"),
    "--help output mentions --json flag",
  );

  // Test 2: upload --help shows usage
  console.log("Test 2: azure-fs upload --help");
  const uploadHelpResult = runRaw("upload --help");
  assert(uploadHelpResult.exitCode === 0, "upload --help exits with code 0");
  const uploadHelpOutput = uploadHelpResult.stdout + uploadHelpResult.stderr;
  assert(
    uploadHelpOutput.includes("local") || uploadHelpOutput.includes("Local") || uploadHelpOutput.includes("<local>"),
    "upload --help mentions local file argument",
  );
  assert(
    uploadHelpOutput.includes("remote") || uploadHelpOutput.includes("Remote") || uploadHelpOutput.includes("<remote>"),
    "upload --help mentions remote path argument",
  );

  // Test 3: config show --json returns valid JSON (may fail with config error, but should still be JSON)
  console.log("Test 3: azure-fs config show --json returns valid JSON");
  const showResult = runRaw("config show --json");
  const showOutput = showResult.stdout.trim();
  let parsedJson: any = null;
  try {
    parsedJson = JSON.parse(showOutput);
  } catch {
    /* parse failed */
  }
  assert(parsedJson !== null, "config show --json returns parseable JSON");
  if (parsedJson) {
    assert(typeof parsedJson.success === "boolean", "JSON has success field");
    assert(typeof parsedJson.metadata === "object", "JSON has metadata field");
    assert(typeof parsedJson.metadata?.command === "string", "JSON has metadata.command");
  }

  // Test 4: Unknown command returns non-zero exit
  console.log("Test 4: Unknown command returns non-zero exit");
  const unknownResult = runRaw("nonexistentcommand");
  assert(unknownResult.exitCode !== 0, `Unknown command exits with non-zero code (got ${unknownResult.exitCode})`);
  const unknownOutput = unknownResult.stdout + unknownResult.stderr;
  assert(
    unknownOutput.includes("unknown") || unknownOutput.includes("error") || unknownOutput.includes("Error") || unknownResult.exitCode === 1,
    "Unknown command produces error output or exit code 1",
  );

  // Summary
  console.log(`\n--- CLI Integration Tests Summary: ${passCount} passed, ${failCount} failed ---\n`);
}

main().catch((err) => {
  console.error("Unhandled error in test-cli-integration.ts:", err);
  process.exitCode = 1;
});
