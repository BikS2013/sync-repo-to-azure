import { AzureFsError } from "./base.error";

/**
 * Error thrown when a blob path is invalid, empty, or too long.
 */
export class PathError extends AzureFsError {
  constructor(code: string, message: string, details?: unknown) {
    super(code, message, undefined, details);
    this.name = "PathError";
  }

  /**
   * Factory: path is empty after normalization.
   */
  static emptyPath(): PathError {
    return new PathError(
      "PATH_EMPTY",
      "Blob path is empty after normalization. Provide a non-empty path.",
    );
  }

  /**
   * Factory: path exceeds the 1024-character limit.
   */
  static tooLong(path: string): PathError {
    return new PathError(
      "PATH_TOO_LONG",
      `Blob path exceeds 1024 characters: ${path.length} characters provided.`,
      { pathLength: path.length },
    );
  }

  /**
   * Factory: path contains invalid segments (e.g., ".." that escapes root).
   */
  static invalidPath(path: string, reason: string): PathError {
    return new PathError(
      "PATH_INVALID",
      `Invalid blob path "${path}": ${reason}`,
      { path, reason },
    );
  }

  /**
   * Factory: local file not found on disk.
   */
  static localFileNotFound(filePath: string): PathError {
    return new PathError(
      "PATH_LOCAL_FILE_NOT_FOUND",
      `Local file not found: ${filePath}`,
      { path: filePath },
    );
  }
}
