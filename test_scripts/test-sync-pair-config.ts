/**
 * test-sync-pair-config.ts — Sync Pair Configuration Loader tests
 *
 * Tests:
 *   - Valid JSON loading
 *   - Valid YAML loading
 *   - Missing file produces ConfigError
 *   - Invalid file extension produces ConfigError
 *   - Invalid JSON content produces parse error
 *   - Empty syncPairs array produces RepoReplicationError
 *   - Missing syncPairs key produces error
 *   - Duplicate pair names produces validation error
 *   - GitHub pair missing source.repo produces validation error
 *   - DevOps pair missing source.pat produces validation error
 *   - Missing destination.folder produces validation error
 *   - Invalid GitHub repo format produces validation error
 *   - Token expiry check: expired token throws, valid future token does not
 *
 * Run: npx ts-node test_scripts/test-sync-pair-config.ts
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  loadSyncPairConfig,
  validateSyncPairConfig,
  checkSyncPairTokenExpiry,
} from "../src/config/sync-pair.loader";
import { ConfigError } from "../src/errors/config.error";
import { RepoReplicationError } from "../src/errors/repo-replication.error";
import { Logger } from "../src/utils/logger.utils";

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

function assertThrows(
  fn: () => void,
  errorClass: new (...args: any[]) => Error,
  messagePart?: string,
  label?: string,
): void {
  try {
    fn();
    assert(false, `${label ?? "assertThrows"}: Expected ${errorClass.name} but no error was thrown`);
  } catch (err: any) {
    assert(
      err instanceof errorClass,
      `${label ?? "assertThrows"}: Error is instance of ${errorClass.name} (got ${err.constructor.name})`,
    );
    if (messagePart) {
      assert(
        typeof err.message === "string" && err.message.includes(messagePart),
        `${label ?? "assertThrows"}: Error message contains "${messagePart}"`,
      );
    }
  }
}

// -- Helpers for building valid config payloads --

function makeValidGitHubPair(overrides?: Record<string, any>): Record<string, any> {
  return {
    name: "gh-pair-1",
    platform: "github",
    source: {
      repo: "owner/repo",
      token: "ghp_test123",
      ref: "main",
    },
    destination: {
      accountUrl: "https://teststorage.blob.core.windows.net",
      container: "test-container",
      folder: "github-backup",
      sasToken: "sv=2022-11-02&sig=abc",
    },
    ...overrides,
  };
}

function makeValidDevOpsPair(overrides?: Record<string, any>): Record<string, any> {
  return {
    name: "devops-pair-1",
    platform: "azure-devops",
    source: {
      organization: "my-org",
      project: "my-project",
      repository: "my-repo",
      pat: "pat-abc123",
      ref: "main",
    },
    destination: {
      accountUrl: "https://teststorage.blob.core.windows.net",
      container: "test-container",
      folder: "devops-backup",
      sasToken: "sv=2022-11-02&sig=xyz",
    },
    ...overrides,
  };
}

function makeValidConfig(): Record<string, any> {
  return {
    syncPairs: [makeValidGitHubPair(), makeValidDevOpsPair()],
  };
}

// -- Temp file helpers --

let tmpDir: string;

function setup(): void {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sync-pair-test-"));
}

function cleanup(): void {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function writeTempFile(filename: string, content: string): string {
  const filePath = path.join(tmpDir, filename);
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

const logger = new Logger("warn");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("\n=== test-sync-pair-config.ts ===\n");

  setup();

  try {
    // Test 1: Valid JSON loading
    console.log("Test 1: Valid JSON loading");
    {
      const config = makeValidConfig();
      const filePath = writeTempFile("valid.json", JSON.stringify(config, null, 2));
      const result = loadSyncPairConfig(filePath, logger);
      assert(Array.isArray(result.syncPairs), "result.syncPairs is an array");
      assert(result.syncPairs.length === 2, "result.syncPairs has 2 items");
      assert(result.syncPairs[0].name === "gh-pair-1", "First pair name is gh-pair-1");
      assert(result.syncPairs[0].platform === "github", "First pair platform is github");
      assert(result.syncPairs[1].name === "devops-pair-1", "Second pair name is devops-pair-1");
      assert(result.syncPairs[1].platform === "azure-devops", "Second pair platform is azure-devops");
    }

    // Test 2: Valid YAML loading
    console.log("\nTest 2: Valid YAML loading");
    {
      const yamlContent = `syncPairs:
  - name: "yaml-gh"
    platform: "github"
    source:
      repo: "owner/repo"
      token: "ghp_yamltest"
      ref: "main"
    destination:
      accountUrl: "https://teststorage.blob.core.windows.net"
      container: "test-container"
      folder: "yaml-backup"
      sasToken: "sv=2022-11-02&sig=yaml"
`;
      const filePath = writeTempFile("valid.yaml", yamlContent);
      const result = loadSyncPairConfig(filePath, logger);
      assert(Array.isArray(result.syncPairs), "YAML result.syncPairs is an array");
      assert(result.syncPairs.length === 1, "YAML result.syncPairs has 1 item");
      assert(result.syncPairs[0].name === "yaml-gh", "YAML pair name is yaml-gh");
      assert(result.syncPairs[0].platform === "github", "YAML pair platform is github");
    }

    // Test 3: Missing file
    console.log("\nTest 3: Missing file produces ConfigError");
    {
      assertThrows(
        () => loadSyncPairConfig("/non/existent/path/sync-pairs.json", logger),
        ConfigError,
        "not found",
        "Missing file",
      );
    }

    // Test 4: Invalid extension
    console.log("\nTest 4: Invalid file extension produces ConfigError");
    {
      const filePath = writeTempFile("config.txt", JSON.stringify(makeValidConfig()));
      assertThrows(
        () => loadSyncPairConfig(filePath, logger),
        ConfigError,
        ".txt",
        "Invalid extension",
      );
    }

    // Test 5: Invalid JSON content
    console.log("\nTest 5: Invalid JSON content produces parse error");
    {
      const filePath = writeTempFile("broken.json", "{ this is not valid json }");
      assertThrows(
        () => loadSyncPairConfig(filePath, logger),
        ConfigError,
        "Failed to parse",
        "Invalid JSON",
      );
    }

    // Test 6: Empty syncPairs array
    console.log("\nTest 6: Empty syncPairs array produces RepoReplicationError");
    {
      const filePath = writeTempFile("empty-pairs.json", JSON.stringify({ syncPairs: [] }));
      assertThrows(
        () => loadSyncPairConfig(filePath, logger),
        RepoReplicationError,
        "at least one sync pair",
        "Empty syncPairs",
      );
    }

    // Test 7: Missing syncPairs key
    console.log("\nTest 7: Missing syncPairs key produces error");
    {
      const filePath = writeTempFile("no-key.json", JSON.stringify({ pairs: [] }));
      assertThrows(
        () => loadSyncPairConfig(filePath, logger),
        RepoReplicationError,
        "'syncPairs' array",
        "Missing syncPairs key",
      );
    }

    // Test 8: Duplicate pair names
    console.log("\nTest 8: Duplicate pair names produces validation error");
    {
      const config = {
        syncPairs: [
          makeValidGitHubPair({ name: "duplicate-name" }),
          makeValidDevOpsPair({ name: "duplicate-name" }),
        ],
      };
      assertThrows(
        () => validateSyncPairConfig(config),
        RepoReplicationError,
        "Duplicate sync pair name",
        "Duplicate names",
      );
    }

    // Test 9: GitHub pair missing source.repo
    console.log("\nTest 9: GitHub pair missing source.repo produces validation error");
    {
      const pair = makeValidGitHubPair();
      delete pair.source.repo;
      const config = { syncPairs: [pair] };
      assertThrows(
        () => validateSyncPairConfig(config),
        RepoReplicationError,
        "requires 'repo'",
        "Missing source.repo",
      );
    }

    // Test 10: DevOps pair missing source.pat
    console.log("\nTest 10: DevOps pair missing source.pat produces validation error");
    {
      const pair = makeValidDevOpsPair();
      delete pair.source.pat;
      const config = { syncPairs: [pair] };
      assertThrows(
        () => validateSyncPairConfig(config),
        RepoReplicationError,
        "requires 'pat'",
        "Missing source.pat",
      );
    }

    // Test 11: Missing destination.folder
    console.log("\nTest 11: Missing destination.folder produces validation error");
    {
      const pair = makeValidGitHubPair();
      delete pair.destination.folder;
      const config = { syncPairs: [pair] };
      assertThrows(
        () => validateSyncPairConfig(config),
        RepoReplicationError,
        "requires 'folder'",
        "Missing destination.folder",
      );
    }

    // Test 12: Invalid GitHub repo format
    console.log("\nTest 12: Invalid GitHub repo format produces validation error");
    {
      const pair = makeValidGitHubPair();
      pair.source.repo = "just-repo-no-owner";
      const config = { syncPairs: [pair] };
      assertThrows(
        () => validateSyncPairConfig(config),
        RepoReplicationError,
        '"owner/repo" format',
        "Invalid repo format",
      );
    }

    // Test 13: Token expiry check
    console.log("\nTest 13a: Expired token throws ConfigError");
    {
      const pastDate = new Date(Date.now() - 86400000).toISOString(); // yesterday
      const config = makeValidConfig();
      config.syncPairs[0].source.tokenExpiry = pastDate;
      const validated = validateSyncPairConfig(config);
      assertThrows(
        () => checkSyncPairTokenExpiry(validated, logger),
        ConfigError,
        "expired",
        "Expired token",
      );
    }

    console.log("\nTest 13b: Valid future token does not throw");
    {
      const futureDate = new Date(Date.now() + 90 * 86400000).toISOString(); // 90 days from now
      const config = makeValidConfig();
      config.syncPairs[0].source.tokenExpiry = futureDate;
      config.syncPairs[1].source.patExpiry = futureDate;
      const validated = validateSyncPairConfig(config);
      try {
        checkSyncPairTokenExpiry(validated, logger);
        assert(true, "No error thrown for valid future token expiry");
      } catch (err: any) {
        assert(false, `Unexpected error for valid future token: ${err.message}`);
      }
    }
  } finally {
    cleanup();
  }

  // Summary
  console.log(`\n--- Sync Pair Config Tests Summary: ${passCount} passed, ${failCount} failed ---\n`);
}

main().catch((err) => {
  console.error("Unhandled error in test-sync-pair-config.ts:", err);
  process.exitCode = 1;
});
