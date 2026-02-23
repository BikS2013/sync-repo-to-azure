import { AzureFsError } from "./base.error";

/**
 * Error thrown when configuration is missing, invalid, or cannot be loaded.
 * No fallback/default values are ever used -- every missing required field
 * produces this error with clear instructions on how to provide the value.
 */
export class ConfigError extends AzureFsError {
  constructor(code: string, message: string, details?: unknown) {
    super(code, message, undefined, details);
    this.name = "ConfigError";
  }

  /**
   * Factory: create a ConfigError for a missing required configuration parameter.
   * The error message lists all three methods to provide the value.
   */
  static missingRequired(
    paramName: string,
    cliFlagHint: string,
    envVarHint: string,
    configFileHint: string,
  ): ConfigError {
    const message =
      `Missing required configuration: ${paramName}\n\n` +
      `Provide it via one of the following methods:\n` +
      `  - CLI flag:          ${cliFlagHint}\n` +
      `  - Environment var:   ${envVarHint}\n` +
      `  - Config file:       ${configFileHint}\n\n` +
      `Run 'azure-fs config init' to create a configuration file interactively.`;

    return new ConfigError("CONFIG_MISSING_REQUIRED", message, { paramName });
  }

  /**
   * Factory: create a ConfigError for an invalid configuration value.
   */
  static invalidValue(
    paramName: string,
    value: unknown,
    allowedValues?: string[],
  ): ConfigError {
    let message = `Invalid configuration value for ${paramName}: "${value}"`;
    if (allowedValues && allowedValues.length > 0) {
      message += `\nAllowed values: ${allowedValues.join(", ")}`;
    }
    return new ConfigError("CONFIG_INVALID_VALUE", message, {
      paramName,
      value,
      allowedValues,
    });
  }
}
