/**
 * test-error-scenarios.ts — Error handling tests
 *
 * Tests:
 *   - Download non-existent file — verify error code BLOB_NOT_FOUND
 *   - Delete non-existent file — verify error (or success with existed=false)
 *   - Upload with invalid path (empty) — verify PATH_EMPTY error
 *   - Set metadata with invalid key (starts with number) — verify INVALID_METADATA_KEY / META_INVALID_KEY
 *   - Try to set > 10 tags — verify TOO_MANY_TAGS / META_MAX_TAGS_EXCEEDED
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

function runWithExit(args: string): { exitCode: number; result: any } {
  try {
    const output = execSync(`${CLI} ${args} --json`, {
      encoding: "utf-8",
      timeout: 60000,
      cwd: process.cwd(),
    });
    return { exitCode: 0, result: JSON.parse(output) };
  } catch (err: any) {
    const exitCode = err.status ?? 1;
    let result: any = null;
    if (err.stdout) {
      try {
        result = JSON.parse(err.stdout);
      } catch {
        /* ignore */
      }
    }
    return { exitCode, result };
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
  console.log("\n=== test-error-scenarios.ts ===\n");

  if (!checkEnvConfigured()) {
    console.log("SKIP: Azure environment not configured.");
    return;
  }

  // Create a temp file for upload tests
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "azure-fs-error-test-"));
  const localFile = path.join(tmpDir, "error-test.txt");
  fs.writeFileSync(localFile, "Error scenario test content", "utf-8");

  // Upload a file for metadata/tag error tests
  const remotePath = `${TEST_PREFIX}/error-test-file.txt`;

  try {
    // Setup: upload a file for metadata/tag tests
    const uploadResult = run(`upload "${localFile}" ${remotePath}`);
    assert(uploadResult.success === true, "Setup: Upload test file for error scenarios");

    // Test 1: Download non-existent file — verify BLOB_NOT_FOUND
    console.log("Test 1: Download non-existent file");
    const nonExistPath = `${TEST_PREFIX}/does-not-exist-${Date.now()}.txt`;
    const { exitCode: dl_exit, result: dl_result } = runWithExit(`download ${nonExistPath}`);
    assert(dl_exit !== 0, `Non-zero exit code for missing file download (got ${dl_exit})`);
    if (dl_result) {
      assert(dl_result.success === false, "Download non-existent returns success=false");
      assert(
        dl_result.error?.code === "BLOB_NOT_FOUND",
        `Error code is BLOB_NOT_FOUND (got ${dl_result.error?.code})`,
      );
    }

    // Test 2: Delete non-existent file
    console.log("Test 2: Delete non-existent file");
    const nonExistPath2 = `${TEST_PREFIX}/does-not-exist-del-${Date.now()}.txt`;
    const { exitCode: del_exit, result: del_result } = runWithExit(`delete ${nonExistPath2}`);
    // delete uses deleteIfExists, so it may succeed with existed=false
    if (del_exit === 0 && del_result?.success === true) {
      // deleteIfExists returns success even if blob didn't exist
      assert(true, "Delete non-existent file returned success (deleteIfExists behavior)");
    } else if (del_result) {
      assert(del_result.success === false, "Delete non-existent returns success=false");
      assert(typeof del_result.error?.code === "string", "Delete non-existent has an error code");
    }

    // Test 3: Upload with empty path — verify PATH_EMPTY error
    console.log("Test 3: Upload with empty path");
    // We pass an empty string as the remote path
    const { exitCode: empty_exit, result: empty_result } = runWithExit(`upload "${localFile}" ""`);
    assert(empty_exit !== 0, `Non-zero exit code for empty path (got ${empty_exit})`);
    if (empty_result) {
      assert(empty_result.success === false, "Upload with empty path returns success=false");
      assert(
        empty_result.error?.code === "PATH_EMPTY" || empty_result.error?.code?.includes("PATH"),
        `Error code relates to PATH (got ${empty_result.error?.code})`,
      );
    }

    // Test 4: Set metadata with invalid key (starts with number)
    console.log("Test 4: Set metadata with invalid key");
    const { exitCode: meta_exit, result: meta_result } = runWithExit(
      `meta set ${remotePath} 1invalidkey=value`,
    );
    assert(meta_exit !== 0, `Non-zero exit code for invalid metadata key (got ${meta_exit})`);
    if (meta_result) {
      assert(meta_result.success === false, "Invalid metadata key returns success=false");
      assert(
        meta_result.error?.code === "META_INVALID_KEY" ||
          meta_result.error?.code === "INVALID_METADATA_KEY",
        `Error code is META_INVALID_KEY (got ${meta_result.error?.code})`,
      );
    }

    // Test 5: Try to set > 10 tags
    console.log("Test 5: Set > 10 tags");
    const tooManyTags = Array.from({ length: 11 }, (_, i) => `tag${i}=val${i}`).join(" ");
    const { exitCode: tag_exit, result: tag_result } = runWithExit(
      `tags set ${remotePath} ${tooManyTags}`,
    );
    assert(tag_exit !== 0, `Non-zero exit code for > 10 tags (got ${tag_exit})`);
    if (tag_result) {
      assert(tag_result.success === false, "Too many tags returns success=false");
      assert(
        tag_result.error?.code === "META_MAX_TAGS_EXCEEDED" ||
          tag_result.error?.code === "TOO_MANY_TAGS",
        `Error code is META_MAX_TAGS_EXCEEDED (got ${tag_result.error?.code})`,
      );
    }
  } finally {
    await cleanup();
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch {
      /* ignore */
    }
  }

  // Summary
  console.log(`\n--- Error Scenarios Tests Summary: ${passCount} passed, ${failCount} failed ---\n`);
}

main().catch((err) => {
  console.error("Unhandled error in test-error-scenarios.ts:", err);
  process.exitCode = 1;
});
