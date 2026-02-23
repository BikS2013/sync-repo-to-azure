/**
 * Information about a blob (file) in Azure Blob Storage.
 */
export interface FileInfo {
  /** Full blob path within the container */
  path: string;
  /** File name (last segment of the path) */
  name: string;
  /** Size in bytes */
  size: number;
  /** MIME content type */
  contentType: string;
  /** Creation timestamp (ISO 8601) */
  createdOn?: string;
  /** Last modified timestamp (ISO 8601) */
  lastModified: string;
  /** ETag for conditional operations */
  etag: string;
  /** User-defined metadata key-value pairs */
  metadata: Record<string, string>;
  /** Blob index tags */
  tags?: Record<string, string>;
}

/**
 * Result of an upload operation.
 */
export interface UploadResult {
  /** Remote blob path */
  path: string;
  /** Size in bytes */
  size: number;
  /** MIME content type that was set */
  contentType: string;
  /** ETag of the uploaded blob */
  etag: string;
  /** Metadata that was set on the blob */
  metadata?: Record<string, string>;
}

/**
 * Result of a download operation.
 */
export interface DownloadResult {
  /** Remote blob path */
  path: string;
  /** Content as string (present when no localPath was given) */
  content?: string;
  /** Local file path (present when localPath was given) */
  localPath?: string;
  /** Size in bytes */
  size: number;
  /** MIME content type */
  contentType: string;
}

/**
 * Result of a delete operation.
 */
export interface DeleteResult {
  /** Remote blob path */
  path: string;
  /** Whether the blob was successfully deleted */
  deleted: boolean;
}

/**
 * Result of an existence check.
 */
export interface ExistsResult {
  /** Remote path that was checked */
  path: string;
  /** Whether the path exists */
  exists: boolean;
  /** Type of entity found (file, folder, or unknown) */
  type: "file" | "folder" | "unknown";
}

// --- Folder operation types ---

/**
 * A single item (file or folder) in a folder listing.
 */
export interface ListItem {
  /** Relative name (last segment, not the full path) */
  name: string;
  /** Full blob path within the container */
  path: string;
  /** Size in bytes (only for files) */
  size?: number;
  /** MIME content type (only for files) */
  contentType?: string;
  /** Last modified timestamp ISO 8601 (only for files) */
  lastModified?: string;
}

/**
 * Result of a createFolder operation.
 */
export interface CreateFolderResult {
  /** Normalized folder path (with trailing slash) */
  path: string;
  /** Whether the folder was newly created */
  created: boolean;
}

/**
 * Result of a listFolder operation.
 */
export interface ListFolderResult {
  /** Normalized folder path that was listed */
  path: string;
  /** Files found at this level */
  files: ListItem[];
  /** Subfolders found at this level */
  folders: ListItem[];
}

/**
 * Result of a deleteFolder operation.
 */
export interface DeleteFolderResult {
  /** Normalized folder path that was deleted */
  path: string;
  /** Number of blobs deleted */
  deletedCount: number;
}

// --- Batch upload types ---

/**
 * Per-file result within a directory upload operation.
 */
export interface UploadDirectoryFileResult {
  /** Relative local file path */
  localPath: string;
  /** Remote blob path */
  remotePath: string;
  /** File size in bytes */
  size: number;
  /** Upload duration in milliseconds */
  durationMs: number;
  /** Whether the upload succeeded */
  success: boolean;
  /** Error message if upload failed */
  error?: string;
}

/**
 * Aggregate result of an uploadDirectory operation.
 */
export interface UploadDirectoryResult {
  /** Local directory that was uploaded */
  localDir: string;
  /** Remote prefix used for the upload */
  remotePrefix: string;
  /** Total number of files discovered */
  totalFiles: number;
  /** Number of successfully uploaded files */
  successCount: number;
  /** Number of failed uploads */
  failedCount: number;
  /** Total bytes uploaded (sum of file sizes) */
  totalBytes: number;
  /** Total wall-clock duration in milliseconds */
  totalDurationMs: number;
  /** Per-file upload results */
  files: UploadDirectoryFileResult[];
}
