import { Express, Request, Response } from "express";
import { ApiResolvedConfig } from "../../types/api-config.types";
import { BlobFileSystemService } from "../../services/blob-filesystem.service";
import { MetadataService } from "../../services/metadata.service";
import { Logger } from "../../utils/logger.utils";
import { createHealthRoutes } from "./health.routes";
import { createFileRoutes } from "./file.routes";
import { createEditRoutes } from "./edit.routes";
import { createFolderRoutes } from "./folder.routes";
import { createMetaRoutes } from "./meta.routes";
import { createTagRoutes } from "./tags.routes";

/**
 * Services passed to the route registration function.
 */
export interface ApiServices {
  blobService: BlobFileSystemService;
  metadataService: MetadataService;
  config: ApiResolvedConfig;
  logger: Logger;
}

/**
 * Register all API routes on the Express application.
 *
 * Route mount points:
 *   /api/health     -> health.routes.ts
 *   /api/v1/files   -> file.routes.ts
 *   /api/v1/edit    -> edit.routes.ts
 *   /api/v1/folders -> folder.routes.ts
 *   /api/v1/meta   -> meta.routes.ts
 *   /api/v1/tags   -> tags.routes.ts
 */
export function registerApiRoutes(app: Express, services: ApiServices): void {
  const { config } = services;

  // Health check routes (liveness + readiness)
  app.use("/api/health", createHealthRoutes(config));

  // File operation routes
  app.use("/api/v1/files", createFileRoutes(services.blobService, config.api));

  // Edit operation routes (patch, append, edit workflow)
  app.use("/api/v1/edit", createEditRoutes(services.blobService, config.api));

  // Folder operation routes
  app.use("/api/v1/folders", createFolderRoutes(services.blobService));

  // Metadata operation routes
  app.use("/api/v1/meta", createMetaRoutes(services.metadataService));

  // Tag operation routes
  app.use("/api/v1/tags", createTagRoutes(services.metadataService));

  // --- 404 handler for unmatched routes ---
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: `Route not found: ${_req.method} ${_req.originalUrl}`,
      },
      metadata: {
        timestamp: new Date().toISOString(),
      },
    });
  });
}
