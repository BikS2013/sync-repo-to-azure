/**
 * test-folder-operations.ts — Folder operations tests
 *
 * Tests:
 *   - Create a folder (mkdir)
 *   - Upload files into the folder
 *   - List folder (non-recursive) — verify files and no subfolders leak
 *   - Create subfolder, upload files into it
 *   - List folder (recursive) — verify all nested files
 *   - Check folder exists (true)
 *   - Delete folder (rmdir) — verify deleted count
 *   - Check folder exists (false)
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
  console.log("\n=== test-folder-operations.ts ===\n");

  if (!checkEnvConfigured()) {
    console.log("SKIP: Azure environment not configured.");
    return;
  }

  const folderPath = `${TEST_PREFIX}/myfolder`;
  const subfolderPath = `${TEST_PREFIX}/myfolder/subfolder`;

  // Create temp local files
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "azure-fs-folder-test-"));
  const fileA = path.join(tmpDir, "fileA.txt");
  const fileB = path.join(tmpDir, "fileB.txt");
  const fileC = path.join(tmpDir, "fileC.txt");

  fs.writeFileSync(fileA, "Content of file A", "utf-8");
  fs.writeFileSync(fileB, "Content of file B", "utf-8");
  fs.writeFileSync(fileC, "Content of file C (in subfolder)", "utf-8");

  try {
    // Test 1: Create a folder
    console.log("Test 1: Create a folder (mkdir)");
    const mkdirResult = run(`mkdir ${folderPath}`);
    assert(mkdirResult.success === true, "mkdir returns success=true");
    assert(typeof mkdirResult.data?.path === "string", "mkdir returns path");

    // Test 2: Upload files into the folder
    console.log("Test 2: Upload files into the folder");
    const uploadA = run(`upload "${fileA}" ${folderPath}/fileA.txt`);
    assert(uploadA.success === true, "Upload fileA success");
    const uploadB = run(`upload "${fileB}" ${folderPath}/fileB.txt`);
    assert(uploadB.success === true, "Upload fileB success");

    // Test 3: List folder (non-recursive)
    console.log("Test 3: List folder (non-recursive)");
    const listResult = run(`ls ${folderPath}/`);
    assert(listResult.success === true, "ls returns success=true");
    const items = listResult.data?.items || listResult.data;
    assert(Array.isArray(items), "ls returns an array of items");

    // We should see fileA.txt and fileB.txt, but not subfolders that don't exist yet
    const fileNames = Array.isArray(items) ? items.map((i: any) => i.name) : [];
    assert(fileNames.includes("fileA.txt"), "ls includes fileA.txt");
    assert(fileNames.includes("fileB.txt"), "ls includes fileB.txt");

    // Test 4: Create subfolder and upload file into it
    console.log("Test 4: Create subfolder and upload file");
    const mkdirSub = run(`mkdir ${subfolderPath}`);
    assert(mkdirSub.success === true, "mkdir subfolder success");
    const uploadC = run(`upload "${fileC}" ${subfolderPath}/fileC.txt`);
    assert(uploadC.success === true, "Upload fileC into subfolder success");

    // Test 5: List folder (non-recursive) should show subfolder but not its files
    console.log("Test 5: List folder (non-recursive) shows subfolder entry");
    const listResult2 = run(`ls ${folderPath}/`);
    assert(listResult2.success === true, "ls returns success=true");
    const items2 = listResult2.data?.items || listResult2.data;
    const names2 = Array.isArray(items2) ? items2.map((i: any) => i.name) : [];
    // The subfolder should appear as a folder entry
    const hasSubfolder = Array.isArray(items2) && items2.some((i: any) => i.type === "folder" && i.name.includes("subfolder"));
    assert(hasSubfolder, "Non-recursive ls shows subfolder as a folder entry");
    // fileC should NOT appear directly
    assert(!names2.includes("fileC.txt"), "Non-recursive ls does not leak subfolder files");

    // Test 6: List folder (recursive) — verify all nested files
    console.log("Test 6: List folder (recursive)");
    const listRecursive = run(`ls ${folderPath}/ --recursive`);
    assert(listRecursive.success === true, "Recursive ls returns success=true");
    const recursiveItems = listRecursive.data?.items || listRecursive.data;
    assert(Array.isArray(recursiveItems), "Recursive ls returns an array");
    // Should include fileC.txt from the subfolder
    const allPaths = Array.isArray(recursiveItems) ? recursiveItems.map((i: any) => i.fullPath || i.name) : [];
    const hasFileC = allPaths.some((p: string) => p.includes("fileC.txt"));
    assert(hasFileC, "Recursive ls includes fileC.txt from subfolder");

    // Test 7: Check folder exists (true)
    console.log("Test 7: Check folder exists (true)");
    const folderExistsResult = run(`exists ${folderPath} --type folder`);
    assert(folderExistsResult.success === true, "Exists returns success=true");
    assert(folderExistsResult.data?.exists === true, "Folder exists=true");

    // Test 8: Delete folder (rmdir) — verify deleted count
    console.log("Test 8: Delete folder (rmdir)");
    const rmdirResult = run(`rmdir ${folderPath}`);
    assert(rmdirResult.success === true, "rmdir returns success=true");
    assert(typeof rmdirResult.data?.deletedCount === "number", "rmdir returns deletedCount");
    assert(rmdirResult.data.deletedCount > 0, `rmdir deleted ${rmdirResult.data.deletedCount} items`);

    // Test 9: Check folder exists (false)
    console.log("Test 9: Check folder exists after rmdir (false)");
    const folderExistsResult2 = run(`exists ${folderPath} --type folder`);
    assert(folderExistsResult2.success === true, "Exists returns success=true");
    assert(folderExistsResult2.data?.exists === false, "Folder exists=false after rmdir");
  } finally {
    // Cleanup any remnants
    await cleanup();
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch {
      /* ignore */
    }
  }

  // Summary
  console.log(`\n--- Folder Operations Tests Summary: ${passCount} passed, ${failCount} failed ---\n`);
}

main().catch((err) => {
  console.error("Unhandled error in test-folder-operations.ts:", err);
  process.exitCode = 1;
});
