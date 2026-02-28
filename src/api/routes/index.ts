import { Express, Request, Response } from "express";
import { ApiResolvedConfig } from "../../types/api-config.types";
import { ConfigSourceTracker } from "../../types/config.types";
import { RepoReplicationService } from "../../services/repo-replication.service";
import { Logger } from "../../utils/logger.utils";
import { createHealthRoutes } from "./health.routes";
import { createRepoRoutes } from "./repo.routes";
import { createDevRoutes } from "./dev.routes";
import { createHotkeyRoutes } from "./hotkeys.routes";
import { ConsoleCommands } from "../../utils/console-commands.utils";

/**
 * Services passed to the route registration function.
 */
export interface ApiServices {
  config: ApiResolvedConfig;
  logger: Logger;
  /** Config source tracker (populated by resolveApiConfig, used by dev routes). */
  sourceTracker?: ConfigSourceTracker;
  /** Console commands instance (populated in non-production environments, used by hotkey routes). */
  consoleCommands?: ConsoleCommands;
  /** Repo replication service instance (optional, created when repo routes are needed). */
  repoReplicationService?: RepoReplicationService;
}

/**
 * Register all API routes on the Express application.
 *
 * Route mount points:
 *   /api/health     -> health.routes.ts
 *   /api/v1/repo   -> repo.routes.ts (repository replication)
 *   /api/dev        -> dev.routes.ts (development only)
 */
export function registerApiRoutes(app: Express, services: ApiServices): void {
  const { config } = services;

  // Health check routes (liveness + readiness)
  app.use("/api/health", createHealthRoutes(config));

  // Repository replication routes (only mounted when service is available)
  if (services.repoReplicationService) {
    app.use("/api/v1/repo", createRepoRoutes(services));
  }

  // Development-only routes (only mounted when NODE_ENV=development)
  if (config.api.nodeEnv === "development") {
    app.use("/api/dev", createDevRoutes(services));
    app.use("/api/dev/hotkeys", createHotkeyRoutes(services));
  }

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
