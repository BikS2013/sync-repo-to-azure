import { Request, Response, NextFunction } from "express";
import { AzureFsError } from "../../errors/base.error";
import { ConfigError } from "../../errors/config.error";
import { AuthError } from "../../errors/auth.error";
import { BlobNotFoundError } from "../../errors/blob-not-found.error";
import { PathError } from "../../errors/path.error";
import { MetadataError } from "../../errors/metadata.error";
import { ConcurrentModificationError } from "../../errors/concurrent-modification.error";
import { Logger } from "../../utils/logger.utils";

/**
 * Map an AzureFsError subclass to an HTTP status code.
 * See technical design Section 5.1 for the full mapping table.
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
        // AUTH_MISSING_*, AUTH_SAS_TOKEN_EXPIRED, AUTH_AZURE_AD_FAILED, AUTH_INVALID_AUTH_METHOD
        return 500;
    }
  }

  if (err instanceof BlobNotFoundError) {
    return 404;
  }

  if (err instanceof PathError) {
    return 400;
  }

  if (err instanceof MetadataError) {
    return 400;
  }

  if (err instanceof ConcurrentModificationError) {
    return 412;
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
 * Handles MulterError for upload failures.
 * Returns a generic 500 for unknown errors (no internal details leaked).
 */
export function createErrorHandlerMiddleware(logger: Logger) {
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

    // --- MulterError (file upload errors) ---
    if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "MulterError") {
      const multerErr = err as unknown as { code: string; message: string; field?: string };

      logger.error(`MulterError: ${multerErr.code} - ${multerErr.message}`, {
        code: multerErr.code,
        field: multerErr.field,
      });

      const httpStatus = multerErr.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      const errorCode = multerErr.code === "LIMIT_FILE_SIZE" ? "UPLOAD_FILE_TOO_LARGE" : "UPLOAD_ERROR";

      res.status(httpStatus).json({
        success: false,
        error: {
          code: errorCode,
          message: multerErr.message,
        },
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
      },
      metadata: { timestamp },
    });
  };
}
