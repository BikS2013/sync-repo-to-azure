import { Request, Response, NextFunction } from "express";

/**
 * Create a per-request timeout middleware.
 * If the request takes longer than the configured timeout, responds with HTTP 408.
 * The timer is cleared when the response finishes normally.
 *
 * @param timeoutMs Timeout in milliseconds from config (api.requestTimeoutMs)
 */
export function createTimeoutMiddleware(timeoutMs: number) {
  return function timeoutMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({
          success: false,
          error: {
            code: "REQUEST_TIMEOUT",
            message: `Request timed out after ${timeoutMs}ms.`,
          },
          metadata: {
            timestamp: new Date().toISOString(),
          },
        });
      }
    }, timeoutMs);

    // Clear the timer when the response finishes
    res.on("finish", () => {
      clearTimeout(timer);
    });

    // Also clear on close (client disconnect)
    res.on("close", () => {
      clearTimeout(timer);
    });

    next();
  };
}
