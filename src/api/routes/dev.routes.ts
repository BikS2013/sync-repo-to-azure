import { Router } from "express";
import { ApiServices } from "./index";
import { createDevController } from "../controllers/dev.controller";

/**
 * Create development-only routes.
 *
 * These routes are only mounted when NODE_ENV=development (checked in routes/index.ts).
 * Each handler also performs a defense-in-depth check and returns 403 if not in development.
 *
 * Endpoints:
 *   GET /api/dev/env       - List all environment variables
 *   GET /api/dev/env/:key  - Get a specific environment variable
 */
export function createDevRoutes(services: ApiServices): Router {
  const router = Router();
  const controller = createDevController(services);

  /**
   * @openapi
   * /api/dev/env:
   *   get:
   *     operationId: listEnvVars
   *     summary: List all environment variables
   *     description: |
   *       Returns all environment variables sorted alphabetically with their
   *       sources and masked sensitive values. Only available in development mode.
   *     tags: [Development]
   *     responses:
   *       200:
   *         description: All environment variables with sources
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   properties:
   *                     environment:
   *                       type: string
   *                     totalVariables:
   *                       type: integer
   *                     variables:
   *                       type: array
   *                       items:
   *                         type: object
   *                         properties:
   *                           name:
   *                             type: string
   *                           value:
   *                             type: string
   *                           source:
   *                             type: string
   *                           masked:
   *                             type: boolean
   *                     sources:
   *                       type: object
   *       403:
   *         description: Not available outside development mode
   */
  router.get("/env", controller.listEnvVars);

  /**
   * @openapi
   * /api/dev/azure-venv:
   *   get:
   *     operationId: getAzureVenvStatus
   *     summary: Inspect azure-venv sync result
   *     description: |
   *       Returns the azure-venv introspection data including blob metadata (without content),
   *       file tree, environment variable sources (without values), and tier counts.
   *       Only available in development mode.
   *     tags: [Development]
   *     responses:
   *       200:
   *         description: Azure-venv introspection data
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   properties:
   *                     watching:
   *                       type: boolean
   *                       description: Whether the azure-venv watcher is actively polling for changes
   *                     attempted:
   *                       type: boolean
   *                     totalBlobs:
   *                       type: integer
   *                     downloaded:
   *                       type: integer
   *                     failed:
   *                       type: integer
   *                     durationMs:
   *                       type: number
   *                     remoteEnvLoaded:
   *                       type: boolean
   *                     blobs:
   *                       type: array
   *                       items:
   *                         type: object
   *                         properties:
   *                           relativePath:
   *                             type: string
   *                           size:
   *                             type: integer
   *                           etag:
   *                             type: string
   *                           lastModified:
   *                             type: string
   *                     fileTree:
   *                       type: array
   *                     envSources:
   *                       type: array
   *                       items:
   *                         type: object
   *                         properties:
   *                           key:
   *                             type: string
   *                           source:
   *                             type: string
   *                     envTierCounts:
   *                       type: object
   *                       properties:
   *                         os:
   *                           type: integer
   *                         remote:
   *                           type: integer
   *                         local:
   *                           type: integer
   *       403:
   *         description: Not available outside development mode
   */
  router.get("/azure-venv", controller.getAzureVenv);

  /**
   * @openapi
   * /api/dev/env/{key}:
   *   get:
   *     operationId: getEnvVar
   *     summary: Get a specific environment variable
   *     description: |
   *       Returns the value and source of a specific environment variable.
   *       The key is normalized to uppercase. Only available in development mode.
   *     tags: [Development]
   *     parameters:
   *       - in: path
   *         name: key
   *         required: true
   *         schema:
   *           type: string
   *         description: Environment variable name (case-insensitive)
   *     responses:
   *       200:
   *         description: Environment variable details
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   properties:
   *                     name:
   *                       type: string
   *                     value:
   *                       type: string
   *                     source:
   *                       type: string
   *                     exists:
   *                       type: boolean
   *                     masked:
   *                       type: boolean
   *       403:
   *         description: Not available outside development mode
   *       404:
   *         description: Variable not found
   */
  router.get("/env/:key", controller.getEnvVar);

  return router;
}
