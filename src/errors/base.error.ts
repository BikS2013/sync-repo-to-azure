/**
 * Base error class for all azure-fs errors.
 * Provides a machine-readable error code and optional status code and details.
 */
export class AzureFsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Serialize the error for JSON output (CommandResult.error format).
   */
  toJSON(): { code: string; message: string; details?: unknown } {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}
