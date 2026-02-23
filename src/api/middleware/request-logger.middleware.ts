import { Request, Response, NextFunction } from "express";
import { Logger } from "../../utils/logger.utils";

/**
 * Create a request logging middleware.
 * Logs method, URL, status code, and duration for every request.
 * Never logs request bodies or response bodies.
 * Uses the existing Logger class (writes to stderr).
 */
export function createRequestLoggerMiddleware(logger: Logger) {
  return function requestLoggerMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const startTime = Date.now();

    res.on("finish", () => {
      const durationMs = Date.now() - startTime;
      logger.info(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs}ms)`);
    });

    next();
  };
}
