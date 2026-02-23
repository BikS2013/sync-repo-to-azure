#!/usr/bin/env ts-node
/**
 * Bulk upload test: compares sequential per-file upload with the batch
 * upload-dir command. Measures timing for both approaches and prints
 * a comparative performance report.
 */
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const CLI = "npx ts-node src/index.ts";
const PROJECT_ROOT = path.resolve(__dirname, "..");
const REMOTE_BASE_SEQ = "BikS-content/test-upload-seq";
const REMOTE_BASE_BATCH = "BikS-content/test-upload-batch";

// Directories/files to exclude
const EXCLUDE_DIRS = ["node_modules", ".git", "dist", ".serena"];
const EXCLUDE_FILES = [".env", "package-lock.json"];

/**
 * Extract the JSON object from CLI output that may contain debug log lines.
 * Finds the first line starting with '{' and parses the JSON block from there.
 */
function extractJson(output: string): any | null {
  const lines = output.trim().split("\n");
  let jsonStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith("{")) {
      jsonStart = i;
      break;
    }
  }
  if (jsonStart === -1) return null;
  const jsonBlock = lines.slice(jsonStart).join("\n");
  try {
    return JSON.parse(jsonBlock);
  } catch {
    return null;
  }
}

interface UploadTiming {
  localPath: string;
  remotePath: string;
  sizeBytes: number;
  durationMs: number;
  success: boolean;
  error?: string;
}

function collectFiles(dir: string, baseDir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.includes(entry.name)) continue;
      results.push(...collectFiles(fullPath, baseDir));
    } else {
      if (EXCLUDE_FILES.includes(entry.name)) continue;
      const relativePath = path.relative(baseDir, fullPath);
      results.push(relativePath);
    }
  }
  return results;
}

function uploadFileSingle(localRelative: string, remoteBase: string): UploadTiming {
  const localAbsolute = path.join(PROJECT_ROOT, localRelative);
  const remotePath = `${remoteBase}/${localRelative}`;
  const stats = fs.statSync(localAbsolute);

  const start = Date.now();
  let success = false;
  let error: string | undefined;

  try {
    const output = execSync(
      `${CLI} upload "${localAbsolute}" "${remotePath}" --json`,
      { encoding: "utf-8", timeout: 60000, cwd: PROJECT_ROOT }
    );
    const result = extractJson(output);
    if (result) {
      success = result.success === true;
      if (!success) error = result.error?.message;
    } else {
      success = true;
    }
  } catch (err: any) {
    error = err.message?.substring(0, 200);
    if (err.stdout) {
      const result = extractJson(err.stdout);
      if (result) {
        success = result.success === true;
        if (!success) error = result.error?.message;
      }
    }
  }

  const durationMs = Date.now() - start;
  return { localPath: localRelative, remotePath, sizeBytes: stats.size, durationMs, success, error };
}

// --- Main ---
const mode = process.argv[2] || "both"; // "seq", "batch", or "both"

console.log("=== Bulk Upload Performance Test ===");
console.log(`Project root: ${PROJECT_ROOT}`);
console.log(`Mode: ${mode}`);
console.log("");

// Collect files (for counting and sequential test)
const files = collectFiles(PROJECT_ROOT, PROJECT_ROOT).sort();
const totalBytes = files.reduce((sum, f) => sum + fs.statSync(path.join(PROJECT_ROOT, f)).size, 0);
console.log(`Found ${files.length} files (${(totalBytes / 1024).toFixed(1)} KB total).\n`);

// --- Sequential Upload ---
let seqDurationMs = 0;
let seqSuccessCount = 0;
let seqFailCount = 0;

if (mode === "seq" || mode === "both") {
  console.log("--- Sequential Upload (one CLI invocation per file) ---\n");
  const seqTimings: UploadTiming[] = [];
  const seqStart = Date.now();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    process.stdout.write(`  [${i + 1}/${files.length}] ${file} ... `);
    const timing = uploadFileSingle(file, REMOTE_BASE_SEQ);
    seqTimings.push(timing);
    console.log(timing.success ? `OK (${timing.durationMs}ms, ${timing.sizeBytes}B)` : `FAIL: ${timing.error}`);
  }

  seqDurationMs = Date.now() - seqStart;
  seqSuccessCount = seqTimings.filter(t => t.success).length;
  seqFailCount = seqTimings.filter(t => !t.success).length;
  const seqDurations = seqTimings.map(t => t.durationMs);
  const seqAvg = seqDurations.reduce((a, b) => a + b, 0) / seqDurations.length;

  console.log(`\n  Sequential result: ${seqSuccessCount}/${files.length} success, ${seqFailCount} failed`);
  console.log(`  Total time: ${(seqDurationMs / 1000).toFixed(1)}s`);
  console.log(`  Avg per file: ${seqAvg.toFixed(0)}ms\n`);
}

