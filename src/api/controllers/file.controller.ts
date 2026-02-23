import { Request, Response } from "express";
import { BlobFileSystemService } from "../../services/blob-filesystem.service";

/**
 * Extract the blob path from Express 5 wildcard route params.
 * In Express 5, `:path(*)` returns an array of path segments.
 */
function extractPath(params: Record<string, unknown>): string {
  const pathParam = params["path"];
  if (Array.isArray(pathParam)) {
    return pathParam.join("/");
  }
  return String(pathParam || "");
}

/**
 * Build the standard API response envelope.
 */
function buildResponse<T>(command: string, data: T, startTime: number) {
  return {
    success: true,
    data,
    metadata: {
      command,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    },
  };
}

/**
 * Factory function that creates file operation controller methods.
 * Each method is a thin layer that extracts request params, calls
 * BlobFileSystemService, and formats the response.
 *
 * Express 5 auto-forwards async errors to the error handler middleware,
 * so no try/catch is needed in these methods.
 */
export function createFileController(blobService: BlobFileSystemService) {
  return {
    /**
     * POST /api/v1/files
     * Upload a new file via multipart form.
     * Form fields: file (binary), remotePath (string), metadata (optional JSON string)
     */
    async upload(req: Request, res: Response): Promise<void> {
      const startTime = Date.now();

      const remotePath = req.body.remotePath as string;
      const file = req.file;

      if (!file) {
        res.status(400).json({
          success: false,
          error: {
            code: "UPLOAD_MISSING_FILE",
            message: "No file provided. Use the 'file' form field.",
          },
          metadata: { timestamp: new Date().toISOString() },
        });
        return;
      }

      if (!remotePath) {
        res.status(400).json({
          success: false,
          error: {
            code: "UPLOAD_MISSING_PATH",
            message: "Missing required form field 'remotePath'.",
          },
          metadata: { timestamp: new Date().toISOString() },
        });
        return;
      }

      // Parse optional metadata from JSON string
      let metadata: Record<string, string> | undefined;
      if (req.body.metadata) {
        metadata = JSON.parse(req.body.metadata as string);
      }

      const result = await blobService.uploadFile(remotePath, file.buffer, metadata);

      if (result.etag) {
        res.setHeader("ETag", result.etag);
      }

      res.status(201).json(buildResponse("api:upload", result, startTime));
    },

    /**
     * GET /api/v1/files/:path(*)
     * Download a file. Returns raw content with appropriate Content-Type.
     * Supports If-None-Match header for 304 responses.
     */
    async download(req: Request, res: Response): Promise<void> {
      const remotePath = extractPath(req.params);

      // First get file info for ETag and content type
      const fileInfo = await blobService.getFileInfo(remotePath);

      // Check If-None-Match for conditional GET
      const ifNoneMatch = req.headers["if-none-match"];
      if (ifNoneMatch && fileInfo.etag && ifNoneMatch === fileInfo.etag) {
        res.status(304).end();
        return;
      }

      // Download the content
      const result = await blobService.downloadFile(remotePath);

      if (fileInfo.etag) {
        res.setHeader("ETag", fileInfo.etag);
      }
      res.setHeader("Content-Type", result.contentType);
      if (result.size !== undefined) {
        res.setHeader("Content-Length", result.size);
      }

      // Return raw content (not wrapped in CommandResult)
      res.status(200).send(result.content);
    },

    /**
     * DELETE /api/v1/files/:path(*)
     * Delete a file.
     */
    async deleteFile(req: Request, res: Response): Promise<void> {
      const startTime = Date.now();
      const remotePath = extractPath(req.params);

      const result = await blobService.deleteFile(remotePath);

      res.status(200).json(buildResponse("api:delete", result, startTime));
    },

    /**
     * PUT /api/v1/files/:path(*)
     * Replace an existing file via multipart form.
     * Requires If-Match header for concurrency protection.
     */
    async replace(req: Request, res: Response): Promise<void> {
      const startTime = Date.now();
      const remotePath = extractPath(req.params);

      // If-Match is required for replace
      const ifMatch = req.headers["if-match"];
      if (!ifMatch) {
        res.status(428).json({
          success: false,
          error: {
            code: "PRECONDITION_REQUIRED",
            message: "The 'If-Match' header is required for replace operations.",
          },
          metadata: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const file = req.file;
      if (!file) {
        res.status(400).json({
          success: false,
          error: {
            code: "UPLOAD_MISSING_FILE",
            message: "No file provided. Use the 'file' form field.",
          },
          metadata: { timestamp: new Date().toISOString() },
        });
        return;
      }

      // Parse optional metadata from JSON string
      let metadata: Record<string, string> | undefined;
      if (req.body.metadata) {
        metadata = JSON.parse(req.body.metadata as string);
      }

      const result = await blobService.replaceFile(remotePath, file.buffer, metadata);

      if (result.etag) {
        res.setHeader("ETag", result.etag);
      }

      res.status(200).json(buildResponse("api:replace", result, startTime));
    },

    /**
     * GET /api/v1/files/:path(*)/info
     * Get file properties, metadata, and tags.
     */
    async info(req: Request, res: Response): Promise<void> {
      const startTime = Date.now();
      const remotePath = extractPath(req.params);

      const result = await blobService.getFileInfo(remotePath);

      if (result.etag) {
        res.setHeader("ETag", result.etag);
      }

      res.status(200).json(buildResponse("api:info", result, startTime));
    },

    /**
     * HEAD /api/v1/files/:path(*)
     * Check if a file exists. Returns 200 if it exists, 404 if not.
     * HEAD responses have no body.
     */
    async exists(req: Request, res: Response): Promise<void> {
      const remotePath = extractPath(req.params);

      const result = await blobService.fileExists(remotePath);

      if (result.exists) {
        // Get file info for ETag header
        const fileInfo = await blobService.getFileInfo(remotePath);
        if (fileInfo.etag) {
          res.setHeader("ETag", fileInfo.etag);
        }
        res.setHeader("Content-Type", fileInfo.contentType);
        res.setHeader("Content-Length", fileInfo.size);
        res.status(200).end();
      } else {
        res.status(404).end();
      }
    },
  };
}
