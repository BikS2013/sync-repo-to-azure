import { LogLevel } from "../types/config.types";

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Simple logger with verbose mode support.
 * Logs to stderr to keep stdout clean for command output (especially in --json mode).
 */
export class Logger {
  private level: LogLevel;
  private verbose: boolean;

  constructor(level: LogLevel, verbose: boolean = false) {
    this.level = level;
    this.verbose = verbose;

    // When verbose mode is on, force debug level
    if (this.verbose) {
      this.level = "debug";
    }
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log("warn", message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log("error", message, data);
  }

  /**
   * Log an Azure SDK request (omitting file content).
   * Use this for request logging when logRequests is enabled.
   */
  logRequest(operation: string, params: Record<string, unknown>): void {
    // Filter out content/data bodies from params
    const sanitized = { ...params };
    for (const key of ["content", "data", "body", "buffer"]) {
      if (key in sanitized) {
        sanitized[key] = "[omitted]";
      }
    }
    this.debug(`Azure request: ${operation}`, sanitized);
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[this.level]) {
      return;
    }

    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    let line = `${prefix} ${message}`;

    if (data && Object.keys(data).length > 0) {
      line += ` ${JSON.stringify(data)}`;
    }

    process.stderr.write(line + "\n");
  }
}

/**
 * Create a "no-op" logger that does not output anything.
 * Useful when config has not been loaded yet.
 */
export class NullLogger extends Logger {
  constructor() {
    super("error", false);
  }

  override debug(): void { /* no-op */ }
  override info(): void { /* no-op */ }
  override warn(): void { /* no-op */ }
  override error(): void { /* no-op */ }
  override logRequest(): void { /* no-op */ }
}
