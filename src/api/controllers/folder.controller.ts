import { Request, Response } from "express";
import { BlobFileSystemService } from "../../services/blob-filesystem.service";

/**
 * Extract the blob path from Express 5 wildcard route params.
 * Express 5 path-to-regexp v8 returns an array for `/:path(*)`.
 */
function extractPath(params: Record<string, unknown>): string {
  const pathParam = params["path"];
  if (Array.isArray(pathParam)) {
    return pathParam.join("/");
  }
  return String(pathParam || "");
}

/**
 * Factory function that creates folder operation controller methods.
 * Each method is a thin adapter: extract params from req, call the service, format the response.
 * Express 5 auto-forwards async errors to the centralized error middleware.
 */
export function createFolderController(blobService: BlobFileSystemService) {
  return {
    /**
     * GET /api/v1/folders/:path(*)
     * List files and subfolders at the given path.
     * Query param `recursive` (truthy) enables recursive flat listing.
     */
    async list(req: Request, res: Response): Promise<void> {
      const startTime = Date.now();
      const folderPath = extractPath(req.params);
      const recursive = req.query.recursive === "true" || req.query.recursive === "1";

      const result = await blobService.listFolder(folderPath, { recursive });

      res.status(200).json({
        success: true,
        data: result,
        metadata: {
          command: "api:folder:list",
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        },
      });
    },

    /**
     * POST /api/v1/folders/:path(*)
     * Create a virtual folder marker blob.
     */
    async create(req: Request, res: Response): Promise<void> {
      const startTime = Date.now();
      const folderPath = extractPath(req.params);

      const result = await blobService.createFolder(folderPath);

      res.status(201).json({
        success: true,
        data: result,
        metadata: {
          command: "api:folder:create",
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        },
      });
    },

    /**
     * DELETE /api/v1/folders/:path(*)
     * Delete a folder and all its contents recursively.
     */
    async deleteFolder(req: Request, res: Response): Promise<void> {
      const startTime = Date.now();
      const folderPath = extractPath(req.params);

      const result = await blobService.deleteFolder(folderPath);

      res.status(200).json({
        success: true,
        data: result,
        metadata: {
          command: "api:folder:delete",
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        },
      });
    },

    /**
     * HEAD /api/v1/folders/:path(*)
     * Check if a folder exists. Returns 200 if it does, 404 if not.
     * HEAD responses have no body.
     */
    async exists(req: Request, res: Response): Promise<void> {
      const folderPath = extractPath(req.params);

      const result = await blobService.folderExists(folderPath);

      if (result.exists) {
        res.status(200).end();
      } else {
        res.status(404).end();
      }
    },
  };
}
