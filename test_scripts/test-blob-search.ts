/**
 * test-blob-search.ts — BlobSearchService and BlobSearchError tests
 *
 * Tests:
 *   - validateParams: throws when no search params provided
 *   - validateParams: throws for invalid ISO date in syncTimeFrom
 *   - validateParams: throws for invalid ISO date in syncTimeTo
 *   - validateParams: throws for maxResults < 1 or > 5000
 *   - validateParams: accepts valid params without throwing
 *   - buildFilterQuery: single param source_registry only
 *   - buildFilterQuery: multiple params source_registry + sourcePath
 *   - buildFilterQuery: date range with syncTimeFrom + syncTimeTo
 *   - buildFilterQuery: containerName filter
 *   - buildFilterQuery: all params combined
 *   - escapeTagValue: normal strings pass through unchanged
 *   - escapeTagValue: single quotes are doubled
 *   - escapeTagValue: multiple quotes handled correctly
 *   - BlobSearchError.missingParams creates error with MISSING_PARAMS code
 *   - BlobSearchError.invalidParam creates error with INVALID_PARAM code
 *   - BlobSearchError.searchFailed creates error with SEARCH_FAILED code and wraps cause
 *   - BlobSearchError.authMissing creates error with AUTH_MISSING code
 *   - All errors are instances of BlobSearchError and AzureFsError
 *
 * Run: npx ts-node test_scripts/test-blob-search.ts
 */

import { BlobSearchService, BlobSearchParams } from "../src/services/blob-search.service";
import { BlobSearchError } from "../src/errors/blob-search.error";
import { AzureFsError } from "../src/errors/base.error";
import { BlobSearchErrorCode } from "../src/types/errors.types";
import { Logger } from "../src/utils/logger.utils";
import type { LogLevel } from "../src/types/config.types";

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

// -- Helper: create a BlobSearchService with a mock BlobServiceClient --

function createService(): BlobSearchService {
  // We only need the service for testing private methods via the public searchByTags.
  // For unit tests of validateParams/buildFilterQuery/escapeTagValue, we create an
  // instance with a dummy BlobServiceClient (never actually called for these tests).
  const mockBlobServiceClient = {} as any;
  const level: LogLevel = "error";
  const logger = new Logger(level, false);
  return new BlobSearchService(mockBlobServiceClient, logger);
}

// -- Helper: expose private methods for testing via prototype access --

function callValidateParams(service: BlobSearchService, params: BlobSearchParams): void {
  // Access private method via bracket notation
  (service as any).validateParams(params);
}

function callBuildFilterQuery(service: BlobSearchService, params: BlobSearchParams): string {
  return (service as any).buildFilterQuery(params);
}

function callEscapeTagValue(service: BlobSearchService, value: string): string {
  return (service as any).escapeTagValue(value);
}

// =============================================================================
// Tests
// =============================================================================

