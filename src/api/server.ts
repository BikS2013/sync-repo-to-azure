import express, { Express } from "express";
import cors from "cors";
import * as http from "http";
import { ApiResolvedConfig } from "../types/api-config.types";
import { resolveApiConfig } from "../config/config.loader";
import { RepoReplicationService } from "../services/repo-replication.service";
import { createContainerClient } from "../services/auth.service";
import { Logger } from "../utils/logger.utils";
import { PortChecker } from "../utils/port-checker.utils";
import swaggerUi from "swagger-ui-express";
import { createErrorHandlerMiddleware } from "./middleware/error-handler.middleware";
import { createRequestLoggerMiddleware } from "./middleware/request-logger.middleware";
import { createTimeoutMiddleware } from "./middleware/timeout.middleware";
import { createYamlBodyParserMiddleware } from "./middleware/yaml-body-parser.middleware";
import { registerApiRoutes, ApiServices } from "./routes/index";
import { createSwaggerSpec } from "./swagger/config";
import { ConsoleCommands } from "../utils/console-commands.utils";

/**
 * Create the Express application with all middleware and routes.
 * This is a pure factory function -- it does not start listening.
 * Exported separately so it can be used in tests.
 *
 * @param config - The fully resolved API configuration.
 * @param logger - Application logger.
 * @param actualPort - Optional override port (when PortChecker auto-selected a different port).
 */
export function createApp(
  config: ApiResolvedConfig,
  logger: Logger,
  actualPort?: number,
  consoleCommands?: ConsoleCommands,
  repoReplicationService?: RepoReplicationService,
): Express {
  const app = express();

  // 1. CORS middleware (first: handles preflight OPTIONS requests immediately)
  app.use(
    cors({
      origin: config.api.corsOrigins,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "If-Match", "If-None-Match"],
      exposedHeaders: ["ETag", "Content-Length", "Content-Type"],
    }),
  );

  // 2. Body parsers (JSON + YAML)
  app.use(express.json({ limit: "10mb" }));
  app.use(createYamlBodyParserMiddleware("10mb"));

  // 3. Request logger (logs method, URL, status code, duration -- never bodies)
  app.use(createRequestLoggerMiddleware(logger));

  // 4. Timeout middleware (aborts long-running requests)
  app.use(createTimeoutMiddleware(config.api.requestTimeoutMs));

  // 5. Swagger documentation (must be before routes because routes include a 404 catch-all)
  if (config.api.swaggerEnabled) {
    const swaggerSpec = createSwaggerSpec(config.api, actualPort);
    app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
    app.get("/api/docs.json", (_req, res) => {
      res.json(swaggerSpec);
    });
  }

  // 6. Routes (includes 404 catch-all at the end)
  const services: ApiServices = {
    config,
    logger,
    sourceTracker: config.sourceTracker,
    consoleCommands,
    repoReplicationService,
  };
  registerApiRoutes(app, services);

  // 7. Error handler (MUST be registered last -- Express 4-argument signature)
  //    Pass nodeEnv to control stack trace inclusion in error responses
  app.use(createErrorHandlerMiddleware(logger, config.api.nodeEnv));

  return app;
}

/**
 * Start the HTTP server.
 * Loads API config, creates services, creates Express app, and starts listening.
 * Handles graceful shutdown on SIGTERM/SIGINT and port conflicts.
 *
 * Startup sequence:
 *   1. Load and validate configuration
 *   2. Create logger and shared services
 *   3. Check port availability (proactive -- before listen)
 *   4. Create Express app (with actualPort for correct Swagger URLs)
 *   5. Start HTTP server
 *   6. Register graceful shutdown handlers
 */
