import { Request, Response, NextFunction } from "express";
import { Logger } from "../../utils/logger.utils";

/**
 * Truncate a string/buffer for logging to avoid flooding the console.
 * Binary content is summarized by byte length.
 */
function summarizeBody(body: unknown, contentType: string | undefined, maxLen: number = 2048): string {
  if (body === undefined || body === null) return "(empty)";

  // Binary content types -- just report size
  if (contentType && /^(image|audio|video|application\/octet-stream|application\/pdf|application\/zip)/i.test(contentType)) {
    if (Buffer.isBuffer(body)) return `[binary ${body.length} bytes]`;
    return "[binary]";
  }

  let text: string;
  if (Buffer.isBuffer(body)) {
    text = body.toString("utf8", 0, Math.min(body.length, maxLen));
  } else if (typeof body === "string") {
    text = body;
  } else {
    try {
      text = JSON.stringify(body, null, 2);
    } catch {
      text = String(body);
    }
  }

  if (text.length > maxLen) {
    return text.slice(0, maxLen) + `... [truncated, total ${text.length} chars]`;
  }
  return text;
}

/**
 * Extract relevant headers for verbose logging.
 */
function pickHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const interesting = [
    "content-type", "content-length", "authorization",
    "if-match", "if-none-match", "etag",
    "accept", "user-agent", "x-request-id",
  ];
  const result: Record<string, unknown> = {};
  for (const key of interesting) {
    if (headers[key] !== undefined) {
      result[key] = key === "authorization" ? "[redacted]" : headers[key];
    }
  }
  return result;
}

/**
 * Create a request logging middleware.
 *
 * - At info level: logs method, URL, status code, and duration.
 * - At debug level: also logs request headers, request body, response headers,
 *   and response body (with truncation for large payloads and redaction for
 *   binary content and auth headers).
 */
export function createRequestLoggerMiddleware(logger: Logger) {
  return function requestLoggerMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const startTime = Date.now();

    // --- Debug: log incoming request details ---
    logger.debug(`--> ${req.method} ${req.originalUrl}`, {
      headers: pickHeaders(req.headers as Record<string, unknown>),
      query: Object.keys(req.query).length > 0 ? req.query as Record<string, unknown> : undefined,
      body: req.body !== undefined && Object.keys(req.body as object).length > 0
        ? summarizeBody(req.body, req.headers["content-type"])
        : undefined,
    } as Record<string, unknown>);

    // --- Capture response body for debug logging ---
    // Override res.write and res.end to collect chunks only when debug is active.
    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);
    const chunks: Buffer[] = [];

    res.write = function (chunk: unknown, ...args: unknown[]): boolean {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      return (originalWrite as Function)(chunk, ...args);
    } as typeof res.write;

    res.end = function (chunk: unknown, ...args: unknown[]): Response {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      }
      return (originalEnd as Function)(chunk, ...args);
    } as typeof res.end;

    res.on("finish", () => {
      const durationMs = Date.now() - startTime;

      // Always log the summary line at info level
      logger.info(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs}ms)`);

      // Debug: log response details
      const responseContentType = res.getHeader("content-type") as string | undefined;
      const responseBody = chunks.length > 0 ? Buffer.concat(chunks) : null;

      logger.debug(`<-- ${res.statusCode} ${req.method} ${req.originalUrl} (${durationMs}ms)`, {
        headers: pickHeaders(res.getHeaders() as Record<string, unknown>),
        body: responseBody
          ? summarizeBody(responseBody, responseContentType)
          : "(empty)",
      });
    });

    next();
  };
}
