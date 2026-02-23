import { AzureFsError } from "./base.error";

/**
 * Error thrown when a blob is not found at the specified path.
 */
export class BlobNotFoundError extends AzureFsError {
  constructor(blobPath: string, details?: unknown) {
    super(
      "BLOB_NOT_FOUND",
      `Blob not found: "${blobPath}". Verify the path and ensure the file exists.`,
      404,
      details ?? { path: blobPath },
    );
    this.name = "BlobNotFoundError";
  }
}
