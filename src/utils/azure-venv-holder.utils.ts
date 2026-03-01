import type { SyncResult, BlobContent, FileTreeNode } from "azure-venv";

/**
 * Module-level holder for the azure-venv SyncResult.
 * Populated at app startup and updated by the watcher on blob changes.
 */
let storedResult: SyncResult | null = null;

/** Stop function for the watcher (set when watch mode is active). */
let watchStopFn: (() => void) | null = null;

/**
 * Store the SyncResult returned by initAzureVenv() or watchAzureVenv().
 */
export function setAzureVenvResult(result: SyncResult): void {
  storedResult = result;
}

/**
 * Replace the stored SyncResult when the watcher detects changes.
 */
export function updateAzureVenvResult(result: SyncResult): void {
  storedResult = result;
}

/**
 * Store the stop() function returned by watchAzureVenv() so it can be called during shutdown.
 */
export function setWatchStopFn(stop: () => void): void {
  watchStopFn = stop;
}

/**
 * Stop the azure-venv watcher. Safe to call even if no watcher is active.
 */
export function stopWatch(): void {
  if (watchStopFn) {
    watchStopFn();
    watchStopFn = null;
  }
}

/**
 * Get the current watch status.
 */
export function getWatchStatus(): { watching: boolean } {
  return { watching: watchStopFn !== null };
}

/**
 * Retrieve the stored SyncResult, or null if not yet initialized.
 */
export function getAzureVenvResult(): SyncResult | null {
  return storedResult;
}

/**
 * Find a blob by its relative path (e.g. "sync-settings.json").
 * Returns the BlobContent or undefined if not found / not initialized.
 */
export function findBlob(relativePath: string): BlobContent | undefined {
  return storedResult?.blobs.find((b) => b.relativePath === relativePath);
}

/**
 * Get the file tree, or an empty array if not initialized.
 */
export function getFileTree(): readonly FileTreeNode[] {
  return storedResult?.fileTree ?? [];
}

/**
 * Get a safe (no secret values) introspection snapshot for dev/debug purposes.
 * Returns null if azure-venv was not initialized.
 */
export function getAzureVenvIntrospection(): Record<string, unknown> | null {
  if (!storedResult) return null;

  return {
    attempted: storedResult.attempted,
    totalBlobs: storedResult.totalBlobs,
    downloaded: storedResult.downloaded,
    failed: storedResult.failed,
    failedBlobs: storedResult.failedBlobs,
    durationMs: storedResult.duration,
    remoteEnvLoaded: storedResult.remoteEnvLoaded,
    blobs: storedResult.blobs.map((b) => ({
      relativePath: b.relativePath,
      size: b.size,
      etag: b.etag,
      lastModified: b.lastModified,
    })),
    fileTree: storedResult.fileTree,
    envSources: Object.entries(storedResult.envDetails.sources).map(
      ([key, source]) => ({ key, source }),
    ),
    envTierCounts: {
      os: storedResult.envDetails.osKeys.length,
      remote: storedResult.envDetails.remoteKeys.length,
      local: storedResult.envDetails.localKeys.length,
    },
  };
}
