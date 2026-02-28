import { Request, Response, NextFunction } from "express";

/**
 * Symbol used to store the timeout timer on the request object.
 * Allows a subsequent timeout middleware to clear the previous timer,
 * enabling per-route timeout overrides (e.g., repo replication routes
 * use a 5-minute timeout instead of the default global timeout).
 */
const TIMEOUT_TIMER_KEY = Symbol("timeoutTimer");

/**
 * Create a per-request timeout middleware.
 * If the request takes longer than the configured timeout, responds with HTTP 408.
 * The timer is cleared when the response finishes normally.
 *
 * When applied multiple times (e.g., global + route-level), the later middleware
 * clears the previous timer and replaces it with a new one. This allows
 * route-specific timeout overrides.
 *
 * @param timeoutMs Timeout in milliseconds from config (api.requestTimeoutMs)
 */
export function createTimeoutMiddleware(timeoutMs: number) {
  return function timeoutMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    // Clear any previously set timeout timer (enables route-level overrides)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reqStore = req as any;
    const existingTimer = reqStore[TIMEOUT_TIMER_KEY] as
      | ReturnType<typeof setTimeout>
      | undefined;
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

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

    // Store the timer on the request for potential override by a later middleware
    reqStore[TIMEOUT_TIMER_KEY] = timer;

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
