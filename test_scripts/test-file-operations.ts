/**
 * test-file-operations.ts — File CRUD tests
 *
 * Tests:
 *   - Upload a text file (from a temp local file)
 *   - Download and verify content matches
 *   - Check file exists (true)
 *   - Get file info — verify size, contentType
 *   - Replace file with new content
 *   - Download and verify new content
 *   - Delete file
 *   - Check file exists (false)
 *   - Check non-existent file returns exists=false
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
  console.log("\n=== test-file-operations.ts ===\n");

  if (!checkEnvConfigured()) {
    console.log("SKIP: Azure environment not configured.");
    return;
  }

  const remotePath = `${TEST_PREFIX}/test-file.txt`;
  const originalContent = "Hello, Azure Blob Storage! This is a test file.";
  const replacedContent = "This content has been replaced for testing.";

  // Create temp local files
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "azure-fs-test-"));
  const localUploadFile = path.join(tmpDir, "upload.txt");
  const localReplaceFile = path.join(tmpDir, "replace.txt");

  fs.writeFileSync(localUploadFile, originalContent, "utf-8");
  fs.writeFileSync(localReplaceFile, replacedContent, "utf-8");

  try {
    // Test 1: Upload a text file
    console.log("Test 1: Upload a text file");
    const uploadResult = run(`upload "${localUploadFile}" ${remotePath}`);
    assert(uploadResult.success === true, "Upload returns success=true");
    assert(uploadResult.data?.path === remotePath, `Uploaded path matches (${uploadResult.data?.path})`);
    assert(typeof uploadResult.data?.size === "number", "Upload returns size");
    assert(typeof uploadResult.data?.etag === "string", "Upload returns etag");

    // Test 2: Download and verify content
    console.log("Test 2: Download and verify content matches");
    const downloadResult = run(`download ${remotePath}`);
    assert(downloadResult.success === true, "Download returns success=true");
    assert(downloadResult.data?.content === originalContent, "Downloaded content matches original");

    // Test 3: Check file exists (true)
    console.log("Test 3: Check file exists (true)");
    const existsResult = run(`exists ${remotePath} --type file`);
    assert(existsResult.success === true, "Exists returns success=true");
    assert(existsResult.data?.exists === true, "File exists=true");

    // Test 4: Get file info
    console.log("Test 4: Get file info — verify size, contentType");
    const infoResult = run(`info ${remotePath}`);
    assert(infoResult.success === true, "Info returns success=true");
    assert(typeof infoResult.data?.size === "number", "Info has size");
    assert(infoResult.data?.size === Buffer.byteLength(originalContent, "utf-8"), "Info size matches content length");
    assert(typeof infoResult.data?.contentType === "string", "Info has contentType");
    assert(typeof infoResult.data?.etag === "string", "Info has etag");
    assert(typeof infoResult.data?.lastModified === "string", "Info has lastModified");

    // Test 5: Replace file with new content
    console.log("Test 5: Replace file with new content");
    const replaceResult = run(`replace "${localReplaceFile}" ${remotePath}`);
    assert(replaceResult.success === true, "Replace returns success=true");
    assert(typeof replaceResult.data?.etag === "string", "Replace returns new etag");

    // Test 6: Download and verify new content
    console.log("Test 6: Download and verify replaced content");
    const downloadResult2 = run(`download ${remotePath}`);
    assert(downloadResult2.success === true, "Download after replace returns success=true");
    assert(downloadResult2.data?.content === replacedContent, "Downloaded content matches replaced content");

    // Test 7: Delete file
    console.log("Test 7: Delete file");
    const deleteResult = run(`delete ${remotePath}`);
    assert(deleteResult.success === true, "Delete returns success=true");

    // Test 8: Check file exists (false)
    console.log("Test 8: Check file exists after deletion (false)");
    const existsResult2 = run(`exists ${remotePath} --type file`);
    assert(existsResult2.success === true, "Exists returns success=true");
    assert(existsResult2.data?.exists === false, "File exists=false after deletion");

    // Test 9: Check non-existent file
    console.log("Test 9: Check non-existent file returns exists=false");
    const nonExistPath = `${TEST_PREFIX}/non-existent-file-${Date.now()}.txt`;
    const existsResult3 = run(`exists ${nonExistPath} --type file`);
    assert(existsResult3.success === true, "Exists for non-existent file returns success=true");
    assert(existsResult3.data?.exists === false, "Non-existent file exists=false");
  } finally {
    // Cleanup
    await cleanup();
    // Remove temp files
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch {
      /* ignore */
    }
  }

  // Summary
  console.log(`\n--- File Operations Tests Summary: ${passCount} passed, ${failCount} failed ---\n`);
}

main().catch((err) => {
  console.error("Unhandled error in test-file-operations.ts:", err);
  process.exitCode = 1;
});