// --- Batch Upload (upload-dir) ---
let batchDurationMs = 0;
let batchSuccessCount = 0;
let batchFailCount = 0;
let batchTotalFiles = 0;

if (mode === "batch" || mode === "both") {
  console.log("--- Batch Upload (upload-dir command with parallel uploads) ---\n");

  const excludeList = [...EXCLUDE_DIRS, ...EXCLUDE_FILES].join(",");
  const batchCmd = `${CLI} upload-dir "${PROJECT_ROOT}" "${REMOTE_BASE_BATCH}" --exclude ${excludeList} --json`;

  console.log(`  Command: ${batchCmd}\n`);

  const batchStart = Date.now();

  try {
    const output = execSync(batchCmd, {
      encoding: "utf-8",
      timeout: 300000,
      cwd: PROJECT_ROOT,
    });

    batchDurationMs = Date.now() - batchStart;
    const result = extractJson(output);

    if (result && result.success) {
      const data = result.data;
      batchTotalFiles = data.totalFiles;
      batchSuccessCount = data.successCount;
      batchFailCount = data.failedCount;
      console.log(`  Files: ${batchTotalFiles} total, ${batchSuccessCount} success, ${batchFailCount} failed`);
      console.log(`  Total bytes: ${(data.totalBytes / 1024).toFixed(1)} KB`);
      console.log(`  Total time: ${(batchDurationMs / 1000).toFixed(1)}s`);
      console.log(`  Server-side duration: ${(data.totalDurationMs / 1000).toFixed(1)}s`);

      // Show per-file timing stats
      if (data.files && data.files.length > 0) {
        const fileDurations = data.files.map((f: any) => f.durationMs);
        const avg = fileDurations.reduce((a: number, b: number) => a + b, 0) / fileDurations.length;
        const sorted = [...fileDurations].sort((a: number, b: number) => a - b);
        const p50 = sorted[Math.floor(sorted.length * 0.5)];
        const p90 = sorted[Math.floor(sorted.length * 0.9)];

        console.log(`  Avg per file: ${avg.toFixed(0)}ms (within batch)`);
        console.log(`  P50: ${p50}ms, P90: ${p90}ms`);
      }

      // Show failed files if any
      if (batchFailCount > 0) {
        console.log("\n  Failed files:");
        for (const f of data.files.filter((f: any) => !f.success)) {
          console.log(`    ${f.localPath}: ${f.error}`);
        }
      }
    } else {
      console.log(`  ERROR: Batch upload failed.`);
      if (result) console.log(`  ${JSON.stringify(result.error || result, null, 2)}`);
    }
  } catch (err: any) {
    batchDurationMs = Date.now() - batchStart;
    console.log(`  ERROR: ${err.message?.substring(0, 300)}`);
    if (err.stdout) {
      const result = extractJson(err.stdout);
      if (result) console.log(`  ${JSON.stringify(result.error || result, null, 2)}`);
    }
  }

  console.log("");
}

// --- Comparison ---
if (mode === "both" && seqDurationMs > 0 && batchDurationMs > 0) {
  console.log("=== Performance Comparison ===\n");
  console.log(`  Files uploaded:     ${files.length}`);
  console.log(`  Total data:         ${(totalBytes / 1024).toFixed(1)} KB`);
  console.log(`  Sequential time:    ${(seqDurationMs / 1000).toFixed(1)}s`);
  console.log(`  Batch time:         ${(batchDurationMs / 1000).toFixed(1)}s`);
  console.log(`  Speedup:            ${(seqDurationMs / batchDurationMs).toFixed(1)}x faster`);
  console.log(`  Time saved:         ${((seqDurationMs - batchDurationMs) / 1000).toFixed(1)}s`);
  console.log(`  Seq throughput:     ${(totalBytes / 1024 / (seqDurationMs / 1000)).toFixed(1)} KB/s`);
  console.log(`  Batch throughput:   ${(totalBytes / 1024 / (batchDurationMs / 1000)).toFixed(1)} KB/s`);
}

const anyFailed = (seqFailCount > 0) || (batchFailCount > 0);
process.exitCode = anyFailed ? 1 : 0;
