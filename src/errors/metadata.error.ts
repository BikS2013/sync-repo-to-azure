import { AzureFsError } from "./base.error";
import { MetadataErrorCode } from "../types/errors.types";

/**
 * Error thrown for metadata and tag validation failures.
 */
export class MetadataError extends AzureFsError {
  constructor(code: string, message: string, details?: unknown) {
    super(code, message, 400, details);
    this.name = "MetadataError";
  }

  /**
   * Factory: metadata key name does not match the allowed pattern.
   * Valid keys must start with a letter or underscore, followed by
   * letters, digits, or underscores.
   */
  static invalidKeyName(key: string): MetadataError {
    return new MetadataError(
      MetadataErrorCode.INVALID_KEY,
      `Invalid metadata key: "${key}". Keys must match /^[a-zA-Z_][a-zA-Z0-9_]*$/.`,
      { key },
    );
  }

  /**
   * Factory: total size of all metadata key-value pairs exceeds the limit.
   */
  static totalSizeExceeded(size: number, max: number): MetadataError {
    return new MetadataError(
      MetadataErrorCode.SIZE_EXCEEDED,
      `Metadata total size ${size} bytes exceeds the maximum of ${max} bytes.`,
      { size, max },
    );
  }

  /**
   * Factory: the number of blob index tags exceeds the per-blob limit.
   */
  static tooManyTags(count: number, max: number): MetadataError {
    return new MetadataError(
      MetadataErrorCode.MAX_TAGS_EXCEEDED,
      `Tag count ${count} exceeds the maximum of ${max} tags per blob.`,
      { count, max },
    );
  }
}
