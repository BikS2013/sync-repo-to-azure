import { Request, Response, NextFunction } from "express";
import { AzureFsError } from "../../errors/base.error";
import { ConfigError } from "../../errors/config.error";
import { AuthError } from "../../errors/auth.error";
import { RepoReplicationError } from "../../errors/repo-replication.error";
import { Logger } from "../../utils/logger.utils";

/**
 * Map an AzureFsError subclass to an HTTP status code.
 */
function mapErrorToHttpStatus(err: AzureFsError): number {
  if (err instanceof ConfigError) {
    return 500;
  }

  if (err instanceof AuthError) {
    switch (err.code) {
      case "AUTH_ACCESS_DENIED":
        return 403;
      case "AUTH_CONNECTION_FAILED":
        return 502;
      default:
        return 500;
    }
  }

  if (err instanceof RepoReplicationError) {
    return err.statusCode || 500;
  }

  // Fallback for any other AzureFsError subclass
  return err.statusCode || 500;
}

/**
 * Determine if the error message should be sanitized (not forwarded to the client).
 * Server-side configuration and authentication errors must not leak internal details.
 */
function getSanitizedMessage(err: AzureFsError): string | null {
  if (err instanceof ConfigError) {
    return "Server configuration error. Contact the administrator.";
  }

  if (err instanceof AuthError) {
    // Only AUTH_ACCESS_DENIED and AUTH_CONNECTION_FAILED are safe to forward
    if (err.code === "AUTH_ACCESS_DENIED" || err.code === "AUTH_CONNECTION_FAILED") {
      return null; // Use original message
    }
    return "Server authentication error. Contact the administrator.";
  }

  return null; // Use original message
}

/**
 * Create the centralized Express error handling middleware.
 * Must be registered LAST in the middleware chain.
 *
 * Maps AzureFsError subclasses to HTTP status codes.
 * Returns a generic 500 for unknown errors (no internal details leaked).
 *
 * When nodeEnv is "development", unknown error responses include the stack trace
 * to aid debugging. In production and test modes, stack traces are never sent.
 *
 * @param logger - The application logger instance.
 * @param nodeEnv - The current NODE_ENV value (controls stack trace inclusion).
 */
export function createErrorHandlerMiddleware(logger: Logger, nodeEnv: string) {
  return function errorHandlerMiddleware(
    err: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
  ): void {
    const timestamp = new Date().toISOString();

    // --- AzureFsError subclasses ---
    if (err instanceof AzureFsError) {
      const httpStatus = mapErrorToHttpStatus(err);
      const sanitizedMessage = getSanitizedMessage(err);

      // Always log the full error internally
      logger.error(`[${err.code}] ${err.message}`, {
        code: err.code,
        httpStatus,
        ...(err.details ? { details: err.details as Record<string, unknown> } : {}),
      });

      const errorBody = sanitizedMessage
        ? { code: err.code, message: sanitizedMessage }
        : err.toJSON();

      res.status(httpStatus).json({
        success: false,
        error: errorBody,
        metadata: { timestamp },
      });
      return;
    }

    // --- Unknown errors ---
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;

    logger.error(`Unhandled error: ${errorMessage}`, {
      stack: errorStack,
    });

    res.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "An internal server error occurred.",
        ...(nodeEnv === "development" && errorStack ? { stack: errorStack } : {}),
      },
      metadata: { timestamp },
    });
  };
}
