/**
 * Types for edit, patch, and append operations on blobs.
 * All edit operations follow the download-modify-reupload pattern
 * with ETag-based conditional writes for concurrency safety.
 */

/**
 * A single find-replace instruction for the patch command.
 */
export interface PatchInstruction {
  /** The text or regex pattern to find. */
  find: string;
  /** The replacement text. */
  replace: string;
  /** Whether `find` should be treated as a regular expression. */
  isRegex?: boolean;
  /** Regex flags (e.g., "g", "gi"). Only used when isRegex is true. */
  flags?: string;
}

/**
 * Result of applying a single PatchInstruction.
 */
export interface PatchInstructionResult {
  /** The find pattern that was used. */
  find: string;
  /** Number of matches found in the content. */
  matchCount: number;
  /** Whether the patch was successfully applied. */
  applied: boolean;
  /** Error message if the patch failed. */
  error?: string;
}

/**
 * Result of applying all patches to a file.
 */
export interface PatchResult {
  /** Remote blob path. */
  path: string;
  /** Number of patches that found at least one match. */
  matchCount: number;
  /** Number of patches that were successfully applied. */
  appliedCount: number;
  /** Per-instruction results. */
  patches: PatchInstructionResult[];
  /** Original file size in bytes. */
  originalSize: number;
  /** New file size in bytes after patching. */
  newSize: number;
  /** ETag of the newly uploaded blob. */
  etag: string;
}

/**
 * Result of the editFile operation (download to temp for external editing).
 */
export interface EditResult {
  /** Remote blob path. */
  path: string;
  /** Local temp file path where the blob was downloaded. */
  tempPath: string;
  /** File size in bytes. */
  size: number;
  /** Content type of the blob. */
  contentType: string;
  /** ETag of the blob at download time (used for conditional re-upload). */
  etag: string;
}

/**
 * Result of re-uploading an edited file with ETag concurrency check.
 */
export interface EditUploadResult {
  /** Remote blob path. */
  path: string;
  /** New file size in bytes. */
  size: number;
  /** New ETag after upload. */
  etag: string;
  /** The ETag that was used for the conditional upload (the previous ETag). */
  previousEtag: string;
}

/**
 * Result of appending or prepending content to a blob.
 */
export interface AppendResult {
  /** Remote blob path. */
  path: string;
  /** Position where content was added. */
  position: "start" | "end";
  /** Number of bytes added. */
  addedLength: number;
  /** New total file size in bytes. */
  newSize: number;
  /** Original file size in bytes. */
  originalSize: number;
  /** ETag of the newly uploaded blob. */
  etag: string;
}
