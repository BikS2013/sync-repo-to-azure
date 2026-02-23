/**
 * test-metadata.ts — Metadata operations tests
 *
 * Tests:
 *   - Upload a file
 *   - Set metadata (key1=val1, key2=val2)
 *   - Get metadata — verify both keys present
 *   - Update metadata (key2=newval, key3=val3) — verify merge
 *   - Delete metadata (key1) — verify removed
 *   - Get metadata — verify final state
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const CLI = "npx ts-node src/index.ts";
const TEST_PREFIX = `test-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

let passCount = 0;
let failCount = 0;

function run(args: string): { success: boolean; data?: any; error?: any; metadata?: any } {
  try {
    const output = execSync(`${CLI} ${args} --json`, {
      encoding: "utf-8",
      timeout: 60000,
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

async function cleanup(): Promise<void> {
  try {
    run(`rmdir ${TEST_PREFIX}`);
  } catch {
    /* ignore cleanup errors */
  }
}

async function main(): Promise<void> {
  console.log("\n=== test-metadata.ts ===\n");

  if (!checkEnvConfigured()) {
    console.log("SKIP: Azure environment not configured.");
    return;
  }

  const remotePath = `${TEST_PREFIX}/meta-test-file.txt`;

  // Create and upload a test file
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "azure-fs-meta-test-"));
  const localFile = path.join(tmpDir, "meta-test.txt");
  fs.writeFileSync(localFile, "Metadata test file content", "utf-8");

  try {
    // Setup: Upload file
    console.log("Setup: Upload test file");
    const uploadResult = run(`upload "${localFile}" ${remotePath}`);
    assert(uploadResult.success === true, "Upload for metadata test success");

    // Test 1: Set metadata
    console.log("Test 1: Set metadata (key1=val1, key2=val2)");
    const setResult = run(`meta set ${remotePath} key1=val1 key2=val2`);
    assert(setResult.success === true, "meta set returns success=true");

    // Test 2: Get metadata — verify both keys
    console.log("Test 2: Get metadata — verify both keys present");
    const getResult1 = run(`meta get ${remotePath}`);
    assert(getResult1.success === true, "meta get returns success=true");
    const meta1 = getResult1.data?.metadata || getResult1.data;
    assert(meta1?.key1 === "val1", "key1=val1 is present");
    assert(meta1?.key2 === "val2", "key2=val2 is present");

    // Test 3: Update metadata (key2=newval, key3=val3) — verify merge
    console.log("Test 3: Update metadata (key2=newval, key3=val3)");
    const updateResult = run(`meta update ${remotePath} key2=newval key3=val3`);
    assert(updateResult.success === true, "meta update returns success=true");

    const getResult2 = run(`meta get ${remotePath}`);
    assert(getResult2.success === true, "meta get after update success");
    const meta2 = getResult2.data?.metadata || getResult2.data;
    assert(meta2?.key1 === "val1", "key1 preserved after update");
    assert(meta2?.key2 === "newval", "key2 updated to newval");
    assert(meta2?.key3 === "val3", "key3=val3 added");

    // Test 4: Delete metadata (key1) — verify removed
    console.log("Test 4: Delete metadata (key1)");
    const deleteResult = run(`meta delete ${remotePath} key1`);
    assert(deleteResult.success === true, "meta delete returns success=true");

    // Test 5: Get metadata — verify final state
    console.log("Test 5: Get metadata — verify final state");
    const getResult3 = run(`meta get ${remotePath}`);
    assert(getResult3.success === true, "meta get final state success");
    const meta3 = getResult3.data?.metadata || getResult3.data;
    assert(meta3?.key1 === undefined, "key1 is removed");
    assert(meta3?.key2 === "newval", "key2 remains as newval");
    assert(meta3?.key3 === "val3", "key3 remains as val3");
  } finally {
    await cleanup();
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch {
      /* ignore */
    }
  }

  // Summary
  console.log(`\n--- Metadata Tests Summary: ${passCount} passed, ${failCount} failed ---\n`);
}

main().catch((err) => {
  console.error("Unhandled error in test-metadata.ts:", err);
  process.exitCode = 1;
});
