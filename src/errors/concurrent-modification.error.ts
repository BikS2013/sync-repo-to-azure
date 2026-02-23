import { AzureFsError } from "./base.error";

/**
 * Error thrown when an ETag-based conditional write fails because
 * the blob was modified by another process between download and re-upload.
 */
export class ConcurrentModificationError extends AzureFsError {
  constructor(blobPath: string, expectedEtag: string, details?: unknown) {
    super(
      "CONCURRENT_MODIFICATION",
      `Concurrent modification detected for "${blobPath}". ` +
        `The blob was modified after it was downloaded (expected ETag: ${expectedEtag}). ` +
        `Retry the operation to get the latest version.`,
      412,
      details ?? { path: blobPath, expectedEtag },
    );
    this.name = "ConcurrentModificationError";
  }
}
