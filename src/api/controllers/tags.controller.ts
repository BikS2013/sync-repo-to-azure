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
 * Factory function that creates tag operation controller methods.
 * Each method is a thin layer that extracts request params, calls
 * MetadataService tag methods, and formats the response.
 *
 * Express 5 auto-forwards async errors to the error handler middleware,
 * so no try/catch is needed in these methods.
 */
export function createTagsController(metadataService: MetadataService) {
  return {
    /**
     * GET /api/v1/tags/:path(*)
     * Get all blob index tags for a blob.
     */
    async get(req: Request, res: Response): Promise<void> {
      const startTime = Date.now();
      const remotePath = extractPath(req.params);

      const result = await metadataService.getTags(remotePath);

      res.status(200).json(buildResponse("api:tags:get", result, startTime));
    },

    /**
     * PUT /api/v1/tags/:path(*)
     * Set (replace all) blob index tags on a blob.
     * Request body: { tags: Record<string, string> }
     */
    async set(req: Request, res: Response): Promise<void> {
      const startTime = Date.now();
      const remotePath = extractPath(req.params);

      const { tags } = req.body;
      if (!tags || typeof tags !== "object") {
        res.status(400).json({
          success: false,
          error: {
            code: "TAGS_MISSING_TAGS",
            message: "Request body must include a 'tags' object with key-value pairs.",
          },
          metadata: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const result = await metadataService.setTags(remotePath, tags);

      res.status(200).json(buildResponse("api:tags:set", result, startTime));
    },

    /**
     * GET /api/v1/tags
     * Query blobs by an OData tag filter expression.
     * Query parameter: filter (required)
     */
    async query(req: Request, res: Response): Promise<void> {
      const startTime = Date.now();

      const filter = req.query["filter"] as string | undefined;
      if (!filter) {
        res.status(400).json({
          success: false,
          error: {
            code: "TAGS_MISSING_FILTER",
            message: "The 'filter' query parameter is required. Example: ?filter=env%20%3D%20'prod'",
          },
          metadata: { timestamp: new Date().toISOString() },
        });
        return;
      }

      const result = await metadataService.queryByTags(filter);

      res.status(200).json(buildResponse("api:tags:query", result, startTime));
    },
  };
}
