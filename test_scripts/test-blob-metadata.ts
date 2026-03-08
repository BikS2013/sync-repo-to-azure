/**
 * test-blob-metadata.ts — Blob metadata and tag setting during upload tests
 *
 * Tests:
 *   - BlobUploadMetadata interface validation (required fields)
 *   - isTagPermissionError helper logic (replicated from private method)
 *   - Tag value truncation (source_path > 256 chars)
 *   - Metadata construction patterns for GitHub and DevOps
 *   - sync_time ISO 8601 format validation
 *   - sync_time consistency across batch entries
 *
 * Run: npx ts-node test_scripts/test-blob-metadata.ts
 */

import { BlobUploadMetadata } from "../src/types/repo-replication.types";

let passCount = 0;
let failCount = 0;

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

// ---------------------------------------------------------------------------
// Replicate the private isTagPermissionError logic for unit testing.
// This mirrors RepoReplicationService.isTagPermissionError exactly.
// ---------------------------------------------------------------------------
function isTagPermissionError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message || "";
    return (
      msg.includes("BlobTagsNotSupportedForSasToken") ||
      (msg.includes("AuthorizationPermissionMismatch") &&
        msg.includes("tag"))
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// Replicate the tag/metadata construction logic from uploadEntryToBlob.
// ---------------------------------------------------------------------------
function buildMetadataAndTags(blobMetadata: BlobUploadMetadata): {
  metadata: Record<string, string>;
  tags: Record<string, string>;
} {
  const metadata: Record<string, string> = {
    source_registry: blobMetadata.source_registry,
    source_path: blobMetadata.source_path,
    sync_time: blobMetadata.sync_time,
  };

  const tags: Record<string, string> = {
    source_registry: blobMetadata.source_registry,
    // Blob index tags have a 256-char value limit
    source_path: blobMetadata.source_path.substring(0, 256),
    sync_time: blobMetadata.sync_time,
  };

  return { metadata, tags };
}

// ---------------------------------------------------------------------------
// ISO 8601 validation helper
// ---------------------------------------------------------------------------
function isValidIso8601(value: string): boolean {
  const parsed = Date.parse(value);
  if (isNaN(parsed)) return false;
  // Ensure it round-trips through toISOString
  const d = new Date(parsed);
  return d.toISOString() === value;
}

async function main(): Promise<void> {
  console.log("\n=== test-blob-metadata.ts ===\n");

  // =========================================================================
  // Section 1: BlobUploadMetadata Interface Validation
  // =========================================================================
  console.log("Section 1: BlobUploadMetadata interface validation");

  // Test 1.1: Interface has all 3 required fields
  console.log("Test 1.1: BlobUploadMetadata has required fields");
  {
    const meta: BlobUploadMetadata = {
      source_registry: "owner/repo",
      source_path: "src/index.ts",
      sync_time: new Date().toISOString(),
    };
    assert(
      "source_registry" in meta,
      "BlobUploadMetadata has source_registry field",
    );
    assert(
      "source_path" in meta,
      "BlobUploadMetadata has source_path field",
    );
    assert(
      "sync_time" in meta,
      "BlobUploadMetadata has sync_time field",
    );
    assert(
      Object.keys(meta).length === 3,
      "BlobUploadMetadata has exactly 3 fields",
    );
  }

  // Test 1.2: All fields are strings
  console.log("Test 1.2: All fields are strings");
  {
    const meta: BlobUploadMetadata = {
      source_registry: "org/project/repo",
      source_path: "path/to/file.ts",
      sync_time: "2026-03-02T10:00:00.000Z",
    };
    assert(typeof meta.source_registry === "string", "source_registry is a string");
    assert(typeof meta.source_path === "string", "source_path is a string");
    assert(typeof meta.sync_time === "string", "sync_time is a string");
  }

  // =========================================================================
  // Section 2: isTagPermissionError helper
  // =========================================================================
  console.log("\nSection 2: isTagPermissionError helper");

  // Test 2.1: Returns true for BlobTagsNotSupportedForSasToken
  console.log("Test 2.1: Detects BlobTagsNotSupportedForSasToken");
  {
    const err = new Error(
      "BlobTagsNotSupportedForSasToken: Blob tags are not supported with SAS token",
    );
    assert(
      isTagPermissionError(err) === true,
      "Returns true for BlobTagsNotSupportedForSasToken error",
    );
  }

  // Test 2.2: Returns true for AuthorizationPermissionMismatch + tag
  console.log("Test 2.2: Detects AuthorizationPermissionMismatch with tag");
  {
    const err = new Error(
      "AuthorizationPermissionMismatch: This request is not authorized to set tag properties",
    );
    assert(
      isTagPermissionError(err) === true,
      "Returns true for AuthorizationPermissionMismatch + tag error",
    );
  }

  // Test 2.3: Returns false for unrelated errors
  console.log("Test 2.3: Returns false for unrelated errors");
  {
    const err1 = new Error("Network timeout after 30000ms");
    assert(
      isTagPermissionError(err1) === false,
      "Returns false for network timeout error",
    );

    const err2 = new Error("ContainerNotFound: The specified container does not exist");
    assert(
      isTagPermissionError(err2) === false,
      "Returns false for ContainerNotFound error",
    );

    const err3 = new Error("AuthorizationPermissionMismatch: cannot read blob");
    assert(
      isTagPermissionError(err3) === false,
      "Returns false for AuthorizationPermissionMismatch without 'tag' keyword",
    );
  }

  // Test 2.4: Returns false for non-Error values
  console.log("Test 2.4: Returns false for non-Error values");
  {
    assert(
      isTagPermissionError("BlobTagsNotSupportedForSasToken") === false,
      "Returns false for plain string (not an Error instance)",
    );
    assert(
      isTagPermissionError(null) === false,
      "Returns false for null",
    );
    assert(
      isTagPermissionError(undefined) === false,
      "Returns false for undefined",
    );
    assert(
      isTagPermissionError(42) === false,
      "Returns false for number",
    );
    assert(
      isTagPermissionError({ message: "BlobTagsNotSupportedForSasToken" }) === false,
      "Returns false for plain object with message property",
    );
  }

  // =========================================================================
  // Section 3: Tag Value Truncation
  // =========================================================================
  console.log("\nSection 3: Tag value truncation");

  // Test 3.1: source_path > 256 chars is truncated in tags
  console.log("Test 3.1: Long source_path truncated in tags");
  {
    const longPath = "a".repeat(300) + "/file.ts";
    const meta: BlobUploadMetadata = {
      source_registry: "owner/repo",
      source_path: longPath,
      sync_time: new Date().toISOString(),
    };

    const { metadata, tags } = buildMetadataAndTags(meta);

    assert(
      tags.source_path.length === 256,
      `Tag source_path is truncated to 256 chars (got ${tags.source_path.length})`,
    );
    assert(
      tags.source_path === longPath.substring(0, 256),
      "Tag source_path contains first 256 chars of original path",
    );
  }

  // Test 3.2: Full path preserved in metadata
  console.log("Test 3.2: Full path preserved in metadata");
  {
    const longPath = "b".repeat(300) + "/deep/nested/file.ts";
    const meta: BlobUploadMetadata = {
      source_registry: "owner/repo",
      source_path: longPath,
      sync_time: new Date().toISOString(),
    };

    const { metadata, tags } = buildMetadataAndTags(meta);

    assert(
      metadata.source_path === longPath,
      `Metadata source_path preserves full path (length: ${metadata.source_path.length})`,
    );
    assert(
      metadata.source_path.length > 256,
      "Metadata source_path is longer than 256 chars",
    );
    assert(
      tags.source_path.length <= 256,
      "Tag source_path does not exceed 256 chars",
    );
  }

  // Test 3.3: Path exactly 256 chars is not truncated
  console.log("Test 3.3: Path exactly 256 chars is not truncated");
  {
    const exactPath = "c".repeat(256);
    const meta: BlobUploadMetadata = {
      source_registry: "owner/repo",
      source_path: exactPath,
      sync_time: new Date().toISOString(),
    };

    const { metadata, tags } = buildMetadataAndTags(meta);

    assert(
      tags.source_path === exactPath,
      "Tag source_path equals original when exactly 256 chars",
    );
    assert(
      metadata.source_path === exactPath,
      "Metadata source_path equals original when exactly 256 chars",
    );
  }

  // Test 3.4: Short path is identical in both metadata and tags
  console.log("Test 3.4: Short path identical in metadata and tags");
  {
    const shortPath = "src/index.ts";
    const meta: BlobUploadMetadata = {
      source_registry: "owner/repo",
      source_path: shortPath,
      sync_time: new Date().toISOString(),
    };

    const { metadata, tags } = buildMetadataAndTags(meta);

    assert(
      tags.source_path === shortPath,
      "Tag source_path equals original for short paths",
    );
    assert(
      metadata.source_path === shortPath,
      "Metadata source_path equals original for short paths",
    );
  }

  // =========================================================================
  // Section 4: Metadata Construction Patterns
  // =========================================================================
  console.log("\nSection 4: Metadata construction patterns");

  // Test 4.1: GitHub format: source_registry is "owner/repo"
  console.log("Test 4.1: GitHub metadata format");
  {
    const owner = "myorg";
    const repo = "my-repo";
    const repoIdentifier = `${owner}/${repo}`;
    const strippedPath = "src/services/auth.service.ts";
    const syncTime = new Date().toISOString();

    const meta: BlobUploadMetadata = {
      source_registry: repoIdentifier,
      source_path: strippedPath,
      sync_time: syncTime,
    };

    assert(
      meta.source_registry === "myorg/my-repo",
      "GitHub source_registry follows owner/repo format",
    );
    assert(
      meta.source_registry.split("/").length === 2,
      "GitHub source_registry has exactly 2 segments (owner/repo)",
    );
    assert(
      meta.source_path === strippedPath,
      "GitHub source_path is the file path within the repo",
    );
  }

  // Test 4.2: DevOps format: source_registry is "org/project/repo"
  console.log("Test 4.2: DevOps metadata format");
  {
    const org = "mycompany";
    const project = "my-project";
    const repository = "backend-api";
    const repoIdentifier = `${org}/${project}/${repository}`;
    const entryPath = "src/controllers/main.controller.ts";
    const syncTime = new Date().toISOString();

    const meta: BlobUploadMetadata = {
      source_registry: repoIdentifier,
      source_path: entryPath,
      sync_time: syncTime,
    };

    assert(
      meta.source_registry === "mycompany/my-project/backend-api",
      "DevOps source_registry follows org/project/repo format",
    );
    assert(
      meta.source_registry.split("/").length === 3,
      "DevOps source_registry has exactly 3 segments (org/project/repo)",
    );
    assert(
      meta.source_path === entryPath,
      "DevOps source_path is the file path within the repo",
    );
  }

  // Test 4.3: sync_time is valid ISO 8601 format
  console.log("Test 4.3: sync_time is valid ISO 8601");
  {
    const syncTime = new Date().toISOString();
    assert(
      isValidIso8601(syncTime),
      `sync_time from toISOString() is valid ISO 8601 (${syncTime})`,
    );

    // Verify it matches the expected pattern YYYY-MM-DDTHH:MM:SS.sssZ
    const iso8601Pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    assert(
      iso8601Pattern.test(syncTime),
      "sync_time matches YYYY-MM-DDTHH:MM:SS.sssZ pattern",
    );
  }

  // Test 4.4: sync_time is consistent across all files in a batch
  console.log("Test 4.4: sync_time consistency in batch");
  {
    // Simulate the pattern from repo-replication.service.ts:
    // syncTime is set once before the loop, then reused for all entries
    const syncTime = new Date().toISOString();

    const files = [
      "src/index.ts",
      "src/config/loader.ts",
      "package.json",
      "README.md",
      "src/services/deep/nested/module.ts",
    ];

    const metadataEntries: BlobUploadMetadata[] = files.map((filePath) => ({
      source_registry: "owner/repo",
      source_path: filePath,
      sync_time: syncTime,
    }));

    const allSameSyncTime = metadataEntries.every(
      (m) => m.sync_time === syncTime,
    );
    assert(
      allSameSyncTime,
      "All entries in a batch share the same sync_time value",
    );

    // Verify each entry has a distinct source_path
    const uniquePaths = new Set(metadataEntries.map((m) => m.source_path));
    assert(
      uniquePaths.size === files.length,
      `Each entry has a unique source_path (${uniquePaths.size} unique out of ${files.length})`,
    );

    // Verify all entries share the same source_registry
    const uniqueRegistries = new Set(metadataEntries.map((m) => m.source_registry));
    assert(
      uniqueRegistries.size === 1,
      "All entries in a batch share the same source_registry",
    );
  }

  // Test 4.5: Metadata and tags contain identical keys
  console.log("Test 4.5: Metadata and tags have matching keys");
  {
    const meta: BlobUploadMetadata = {
      source_registry: "owner/repo",
      source_path: "src/file.ts",
      sync_time: new Date().toISOString(),
    };

    const { metadata, tags } = buildMetadataAndTags(meta);

    const metadataKeys = Object.keys(metadata).sort();
    const tagKeys = Object.keys(tags).sort();

    assert(
      JSON.stringify(metadataKeys) === JSON.stringify(tagKeys),
      "Metadata and tags have the same keys (source_registry, source_path, sync_time)",
    );
    assert(
      metadataKeys.length === 3,
      "Both metadata and tags have exactly 3 keys",
    );
  }

  // =========================================================================
  // Summary
  // =========================================================================
  console.log(
    `\n--- Blob Metadata Tests Summary: ${passCount} passed, ${failCount} failed ---\n`,
  );
}

main().catch((err) => {
  console.error("Unhandled error in test-blob-metadata.ts:", err);
  process.exitCode = 1;
});
