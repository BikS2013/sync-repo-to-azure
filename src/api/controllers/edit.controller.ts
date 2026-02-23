import { Request, Response } from "express";
import { BlobFileSystemService } from "../../services/blob-filesystem.service";
import { PatchInstruction } from "../../types/patch.types";

/**
 * Extract the blob path from Express 5 wildcard params.
 * Express 5 with path-to-regexp v8 returns an array for `/:path(*)`.
 */
function extractPath(params: Record<string, unknown>): string {
  const pathParam = params["path"];
  if (Array.isArray(pathParam)) {
    return pathParam.join("/");
  }
  return String(pathParam || "");
}

/**
 * Create edit operation controllers (patch, append, edit/re-upload).
 * All mutation endpoints require the If-Match header for ETag concurrency.
 */
export function createEditController(blobService: BlobFileSystemService) {
  return {
    /**
     * PATCH /api/v1/files/:path(*)/patch
     * Apply find-replace patches to blob content.
     * Requires If-Match header.
     *
     * Body: { patches: PatchInstruction[] }
     */
    async patch(req: Request, res: Response): Promise<void> {
      const remotePath = extractPath(req.params);
      const ifMatch = req.headers["if-match"] as string | undefined;

      if (!ifMatch) {
        res.status(428).json({
          success: false,
          error: {
            code: "PRECONDITION_REQUIRED",
            message: "The If-Match header is required for patch operations.",
          },
          metadata: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const body = req.body as { patches?: PatchInstruction[] };
      if (!body.patches || !Array.isArray(body.patches) || body.patches.length === 0) {
        res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Request body must include a non-empty 'patches' array.",
          },
          metadata: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const startTime = Date.now();
      const result = await blobService.patchFile(remotePath, body.patches);

      res.setHeader("ETag", result.etag);
      res.status(200).json({
        success: true,
        data: result,
        metadata: {
          command: "api:edit:patch",
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        },
      });
    },

    /**
     * PATCH /api/v1/files/:path(*)/append
     * Append or prepend content to a blob.
     * Requires If-Match header.
     *
     * Body: { content: string, position: "start" | "end" }
     */
    async append(req: Request, res: Response): Promise<void> {
      const remotePath = extractPath(req.params);
      const ifMatch = req.headers["if-match"] as string | undefined;

      if (!ifMatch) {
        res.status(428).json({
          success: false,
          error: {
            code: "PRECONDITION_REQUIRED",
            message: "The If-Match header is required for append operations.",
          },
          metadata: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const body = req.body as { content?: string; position?: "start" | "end" };
      if (body.content === undefined || body.content === null) {
        res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Request body must include 'content' field.",
          },
          metadata: { timestamp: new Date().toISOString() },
        });
        return;
      }

      if (body.position && body.position !== "start" && body.position !== "end") {
        res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "The 'position' field must be 'start' or 'end'.",
          },
          metadata: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const startTime = Date.now();
      const result = await blobService.appendToFile(
        remotePath,
        body.content,
        body.position || "end",
      );

      res.setHeader("ETag", result.etag);
      res.status(200).json({
        success: true,
        data: result,
        metadata: {
          command: "api:edit:append",
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        },
      });
    },

    /**
     * POST /api/v1/files/:path(*)/edit
     * Phase 1: Download blob for editing. Returns temp file info and ETag.
     */
    async editDownload(req: Request, res: Response): Promise<void> {
      const remotePath = extractPath(req.params);
      const startTime = Date.now();
      const result = await blobService.editFile(remotePath);

      res.setHeader("ETag", result.etag);
      res.status(200).json({
        success: true,
        data: result,
        metadata: {
          command: "api:edit:download",
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        },
      });
    },

    /**
     * PUT /api/v1/files/:path(*)/edit
     * Phase 2: Re-upload edited file with ETag concurrency check.
     * Requires If-Match header (the ETag from Phase 1).
     * Multipart form: field "file" with the edited content.
     */
    async editUpload(req: Request, res: Response): Promise<void> {
      const remotePath = extractPath(req.params);
      const ifMatch = req.headers["if-match"] as string | undefined;

      if (!ifMatch) {
        res.status(428).json({
          success: false,
          error: {
            code: "PRECONDITION_REQUIRED",
            message: "The If-Match header is required for edit re-upload. Use the ETag from the edit download response.",
          },
          metadata: { timestamp: new Date().toISOString() },
        });
        return;
      }

      if (!req.file) {
        res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "A file must be uploaded in the 'file' field.",
          },
          metadata: { timestamp: new Date().toISOString() },
        });
        return;
      }

      // Write the buffer to a temp file for editFileUpload (which expects a local path)
      const os = await import("os");
      const fs = await import("fs");
      const path = await import("path");
      const ext = path.extname(remotePath) || ".tmp";
      const tempPath = path.join(
        os.tmpdir(),
        `azure-fs-api-edit-${Date.now()}-${Math.random().toString(36).substring(2, 8)}${ext}`,
      );
      fs.writeFileSync(tempPath, req.file.buffer);

      const startTime = Date.now();
      try {
        const result = await blobService.editFileUpload(remotePath, tempPath, ifMatch);

        res.setHeader("ETag", result.etag);
        res.status(200).json({
          success: true,
          data: result,
          metadata: {
            command: "api:edit:upload",
            timestamp: new Date().toISOString(),
            durationMs: Date.now() - startTime,
          },
        });
      } finally {
        // Clean up temp file
        try {
          fs.unlinkSync(tempPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    },
  };
}
