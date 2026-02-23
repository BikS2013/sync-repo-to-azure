/**
 * test-edit-operations.ts — Edit strategies tests
 *
 * Tests:
 *   - Upload a text file
 *   - Test patch: find-replace literal text, verify content changed
 *   - Test patch: regex replacement, verify content changed
 *   - Test patch: no matches found, verify matchCount=0
 *   - Test append (end): verify content has appended text
 *   - Test append (start): verify content has prepended text
 *   - Test edit: download to temp, verify temp file exists, re-upload
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
  console.log("\n=== test-edit-operations.ts ===\n");

  if (!checkEnvConfigured()) {
    console.log("SKIP: Azure environment not configured.");
    return;
  }

  const remotePath = `${TEST_PREFIX}/editable-file.txt`;
  const initialContent = "Hello World! Version v1.0 is ready. Hello World again!";

  // Create temp file and upload
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "azure-fs-edit-test-"));
  const localFile = path.join(tmpDir, "editable.txt");
  fs.writeFileSync(localFile, initialContent, "utf-8");

  try {
    // Upload initial file
    console.log("Setup: Upload initial file");
    const uploadResult = run(`upload "${localFile}" ${remotePath}`);
    assert(uploadResult.success === true, "Initial upload success");

    // Test 1: Patch with find-replace (literal)
    console.log("Test 1: Patch — find-replace literal text");
    const patchResult1 = run(`patch ${remotePath} --find "Hello World" --replace "Hi Universe"`);
    assert(patchResult1.success === true, "Patch find-replace returns success=true");
    assert(typeof patchResult1.data?.patchesApplied === "number", "Patch returns patchesApplied");

    // Verify content changed
    const download1 = run(`download ${remotePath}`);
    assert(download1.success === true, "Download after patch success");
    assert(
      download1.data?.content?.includes("Hi Universe"),
      "Content contains 'Hi Universe' after find-replace",
    );

    // Test 2: Patch with regex replacement
    console.log("Test 2: Patch — regex replacement");
    const patchResult2 = run(`patch ${remotePath} --find "v\\d+\\.\\d+" --replace "v2.0" --regex --flags g`);
    assert(patchResult2.success === true, "Patch regex returns success=true");

    const download2 = run(`download ${remotePath}`);
    assert(download2.success === true, "Download after regex patch success");
    assert(
      download2.data?.content?.includes("v2.0"),
      "Content contains 'v2.0' after regex replacement",
    );

    // Test 3: Patch with no matches
    console.log("Test 3: Patch — no matches found");
    const patchResult3 = run(`patch ${remotePath} --find "NONEXISTENT_STRING_12345" --replace "replaced"`);
    assert(patchResult3.success === true, "Patch no-match returns success=true");
    // Check that details show 0 matches
    const details3 = patchResult3.data?.details;
    if (Array.isArray(details3) && details3.length > 0) {
      assert(
        details3[0].matchesFound === 0 || details3[0].matchCount === 0,
        "No matches found (matchesFound=0 or matchCount=0)",
      );
    } else {
      // Alternatively check patchesApplied
      assert(
        patchResult3.data?.patchesApplied === 0,
        "patchesApplied=0 for no-match patch",
      );
    }

    // Test 4: Append (end)
    console.log("Test 4: Append (end)");
    const appendEnd = run(`append ${remotePath} --content " [APPENDED_END]" --position end`);
    assert(appendEnd.success === true, "Append end returns success=true");
    assert(typeof appendEnd.data?.newSize === "number", "Append returns newSize");

    const download4 = run(`download ${remotePath}`);
    assert(download4.success === true, "Download after append-end success");
    assert(
      download4.data?.content?.endsWith(" [APPENDED_END]"),
      "Content ends with appended text",
    );

    // Test 5: Append (start)
    console.log("Test 5: Append (start)");
    const appendStart = run(`append ${remotePath} --content "[PREPENDED] " --position start`);
    assert(appendStart.success === true, "Append start returns success=true");

    const download5 = run(`download ${remotePath}`);
    assert(download5.success === true, "Download after append-start success");
    assert(
      download5.data?.content?.startsWith("[PREPENDED] "),
      "Content starts with prepended text",
    );

    // Test 6: Edit (download to temp, verify file exists)
    console.log("Test 6: Edit — download to temp file");
    const editResult = run(`edit ${remotePath}`);
    assert(editResult.success === true, "Edit (download) returns success=true");
    assert(typeof editResult.data?.localPath === "string", "Edit returns localPath");
    assert(typeof editResult.data?.etag === "string", "Edit returns etag");

    const editLocalPath = editResult.data?.localPath;
    if (editLocalPath) {
      const tempExists = fs.existsSync(editLocalPath);
      assert(tempExists, `Temp file exists at ${editLocalPath}`);

      if (tempExists) {
        // Modify the temp file and re-upload
        const tempContent = fs.readFileSync(editLocalPath, "utf-8");
        fs.writeFileSync(editLocalPath, tempContent + " [EDITED]", "utf-8");

        const editUpload = run(
          `edit ${remotePath} --upload --local "${editLocalPath}" --etag "${editResult.data.etag}"`,
        );
        assert(editUpload.success === true, "Edit re-upload returns success=true");

        // Verify the re-uploaded content
        const download6 = run(`download ${remotePath}`);
        assert(download6.success === true, "Download after edit re-upload success");
        assert(
          download6.data?.content?.includes("[EDITED]"),
          "Content contains [EDITED] after edit re-upload",
        );

        // Clean up temp file
        try {
          fs.unlinkSync(editLocalPath);
        } catch {
          /* ignore */
        }
      }
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
  console.log(`\n--- Edit Operations Tests Summary: ${passCount} passed, ${failCount} failed ---\n`);
}

main().catch((err) => {
  console.error("Unhandled error in test-edit-operations.ts:", err);
  process.exitCode = 1;
});
