import { AzureFsError } from "../errors/base.error";
import { ConfigError } from "../errors/config.error";
import { AuthError } from "../errors/auth.error";
import { PathError } from "../errors/path.error";
import { MetadataError } from "../errors/metadata.error";

/**
 * Process exit codes for the azure-fs CLI.
 *
 *   0 = success (default)
 *   1 = operation error (blob not found, network error, concurrent modification, etc.)
 *   2 = config/auth error (missing config, invalid auth)
 *   3 = validation error (invalid path, metadata limits exceeded)
 */
export const ExitCode = {
  SUCCESS: 0,
  OPERATION_ERROR: 1,
  CONFIG_ERROR: 2,
  VALIDATION_ERROR: 3,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * Determine the appropriate exit code for a given error.
 */
export function exitCodeForError(err: unknown): ExitCodeValue {
  if (err instanceof ConfigError) {
    return ExitCode.CONFIG_ERROR;
  }
  if (err instanceof AuthError) {
    return ExitCode.CONFIG_ERROR;
  }
  if (err instanceof PathError) {
    return ExitCode.VALIDATION_ERROR;
  }
  if (err instanceof MetadataError) {
    return ExitCode.VALIDATION_ERROR;
  }
  if (err instanceof AzureFsError) {
    return ExitCode.OPERATION_ERROR;
  }
  return ExitCode.OPERATION_ERROR;
}
