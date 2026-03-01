import { AzureFsError } from "./base.error";

/**
 * Error thrown when authentication fails or credentials are missing.
 */
export class AuthError extends AzureFsError {
  constructor(code: string, message: string, statusCode?: number, details?: unknown) {
    super(code, message, statusCode, details);
    this.name = "AuthError";
  }

  /**
   * Factory: missing connection string for connection-string auth method.
   */
  static missingConnectionString(): AuthError {
    return new AuthError(
      "AUTH_MISSING_CONNECTION_STRING",
      'AZURE_STORAGE_CONNECTION_STRING environment variable is required when authMethod is "connection-string".\n' +
        'Set it via: export AZURE_STORAGE_CONNECTION_STRING="DefaultEndpointsProtocol=https;AccountName=..."\n' +
        "Find it in: Azure Portal > Storage Account > Access Keys",
    );
  }

  /**
   * Factory: missing SAS token for sas-token auth method.
   */
  static missingSasToken(): AuthError {
    return new AuthError(
      "AUTH_MISSING_SAS_TOKEN",
      'AZURE_STORAGE_SAS_TOKEN environment variable is required when authMethod is "sas-token".\n' +
        'Set it via: export AZURE_STORAGE_SAS_TOKEN="sv=2021-06-08&ss=b&srt=sco&..."\n' +
        "Generate it in: Azure Portal > Storage Account > Shared Access Signature",
    );
  }

  /**
   * Factory: SAS token has expired.
   */
  static sasTokenExpired(expiry: string): AuthError {
    return new AuthError(
      "AUTH_SAS_TOKEN_EXPIRED",
      `SAS token has expired. Expiry: ${expiry}\n` +
        "Generate a new SAS token in: Azure Portal > Storage Account > Shared Access Signature\n" +
        "Then update the AZURE_STORAGE_SAS_TOKEN environment variable and the AZURE_STORAGE_SAS_TOKEN_EXPIRY value.",
    );
  }

  /**
   * Factory: Azure AD authentication failed.
   */
  static azureAdFailed(originalError?: unknown): AuthError {
    const details = originalError instanceof Error ? originalError.message : originalError;
    return new AuthError(
      "AUTH_AZURE_AD_FAILED",
      "Azure AD authentication failed.\n\n" +
        "Troubleshooting steps:\n" +
        "  1. Check if logged in: az account show\n" +
        "  2. Log in if needed: az login\n" +
        "  3. Verify RBAC role: Storage Blob Data Contributor\n" +
        "  4. Check scope: Storage account or container level\n" +
        "  5. Note: Role assignments can take up to 8 minutes to propagate",
      undefined,
      details,
    );
  }

  /**
   * Factory: invalid authentication method specified.
   */
  /**
   * Factory: global Azure Storage configuration is not set.
   */
  static missingStorageConfig(): AuthError {
    return new AuthError(
      "AUTH_MISSING_STORAGE_CONFIG",
      "Global Azure Storage configuration is not set. " +
        "Provide AZURE_STORAGE_ACCOUNT_URL, AZURE_STORAGE_CONTAINER_NAME, and AZURE_FS_AUTH_METHOD " +
        "environment variables, or use sync pairs with per-pair storage credentials.",
      400,
    );
  }

  static invalidAuthMethod(method: string): AuthError {
    return new AuthError(
      "AUTH_INVALID_AUTH_METHOD",
      `Invalid authentication method: "${method}"\n` +
        'Allowed values: "connection-string", "sas-token", "azure-ad"',
      undefined,
      { method, allowedValues: ["connection-string", "sas-token", "azure-ad"] },
    );
  }
}
