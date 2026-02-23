import * as dotenv from "dotenv";
dotenv.config();

import express, { Express } from "express";
import cors from "cors";
import * as http from "http";
import { ApiResolvedConfig } from "../types/api-config.types";
import { resolveApiConfig } from "../config/config.loader";
import { BlobFileSystemService } from "../services/blob-filesystem.service";
import { MetadataService } from "../services/metadata.service";
import { Logger } from "../utils/logger.utils";
import swaggerUi from "swagger-ui-express";
import { createErrorHandlerMiddleware } from "./middleware/error-handler.middleware";
import { createRequestLoggerMiddleware } from "./middleware/request-logger.middleware";
import { createTimeoutMiddleware } from "./middleware/timeout.middleware";
import { registerApiRoutes, ApiServices } from "./routes/index";
import { createSwaggerSpec } from "./swagger/config";

/**
 * Create the Express application with all middleware and routes.
 * This is a pure factory function -- it does not start listening.
 * Exported separately so it can be used in tests.
 */
export function createApp(
  config: ApiResolvedConfig,
  blobService: BlobFileSystemService,
  metadataService: MetadataService,
  logger: Logger,
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

  // 2. JSON body parser (multipart uploads bypass this; they use multer)
  app.use(express.json({ limit: "10mb" }));

  // 3. Request logger (logs method, URL, status code, duration -- never bodies)
  app.use(createRequestLoggerMiddleware(logger));

  // 4. Timeout middleware (aborts long-running requests)
  app.use(createTimeoutMiddleware(config.api.requestTimeoutMs));

  // 5. Swagger documentation (must be before routes because routes include a 404 catch-all)
  if (config.api.swaggerEnabled) {
    const swaggerSpec = createSwaggerSpec(config.api);
    app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
    app.get("/api/docs.json", (_req, res) => {
      res.json(swaggerSpec);
    });
  }

  // 6. Routes (includes 404 catch-all at the end)
  const services: ApiServices = {
    blobService,
    metadataService,
    config,
    logger,
  };
  registerApiRoutes(app, services);

  // 7. Error handler (MUST be registered last -- Express 4-argument signature)
  app.use(createErrorHandlerMiddleware(logger));

  return app;
}

/**
 * Start the HTTP server.
 * Loads API config, creates services, creates Express app, and starts listening.
 * Handles graceful shutdown on SIGTERM/SIGINT and port conflicts.
 */
export async function startServer(): Promise<void> {
  // 1. Load and validate all configuration (base + API section)
  const config = resolveApiConfig();

  // 2. Create logger
  const logger = new Logger(config.logging.level, false);

  // 3. Create shared service instances (one-time creation, reused across all requests)
  const blobService = new BlobFileSystemService(config, logger);
  const metadataService = new MetadataService(config, logger);

  // 4. Create Express app
  const app = createApp(config, blobService, metadataService, logger);

  // 5. Start HTTP server
  const server = http.createServer(app);

  // Port conflict detection
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      logger.error(`Port ${config.api.port} is already in use. Choose a different port.`);
      process.exit(1);
    }
    logger.error(`Server error: ${err.message}`);
    process.exit(1);
  });

  server.listen(config.api.port, config.api.host, () => {
    const serverUrl = `http://${config.api.host}:${config.api.port}`;

    logger.info(`Azure FS API server started`, {
      url: serverUrl,
      healthUrl: `${serverUrl}/api/health`,
      docsUrl: config.api.swaggerEnabled ? `${serverUrl}/api/docs` : "(disabled)",
      environment: process.env.NODE_ENV || "development",
    });

    // Also output to stdout for visibility
    process.stdout.write(`\nAzure FS API server listening on ${serverUrl}\n`);
    process.stdout.write(`  Health:    ${serverUrl}/api/health\n`);
    process.stdout.write(`  Readiness: ${serverUrl}/api/health/ready\n`);
    if (config.api.swaggerEnabled) {
      process.stdout.write(`  Docs:      ${serverUrl}/api/docs\n`);
    }
    process.stdout.write(`\n`);
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
startServer().catch((err) => {
  process.stderr.write(`Failed to start API server: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
});
