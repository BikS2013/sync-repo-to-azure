import { BlobServiceClient, ContainerClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import { ResolvedConfig } from "../types/config.types";
import { AuthError } from "../errors/auth.error";

/**
 * Result of a connection validation test.
 */
export interface ConnectionTestResult {
  success: boolean;
  authMethod: string;
  accountUrl: string;
  containerName: string;
  containerExists: boolean;
  error?: string;
}

/**
 * Create an authenticated BlobServiceClient based on the configured auth method.
 *
 * Factory pattern:
 *   - connection-string: BlobServiceClient.fromConnectionString()
 *   - sas-token: new BlobServiceClient(accountUrl + sasToken)
 *   - azure-ad: new BlobServiceClient(accountUrl, DefaultAzureCredential)
 *
 * Throws AuthError with clear message when credentials are missing for the selected method.
 */
export function createBlobServiceClient(config: ResolvedConfig): BlobServiceClient {
  switch (config.storage.authMethod) {
    case "connection-string":
      return createConnectionStringClient();
    case "sas-token":
      return createSasTokenClient(config);
    case "azure-ad":
      return createAzureAdClient(config);
    default:
      throw AuthError.invalidAuthMethod(config.storage.authMethod);
  }
}

/**
 * Create a ContainerClient for the configured container.
 */
export function createContainerClient(config: ResolvedConfig): ContainerClient {
  const serviceClient = createBlobServiceClient(config);
  return serviceClient.getContainerClient(config.storage.containerName);
}

/**
 * Validate the connection by attempting to check if the configured container exists.
 */
export async function validateConnection(
  config: ResolvedConfig,
): Promise<ConnectionTestResult> {
  const result: ConnectionTestResult = {
    success: false,
    authMethod: config.storage.authMethod,
    accountUrl: config.storage.accountUrl,
    containerName: config.storage.containerName,
    containerExists: false,
  };

  try {
    const containerClient = createContainerClient(config);
    result.containerExists = await containerClient.exists();
    result.success = true;
  } catch (err) {
    if (err instanceof AuthError) {
      result.error = err.message;
    } else if (err instanceof Error) {
      result.error = err.message;
    } else {
      result.error = String(err);
    }
  }

  return result;
}

// --- Private factory functions ---

function createConnectionStringClient(): BlobServiceClient {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) {
    throw AuthError.missingConnectionString();
  }
  return BlobServiceClient.fromConnectionString(connectionString);
}

function createSasTokenClient(config: ResolvedConfig): BlobServiceClient {
  const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN;
  if (!sasToken) {
    throw AuthError.missingSasToken();
  }

  // Check if the SAS token has expired
  if (config.storage.sasTokenExpiry) {
    const expiryDate = new Date(config.storage.sasTokenExpiry);
    if (expiryDate.getTime() <= Date.now()) {
      throw AuthError.sasTokenExpired(config.storage.sasTokenExpiry);
    }
  }

  const separator = config.storage.accountUrl.includes("?") ? "&" : "?";
  return new BlobServiceClient(`${config.storage.accountUrl}${separator}${sasToken}`);
}

function createAzureAdClient(config: ResolvedConfig): BlobServiceClient {
  const credential = new DefaultAzureCredential();
  return new BlobServiceClient(config.storage.accountUrl, credential);
}
