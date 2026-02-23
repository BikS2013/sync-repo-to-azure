import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ContainerClient } from "@azure/storage-blob";
import { ResolvedConfig } from "../types/config.types";
import {
  FileInfo,
  UploadResult,
  DownloadResult,
  DeleteResult,
  ExistsResult,
  CreateFolderResult,
  ListFolderResult,
  ListItem,
  DeleteFolderResult,
  UploadDirectoryResult,
  UploadDirectoryFileResult,
} from "../types/filesystem.types";
import {
  PatchInstruction,
  PatchInstructionResult,
  PatchResult,
  EditResult,
  EditUploadResult,
  AppendResult,
} from "../types/patch.types";
import { createContainerClient } from "./auth.service";
import { validatePath, validateFolderPath, getFileName } from "./path.service";
import { BlobNotFoundError } from "../errors/blob-not-found.error";
import { ConcurrentModificationError } from "../errors/concurrent-modification.error";
import { PathError } from "../errors/path.error";
import { detectContentType } from "../utils/content-type.utils";
import { streamToString, isLargeFile } from "../utils/stream.utils";
import { withRetry, retryConfigFromResolved, RetryConfig } from "../utils/retry.utils";
import { Logger } from "../utils/logger.utils";
import { parallelLimit } from "../utils/concurrency.utils";

/**
 * Core service class for Azure Blob Storage file operations.
 *
 * Wraps all blob operations behind a file-system-oriented API.
 * Every method:
 *   - Accepts and normalizes paths via PathService
 *   - Returns typed results from filesystem.types
 *   - Throws custom errors (BlobNotFoundError, PathError)
 *   - Supports the configured retry strategy
 *   - Logs requests (omitting file content)
 */
export class BlobFileSystemService {
  private containerClient: ContainerClient;
  private retryConfig: RetryConfig;
  private logger: Logger;

  constructor(config: ResolvedConfig, logger: Logger) {
    this.containerClient = createContainerClient(config);
    this.retryConfig = retryConfigFromResolved(config);
    this.logger = logger;
  }

  /**
   * Upload content or a local file to blob storage.
   *
   * @param remotePath Remote blob path
   * @param source Local file path (string path to a file on disk) or content (Buffer or string content)
   * @param metadata Optional user-defined metadata
   */
  async uploadFile(
    remotePath: string,
    source: string | Buffer,
    metadata?: Record<string, string>,
  ): Promise<UploadResult> {
    const normalizedPath = validatePath(remotePath);
    const blockBlobClient = this.containerClient.getBlockBlobClient(normalizedPath);
    const contentType = detectContentType(normalizedPath);

    this.logger.logRequest("uploadFile", {
      remotePath: normalizedPath,
      contentType,
      metadata,
    });

    return withRetry(async () => {
      let size: number;
      let etag: string;

      if (typeof source === "string" && fs.existsSync(source)) {
        // Source is a local file path
        const localFilePath = path.resolve(source);
        if (!fs.existsSync(localFilePath)) {
          throw PathError.localFileNotFound(localFilePath);
        }

        const stats = fs.statSync(localFilePath);
        size = stats.size;

        this.logger.logRequest("uploadFile.SDK", {
          method: isLargeFile(localFilePath) ? "uploadStream" : "uploadFile",
          localPath: localFilePath,
          size,
        });

        if (isLargeFile(localFilePath)) {
          // Streaming upload for large files (> 100 MB)
          const readStream = fs.createReadStream(localFilePath);
          const response = await blockBlobClient.uploadStream(
            readStream,
            4 * 1024 * 1024, // 4 MB buffer size
            20, // max concurrency
            {
              blobHTTPHeaders: { blobContentType: contentType },
              metadata,
            },
          );
          etag = response.etag ?? "";
        } else {
          const response = await blockBlobClient.uploadFile(localFilePath, {
            blobHTTPHeaders: { blobContentType: contentType },
            metadata,
          });
          etag = response.etag ?? "";
        }
      } else {
        // Source is content (string or Buffer)
        const buffer = Buffer.isBuffer(source)
          ? source
          : Buffer.from(source as string, "utf-8");
        size = buffer.length;

        this.logger.logRequest("uploadFile.SDK", {
          method: "upload",
          size,
        });

        const response = await blockBlobClient.upload(buffer, buffer.length, {
          blobHTTPHeaders: { blobContentType: contentType },
          metadata,
        });
        etag = response.etag ?? "";
      }

      return {
        path: normalizedPath,
        size,
        contentType,
        etag,
        metadata,
      };
    }, this.retryConfig);
  }

