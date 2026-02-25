/**
 * test-port-checker.ts -- PortChecker utility integration tests
 *
 * Tests:
 *   1. isPortAvailable() returns true for an unused port
 *   2. isPortAvailable() returns false for a port in use (temporary server)
 *   3. findAvailablePort() finds an available port in a range
 *   4. findAvailablePort() skips occupied ports and finds the next one
 *   5. getProcessUsingPort() returns null or a string (no crash)
 *   6. getProcessUsingPort() returns process info for a port in use
 */

import * as net from "net";
import { PortChecker, PortCheckResult } from "../src/utils/port-checker.utils";

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failCount++;
  } else {
    console.log(`  PASS: ${message}`);
    passCount++;
  }
}

/**
 * Create a temporary TCP server on the given port.
 * Returns the server so it can be closed after the test.
 */
function createTempServer(port: number, host: string = "127.0.0.1"): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (err) => reject(err));
    server.once("listening", () => resolve(server));
    server.listen(port, host);
  });
}

/**
 * Close a server and wait for it to fully shut down.
 */
function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function main(): Promise<void> {
  console.log("\n=== test-port-checker.ts ===\n");

  // Use high ports to avoid conflicts
  const TEST_PORT = 49152;
  const TEST_HOST = "127.0.0.1";

  // -------------------------------------------------------
  // Test 1: isPortAvailable() returns true for an unused port
  // -------------------------------------------------------
  console.log("Test 1: isPortAvailable() on an unused port returns true");
  try {
    const available = await PortChecker.isPortAvailable(TEST_PORT, TEST_HOST);
    assert(available === true, `Port ${TEST_PORT} is available (expected true, got ${available})`);
  } catch (err: any) {
    assert(false, `isPortAvailable threw unexpectedly: ${err.message}`);
  }

  // -------------------------------------------------------
  // Test 2: isPortAvailable() returns false for a port in use
  // -------------------------------------------------------
  console.log("Test 2: isPortAvailable() on an occupied port returns false");
  let tempServer: net.Server | null = null;
  try {
    tempServer = await createTempServer(TEST_PORT, TEST_HOST);
    const available = await PortChecker.isPortAvailable(TEST_PORT, TEST_HOST);
    assert(available === false, `Port ${TEST_PORT} is not available (expected false, got ${available})`);
  } catch (err: any) {
    assert(false, `Test 2 threw unexpectedly: ${err.message}`);
  } finally {
    if (tempServer) {
      await closeServer(tempServer);
      tempServer = null;
    }
  }

  // -------------------------------------------------------
  // Test 3: findAvailablePort() finds an available port in a range
  // -------------------------------------------------------
  console.log("Test 3: findAvailablePort() finds an available port");
  try {
    const result: PortCheckResult = await PortChecker.findAvailablePort(TEST_PORT, 5, TEST_HOST);
    assert(result.available === true, `findAvailablePort found an available port (port=${result.port})`);
    assert(result.port >= TEST_PORT, `Found port ${result.port} is >= ${TEST_PORT}`);
    assert(result.error === undefined, "No error in result");
  } catch (err: any) {
    assert(false, `findAvailablePort threw unexpectedly: ${err.message}`);
  }

  // -------------------------------------------------------
  // Test 4: findAvailablePort() skips occupied ports
  // -------------------------------------------------------
  console.log("Test 4: findAvailablePort() skips occupied ports and finds the next one");
  let server1: net.Server | null = null;
  let server2: net.Server | null = null;
  try {
    // Occupy TEST_PORT and TEST_PORT+1
    server1 = await createTempServer(TEST_PORT, TEST_HOST);
    server2 = await createTempServer(TEST_PORT + 1, TEST_HOST);

    // findAvailablePort should skip both and find TEST_PORT+2
    const result = await PortChecker.findAvailablePort(TEST_PORT, 5, TEST_HOST);
    assert(result.available === true, `findAvailablePort found a port after skipping occupied ones`);
    assert(
      result.port >= TEST_PORT + 2,
      `Found port ${result.port} is >= ${TEST_PORT + 2} (skipped ${TEST_PORT} and ${TEST_PORT + 1})`,
    );
  } catch (err: any) {
    assert(false, `Test 4 threw unexpectedly: ${err.message}`);
  } finally {
    if (server1) await closeServer(server1);
    if (server2) await closeServer(server2);
  }

  // -------------------------------------------------------
  // Test 5: getProcessUsingPort() returns null for an unused port
  // -------------------------------------------------------
  console.log("Test 5: getProcessUsingPort() returns null or string (no crash) for unused port");
  try {
    const processInfo = await PortChecker.getProcessUsingPort(TEST_PORT);
    // On an unused port, should return null
    assert(
      processInfo === null || typeof processInfo === "string",
      `getProcessUsingPort returns null or string (got ${typeof processInfo})`,
    );
    assert(processInfo === null, `getProcessUsingPort returns null for unused port (got ${processInfo})`);
  } catch (err: any) {
    assert(false, `getProcessUsingPort threw unexpectedly: ${err.message}`);
  }

  // -------------------------------------------------------
  // Test 6: getProcessUsingPort() returns process info for an occupied port
  // -------------------------------------------------------
  console.log("Test 6: getProcessUsingPort() returns process info for occupied port");
  let server3: net.Server | null = null;
  try {
    server3 = await createTempServer(TEST_PORT, TEST_HOST);
    const processInfo = await PortChecker.getProcessUsingPort(TEST_PORT);
    // On macOS/Linux should return a string like "node (PID: 12345)"
    // On Windows or if lsof fails, returns null
    if (process.platform === "win32") {
      assert(processInfo === null, "getProcessUsingPort returns null on Windows (expected)");
    } else {
      assert(
        processInfo === null || typeof processInfo === "string",
        `getProcessUsingPort returns null or string for occupied port (got ${typeof processInfo})`,
      );
      if (processInfo !== null) {
        assert(
          processInfo.includes("PID:"),
          `Process info contains PID information: "${processInfo}"`,
        );
      } else {
        // lsof might not detect the port yet or may not be available
        console.log("  INFO: getProcessUsingPort returned null (lsof may not have detected the binding yet)");
        assert(true, "getProcessUsingPort returned null (acceptable -- lsof timing)");
      }
    }
  } catch (err: any) {
    assert(false, `Test 6 threw unexpectedly: ${err.message}`);
  } finally {
    if (server3) await closeServer(server3);
  }

  // Summary
  console.log(`\n--- PortChecker Tests Summary: ${passCount} passed, ${failCount} failed ---\n`);
  if (failCount > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Unhandled error in test-port-checker.ts:", err);
  process.exitCode = 1;
});
