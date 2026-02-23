import { MetadataError } from "../errors/metadata.error";

/**
 * Regex for valid metadata key names.
 * Must start with a letter or underscore, followed by letters, digits, or underscores.
 */
const METADATA_KEY_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Maximum total size in bytes for all metadata key-value pairs on a single blob. */
const METADATA_MAX_SIZE_BYTES = 8192;

/** Maximum number of blob index tags per blob. */
const MAX_TAGS_PER_BLOB = 10;

/**
 * Validate a single metadata key name.
 * Throws MetadataError.invalidKeyName if the key does not match the allowed pattern.
 */
export function validateMetadataKey(key: string): void {
  if (!METADATA_KEY_PATTERN.test(key)) {
    throw MetadataError.invalidKeyName(key);
  }
}

/**
 * Validate the total byte size of a metadata record.
 * Size is calculated as the sum of UTF-8 byte lengths of all keys and values.
 * Throws MetadataError.totalSizeExceeded if the total exceeds 8192 bytes.
 */
export function validateMetadataSize(metadata: Record<string, string>): void {
  let totalSize = 0;
  for (const [key, value] of Object.entries(metadata)) {
    totalSize += Buffer.byteLength(key, "utf-8");
    totalSize += Buffer.byteLength(value, "utf-8");
  }

  if (totalSize > METADATA_MAX_SIZE_BYTES) {
    throw MetadataError.totalSizeExceeded(totalSize, METADATA_MAX_SIZE_BYTES);
  }
}

/**
 * Validate the number of blob index tags.
 * Throws MetadataError.tooManyTags if the count exceeds 10.
 */
export function validateTagCount(tags: Record<string, string>): void {
  const count = Object.keys(tags).length;
  if (count > MAX_TAGS_PER_BLOB) {
    throw MetadataError.tooManyTags(count, MAX_TAGS_PER_BLOB);
  }
}
