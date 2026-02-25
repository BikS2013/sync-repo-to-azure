import * as net from "net";
import { exec } from "child_process";

/**
 * Result of a port availability check.
 */
export interface PortCheckResult {
  /** Whether the port is available for binding. */
  available: boolean;
  /** The port number that was checked (or the first available port found). */
  port: number;
  /** Error message if the port search failed. */
  error?: string;
}

/**
 * Utility class for checking TCP port availability and identifying
 * processes using a port. Used by the API server startup to proactively
 * detect port conflicts before Express attempts to listen.
 *
 * All methods are static -- no instantiation needed.
 * No dependencies on project config or services (standalone utility).
 */
export class PortChecker {
  /**
   * Check if a TCP port is available by attempting to bind a temporary server.
   *
   * Creates a `net.Server`, attempts to bind to the port. If binding succeeds,
   * the port is available (the server is immediately closed). If `EADDRINUSE`
   * fires, the port is taken.
   *
   * @param port - The port number to check.
   * @param host - The host to bind to (default: "localhost").
   * @returns true if the port is available, false if it is in use.
   */
  static async isPortAvailable(port: number, host: string = "localhost"): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();

      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          resolve(false);
        } else {
          // Other errors (permission denied, etc.) -- treat as unavailable
          resolve(false);
        }
      });

      server.once("listening", () => {
        server.close(() => {
          resolve(true);
        });
      });

      server.listen(port, host);
    });
  }

  /**
   * Sequentially scan ports starting from startPort to find an available one.
   *
   * Tests each port in order: startPort, startPort+1, ..., startPort+maxAttempts-1.
   * Returns the first available port found, or an error if none are available.
   *
   * @param startPort - The first port to try.
   * @param maxAttempts - Maximum number of ports to scan (default: 10).
   * @param host - The host to bind to (default: "localhost").
   * @returns A PortCheckResult with the first available port or an error.
   */
  static async findAvailablePort(
    startPort: number,
    maxAttempts: number = 10,
    host: string = "localhost",
  ): Promise<PortCheckResult> {
    let currentPort = startPort;

    for (let i = 0; i < maxAttempts; i++) {
      const isAvailable = await PortChecker.isPortAvailable(currentPort, host);
      if (isAvailable) {
        return { available: true, port: currentPort };
      }
      process.stderr.write(`[WARN] Port ${currentPort} is in use, trying next...\n`);
      currentPort++;
    }

    return {
      available: false,
      port: startPort,
      error: `Could not find an available port after ${maxAttempts} attempts (${startPort}-${startPort + maxAttempts - 1})`,
    };
  }

  /**
   * Use lsof to identify which process is using a port.
   *
   * macOS/Linux only. Returns null on Windows, on failure, or if no process
   * is found listening on the port. This is purely informational -- failure
   * does not affect the port check logic.
   *
   * @param port - The port to look up.
   * @returns A string like "node (PID: 12345)" or null.
   */
  static async getProcessUsingPort(port: number): Promise<string | null> {
    // lsof is not available on Windows
    if (process.platform === "win32") {
      return null;
    }

    return new Promise((resolve) => {
      exec(
        `lsof -i :${port} | grep LISTEN | head -1`,
        { timeout: 5000 },
        (error, stdout) => {
          if (error || !stdout.trim()) {
            resolve(null);
            return;
          }

          const parts = stdout.trim().split(/\s+/);
          const command = parts[0];
          const pid = parts[1];
          if (command && pid) {
            resolve(`${command} (PID: ${pid})`);
          } else {
            resolve(null);
          }
        },
      );
    });
  }
}
