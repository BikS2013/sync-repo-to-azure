import { CommandResult, CommandError, CommandMetadata } from "../types/command-result.types";
import { AzureFsError } from "../errors/base.error";

/**
 * Create a success CommandResult.
 */
export function formatSuccess<T>(
  data: T,
  command: string,
  startTime: number,
): CommandResult<T> {
  return {
    success: true,
    data,
    metadata: createMetadata(command, startTime),
  };
}

/**
 * Create an error CommandResult.
 */
export function formatError(
  code: string,
  message: string,
  command: string,
  startTime: number,
  details?: unknown,
): CommandResult<never> {
  return {
    success: false,
    error: { code, message, details },
    metadata: createMetadata(command, startTime),
  };
}

/**
 * Create an error CommandResult from an Error or AzureFsError instance.
 */
export function formatErrorFromException(
  err: unknown,
  command: string,
  startTime: number,
): CommandResult<never> {
  if (err instanceof AzureFsError) {
    return {
      success: false,
      error: err.toJSON() as CommandError,
      metadata: createMetadata(command, startTime),
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  return formatError("UNKNOWN_ERROR", message, command, startTime);
}

/**
 * Output a CommandResult to stdout.
 * When jsonMode is true, outputs JSON.stringify with indentation.
 * When jsonMode is false, outputs human-readable formatted text.
 */
export function outputResult<T>(result: CommandResult<T>, jsonMode: boolean): void {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    if (result.success) {
      if (result.data !== undefined && result.data !== null) {
        if (typeof result.data === "object") {
          // Pretty-print objects for human consumption
          printObject(result.data as Record<string, unknown>, 0);
        } else {
          process.stdout.write(String(result.data) + "\n");
        }
      }
    } else {
      // Errors go to stderr in human-readable mode
      if (result.error) {
        process.stderr.write(`Error [${result.error.code}]: ${result.error.message}\n`);
        if (result.error.details) {
          process.stderr.write(
            `Details: ${JSON.stringify(result.error.details, null, 2)}\n`,
          );
        }
      }
    }
  }
}

/**
 * Helper: print a plain object in a human-readable indented format.
 */
function printObject(obj: Record<string, unknown>, indent: number): void {
  const prefix = "  ".repeat(indent);
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      continue;
    }
    if (typeof value === "object" && !Array.isArray(value)) {
      process.stdout.write(`${prefix}${key}:\n`);
      printObject(value as Record<string, unknown>, indent + 1);
    } else if (Array.isArray(value)) {
      process.stdout.write(`${prefix}${key}: ${JSON.stringify(value)}\n`);
    } else {
      process.stdout.write(`${prefix}${key}: ${value}\n`);
    }
  }
}

/**
 * Create CommandMetadata with timing info.
 */
function createMetadata(command: string, startTime: number): CommandMetadata {
  return {
    command,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startTime,
  };
}