  /**
   * Download a blob from storage.
   *
   * @param remotePath Remote blob path
   * @param localPath Optional local file path to save to. If omitted, returns content as string.
   */
  async downloadFile(
    remotePath: string,
    localPath?: string,
  ): Promise<DownloadResult> {
    const normalizedPath = validatePath(remotePath);
    const blobClient = this.containerClient.getBlobClient(normalizedPath);

    this.logger.logRequest("downloadFile", {
      remotePath: normalizedPath,
      localPath,
    });

    return withRetry(async () => {
      const properties = await blobClient.getProperties();
      const size = properties.contentLength ?? 0;
      const contentType = properties.contentType ?? "application/octet-stream";

      if (localPath) {
        // Download to local file
        const resolvedLocal = path.resolve(localPath);

        // Ensure parent directory exists
        const parentDir = path.dirname(resolvedLocal);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }

        this.logger.logRequest("downloadFile.SDK", {
          method: "downloadToFile",
          localPath: resolvedLocal,
          size,
        });

        const blockBlobClient = blobClient.getBlockBlobClient();
        const downloadResponse = await blockBlobClient.download(0);

        if (!downloadResponse.readableStreamBody) {
          throw new Error("Download response has no readable stream body.");
        }

        const writeStream = fs.createWriteStream(resolvedLocal);
        await new Promise<void>((resolve, reject) => {
          downloadResponse.readableStreamBody!.pipe(writeStream);
          writeStream.on("finish", resolve);
          writeStream.on("error", reject);
        });

        return {
          path: normalizedPath,
          localPath: resolvedLocal,
          size,
          contentType,
        };
      } else {
        // Download to string (in memory)
        this.logger.logRequest("downloadFile.SDK", {
          method: "download",
          size,
        });

        const blockBlobClient = blobClient.getBlockBlobClient();
        const downloadResponse = await blockBlobClient.download(0);

        if (!downloadResponse.readableStreamBody) {
          throw new Error("Download response has no readable stream body.");
        }

        const content = await streamToString(downloadResponse.readableStreamBody);

        return {
          path: normalizedPath,
          content,
          size,
          contentType,
        };
      }
    }, this.retryConfig);
  }

  /**
   * Delete a single blob.
   *
   * @param remotePath Remote blob path
   * @throws BlobNotFoundError if the blob does not exist
   */
  async deleteFile(remotePath: string): Promise<DeleteResult> {
    const normalizedPath = validatePath(remotePath);
    const blobClient = this.containerClient.getBlobClient(normalizedPath);

    this.logger.logRequest("deleteFile", { remotePath: normalizedPath });

    return withRetry(async () => {
      // Check existence first
      const exists = await blobClient.exists();
      if (!exists) {
        throw new BlobNotFoundError(normalizedPath);
      }

      await blobClient.delete({ deleteSnapshots: "include" });

      return {
        path: normalizedPath,
        deleted: true,
      };
    }, this.retryConfig);
  }

  /**
   * Check if a blob exists.
   *
   * @param remotePath Remote blob path
   */
  async fileExists(remotePath: string): Promise<ExistsResult> {
    const normalizedPath = validatePath(remotePath);
    const blobClient = this.containerClient.getBlobClient(normalizedPath);

    this.logger.logRequest("fileExists", { remotePath: normalizedPath });

    return withRetry(async () => {
      const exists = await blobClient.exists();
      return {
        path: normalizedPath,
        exists,
        type: exists ? "file" as const : "unknown" as const,
      };
    }, this.retryConfig);
  }

  /**
   * Replace an existing blob with new content. Throws BlobNotFoundError if the blob does not exist.
   *
   * @param remotePath Remote blob path
   * @param source Local file path or content (string/Buffer)
   * @param metadata Optional metadata to set on the blob
   */
  async replaceFile(
    remotePath: string,
    source: string | Buffer,
    metadata?: Record<string, string>,
  ): Promise<UploadResult> {
    const normalizedPath = validatePath(remotePath);
    const blobClient = this.containerClient.getBlobClient(normalizedPath);

    this.logger.logRequest("replaceFile", {
      remotePath: normalizedPath,
      metadata,
    });

    return withRetry(async () => {
      // Verify blob exists before replacing
      const exists = await blobClient.exists();
      if (!exists) {
        throw new BlobNotFoundError(normalizedPath);
      }

      // Delegate to uploadFile (which handles both file paths and content)
      return this._uploadContent(normalizedPath, source, metadata);
    }, this.retryConfig);
  }

  /**
   * Get detailed information about a blob.
   *
   * @param remotePath Remote blob path
   * @throws BlobNotFoundError if the blob does not exist
   */
  async getFileInfo(remotePath: string): Promise<FileInfo> {
    const normalizedPath = validatePath(remotePath);
    const blobClient = this.containerClient.getBlobClient(normalizedPath);

    this.logger.logRequest("getFileInfo", { remotePath: normalizedPath });

    return withRetry(async () => {
      try {
        const properties = await blobClient.getProperties();

        let tags: Record<string, string> | undefined;
        try {
          const tagResponse = await blobClient.getTags();
          tags = tagResponse.tags;
        } catch {
          // Tags may not be available depending on permissions; ignore errors
        }

        return {
          path: normalizedPath,
          name: getFileName(normalizedPath),
          size: properties.contentLength ?? 0,
          contentType: properties.contentType ?? "application/octet-stream",
          createdOn: properties.createdOn?.toISOString(),
          lastModified: properties.lastModified?.toISOString() ?? new Date().toISOString(),
          etag: properties.etag ?? "",
          metadata: (properties.metadata as Record<string, string>) ?? {},
          tags,
        };
      } catch (error) {
        if (error && typeof error === "object" && (error as Record<string, unknown>)["statusCode"] === 404) {
          throw new BlobNotFoundError(normalizedPath);
        }
        throw error;
      }
    }, this.retryConfig);
  }

  // --- Folder Operations ---

  /**
   * Create a virtual folder by uploading a zero-byte marker blob.
   *
   * The marker blob is created at `{normalizedPath}.folder` with
   * content type `application/x-directory` and metadata `hdi_isfolder: "true"`
   * for ADLS Gen2 compatibility.
   *
   * @param folderPath Remote folder path
   */
  async createFolder(folderPath: string): Promise<CreateFolderResult> {
    const normalizedPath = validateFolderPath(folderPath);
    // For root path, we don't create a marker
    const markerPath = normalizedPath === "" ? ".folder" : `${normalizedPath}.folder`;
    const blockBlobClient = this.containerClient.getBlockBlobClient(markerPath);

    this.logger.logRequest("createFolder", { folderPath: normalizedPath });

    return withRetry(async () => {
      // Check if marker already exists
      const exists = await blockBlobClient.exists();
      if (exists) {
        return {
          path: normalizedPath,
          created: false,
        };
      }

      // Create zero-byte marker blob
      await blockBlobClient.upload("", 0, {
        blobHTTPHeaders: {
          blobContentType: "application/x-directory",
        },
        metadata: {
          hdi_isfolder: "true",
        },
      });

      return {
        path: normalizedPath,
        created: true,
      };
    }, this.retryConfig);
  }

  /**
   * List files and subfolders within a folder.
   *
   * Non-recursive mode uses `listBlobsByHierarchy` for a single-level listing.
   * Recursive mode uses `listBlobsFlat` to list all nested items.
   * Folder marker blobs (`.folder`) are excluded from file listings.
   *
   * @param folderPath Remote folder path (use "" or "/" for root)
   * @param options Optional listing options
   */
  async listFolder(
    folderPath: string,
    options?: { recursive?: boolean },
  ): Promise<ListFolderResult> {
    const normalizedPath = validateFolderPath(folderPath);
    const prefix = normalizedPath; // Already has trailing slash or is empty for root
    const recursive = options?.recursive ?? false;

    this.logger.logRequest("listFolder", { folderPath: normalizedPath, recursive });

    return withRetry(async () => {
      const files: ListItem[] = [];
      const folders: ListItem[] = [];

      if (recursive) {
        // Flat listing -- returns all blobs under the prefix
        for await (const blob of this.containerClient.listBlobsFlat({ prefix })) {
          // Skip folder marker blobs
          if (blob.name.endsWith(".folder")) {
            continue;
          }
          const relativeName = prefix ? blob.name.substring(prefix.length) : blob.name;
          files.push({
            name: relativeName,
            path: blob.name,
            size: blob.properties.contentLength ?? undefined,
            contentType: blob.properties.contentType ?? undefined,
            lastModified: blob.properties.lastModified?.toISOString(),
          });
        }
      } else {
        // Hierarchical listing -- single level
        const iterator = this.containerClient.listBlobsByHierarchy("/", { prefix });

        for await (const item of iterator) {
          if (item.kind === "prefix") {
            // This is a virtual directory (subfolder)
            const folderFullPath = item.name;
            // Extract relative folder name: strip prefix and trailing slash
            const relativeName = prefix ? folderFullPath.substring(prefix.length) : folderFullPath;
            const cleanName = relativeName.replace(/\/$/, "");
            folders.push({
              name: cleanName,
              path: folderFullPath,
            });
          } else {
            // This is a blob (file)
            // Skip folder marker blobs
            if (item.name.endsWith(".folder")) {
              continue;
            }
            const relativeName = prefix ? item.name.substring(prefix.length) : item.name;
            files.push({
              name: relativeName,
              path: item.name,
              size: item.properties.contentLength ?? undefined,
              contentType: item.properties.contentType ?? undefined,
              lastModified: item.properties.lastModified?.toISOString(),
            });
          }
        }
      }

      return {
        path: normalizedPath,
        files,
        folders,
      };
    }, this.retryConfig);
  }

  /**
   * Delete a folder and all its contents recursively.
   *
   * Lists all blobs under the folder prefix using flat listing,
   * then deletes each one (including the folder marker blob).
   *
   * @param folderPath Remote folder path
   */
  async deleteFolder(folderPath: string): Promise<DeleteFolderResult> {
    const normalizedPath = validateFolderPath(folderPath);
    const prefix = normalizedPath;

    this.logger.logRequest("deleteFolder", { folderPath: normalizedPath });

    return withRetry(async () => {
      let deletedCount = 0;

      // List all blobs under this prefix (flat) and delete each
      for await (const blob of this.containerClient.listBlobsFlat({ prefix })) {
        const blobClient = this.containerClient.getBlobClient(blob.name);
        await blobClient.delete({ deleteSnapshots: "include" });
        deletedCount++;
      }

      return {
        path: normalizedPath,
        deletedCount,
      };
    }, this.retryConfig);
  }

  /**
   * Check if a folder exists.
   *
   * A folder is considered to exist if any blobs have the folder path as a prefix.
   * Uses `listBlobsFlat` with max 1 result for efficiency.
   *
   * @param folderPath Remote folder path
   */
  async folderExists(folderPath: string): Promise<ExistsResult> {
    const normalizedPath = validateFolderPath(folderPath);
    const prefix = normalizedPath;

    this.logger.logRequest("folderExists", { folderPath: normalizedPath });

    return withRetry(async () => {
      // Check if any blobs exist with this prefix
      const iterator = this.containerClient.listBlobsFlat({ prefix }).byPage({ maxPageSize: 1 });
      const page = await iterator.next();

      const exists = !page.done &&
        page.value.segment.blobItems &&
        page.value.segment.blobItems.length > 0;

      return {
        path: normalizedPath,
        exists,
        type: exists ? "folder" as const : "unknown" as const,
      };
    }, this.retryConfig);
  }

  // --- Edit Operations ---

  /**
   * Strategy 1: Download blob to a temp file for external editing.
   * Returns the temp path and the blob's current ETag.
   * The caller can then modify the file and call editFileUpload() to re-upload.
   *
   * @param remotePath Remote blob path
   */
  async editFile(remotePath: string): Promise<EditResult> {
    const normalizedPath = validatePath(remotePath);
    const blobClient = this.containerClient.getBlobClient(normalizedPath);

    this.logger.logRequest("editFile", { remotePath: normalizedPath });

    return withRetry(async () => {
      // Get properties for ETag and content info
      let properties;
      try {
        properties = await blobClient.getProperties();
      } catch (error) {
        if (error && typeof error === "object" && (error as Record<string, unknown>)["statusCode"] === 404) {
          throw new BlobNotFoundError(normalizedPath);
        }
        throw error;
      }

      const etag = properties.etag ?? "";
      const size = properties.contentLength ?? 0;
      const contentType = properties.contentType ?? "application/octet-stream";

      // Download to temp file
      const ext = path.extname(normalizedPath) || ".tmp";
      const tempDir = os.tmpdir();
      const tempFileName = `azure-fs-edit-${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`;
      const tempPath = path.join(tempDir, tempFileName);

      const blockBlobClient = blobClient.getBlockBlobClient();
      const downloadResponse = await blockBlobClient.download(0);

      if (!downloadResponse.readableStreamBody) {
        throw new Error("Download response has no readable stream body.");
      }

      const writeStream = fs.createWriteStream(tempPath);
      await new Promise<void>((resolve, reject) => {
        downloadResponse.readableStreamBody!.pipe(writeStream);
        writeStream.on("finish", resolve);
        writeStream.on("error", reject);
      });

      this.logger.logRequest("editFile.downloaded", {
        tempPath,
        size,
        etag,
      });

      return {
        path: normalizedPath,
        tempPath,
        size,
        contentType,
        etag,
      };
    }, this.retryConfig);
  }

  /**
   * Strategy 1 (cont.): Re-upload an edited file with ETag-based conditional write.
   * Throws ConcurrentModificationError if the blob was modified since download.
   *
   * @param remotePath Remote blob path
   * @param localPath Local file path (the edited temp file)
   * @param etag The ETag obtained from editFile (used for conditional upload)
   */
  async editFileUpload(
    remotePath: string,
    localPath: string,
    etag: string,
  ): Promise<EditUploadResult> {
    const normalizedPath = validatePath(remotePath);
    const blockBlobClient = this.containerClient.getBlockBlobClient(normalizedPath);
    const contentType = detectContentType(normalizedPath);

    this.logger.logRequest("editFileUpload", {
      remotePath: normalizedPath,
      localPath,
      etag,
    });

    return withRetry(async () => {
      const resolvedLocal = path.resolve(localPath);
      if (!fs.existsSync(resolvedLocal)) {
        throw PathError.localFileNotFound(resolvedLocal);
      }

      const stats = fs.statSync(resolvedLocal);
      const size = stats.size;
      const content = fs.readFileSync(resolvedLocal);

      try {
        const response = await blockBlobClient.upload(content, content.length, {
          blobHTTPHeaders: { blobContentType: contentType },
          conditions: { ifMatch: etag },
        });

        return {
          path: normalizedPath,
          size,
          etag: response.etag ?? "",
          previousEtag: etag,
        };
      } catch (error) {
        if (error && typeof error === "object" && (error as Record<string, unknown>)["statusCode"] === 412) {
          throw new ConcurrentModificationError(normalizedPath, etag);
        }
        throw error;
      }
    }, this.retryConfig);
  }

  /**
   * Strategy 2: In-place patching of blob content.
   * Downloads the blob, applies find-replace patches sequentially,
   * and re-uploads with ETag-based conditional write.
   *
   * @param remotePath Remote blob path
   * @param patches Array of PatchInstructions to apply
   */
  async patchFile(
    remotePath: string,
    patches: PatchInstruction[],
  ): Promise<PatchResult> {
    const normalizedPath = validatePath(remotePath);
    const blockBlobClient = this.containerClient.getBlockBlobClient(normalizedPath);
    const contentType = detectContentType(normalizedPath);

    this.logger.logRequest("patchFile", {
      remotePath: normalizedPath,
      patchCount: patches.length,
    });

    return withRetry(async () => {
      // Download current content with ETag
      const downloadResponse = await blockBlobClient.download(0);
      const currentEtag = downloadResponse.etag ?? "";

      if (!downloadResponse.readableStreamBody) {
        throw new Error("Download response has no readable stream body.");
      }

      const originalContent = await streamToString(downloadResponse.readableStreamBody);
      const originalSize = Buffer.byteLength(originalContent, "utf-8");

      // Apply patches sequentially
      let content = originalContent;
      const patchResults: PatchInstructionResult[] = [];

      for (const patch of patches) {
        try {
          let matchCount = 0;

          if (patch.isRegex) {
            const regex = new RegExp(patch.find, patch.flags ?? "g");
            const matches = content.match(regex);
            matchCount = matches ? matches.length : 0;

            if (matchCount > 0) {
              content = content.replace(regex, patch.replace);
            }
          } else {
            // Count occurrences for string replacement
            let searchFrom = 0;
            while (true) {
              const idx = content.indexOf(patch.find, searchFrom);
              if (idx === -1) break;
              matchCount++;
              searchFrom = idx + patch.find.length;
            }

            if (matchCount > 0) {
              // replaceAll for literal string replacement
              content = content.split(patch.find).join(patch.replace);
            }
          }

          patchResults.push({
            find: patch.find,
            matchCount,
            applied: matchCount > 0,
          });
        } catch (err) {
          patchResults.push({
            find: patch.find,
            matchCount: 0,
            applied: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Re-upload with ETag condition
      const newBuffer = Buffer.from(content, "utf-8");
      const newSize = newBuffer.length;

      try {
        const response = await blockBlobClient.upload(newBuffer, newBuffer.length, {
          blobHTTPHeaders: { blobContentType: contentType },
          conditions: { ifMatch: currentEtag },
        });

        const appliedCount = patchResults.filter((r) => r.applied).length;

        return {
          path: normalizedPath,
          matchCount: appliedCount,
          appliedCount,
          patches: patchResults,
          originalSize,
          newSize,
          etag: response.etag ?? "",
        };
      } catch (error) {
        if (error && typeof error === "object" && (error as Record<string, unknown>)["statusCode"] === 412) {
          throw new ConcurrentModificationError(normalizedPath, currentEtag);
        }
        throw error;
      }
    }, this.retryConfig);
  }

  /**
   * Strategy 3: Append or prepend content to a blob.
   * Downloads the blob, concatenates the new content at the specified position,
   * and re-uploads with ETag-based conditional write.
   *
   * @param remotePath Remote blob path
   * @param content Content to add
   * @param position Where to add the content: "start" or "end" (default: "end")
   */
  async appendToFile(
    remotePath: string,
    content: string,
    position: "start" | "end" = "end",
  ): Promise<AppendResult> {
    const normalizedPath = validatePath(remotePath);
    const blockBlobClient = this.containerClient.getBlockBlobClient(normalizedPath);
    const contentType = detectContentType(normalizedPath);

    this.logger.logRequest("appendToFile", {
      remotePath: normalizedPath,
      position,
      addedLength: content.length,
    });

    return withRetry(async () => {
      // Download current content with ETag
      const downloadResponse = await blockBlobClient.download(0);
      const currentEtag = downloadResponse.etag ?? "";

      if (!downloadResponse.readableStreamBody) {
        throw new Error("Download response has no readable stream body.");
      }

      const existingContent = await streamToString(downloadResponse.readableStreamBody);
      const originalSize = Buffer.byteLength(existingContent, "utf-8");

      // Concatenate
      const newContent = position === "start"
        ? content + existingContent
        : existingContent + content;

      const newBuffer = Buffer.from(newContent, "utf-8");
      const newSize = newBuffer.length;
      const addedLength = Buffer.byteLength(content, "utf-8");

      // Re-upload with ETag condition
      try {
        const response = await blockBlobClient.upload(newBuffer, newBuffer.length, {
          blobHTTPHeaders: { blobContentType: contentType },
          conditions: { ifMatch: currentEtag },
        });

        return {
          path: normalizedPath,
          position,
          addedLength,
          newSize,
          originalSize,
          etag: response.etag ?? "",
        };
      } catch (error) {
        if (error && typeof error === "object" && (error as Record<string, unknown>)["statusCode"] === 412) {
          throw new ConcurrentModificationError(normalizedPath, currentEtag);
        }
        throw error;
      }
    }, this.retryConfig);
  }

  // --- Batch Operations ---

  /**
   * Upload an entire local directory to blob storage with parallel uploads.
   *
   * Recursively walks the local directory, skipping excluded patterns,
   * and uploads all files preserving folder structure under remotePrefix.
   *
   * @param localDir Local directory path
   * @param remotePrefix Remote blob prefix for all uploaded files
   * @param options Concurrency, exclusion patterns, and shared metadata
   */
  async uploadDirectory(
    localDir: string,
    remotePrefix: string,
    options?: {
      concurrency?: number;
      exclude?: string[];
      metadata?: Record<string, string>;
    },
  ): Promise<UploadDirectoryResult> {
    const resolvedDir = path.resolve(localDir);
    if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
      throw new PathError(
        "PATH_NOT_DIRECTORY",
        `Local path is not a directory: ${resolvedDir}`,
        { path: resolvedDir },
      );
    }

    const concurrency = options?.concurrency ?? 10;
    const excludePatterns = options?.exclude ?? [];
    const metadata = options?.metadata;

    // Normalize remote prefix: strip leading slash, ensure trailing slash
    let normalizedPrefix = remotePrefix.replace(/^\/+/, "");
    if (normalizedPrefix && !normalizedPrefix.endsWith("/")) {
      normalizedPrefix += "/";
    }

    this.logger.logRequest("uploadDirectory", {
      localDir: resolvedDir,
      remotePrefix: normalizedPrefix,
      concurrency,
      excludePatterns,
    });

    // Collect files recursively
    const filePairs = this._collectLocalFiles(resolvedDir, resolvedDir, excludePatterns);

    this.logger.logRequest("uploadDirectory.collected", {
      fileCount: filePairs.length,
    });

    const overallStart = Date.now();

    // Build upload tasks
    const tasks = filePairs.map(({ localPath, relativePath }) => {
      return async (): Promise<UploadDirectoryFileResult> => {
        const remotePath = normalizedPrefix + relativePath;
        const stats = fs.statSync(localPath);
        const fileStart = Date.now();

        try {
          await this.uploadFile(remotePath, localPath, metadata);
          return {
            localPath: relativePath,
            remotePath,
            size: stats.size,
            durationMs: Date.now() - fileStart,
            success: true,
          };
        } catch (err) {
          return {
            localPath: relativePath,
            remotePath,
            size: stats.size,
            durationMs: Date.now() - fileStart,
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      };
    });

    // Execute with concurrency limit
    const fileResults = await parallelLimit<UploadDirectoryFileResult>(tasks, concurrency);
    const totalDurationMs = Date.now() - overallStart;

    const successCount = fileResults.filter((r) => r.success).length;
    const failedCount = fileResults.filter((r) => !r.success).length;
    const totalBytes = fileResults.reduce((sum, r) => sum + r.size, 0);

    return {
      localDir: resolvedDir,
      remotePrefix: normalizedPrefix,
      totalFiles: fileResults.length,
      successCount,
      failedCount,
      totalBytes,
      totalDurationMs,
      files: fileResults,
    };
  }

  // --- Private helpers ---

  /**
   * Recursively collect local files, skipping excluded directory/file names.
   * Returns array of { localPath (absolute), relativePath (forward-slashed) }.
   */
  private _collectLocalFiles(
    dir: string,
    baseDir: string,
    excludePatterns: string[],
  ): { localPath: string; relativePath: string }[] {
    const results: { localPath: string; relativePath: string }[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Check exclusion against the entry name
      if (excludePatterns.includes(entry.name)) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        results.push(...this._collectLocalFiles(fullPath, baseDir, excludePatterns));
      } else if (entry.isFile()) {
        // Use forward slashes for blob paths regardless of OS
        const relativePath = path.relative(baseDir, fullPath).split(path.sep).join("/");
        results.push({ localPath: fullPath, relativePath });
      }
    }

    return results;
  }

  /**
   * Internal upload implementation used by both uploadFile and replaceFile.
   */
  private async _uploadContent(
    normalizedPath: string,
    source: string | Buffer,
    metadata?: Record<string, string>,
  ): Promise<UploadResult> {
    const blockBlobClient = this.containerClient.getBlockBlobClient(normalizedPath);
    const contentType = detectContentType(normalizedPath);
    let size: number;
    let etag: string;

    if (typeof source === "string" && fs.existsSync(source)) {
      // Source is a local file path
      const localFilePath = path.resolve(source);
      const stats = fs.statSync(localFilePath);
      size = stats.size;

      if (isLargeFile(localFilePath)) {
        const readStream = fs.createReadStream(localFilePath);
        const response = await blockBlobClient.uploadStream(
          readStream,
          4 * 1024 * 1024,
          20,
          {
            blobHTTPHeaders: { blobContentType: contentType },
            metadata,
          },
        );
        etag = response.etag ?? "";
      } else {
        const response = await blockBlobClient.uploadFile(localFilePath, {
          blobHTTPHeaders: { blobContentType: contentType },
          metadata,
        });
        etag = response.etag ?? "";
      }
    } else {
      const buffer = Buffer.isBuffer(source)
        ? source
        : Buffer.from(source as string, "utf-8");
      size = buffer.length;

      const response = await blockBlobClient.upload(buffer, buffer.length, {
        blobHTTPHeaders: { blobContentType: contentType },
        metadata,
      });
      etag = response.etag ?? "";
    }

    return {
      path: normalizedPath,
      size,
      contentType,
      etag,
      metadata,
    };
  }
}
