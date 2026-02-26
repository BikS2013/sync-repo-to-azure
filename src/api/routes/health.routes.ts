import { Router, Request, Response } from "express";
import { ResolvedConfig } from "../../types/config.types";
import { validateConnection } from "../../services/auth.service";

/**
 * Create the health check router.
 *
 * - GET /          Liveness probe: always returns 200 if the process is alive
 * - GET /ready     Readiness probe: verifies Azure Storage connectivity
 *
 * Mounted at /api/health by the route registration barrel.
 */
export function createHealthRoutes(config: ResolvedConfig): Router {
  const router = Router();

  /**
   * @openapi
   * /api/health:
   *   get:
   *     operationId: checkHealth
   *     summary: Liveness check
   *     description: Confirms the process is running and can handle HTTP requests. Always returns 200 if the server is alive.
   *     tags:
   *       - Health
   *     responses:
   *       200:
   *         description: Server is alive
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 status:
   *                   type: string
   *                   example: ok
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   *                   example: "2026-02-23T12:00:00.000Z"
   *                 uptime:
   *                   type: number
   *                   description: Process uptime in seconds
   *                   example: 123.456
   */
  router.get("/", (_req: Request, res: Response) => {
    res.status(200).json({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  /**
   * @openapi
   * /api/health/ready:
   *   get:
   *     operationId: checkReadiness
   *     summary: Readiness check
   *     description: Verifies connectivity to Azure Blob Storage. Returns 200 if the storage account is reachable and the container exists, 503 otherwise.
   *     tags:
   *       - Health
   *     responses:
   *       200:
   *         description: Server is ready and Azure Storage is connected
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 status:
   *                   type: string
   *                   example: ready
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   *                 uptime:
   *                   type: number
   *                 checks:
   *                   type: object
   *                   properties:
   *                     azureStorage:
   *                       type: object
   *                       properties:
   *                         status:
   *                           type: string
   *                           example: connected
   *                         containerName:
   *                           type: string
   *                         containerExists:
   *                           type: boolean
   *                         responseTimeMs:
   *                           type: number
   *       503:
   *         description: Server is not ready (Azure Storage unreachable)
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 status:
   *                   type: string
   *                   example: not_ready
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   *                 uptime:
   *                   type: number
   *                 checks:
   *                   type: object
   *                   properties:
   *                     azureStorage:
   *                       type: object
   *                       properties:
   *                         status:
   *                           type: string
   *                           example: disconnected
   *                         error:
   *                           type: string
   *                         responseTimeMs:
   *                           type: number
   */
  router.get("/ready", async (_req: Request, res: Response) => {
    const startTime = Date.now();

    try {
      const result = await validateConnection(config);
      const responseTimeMs = Date.now() - startTime;

      if (result.success) {
        res.status(200).json({
          status: "ready",
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          checks: {
            azureStorage: {
              status: "connected",
              containerName: result.containerName,
              containerExists: result.containerExists,
              responseTimeMs,
            },
          },
        });
      } else {
        res.status(503).json({
          status: "not_ready",
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          checks: {
            azureStorage: {
              status: "disconnected",
              error: result.error,
              responseTimeMs,
            },
          },
        });
      }
    } catch (err) {
      const responseTimeMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      res.status(503).json({
        status: "not_ready",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        checks: {
          azureStorage: {
            status: "disconnected",
            error: errorMessage,
            responseTimeMs,
          },
        },
      });
    }
  });

  return router;
}
