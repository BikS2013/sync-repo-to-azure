import { Request, Response } from "express";
import { MetadataService } from "../../services/metadata.service";

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
 * Factory function that creates metadata operation controller methods.
 * Each method is a thin layer that extracts request params, calls
 * MetadataService, and formats the response.
 *
 * Express 5 auto-forwards async errors to the error handler middleware,
 * so no try/catch is needed in these methods.
 */
export function createMetaController(metadataService: MetadataService) {
  return {
    /**
     * GET /api/v1/meta/:path(*)
     * Get all user-defined metadata for a blob.
     */
    async get(req: Request, res: Response): Promise<void> {
      const startTime = Date.now();
      const remotePath = extractPath(req.params);

      const result = await metadataService.getMetadata(remotePath);

      res.status(200).json(buildResponse("api:meta:get", result, startTime));
    },

    /**
     * PUT /api/v1/meta/:path(*)
     * Set (replace all) metadata on a blob.
     * Request body: { metadata: Record<string, string> }
     */
    async set(req: Request, res: Response): Promise<void> {
      const startTime = Date.now();
      const remotePath = extractPath(req.params);

      const { metadata } = req.body;
      if (!metadata || typeof metadata !== "object") {
        res.status(400).json({
          success: false,
          error: {
            code: "META_MISSING_METADATA",
            message: "Request body must include a 'metadata' object with key-value pairs.",
          },
          metadata: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const result = await metadataService.setMetadata(remotePath, metadata);

      res.status(200).json(buildResponse("api:meta:set", result, startTime));
    },

    /**
     * PATCH /api/v1/meta/:path(*)
     * Merge metadata into existing blob metadata.
     * Request body: { metadata: Record<string, string> }
     */
    async update(req: Request, res: Response): Promise<void> {
      const startTime = Date.now();
      const remotePath = extractPath(req.params);

      const { metadata } = req.body;
      if (!metadata || typeof metadata !== "object") {
        res.status(400).json({
          success: false,
          error: {
            code: "META_MISSING_METADATA",
            message: "Request body must include a 'metadata' object with key-value pairs.",
          },
          metadata: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const result = await metadataService.updateMetadata(remotePath, metadata);

      res.status(200).json(buildResponse("api:meta:update", result, startTime));
    },

    /**
     * DELETE /api/v1/meta/:path(*)
     * Delete specific metadata keys from a blob.
     * Request body: { keys: string[] }
     */
    async deleteKeys(req: Request, res: Response): Promise<void> {
      const startTime = Date.now();
      const remotePath = extractPath(req.params);

      const { keys } = req.body;
      if (!keys || !Array.isArray(keys) || keys.length === 0) {
        res.status(400).json({
          success: false,
          error: {
            code: "META_MISSING_KEYS",
            message: "Request body must include a non-empty 'keys' array of metadata key names to delete.",
          },
          metadata: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const result = await metadataService.deleteMetadata(remotePath, keys);

      res.status(200).json(buildResponse("api:meta:delete", result, startTime));
    },
  };
}
