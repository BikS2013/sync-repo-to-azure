import { ResolvedConfig } from "../types/config.types";

/**
 * Retry configuration derived from ResolvedConfig.retry.
 */
export interface RetryConfig {
  strategy: "none" | "exponential" | "fixed";
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
}

/**
 * Check whether an error is retryable (transient Azure errors).
 * Retryable conditions: HTTP 429 (throttled), 503 (service unavailable),
 * and network-level errors (ECONNRESET, ECONNREFUSED, ETIMEDOUT).
 */
function isRetryableError(error: unknown): boolean {
  if (error && typeof error === "object") {
    const err = error as Record<string, unknown>;

    // Azure SDK errors have statusCode
    const statusCode = err["statusCode"] as number | undefined;
    if (statusCode === 429 || statusCode === 503) {
      return true;
    }

    // Node.js network errors
    const code = err["code"] as string | undefined;
    if (code === "ECONNRESET" || code === "ECONNREFUSED" || code === "ETIMEDOUT") {
      return true;
    }
  }
  return false;
}

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate the delay for a given attempt based on the retry strategy.
 */
function calculateDelay(config: RetryConfig, attempt: number): number {
  if (config.strategy === "fixed") {
    return config.initialDelayMs;
  }

  // exponential: initialDelay * 2^attempt, capped at maxDelay
  const delay = config.initialDelayMs * Math.pow(2, attempt);
  return Math.min(delay, config.maxDelayMs);
}

/**
 * Execute an async function with configurable retry logic.
 *
 * @param fn The async operation to execute
 * @param config Retry configuration
 * @returns The result of the operation
 * @throws The last error if all retries are exhausted
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
): Promise<T> {
  // "none" strategy: execute once, no retry
  if (config.strategy === "none") {
    return fn();
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Don't retry if:
      //   - This was the last attempt
      //   - The error is not retryable
      if (attempt >= config.maxRetries || !isRetryableError(error)) {
        throw error;
      }

      const delay = calculateDelay(config, attempt);
      await sleep(delay);
    }
  }

  // Should not reach here, but TypeScript needs it
  throw lastError;
}

/**
 * Build a RetryConfig from a ResolvedConfig.
 */
export function retryConfigFromResolved(config: ResolvedConfig): RetryConfig {
  return {
    strategy: config.retry.strategy,
    maxRetries: config.retry.maxRetries,
    initialDelayMs: config.retry.initialDelayMs,
    maxDelayMs: config.retry.maxDelayMs,
  };
}