async function main(): Promise<void> {
  console.log("\n=== test-blob-search.ts ===\n");

  const service = createService();

  // -------------------------------------------------------------------------
  // Section 1: validateParams
  // -------------------------------------------------------------------------
  console.log("--- validateParams ---");

  // Test 1: Throws when no search params provided (all undefined)
  console.log("Test 1: Throws when no search params provided");
  assertThrows(
    () => callValidateParams(service, {}),
    BlobSearchError,
    "At least one of",
    "No params",
  );

  // Test 2: Throws for invalid ISO date in syncTimeFrom
  console.log("Test 2: Throws for invalid syncTimeFrom date");
  assertThrows(
    () => callValidateParams(service, { syncTimeFrom: "not-a-date" }),
    BlobSearchError,
    "syncTimeFrom",
    "Invalid syncTimeFrom",
  );

  // Test 3: Throws for invalid ISO date in syncTimeTo
  console.log("Test 3: Throws for invalid syncTimeTo date");
  assertThrows(
    () => callValidateParams(service, { syncTimeTo: "garbage" }),
    BlobSearchError,
    "syncTimeTo",
    "Invalid syncTimeTo",
  );

  // Test 4a: Throws for maxResults < 1
  console.log("Test 4a: Throws for maxResults < 1");
  assertThrows(
    () => callValidateParams(service, { sourceRegistry: "github", maxResults: 0 }),
    BlobSearchError,
    "maxResults",
    "maxResults < 1",
  );

  // Test 4b: Throws for maxResults > 5000
  console.log("Test 4b: Throws for maxResults > 5000");
  assertThrows(
    () => callValidateParams(service, { sourceRegistry: "github", maxResults: 5001 }),
    BlobSearchError,
    "maxResults",
    "maxResults > 5000",
  );

  // Test 5: Accepts valid params without throwing
  console.log("Test 5: Accepts valid params without throwing");
  try {
    callValidateParams(service, {
      sourceRegistry: "github",
      syncTimeFrom: "2025-01-01T00:00:00Z",
      syncTimeTo: "2025-12-31T23:59:59Z",
      maxResults: 100,
    });
    assert(true, "Valid params do not throw");
  } catch (err: any) {
    assert(false, `Valid params should not throw but got: ${err.message}`);
  }

  // Test 5b: Accepts params with only sourcePath
  console.log("Test 5b: Accepts params with only sourcePath");
  try {
    callValidateParams(service, { sourcePath: "owner/repo" });
    assert(true, "sourcePath-only params do not throw");
  } catch (err: any) {
    assert(false, `sourcePath-only should not throw but got: ${err.message}`);
  }

  // -------------------------------------------------------------------------
  // Section 2: buildFilterQuery
  // -------------------------------------------------------------------------
  console.log("\n--- buildFilterQuery ---");

  // Test 6: Single param: source_registry only
  console.log("Test 6: Single param source_registry");
  {
    const query = callBuildFilterQuery(service, { sourceRegistry: "github" });
    assert(
      query === `"source_registry" = 'github'`,
      `Query is correct (got: ${query})`,
    );
  }

  // Test 7: Multiple params: source_registry + sourcePath joined with AND
  console.log("Test 7: Multiple params source_registry + sourcePath");
  {
    const query = callBuildFilterQuery(service, {
      sourceRegistry: "github",
      sourcePath: "owner/repo",
    });
    const expected = `"source_registry" = 'github' AND "source_path" = 'owner/repo'`;
    assert(
      query === expected,
      `Query has AND join (got: ${query})`,
    );
  }

  // Test 8: Date range: syncTimeFrom + syncTimeTo
  console.log("Test 8: Date range syncTimeFrom + syncTimeTo");
  {
    const query = callBuildFilterQuery(service, {
      syncTimeFrom: "2025-01-01T00:00:00Z",
      syncTimeTo: "2025-12-31T23:59:59Z",
    });
    const expected = `"sync_time" >= '2025-01-01T00:00:00Z' AND "sync_time" <= '2025-12-31T23:59:59Z'`;
    assert(
      query === expected,
      `Date range query correct (got: ${query})`,
    );
  }

  // Test 9: Container filter: containerName
  console.log("Test 9: Container filter containerName");
  {
    const query = callBuildFilterQuery(service, {
      sourceRegistry: "github",
      containerName: "my-container",
    });
    const expected = `"source_registry" = 'github' AND @container = 'my-container'`;
    assert(
      query === expected,
      `Container filter correct (got: ${query})`,
    );
  }

  // Test 10: All params combined
  console.log("Test 10: All params combined");
  {
    const query = callBuildFilterQuery(service, {
      sourceRegistry: "azure-devops",
      sourcePath: "project/repo",
      syncTimeFrom: "2025-06-01T00:00:00Z",
      syncTimeTo: "2025-06-30T23:59:59Z",
      containerName: "backups",
    });
    const expected =
      `"source_registry" = 'azure-devops' AND ` +
      `"source_path" = 'project/repo' AND ` +
      `"sync_time" >= '2025-06-01T00:00:00Z' AND ` +
      `"sync_time" <= '2025-06-30T23:59:59Z' AND ` +
      `@container = 'backups'`;
    assert(
      query === expected,
      `All params combined query correct (got: ${query})`,
    );
  }

  // -------------------------------------------------------------------------
  // Section 3: escapeTagValue
  // -------------------------------------------------------------------------
  console.log("\n--- escapeTagValue ---");

  // Test 11: Normal strings pass through unchanged
  console.log("Test 11: Normal strings pass through unchanged");
  {
    const result = callEscapeTagValue(service, "hello-world");
    assert(result === "hello-world", `Normal string unchanged (got: ${result})`);
  }

  // Test 12: Single quotes are doubled
  console.log("Test 12: Single quotes are doubled");
  {
    const result = callEscapeTagValue(service, "it's");
    assert(result === "it''s", `Single quote doubled (got: ${result})`);
  }

  // Test 13: Multiple quotes handled correctly
  console.log("Test 13: Multiple quotes handled correctly");
  {
    const result = callEscapeTagValue(service, "it's a 'test'");
    assert(result === "it''s a ''test''", `Multiple quotes doubled (got: ${result})`);
  }

  // -------------------------------------------------------------------------
  // Section 4: BlobSearchError factory methods
  // -------------------------------------------------------------------------
  console.log("\n--- BlobSearchError factory methods ---");

  // Test 14: missingParams creates error with MISSING_PARAMS code
  console.log("Test 14: missingParams factory");
  {
    const err = BlobSearchError.missingParams("test detail");
    assert(err instanceof BlobSearchError, "Is BlobSearchError instance");
    assert(err instanceof AzureFsError, "Is AzureFsError instance");
    assert(err.code === BlobSearchErrorCode.MISSING_PARAMS, `Code is MISSING_PARAMS (got: ${err.code})`);
    assert(err.statusCode === 400, `Status code is 400 (got: ${err.statusCode})`);
    assert(err.message.includes("test detail"), `Message contains detail (got: ${err.message})`);
  }

  // Test 15: invalidParam creates error with INVALID_PARAM code
  console.log("Test 15: invalidParam factory");
  {
    const err = BlobSearchError.invalidParam("syncTimeFrom", "bad date");
    assert(err instanceof BlobSearchError, "Is BlobSearchError instance");
    assert(err instanceof AzureFsError, "Is AzureFsError instance");
    assert(err.code === BlobSearchErrorCode.INVALID_PARAM, `Code is INVALID_PARAM (got: ${err.code})`);
    assert(err.statusCode === 400, `Status code is 400 (got: ${err.statusCode})`);
    assert(err.message.includes("syncTimeFrom"), `Message contains param name (got: ${err.message})`);
    assert((err.details as any)?.param === "syncTimeFrom", `Details contains param field`);
  }

  // Test 16: searchFailed creates error with SEARCH_FAILED code and wraps cause
  console.log("Test 16: searchFailed factory");
  {
    const cause = new Error("network timeout");
    const err = BlobSearchError.searchFailed("connection lost", cause);
    assert(err instanceof BlobSearchError, "Is BlobSearchError instance");
    assert(err instanceof AzureFsError, "Is AzureFsError instance");
    assert(err.code === BlobSearchErrorCode.SEARCH_FAILED, `Code is SEARCH_FAILED (got: ${err.code})`);
    assert(err.statusCode === 500, `Status code is 500 (got: ${err.statusCode})`);
    assert(err.message.includes("connection lost"), `Message contains detail (got: ${err.message})`);
    assert(
      (err.details as any)?.cause === "network timeout",
      `Details wraps cause message (got: ${JSON.stringify(err.details)})`,
    );
  }

  // Test 16b: searchFailed without cause
  console.log("Test 16b: searchFailed without cause");
  {
    const err = BlobSearchError.searchFailed("unknown error");
    assert(err.code === BlobSearchErrorCode.SEARCH_FAILED, `Code is SEARCH_FAILED`);
    assert(err.details === undefined, `Details is undefined when no cause`);
  }

  // Test 17: authMissing creates error with AUTH_MISSING code
  console.log("Test 17: authMissing factory");
  {
    const err = BlobSearchError.authMissing();
    assert(err instanceof BlobSearchError, "Is BlobSearchError instance");
    assert(err instanceof AzureFsError, "Is AzureFsError instance");
    assert(err.code === BlobSearchErrorCode.AUTH_MISSING, `Code is AUTH_MISSING (got: ${err.code})`);
    assert(err.statusCode === 401, `Status code is 401 (got: ${err.statusCode})`);
    assert(err.message.includes("authentication"), `Message mentions authentication`);
  }

  // Test 18: All error instances are also Error instances
  console.log("Test 18: All errors are Error instances");
  {
    const errors = [
      BlobSearchError.missingParams("x"),
      BlobSearchError.invalidParam("p", "d"),
      BlobSearchError.searchFailed("f"),
      BlobSearchError.authMissing(),
    ];
    for (const err of errors) {
      assert(err instanceof Error, `${err.code} is instance of Error`);
      assert(err instanceof AzureFsError, `${err.code} is instance of AzureFsError`);
      assert(err instanceof BlobSearchError, `${err.code} is instance of BlobSearchError`);
      assert(err.name === "BlobSearchError", `${err.code} has name BlobSearchError (got: ${err.name})`);
    }
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log(`\n--- Blob Search Tests Summary: ${passCount} passed, ${failCount} failed ---\n`);
}

main().catch((err) => {
  console.error("Unhandled error in test-blob-search.ts:", err);
  process.exitCode = 1;
});
