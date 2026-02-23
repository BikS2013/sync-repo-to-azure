/**
 * Structured result returned by every CLI command.
 * When --json is set, this is serialized to stdout.
 */
export interface CommandResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: CommandError;
  metadata: CommandMetadata;
}

/**
 * Structured error information for machine-readable output.
 */
export interface CommandError {
  /** Machine-readable error code (e.g., "CONFIG_MISSING_REQUIRED") */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Additional context or details */
  details?: unknown;
}

/**
 * Metadata about the command execution.
 */
export interface CommandMetadata {
  /** Command name (e.g., "config show", "upload") */
  command: string;
  /** ISO 8601 timestamp of execution */
  timestamp: string;
  /** Execution time in milliseconds */
  durationMs: number;
}