export async function startServer(): Promise<void> {
  // 1. Load and validate all configuration (base + API section)
  const config = resolveApiConfig();

  // 2. Create logger
  const logger = new Logger(config.logging.level, false);

  // 3. Create repo replication service (global ContainerClient is optional for sync-pairs-only deployments)
  let containerClient: import("@azure/storage-blob").ContainerClient | null = null;
  if (config.storage) {
    try {
      containerClient = createContainerClient(config);
      logger.info("Global Azure Storage container client initialized");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`Global Azure Storage container client not available: ${message}`);
      logger.warn("Single-repo replication (clone-github, clone-devops) will be unavailable. Sync pairs with per-pair credentials will still work.");
    }
  } else {
    logger.info("No global Azure Storage configuration — running in sync-pairs-only mode");
  }
  const repoReplicationService = new RepoReplicationService(config, containerClient, logger);

  // 4. Check port availability (proactive port check)
  let actualPort = config.api.port;
  const isAvailable = await PortChecker.isPortAvailable(config.api.port, config.api.host);

  if (!isAvailable) {
    // Log which process is using the port (informational, may return null)
    const processInfo = await PortChecker.getProcessUsingPort(config.api.port);
    if (processInfo) {
      logger.warn(`Port ${config.api.port} is in use by: ${processInfo}`);
    } else {
      logger.warn(`Port ${config.api.port} is already in use`);
    }

    if (config.api.autoSelectPort) {
      const result = await PortChecker.findAvailablePort(config.api.port + 1, 10, config.api.host);
      if (!result.available) {
        logger.error(result.error || "Could not find an available port");
        process.exit(1);
      }
      actualPort = result.port;
      logger.info(`Auto-selected port ${actualPort}`);
    } else {
      logger.error(
        `Port ${config.api.port} is already in use. ` +
        `Set AUTO_SELECT_PORT=true to auto-select, or choose a different port.`,
      );
      process.exit(1);
    }
  }

  // 5. Create ConsoleCommands instance before createApp so it can be injected into routes
  //    (only in non-production environments). setup() is called after server.listen().
  let consoleCommands: ConsoleCommands | null = null;
  if (config.api.nodeEnv !== "production") {
    const inspector = ConsoleCommands.createInspector(config);
    consoleCommands = new ConsoleCommands(inspector);
  }

  // 6. Create Express app (pass actualPort only when it differs from configured port)
  const app = createApp(
    config,
    logger,
    actualPort !== config.api.port ? actualPort : undefined,
    consoleCommands ?? undefined,
    repoReplicationService,
  );

  // 7. Start HTTP server
  const server = http.createServer(app);

  // Safety net: handle port conflict race condition (between isPortAvailable and listen)
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logger.error(`Port ${actualPort} is already in use (race condition). Choose a different port.`);
      process.exit(1);
    }
    logger.error(`Server error: ${err.message}`);
    process.exit(1);
  });

  server.listen(actualPort, config.api.host, () => {
    const serverUrl = `http://${config.api.host}:${actualPort}`;

    logger.info(`Repo Sync API server started`, {
      url: serverUrl,
      healthUrl: `${serverUrl}/api/health`,
      docsUrl: config.api.swaggerEnabled ? `${serverUrl}/api/docs` : "(disabled)",
      environment: config.api.nodeEnv,
    });

    // Also output to stdout for visibility
    process.stdout.write(`\nRepo Sync API server listening on ${serverUrl}\n`);
    process.stdout.write(`  Health:    ${serverUrl}/api/health\n`);
    process.stdout.write(`  Readiness: ${serverUrl}/api/health/ready\n`);
    if (config.api.swaggerEnabled) {
      process.stdout.write(`  Docs:      ${serverUrl}/api/docs\n`);
    }
    if (actualPort !== config.api.port) {
      process.stdout.write(`  Note:      Auto-selected port ${actualPort} (configured: ${config.api.port})\n`);
    }
    process.stdout.write(`\n`);

    // Setup console hotkeys readline (non-production only)
    // Must be called after server.listen() since readline needs a running event loop
    if (consoleCommands) {
      consoleCommands.setup();
    }
  });

  // --- Graceful shutdown ---
  const SHUTDOWN_TIMEOUT_MS = 10_000;
  let shutdownInProgress = false;

  function gracefulShutdown(signal: string): void {
    if (shutdownInProgress) {
      // Double-signal: force-exit immediately
      logger.warn(`Received ${signal} again during shutdown. Forcing exit.`);
      process.exit(1);
    }

    shutdownInProgress = true;
    logger.info(`Received ${signal}, shutting down gracefully...`);

    // Stop azure-venv watcher
    stopWatch();

    // Cleanup console hotkeys
    if (consoleCommands) {
      consoleCommands.cleanup();
      consoleCommands = null;
    }

    // Stop accepting new connections
    server.close(() => {
      logger.info("All connections drained. Exiting.");
      process.exit(0);
    });

    // Safety net: if connections don't drain in time, force exit
    setTimeout(() => {
      logger.warn(`Shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms. Forcing exit.`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

// --- Main entry point ---
// When this file is executed directly (not imported), start the server.
// azure-venv must run first to load remote blobs + env vars before config resolution.
import { watchAzureVenv } from "azure-venv";
import { setAzureVenvResult, setWatchStopFn, stopWatch } from "../utils/azure-venv-holder.utils";

async function bootstrap(): Promise<void> {
  const { initialSync, stop } = await watchAzureVenv();
  setAzureVenvResult(initialSync);
  setWatchStopFn(stop);
  if (initialSync.attempted) {
    const pollInterval = process.env.AZURE_VENV_POLL_INTERVAL ?? "30000";
    process.stdout.write(
      `azure-venv: ${initialSync.downloaded} blobs read in ${initialSync.duration}ms\n`,
    );
    process.stdout.write(
      `azure-venv: watching with poll interval ${pollInterval}ms\n`,
    );
  }
  await startServer();
}

bootstrap().catch((err) => {
  process.stderr.write(`Failed to start API server: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
});
