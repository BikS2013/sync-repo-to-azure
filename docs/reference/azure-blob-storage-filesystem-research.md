# Azure Blob Storage File System Tool - Research

## Table of Contents
1. [Azure Blob Storage SDK Overview](#1-azure-blob-storage-sdk-overview)
2. [Authentication Methods](#2-authentication-methods)
3. [File System Operations](#3-file-system-operations)
4. [Metadata Management](#4-metadata-management)
5. [Configuration Design](#5-configuration-design)
6. [CLI Tool Architecture](#6-cli-tool-architecture)
7. [Key Findings and Recommendations](#7-key-findings-and-recommendations)
8. [Reference Links](#8-reference-links)

---

## 1. Azure Blob Storage SDK Overview

### Package Details

**Package Name**: `@azure/storage-blob`

**Latest Version**: 12.31.0 (as of February 2026)

**Installation**:
```bash
npm install @azure/storage-blob
```

**Additional Required Packages**:
```bash
npm install @azure/identity  # For authentication
npm install @types/node      # TypeScript definitions for Node.js
```

### Core Classes and Responsibilities

The Azure Blob Storage SDK for JavaScript/TypeScript provides three primary client classes:

#### BlobServiceClient
- **Purpose**: Top-level client for interacting with the storage account
- **Responsibilities**:
  - Get/Set Blob Service Properties
  - Create/List/Delete Containers
  - Find blobs by tags across containers
- **Usage Pattern**: Entry point for all storage operations

#### ContainerClient
- **Purpose**: Client for interacting with a specific container
- **Responsibilities**:
  - Create/Delete containers
  - List blobs within the container (flat or hierarchical)
  - Get container properties and metadata
  - Generate container clients for blob operations
- **Usage Pattern**: Obtained via `BlobServiceClient.getContainerClient(containerName)`

#### BlobClient
- **Purpose**: Client for interacting with individual blobs
- **Responsibilities**:
  - Download blob content
  - Get blob properties and metadata
  - Delete blobs
  - Check blob existence
- **Usage Pattern**: Obtained via `ContainerClient.getBlobClient(blobName)`

#### BlockBlobClient (extends BlobClient)
- **Purpose**: Specialized client for block blobs (most common blob type)
- **Responsibilities**:
  - Upload data from strings, buffers, streams, or files
  - Set HTTP headers and metadata
  - Parallel upload operations
- **Usage Pattern**: Obtained via `ContainerClient.getBlockBlobClient(blobName)`

### TypeScript Type Definitions

The SDK includes comprehensive TypeScript definitions. Key interfaces include:

- `BlobServiceClientOptions`: Configuration options for the service client
- `ContainerCreateOptions`: Options for creating containers
- `BlockBlobParallelUploadOptions`: Advanced upload configuration
- `ContainerListBlobsOptions`: Options for listing operations
- `Metadata`: Key-value pairs for custom metadata
- `BlobHTTPHeaders`: System properties like Content-Type, Content-Encoding

### Supported Environments

- **Node.js**: LTS versions (18+)
- **Browsers**: Latest versions of Safari, Chrome, Edge, and Firefox
- **Service Version**: 2026-02-06 (latest)

### Node.js-Only Features

The following features are only available in Node.js runtime:
- Shared Key Authorization (`StorageSharedKeyCredential`)
- SAS generation functions
- `BlockBlobClient.uploadFile()` - Upload from file path
- `BlockBlobClient.uploadStream()` - Upload from readable stream
- `BlobClient.downloadToBuffer()` - Download to buffer
- `BlobClient.downloadToFile()` - Download to file path

### Browser-Only Features

- `BlockBlobClient.uploadBrowserData()` - Upload from browser data

---

## 2. Authentication Methods

### Comparison Table

| Method | Security | Setup Complexity | Best For | Credential Rotation | Local Development |
|--------|----------|------------------|----------|---------------------|-------------------|
| **DefaultAzureCredential** | Excellent | Medium | Production, Local Dev | Automatic | Excellent |
| **Connection String** | Poor | Very Low | Quick prototypes only | Manual | Good |
| **SAS Token** | Good | Medium | Time-limited access | Time-based | Good |
| **Account Key** | Poor | Low | Legacy apps only | Manual | Good |

### 2.1 DefaultAzureCredential (Azure AD) - RECOMMENDED

**Description**: Uses Azure Active Directory (Entra ID) for passwordless authentication. Automatically discovers credentials from multiple sources in a predefined order.

**Credential Chain Order**:
1. Environment variables (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`)
2. Workload Identity (Azure Kubernetes Service)
3. Managed Identity (when deployed to Azure)
4. Azure CLI credentials (local development)
5. Azure PowerShell credentials
6. Visual Studio Code credentials
7. Interactive browser authentication

#### Setup Steps

**1. Install Required Package**:
```bash
npm install @azure/identity
```

**2. Assign Azure RBAC Role**:

Assign the **Storage Blob Data Contributor** role to your identity (user account, service principal, or managed identity):
- Scope: Storage account level (Principle of Least Privilege)
- Required Actions:
  - `Microsoft.Storage/storageAccounts/blobServices/containers/blobs/read`
  - `Microsoft.Storage/storageAccounts/blobServices/containers/blobs/write`
  - `Microsoft.Storage/storageAccounts/blobServices/containers/blobs/delete`

**3. Local Development Setup**:
```bash
# Sign in with Azure CLI
az login

# Or use environment variables for service principal
export AZURE_TENANT_ID="your-tenant-id"
export AZURE_CLIENT_ID="your-client-id"
export AZURE_CLIENT_SECRET="your-client-secret"
```

#### TypeScript Code Example

```typescript
import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';

const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
if (!accountName) {
  throw new Error('AZURE_STORAGE_ACCOUNT_NAME environment variable is required');
}

const credential = new DefaultAzureCredential();
const blobServiceClient = new BlobServiceClient(
  `https://${accountName}.blob.core.windows.net`,
  credential
);

// Use the client
const containerClient = blobServiceClient.getContainerClient('mycontainer');
const exists = await containerClient.exists();
console.log(`Container exists: ${exists}`);
```

#### Pros
- **Superior Security**: No credentials stored in code or configuration files
- **Automatic Credential Rotation**: Managed identities rotate automatically
- **Multi-Environment Support**: Same code works locally and in Azure
- **Audit Trail**: Azure AD logs all authentication attempts
- **Fine-Grained Access Control**: Use RBAC for precise permissions

#### Cons
- **Initial Setup Complexity**: Requires Azure AD configuration
- **Role Assignment Required**: Must assign RBAC roles (can take up to 8 minutes to propagate)
- **Network Dependency**: Requires connectivity to Azure AD

#### When to Use
- **Production deployments** (always)
- **Local development** with Azure CLI installed
- **CI/CD pipelines** with service principals or managed identities
- **Any scenario where security is a priority**

#### Security Considerations
- Never commit service principal secrets to source control
- Use managed identities when running in Azure (App Service, Azure Functions, VMs)
- Apply least-privilege principle when assigning roles
- Monitor authentication logs in Azure AD

---

### 2.2 Connection String

**Description**: Contains all information needed to authenticate, including the account key. Format: `DefaultEndpointsProtocol=https;AccountName=myaccount;AccountKey=mykey;EndpointSuffix=core.windows.net`

#### Setup Steps

**1. Obtain Connection String**:
- Navigate to Azure Portal → Storage Account → Access Keys
- Copy "Connection string" under key1 or key2

**2. Store Securely**:
```bash
# Environment variable (preferred for connection strings)
export AZURE_STORAGE_CONNECTION_STRING="DefaultEndpointsProtocol=https;AccountName=..."
```

#### TypeScript Code Example

```typescript
import { BlobServiceClient } from '@azure/storage-blob';

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
if (!connectionString) {
  throw new Error('AZURE_STORAGE_CONNECTION_STRING environment variable is required');
}

const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);

// Use the client
const containerClient = blobServiceClient.getContainerClient('mycontainer');
```

#### Pros
- **Simplest Setup**: Single string contains all authentication info
- **Quick Prototyping**: Fastest way to get started
- **No Additional Configuration**: No RBAC or AD setup required

#### Cons
- **Severe Security Risk**: Grants full access to storage account
- **No Audit Trail**: Cannot distinguish between different users/applications
- **Manual Rotation**: Regenerating keys breaks all applications using old key
- **Broad Permissions**: Cannot restrict to specific containers or operations
- **Exposure Risk**: Easy to accidentally commit to source control

#### When to Use
- **Quick prototypes and proof-of-concepts only**
- **Never in production environments**
- **Never for applications with multiple users**

#### Security Considerations
- **NEVER commit connection strings to source control**
- Always store in environment variables or secure key vaults
- Rotate keys regularly (but requires updating all applications)
- Consider disabling shared key access entirely if not needed
- Monitor storage account access logs

---

### 2.3 SAS Token (Shared Access Signature)

**Description**: Time-limited, permission-scoped token that grants delegated access to storage resources without exposing the account key.

**Types**:
- **User Delegation SAS**: Secured with Azure AD credentials (recommended)
- **Service SAS**: Secured with account key
- **Account SAS**: Secured with account key, grants access to multiple services

#### Setup Steps

**1. Generate SAS Token** (User Delegation - Recommended):

```typescript
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
  SASProtocol
} from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';

async function generateUserDelegationSAS(
  accountName: string,
  containerName: string,
  blobName: string
): Promise<string> {
  const credential = new DefaultAzureCredential();
  const blobServiceClient = new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net`,
    credential
  );

  // Get user delegation key (valid for up to 7 days)
  const startsOn = new Date();
  const expiresOn = new Date(startsOn);
  expiresOn.setHours(startsOn.getHours() + 1); // 1 hour validity

  const userDelegationKey = await blobServiceClient.getUserDelegationKey(
    startsOn,
    expiresOn
  );

  // Generate SAS token
  const sasToken = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse('r'), // Read only
      startsOn,
      expiresOn,
      protocol: SASProtocol.Https,
    },
    userDelegationKey,
    accountName
  ).toString();

  return sasToken;
}
```

**2. Use SAS Token**:

```typescript
import { BlobServiceClient } from '@azure/storage-blob';

const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN;

if (!accountName || !sasToken) {
  throw new Error('Required environment variables not set');
}

const blobServiceClient = new BlobServiceClient(
  `https://${accountName}.blob.core.windows.net?${sasToken}`
);
```

#### Pros
- **Time-Limited Access**: Automatically expires after specified duration
- **Granular Permissions**: Can restrict to specific operations (read, write, delete, list)
- **Resource-Scoped**: Can limit to specific containers or blobs
- **Revocable**: User delegation SAS can be revoked by rotating user delegation key
- **No Key Exposure**: Doesn't expose account key

#### Cons
- **Generation Complexity**: Requires code or tools to generate
- **Token Management**: Must distribute and refresh tokens before expiry
- **Still Bearer Tokens**: Anyone with the token has access until expiry
- **Limited Revocation**: Service SAS cannot be revoked until expiry

#### When to Use
- **Third-party access**: Granting temporary access to external users/systems
- **Download links**: Providing time-limited download URLs
- **Upload scenarios**: Allowing clients to upload directly to storage
- **When Azure AD is not available**: Fallback authentication method
- **Mobile/web applications**: Where managing credentials is challenging

#### Security Considerations
- **Always use User Delegation SAS** (secured with Azure AD) over Service SAS
- Set the shortest practical expiration time
- Use HTTPS-only protocol (`SASProtocol.Https`)
- Restrict permissions to minimum required (e.g., read-only)
- Consider IP restrictions for sensitive operations
- Monitor SAS usage through storage analytics

---

### 2.4 Account Key (Shared Key)

**Description**: Direct authentication using storage account name and one of the two account keys. Provides full access to the storage account.

#### Setup Steps

**1. Obtain Account Key**:
- Navigate to Azure Portal → Storage Account → Access Keys
- Copy "Key" value under key1 or key2

**2. Store Securely**:
```bash
export AZURE_STORAGE_ACCOUNT_NAME="mystorageaccount"
export AZURE_STORAGE_ACCOUNT_KEY="base64-encoded-key"
```

#### TypeScript Code Example

```typescript
import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob';

const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY;

if (!accountName || !accountKey) {
  throw new Error('Required environment variables not set');
}

const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
const blobServiceClient = new BlobServiceClient(
  `https://${accountName}.blob.core.windows.net`,
  sharedKeyCredential
);
```

#### Pros
- **Simple Implementation**: Straightforward authentication mechanism
- **No Azure AD Required**: Works without Azure Active Directory setup
- **Offline Generation**: Can generate SAS tokens offline

#### Cons
- **Full Account Access**: No way to restrict permissions
- **No Audit Differentiation**: All operations appear as account-level actions
- **Key Rotation Disruption**: Rotating keys breaks all applications
- **Security Risk**: Similar risks to connection strings
- **Microsoft Discourages**: Not recommended for new applications

#### When to Use
- **Legacy applications** that cannot be updated
- **Quick scripts** for personal use only
- **As a last resort** when other methods are not feasible

#### Security Considerations
- **Prefer DefaultAzureCredential** whenever possible
- Never expose account keys in code, logs, or error messages
- Store keys in Azure Key Vault or similar secure storage
- Enable "Secure transfer required" on storage account
- Consider disabling shared key access if not needed
- Regularly rotate keys (but plan for application updates)

---

### Recommended Authentication Strategy for CLI Tool

**For this TypeScript CLI tool used by developers/agents locally:**

**Primary Recommendation**: **DefaultAzureCredential**

**Reasoning**:
1. **Developer Experience**: Works seamlessly with Azure CLI login (`az login`)
2. **Security**: No credentials stored in configuration files
3. **Production Ready**: Same code works when deployed to Azure with managed identity
4. **Flexibility**: Falls back to environment variables for CI/CD scenarios

**Fallback Option**: **User Delegation SAS Token**
- For scenarios where Azure AD authentication is not available
- Time-limited access reduces security risk
- Can be generated on-demand via Azure CLI or portal

**Configuration Approach**:
```typescript
// Priority order for authentication:
// 1. DefaultAzureCredential (recommended)
// 2. SAS token from environment variable (fallback)
// 3. Throw error - no connection string or account key fallback

const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
if (!accountName) {
  throw new Error('AZURE_STORAGE_ACCOUNT_NAME is required');
}

let blobServiceClient: BlobServiceClient;

const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN;
if (sasToken) {
  // Fallback to SAS token
  blobServiceClient = new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net?${sasToken}`
  );
} else {
  // Primary: DefaultAzureCredential
  const credential = new DefaultAzureCredential();
  blobServiceClient = new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net`,
    credential
  );
}
```

---

## 3. File System Operations

Azure Blob Storage uses a flat namespace by default, but supports virtual directory emulation through blob name prefixes and delimiter characters (typically `/`).

### 3.1 List Files and Folders (with prefix/delimiter)

**SDK Methods**:
- `ContainerClient.listBlobsFlat(options)` - Flat listing (all blobs)
- `ContainerClient.listBlobsByHierarchy(delimiter, options)` - Hierarchical listing (folder emulation)

#### List Files Flat (No Folder Structure)

```typescript
import { ContainerClient, ContainerListBlobsOptions } from '@azure/storage-blob';

async function listBlobsFlat(
  containerClient: ContainerClient,
  prefix?: string
): Promise<string[]> {
  const blobNames: string[] = [];

  const options: ContainerListBlobsOptions = {
    prefix: prefix || '', // Filter by prefix (folder path)
    includeMetadata: true,
    includeSnapshots: false,
    includeTags: false,
    includeVersions: false,
  };

  // Iterate through all blobs
  for await (const blob of containerClient.listBlobsFlat(options)) {
    blobNames.push(blob.name);
    console.log(`Blob: ${blob.name}`);
    console.log(`  Size: ${blob.properties.contentLength} bytes`);
    console.log(`  Last Modified: ${blob.properties.lastModified}`);
    console.log(`  Content Type: ${blob.properties.contentType}`);
  }

  return blobNames;
}
```

#### List Files Hierarchically (With Folder Emulation)

```typescript
import { ContainerClient, ContainerListBlobsOptions } from '@azure/storage-blob';

interface FileSystemItem {
  name: string;
  type: 'file' | 'folder';
  size?: number;
  lastModified?: Date;
}

async function listBlobsHierarchical(
  containerClient: ContainerClient,
  folderPath: string = '',
  delimiter: string = '/'
): Promise<FileSystemItem[]> {
  const items: FileSystemItem[] = [];

  const options: ContainerListBlobsOptions = {
    prefix: folderPath, // List items under this "folder"
  };

  // List blobs hierarchically
  const iterator = containerClient.listBlobsByHierarchy(delimiter, options);

  for await (const response of iterator.byPage({ maxPageSize: 100 })) {
    // Process virtual directories (folders)
    if (response.segment.blobPrefixes) {
      for (const prefix of response.segment.blobPrefixes) {
        items.push({
          name: prefix.name,
          type: 'folder',
        });
      }
    }

    // Process blobs (files)
    for (const blob of response.segment.blobItems) {
      items.push({
        name: blob.name,
        type: 'file',
        size: blob.properties.contentLength,
        lastModified: blob.properties.lastModified,
      });
    }
  }

  return items;
}

// Usage example
const items = await listBlobsHierarchical(containerClient, 'documents/');
items.forEach(item => {
  if (item.type === 'folder') {
    console.log(`[DIR]  ${item.name}`);
  } else {
    console.log(`[FILE] ${item.name} (${item.size} bytes)`);
  }
});
```

#### Important Parameters

- **prefix**: Filter results to blobs starting with this string (e.g., `'documents/2024/'`)
- **delimiter**: Character to use for folder separation (default: `'/'`)
- **maxPageSize**: Number of results per page (default: 5000, max: 5000)
- **includeMetadata**: Include custom metadata in results
- **includeTags**: Include blob index tags

#### Error Handling

```typescript
async function listBlobsSafe(containerClient: ContainerClient): Promise<string[]> {
  try {
    const blobNames: string[] = [];
    for await (const blob of containerClient.listBlobsFlat()) {
      blobNames.push(blob.name);
    }
    return blobNames;
  } catch (error: any) {
    if (error.statusCode === 404) {
      throw new Error(`Container not found: ${containerClient.containerName}`);
    } else if (error.statusCode === 403) {
      throw new Error('Access denied. Check authentication and permissions.');
    }
    throw new Error(`Failed to list blobs: ${error.message}`);
  }
}
```

---

### 3.2 Create Folder (Virtual Directory)

Azure Blob Storage doesn't have true folders. Folders are emulated through blob name prefixes. There are two common approaches:

#### Approach 1: Zero-Byte Marker Blob (Explicit)

Create a zero-byte blob with the folder path to explicitly mark the folder.

```typescript
import { ContainerClient, BlockBlobClient } from '@azure/storage-blob';

async function createFolder(
  containerClient: ContainerClient,
  folderPath: string
): Promise<void> {
  // Ensure folder path ends with delimiter
  const normalizedPath = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;

  // Create a zero-byte blob as a folder marker
  const blockBlobClient = containerClient.getBlockBlobClient(normalizedPath);

  try {
    await blockBlobClient.upload('', 0, {
      blobHTTPHeaders: {
        blobContentType: 'application/x-directory',
      },
      metadata: {
        hdi_isfolder: 'true', // Azure Data Lake Gen2 convention
      },
    });
    console.log(`Folder created: ${normalizedPath}`);
  } catch (error: any) {
    if (error.statusCode === 409) {
      console.log(`Folder already exists: ${normalizedPath}`);
    } else {
      throw new Error(`Failed to create folder: ${error.message}`);
    }
  }
}

// Usage
await createFolder(containerClient, 'documents/projects');
// Creates blob: "documents/projects/"
```

#### Approach 2: Implicit Creation (Prefix Convention)

Folders are created implicitly when you upload a blob with a prefix.

```typescript
async function createFolderImplicit(
  containerClient: ContainerClient,
  blobPath: string,
  content: string
): Promise<void> {
  // Upload a file with a path prefix
  // The "folder" is created automatically
  const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
  await blockBlobClient.upload(content, content.length);

  // Example: 'documents/projects/readme.txt'
  // This implicitly creates "folders": documents/ and documents/projects/
}
```

#### Recommendation

**For a file system abstraction tool**: Use **Approach 1** (zero-byte marker blobs)

**Reasons**:
- Makes folders explicit and visible in listings
- Allows setting metadata on folders
- Compatible with Azure Portal and Storage Explorer
- Matches behavior of hierarchical namespace (ADLS Gen2)
- Can distinguish between empty folders and non-existent paths

---

### 3.3 Upload File

**SDK Methods**:
- `BlockBlobClient.upload(data, length)` - Upload string or buffer
- `BlockBlobClient.uploadData(data)` - Upload buffer with parallel upload
- `BlockBlobClient.uploadFile(filePath)` - Upload from file path (Node.js only)
- `BlockBlobClient.uploadStream(stream)` - Upload from stream (Node.js only)

#### Upload from String

```typescript
import { BlockBlobClient } from '@azure/storage-blob';

async function uploadFromString(
  containerClient: ContainerClient,
  blobName: string,
  content: string
): Promise<void> {
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  try {
    const uploadResponse = await blockBlobClient.upload(
      content,
      content.length,
      {
        blobHTTPHeaders: {
          blobContentType: 'text/plain',
          blobContentEncoding: 'utf-8',
        },
        metadata: {
          uploadedBy: 'cli-tool',
          uploadedAt: new Date().toISOString(),
        },
      }
    );

    console.log(`Uploaded blob: ${blobName}`);
    console.log(`  Request ID: ${uploadResponse.requestId}`);
    console.log(`  ETag: ${uploadResponse.etag}`);
  } catch (error: any) {
    throw new Error(`Upload failed: ${error.message}`);
  }
}
```

#### Upload from File Path (Node.js)

```typescript
import { BlockBlobClient, BlockBlobParallelUploadOptions } from '@azure/storage-blob';
import * as path from 'path';
import * as fs from 'fs';

async function uploadFromFile(
  containerClient: ContainerClient,
  blobName: string,
  filePath: string
): Promise<void> {
  // Validate file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  // Determine content type from file extension
  const ext = path.extname(filePath).toLowerCase();
  const contentTypeMap: Record<string, string> = {
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.xml': 'application/xml',
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.pdf': 'application/pdf',
  };

  const options: BlockBlobParallelUploadOptions = {
    blobHTTPHeaders: {
      blobContentType: contentTypeMap[ext] || 'application/octet-stream',
    },
    // Parallel upload configuration
    blockSize: 4 * 1024 * 1024, // 4 MiB per block
    concurrency: 5, // 5 concurrent uploads
    maxSingleShotSize: 256 * 1024 * 1024, // 256 MiB threshold
  };

  const uploadResponse = await blockBlobClient.uploadFile(filePath, options);
  console.log(`Uploaded file: ${filePath} -> ${blobName}`);
}
```

#### Upload from Stream (Node.js)

```typescript
import { BlockBlobClient } from '@azure/storage-blob';
import * as fs from 'fs';

async function uploadFromStream(
  containerClient: ContainerClient,
  blobName: string,
  filePath: string
): Promise<void> {
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  const stream = fs.createReadStream(filePath);

  const uploadResponse = await blockBlobClient.uploadStream(
    stream,
    4 * 1024 * 1024, // Buffer size: 4 MiB
    5, // Max concurrency
    {
      blobHTTPHeaders: {
        blobContentType: 'application/octet-stream',
      },
    }
  );

  console.log(`Uploaded from stream: ${blobName}`);
}
```

#### Upload with Metadata and Tags

```typescript
import { BlockBlobClient, Tags } from '@azure/storage-blob';

async function uploadWithMetadata(
  containerClient: ContainerClient,
  blobName: string,
  content: string
): Promise<void> {
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  const metadata = {
    author: 'john-doe',
    department: 'engineering',
    project: 'azure-cli-tool',
  };

  const tags: Tags = {
    classification: 'internal',
    retention: '7-years',
    status: 'active',
  };

  await blockBlobClient.upload(content, content.length, {
    metadata,
    tags,
    blobHTTPHeaders: {
      blobContentType: 'text/plain',
    },
  });
}
```

#### Error Handling

```typescript
async function uploadSafe(
  containerClient: ContainerClient,
  blobName: string,
  content: string
): Promise<void> {
  try {
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.upload(content, content.length);
  } catch (error: any) {
    if (error.statusCode === 404) {
      throw new Error('Container does not exist');
    } else if (error.statusCode === 403) {
      throw new Error('Access denied. Check permissions.');
    } else if (error.statusCode === 409) {
      throw new Error('Blob already exists (use overwrite option)');
    } else if (error.code === 'ENOENT') {
      throw new Error('Local file not found');
    }
    throw new Error(`Upload failed: ${error.message}`);
  }
}
```

---

### 3.4 Download File

**SDK Methods**:
- `BlobClient.download(offset?, length?)` - Download blob content as stream
- `BlobClient.downloadToBuffer(buffer?)` - Download to buffer (Node.js only)
- `BlobClient.downloadToFile(filePath)` - Download to file (Node.js only)

#### Download to String (Node.js)

```typescript
import { BlobClient } from '@azure/storage-blob';
import { Readable } from 'stream';

async function downloadToString(
  containerClient: ContainerClient,
  blobName: string
): Promise<string> {
  const blobClient = containerClient.getBlobClient(blobName);

  const downloadResponse = await blobClient.download(0); // offset = 0, downloads entire blob

  if (!downloadResponse.readableStreamBody) {
    throw new Error('No stream body in download response');
  }

  return streamToString(downloadResponse.readableStreamBody);
}

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    stream.on('error', reject);
  });
}

// Usage
const content = await downloadToString(containerClient, 'documents/readme.txt');
console.log(content);
```

#### Download to Buffer (Node.js)

```typescript
async function downloadToBuffer(
  containerClient: ContainerClient,
  blobName: string
): Promise<Buffer> {
  const blobClient = containerClient.getBlobClient(blobName);

  // Download directly to buffer
  const buffer = await blobClient.downloadToBuffer();

  console.log(`Downloaded ${buffer.length} bytes`);
  return buffer;
}
```

#### Download to File (Node.js)

```typescript
async function downloadToFile(
  containerClient: ContainerClient,
  blobName: string,
  destinationPath: string
): Promise<void> {
  const blobClient = containerClient.getBlobClient(blobName);

  await blobClient.downloadToFile(destinationPath);
  console.log(`Downloaded blob to: ${destinationPath}`);
}
```

#### Download with Range (Partial Download)

```typescript
async function downloadRange(
  containerClient: ContainerClient,
  blobName: string,
  offset: number,
  length: number
): Promise<string> {
  const blobClient = containerClient.getBlobClient(blobName);

  // Download specific range
  const downloadResponse = await blobClient.download(offset, length);

  if (!downloadResponse.readableStreamBody) {
    throw new Error('No stream body in download response');
  }

  return streamToString(downloadResponse.readableStreamBody);
}

// Download first 1KB
const firstKB = await downloadRange(containerClient, 'largefile.txt', 0, 1024);
```

#### Download with Properties Check

```typescript
async function downloadWithValidation(
  containerClient: ContainerClient,
  blobName: string
): Promise<string> {
  const blobClient = containerClient.getBlobClient(blobName);

  // Get properties first
  const properties = await blobClient.getProperties();
  console.log(`Blob size: ${properties.contentLength} bytes`);
  console.log(`Content type: ${properties.contentType}`);
  console.log(`Last modified: ${properties.lastModified}`);

  // Check if file is too large for in-memory download
  const maxSize = 100 * 1024 * 1024; // 100 MB
  if (properties.contentLength && properties.contentLength > maxSize) {
    throw new Error('File too large for in-memory download');
  }

  // Download
  const downloadResponse = await blobClient.download();
  if (!downloadResponse.readableStreamBody) {
    throw new Error('No stream body');
  }

  return streamToString(downloadResponse.readableStreamBody);
}
```

#### Error Handling

```typescript
async function downloadSafe(
  containerClient: ContainerClient,
  blobName: string
): Promise<string | null> {
  try {
    const blobClient = containerClient.getBlobClient(blobName);
    const downloadResponse = await blobClient.download();

    if (!downloadResponse.readableStreamBody) {
      throw new Error('No stream body in response');
    }

    return await streamToString(downloadResponse.readableStreamBody);
  } catch (error: any) {
    if (error.statusCode === 404) {
      console.error(`Blob not found: ${blobName}`);
      return null;
    } else if (error.statusCode === 403) {
      throw new Error('Access denied. Check permissions.');
    }
    throw new Error(`Download failed: ${error.message}`);
  }
}
```

---

### 3.5 Replace File (Overwrite)

Uploading to an existing blob name automatically overwrites it by default. No special parameters are needed.

```typescript
async function replaceFile(
  containerClient: ContainerClient,
  blobName: string,
  newContent: string
): Promise<void> {
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  // This will overwrite if the blob exists
  await blockBlobClient.upload(newContent, newContent.length, {
    blobHTTPHeaders: {
      blobContentType: 'text/plain',
    },
  });

  console.log(`Replaced blob: ${blobName}`);
}
```

#### Replace with Conditional Access (Prevent Overwrites)

Use conditions to prevent accidental overwrites:

```typescript
async function replaceOnlyIfExists(
  containerClient: ContainerClient,
  blobName: string,
  newContent: string
): Promise<void> {
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  // Get current ETag
  const properties = await blockBlobClient.getProperties();
  const currentETag = properties.etag;

  // Upload with condition: only if ETag matches (prevents concurrent modifications)
  await blockBlobClient.upload(newContent, newContent.length, {
    conditions: {
      ifMatch: currentETag, // Only upload if blob hasn't changed
    },
  });
}
```

#### Replace Only If Blob Exists

```typescript
async function replaceIfExists(
  containerClient: ContainerClient,
  blobName: string,
  newContent: string
): Promise<boolean> {
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  // Check if blob exists
  const exists = await blockBlobClient.exists();
  if (!exists) {
    console.log(`Blob does not exist: ${blobName}`);
    return false;
  }

  // Replace
  await blockBlobClient.upload(newContent, newContent.length);
  return true;
}
```

---

### 3.6 Delete File

**SDK Method**:
- `BlobClient.delete(options?)` - Delete blob
- `BlobClient.deleteIfExists(options?)` - Delete only if exists (no error if not found)

#### Delete Blob

```typescript
async function deleteFile(
  containerClient: ContainerClient,
  blobName: string
): Promise<void> {
  const blobClient = containerClient.getBlobClient(blobName);

  try {
    await blobClient.delete();
    console.log(`Deleted blob: ${blobName}`);
  } catch (error: any) {
    if (error.statusCode === 404) {
      console.log(`Blob not found: ${blobName}`);
    } else {
      throw new Error(`Delete failed: ${error.message}`);
    }
  }
}
```

#### Delete If Exists (No Error)

```typescript
async function deleteIfExists(
  containerClient: ContainerClient,
  blobName: string
): Promise<boolean> {
  const blobClient = containerClient.getBlobClient(blobName);

  const deleteResponse = await blobClient.deleteIfExists();

  if (deleteResponse.succeeded) {
    console.log(`Deleted blob: ${blobName}`);
    return true;
  } else {
    console.log(`Blob did not exist: ${blobName}`);
    return false;
  }
}
```

#### Delete Folder (Virtual Directory)

Since folders are virtual, deleting a folder means deleting all blobs with that prefix:

```typescript
async function deleteFolder(
  containerClient: ContainerClient,
  folderPath: string
): Promise<number> {
  // Ensure folder path ends with delimiter
  const prefix = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;

  let deletedCount = 0;

  // List all blobs with this prefix
  for await (const blob of containerClient.listBlobsFlat({ prefix })) {
    const blobClient = containerClient.getBlobClient(blob.name);
    await blobClient.delete();
    deletedCount++;
    console.log(`Deleted: ${blob.name}`);
  }

  console.log(`Deleted ${deletedCount} blobs from folder: ${folderPath}`);
  return deletedCount;
}
```

#### Delete with Snapshot Options

```typescript
import { BlobDeleteOptions } from '@azure/storage-blob';

async function deleteWithSnapshots(
  containerClient: ContainerClient,
  blobName: string
): Promise<void> {
  const blobClient = containerClient.getBlobClient(blobName);

  const options: BlobDeleteOptions = {
    deleteSnapshots: 'include', // Also delete snapshots
  };

  await blobClient.delete(options);
}
```

---

### 3.7 Edit File (Read-Modify-Write Pattern)

Blobs are immutable. To edit a file, you must download, modify, and upload.

```typescript
async function editFile(
  containerClient: ContainerClient,
  blobName: string,
  editFn: (content: string) => string
): Promise<void> {
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  // 1. Download current content
  const downloadResponse = await blockBlobClient.download();
  if (!downloadResponse.readableStreamBody) {
    throw new Error('Cannot read blob content');
  }

  const currentContent = await streamToString(downloadResponse.readableStreamBody);

  // 2. Apply modifications
  const newContent = editFn(currentContent);

  // 3. Upload modified content
  await blockBlobClient.upload(newContent, newContent.length);

  console.log(`Edited blob: ${blobName}`);
}

// Usage: Append a line to a file
await editFile(containerClient, 'log.txt', (content) => {
  return content + '\nNew log entry at ' + new Date().toISOString();
});
```

#### Edit with Concurrency Protection

```typescript
async function editFileSafe(
  containerClient: ContainerClient,
  blobName: string,
  editFn: (content: string) => string,
  maxRetries: number = 3
): Promise<void> {
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // 1. Download with ETag
      const downloadResponse = await blockBlobClient.download();
      const currentETag = downloadResponse.etag;

      if (!downloadResponse.readableStreamBody) {
        throw new Error('Cannot read blob content');
      }

      const currentContent = await streamToString(downloadResponse.readableStreamBody);

      // 2. Apply modifications
      const newContent = editFn(currentContent);

      // 3. Upload with condition: only if ETag matches
      await blockBlobClient.upload(newContent, newContent.length, {
        conditions: {
          ifMatch: currentETag, // Prevent concurrent modifications
        },
      });

      console.log(`Edited blob: ${blobName}`);
      return;
    } catch (error: any) {
      if (error.statusCode === 412 && attempt < maxRetries - 1) {
        // Precondition failed - blob was modified by another process
        console.log(`Retry ${attempt + 1}: Blob was modified concurrently`);
        continue;
      }
      throw error;
    }
  }

  throw new Error('Failed to edit blob after maximum retries');
}
```

---

### 3.8 Check if File/Folder Exists

**SDK Method**:
- `BlobClient.exists()` - Returns boolean
- `ContainerClient.exists()` - Check if container exists

#### Check if Blob Exists

```typescript
async function blobExists(
  containerClient: ContainerClient,
  blobName: string
): Promise<boolean> {
  const blobClient = containerClient.getBlobClient(blobName);
  return await blobClient.exists();
}

// Usage
if (await blobExists(containerClient, 'documents/readme.txt')) {
  console.log('File exists');
} else {
  console.log('File does not exist');
}
```

#### Check if Folder Exists

Since folders are virtual, check if any blobs exist with that prefix:

```typescript
async function folderExists(
  containerClient: ContainerClient,
  folderPath: string
): Promise<boolean> {
  const prefix = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;

  // Try to get at least one blob with this prefix
  const iterator = containerClient.listBlobsFlat({ prefix }).byPage({ maxPageSize: 1 });
  const page = await iterator.next();

  if (page.done) {
    return false;
  }

  return page.value.segment.blobItems.length > 0;
}

// Alternative: Check for marker blob
async function folderExistsExplicit(
  containerClient: ContainerClient,
  folderPath: string
): Promise<boolean> {
  const markerPath = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;
  const blobClient = containerClient.getBlobClient(markerPath);
  return await blobClient.exists();
}
```

#### Check Container Exists

```typescript
async function containerExists(
  blobServiceClient: BlobServiceClient,
  containerName: string
): Promise<boolean> {
  const containerClient = blobServiceClient.getContainerClient(containerName);
  return await containerClient.exists();
}
```

#### Best Practice: Avoid Exists() in Tight Loops

The `exists()` method is a billable transaction. For high-volume scenarios, use conditional operations:

```typescript
// AVOID: Two separate operations
if (await blobClient.exists()) {
  await blobClient.delete();
}

// PREFER: Single operation with error handling
await blobClient.deleteIfExists(); // Or catch 404 error
```

---

## 4. Metadata Management

Azure Blob Storage supports two types of metadata:
1. **System Properties**: Standard HTTP headers (Content-Type, Content-Encoding, etc.)
2. **Custom Metadata**: User-defined key-value pairs

### 4.1 System Properties vs Custom Metadata

#### System Properties (Standard HTTP Headers)

**Accessible via `BlobHTTPHeaders`**:
- `blobContentType` - MIME type (e.g., `text/plain`, `application/json`)
- `blobContentEncoding` - Compression method (e.g., `gzip`, `deflate`)
- `blobContentLanguage` - Language (e.g., `en-US`, `fr-FR`)
- `blobContentDisposition` - Display/download behavior (e.g., `inline`, `attachment; filename="data.csv"`)
- `blobCacheControl` - Browser caching behavior (e.g., `max-age=3600`)
- `blobContentMD5` - MD5 hash for integrity validation

**Characteristics**:
- Part of HTTP protocol
- Automatically interpreted by browsers and clients
- No size limits
- Affect blob behavior (e.g., how browsers display the blob)

#### Custom Metadata

**Accessible via `Metadata` object**:
- User-defined key-value pairs
- Keys must be valid C# identifiers (alphanumeric + underscores)
- Keys are case-insensitive (stored in lowercase)
- Values are strings only

**Characteristics**:
- For application-specific data
- Not interpreted by Azure Storage or clients
- Subject to size limits (see below)
- Can be indexed using Blob Index Tags for querying

**Comparison Table**:

| Feature | System Properties | Custom Metadata |
|---------|------------------|-----------------|
| Purpose | Standard HTTP behavior | Application data |
| Keys | Predefined | User-defined |
| Size Limit | No limit | 8 KB total |
| Queryable | No | No (unless using Index Tags) |
| Case Sensitivity | Case-sensitive | Case-insensitive |
| Retrieved | With blob properties | With blob properties |

---

### 4.2 Setting Metadata on Upload

```typescript
import {
  BlockBlobClient,
  Metadata,
  BlobHTTPHeaders
} from '@azure/storage-blob';

async function uploadWithFullMetadata(
  containerClient: ContainerClient,
  blobName: string,
  content: string
): Promise<void> {
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  // System properties
  const httpHeaders: BlobHTTPHeaders = {
    blobContentType: 'text/plain',
    blobContentEncoding: 'utf-8',
    blobContentLanguage: 'en-US',
    blobCacheControl: 'no-cache',
    blobContentDisposition: 'inline',
  };

  // Custom metadata
  const metadata: Metadata = {
    author: 'john-doe',
    department: 'engineering',
    project: 'azure-storage-tool',
    version: '1.0.0',
    createdBy: 'cli-tool',
    createdAt: new Date().toISOString(),
  };

  await blockBlobClient.upload(content, content.length, {
    blobHTTPHeaders: httpHeaders,
    metadata: metadata,
  });

  console.log(`Uploaded with metadata: ${blobName}`);
}
```

---

### 4.3 Reading Metadata

```typescript
import { BlobGetPropertiesResponse } from '@azure/storage-blob';

async function readMetadata(
  containerClient: ContainerClient,
  blobName: string
): Promise<void> {
  const blobClient = containerClient.getBlobClient(blobName);

  // Get properties returns both system properties and custom metadata
  const properties: BlobGetPropertiesResponse = await blobClient.getProperties();

  // System properties
  console.log('System Properties:');
  console.log(`  Content-Type: ${properties.contentType}`);
  console.log(`  Content-Length: ${properties.contentLength}`);
  console.log(`  Content-Encoding: ${properties.contentEncoding}`);
  console.log(`  Last-Modified: ${properties.lastModified}`);
  console.log(`  ETag: ${properties.etag}`);

  // Custom metadata
  console.log('\nCustom Metadata:');
  if (properties.metadata) {
    for (const [key, value] of Object.entries(properties.metadata)) {
      console.log(`  ${key}: ${value}`);
    }
  }
}
```

#### Reading Metadata During List Operations

```typescript
async function listWithMetadata(
  containerClient: ContainerClient
): Promise<void> {
  const options = {
    includeMetadata: true, // Include metadata in list results
  };

  for await (const blob of containerClient.listBlobsFlat(options)) {
    console.log(`Blob: ${blob.name}`);

    if (blob.metadata) {
      console.log('  Metadata:');
      for (const [key, value] of Object.entries(blob.metadata)) {
        console.log(`    ${key}: ${value}`);
      }
    }
  }
}
```

---

### 4.4 Updating Metadata

Updating metadata replaces all existing metadata. To preserve existing metadata, read it first.

```typescript
async function updateMetadata(
  containerClient: ContainerClient,
  blobName: string,
  newMetadata: Metadata
): Promise<void> {
  const blobClient = containerClient.getBlobClient(blobName);

  // This REPLACES all metadata
  await blobClient.setMetadata(newMetadata);

  console.log(`Updated metadata for: ${blobName}`);
}
```

#### Update Metadata Preserving Existing Values

```typescript
async function updateMetadataPreserve(
  containerClient: ContainerClient,
  blobName: string,
  additionalMetadata: Metadata
): Promise<void> {
  const blobClient = containerClient.getBlobClient(blobName);

  // 1. Read current metadata
  const properties = await blobClient.getProperties();
  const currentMetadata = properties.metadata || {};

  // 2. Merge with new metadata
  const updatedMetadata: Metadata = {
    ...currentMetadata,
    ...additionalMetadata,
  };

  // 3. Set merged metadata
  await blobClient.setMetadata(updatedMetadata);

  console.log(`Updated metadata for: ${blobName}`);
}
```

#### Update Single Metadata Field

```typescript
async function updateSingleMetadataField(
  containerClient: ContainerClient,
  blobName: string,
  key: string,
  value: string
): Promise<void> {
  const blobClient = containerClient.getBlobClient(blobName);

  // Read current metadata
  const properties = await blobClient.getProperties();
  const metadata = properties.metadata || {};

  // Update single field
  metadata[key] = value;

  // Write back
  await blobClient.setMetadata(metadata);
}
```

---

### 4.5 Blob Index Tags (for Querying)

Blob Index Tags are separate from metadata and are indexed for querying across containers.

```typescript
import { Tags } from '@azure/storage-blob';

async function setBlobTags(
  containerClient: ContainerClient,
  blobName: string
): Promise<void> {
  const blobClient = containerClient.getBlobClient(blobName);

  const tags: Tags = {
    environment: 'production',
    classification: 'confidential',
    department: 'engineering',
    retention: '7-years',
  };

  await blobClient.setTags(tags);
  console.log(`Set tags on: ${blobName}`);
}

async function getBlobTags(
  containerClient: ContainerClient,
  blobName: string
): Promise<Tags> {
  const blobClient = containerClient.getBlobClient(blobName);
  const response = await blobClient.getTags();
  return response.tags;
}

async function findBlobsByTags(
  blobServiceClient: BlobServiceClient,
  tagQuery: string
): Promise<string[]> {
  const blobNames: string[] = [];

  // Example queries:
  // - "environment='production'"
  // - "department='engineering' AND classification='confidential'"
  // - "@container='mycontainer' AND status='active'"

  const iterator = blobServiceClient.findBlobsByTags(tagQuery);

  for await (const blob of iterator) {
    blobNames.push(blob.name);
    console.log(`Found: ${blob.name}`);
    console.log(`  Tags: ${JSON.stringify(blob.tags)}`);
  }

  return blobNames;
}
```

**Query Syntax**:
- Single condition: `"status='active'"`
- AND conditions: `"env='prod' AND dept='eng'"`
- Range queries: `"createdOn >= '2024-01' AND createdOn <= '2024-12'"`
- Container filter: `"@container='mycontainer' AND status='active'"`

**Permissions Required**: `Microsoft.Storage/storageAccounts/blobServices/containers/blobs/filter/action`

**Limitations**:
- Cannot query by metadata (only index tags)
- Tags on previous versions are not indexed
- Not supported on accounts with hierarchical namespace enabled

---

### 4.6 Metadata Limits and Constraints

#### Size Limits

**Custom Metadata**:
- **Total size**: Up to **8 KB** for all metadata key-value pairs combined (for block blobs and containers)
- **Page blobs**: Up to **1 MB** metadata size
- Size includes:
  - Metadata key names
  - Metadata values
  - HTTP header overhead (`x-ms-meta-` prefix)

**Calculation Example**:
```
Key: "author" = 6 bytes
Prefix: "x-ms-meta-" = 11 bytes
Value: "john-doe" = 8 bytes
Total per entry: ~25 bytes

Maximum entries (approximate): 8192 bytes / 25 bytes = ~327 entries
```

#### Naming Constraints

**Metadata Key Requirements**:
- Must be valid C# identifiers
- Can only contain: Letters (a-z, A-Z), digits (0-9), underscores (_)
- Must start with a letter or underscore
- Case-insensitive (Azure stores in lowercase)
- Maximum length: Not explicitly documented, but recommend < 256 characters

**Valid Keys**: `author`, `Created_Date`, `version_1_0`, `_private`

**Invalid Keys**: `created-date` (hyphen), `2nd_version` (starts with digit), `user.name` (period)

**Metadata Value Requirements**:
- Must be valid HTTP header values
- Can contain ASCII characters
- Non-ASCII characters must be Base64 or URL-encoded
- Maximum length: Not explicitly limited, but subject to 8 KB total size constraint

#### Blob Index Tags Limits

**Index Tags**:
- **Maximum tags per blob**: 10 tags
- **Key length**: 1-128 characters
- **Value length**: 0-256 characters
- **Total size per blob**: Approximately 2 KB
- **Characters allowed**: Letters, digits, space, and `+ - . / : = _`

#### HTTP Header Requirements

All metadata is transmitted as HTTP headers with the `x-ms-meta-` prefix:
- Keys are prefixed: `x-ms-meta-author: john-doe`
- Headers are case-insensitive
- Must adhere to HTTP/1.1 header restrictions

#### Duplicate Key Handling

If duplicate metadata keys are provided, Azure returns HTTP 400 (Bad Request).

```typescript
// This will fail:
const invalidMetadata = {
  Author: 'John',
  author: 'Jane', // Duplicate (case-insensitive)
};
```

#### Best Practices

1. **Keep metadata small**: Aim for < 4 KB to leave room for growth
2. **Use Index Tags for querying**: Metadata is not queryable; use tags instead
3. **Encode special characters**: Use Base64 for non-ASCII values
4. **Document metadata schema**: Maintain a list of expected keys and value formats
5. **Validate before setting**: Check key naming rules and total size
6. **Use consistent casing**: Even though case-insensitive, use lowercase for consistency

#### Code Example: Metadata Validation

```typescript
function validateMetadataKey(key: string): boolean {
  // Must be valid C# identifier
  const regex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  return regex.test(key);
}

function estimateMetadataSize(metadata: Metadata): number {
  let totalSize = 0;
  for (const [key, value] of Object.entries(metadata)) {
    // x-ms-meta- prefix + key + value + overhead
    totalSize += 11 + key.length + value.length + 10;
  }
  return totalSize;
}

function validateMetadata(metadata: Metadata): void {
  // Validate keys
  for (const key of Object.keys(metadata)) {
    if (!validateMetadataKey(key)) {
      throw new Error(`Invalid metadata key: ${key}`);
    }
  }

  // Validate size
  const size = estimateMetadataSize(metadata);
  const maxSize = 8 * 1024; // 8 KB

  if (size > maxSize) {
    throw new Error(`Metadata too large: ${size} bytes (max: ${maxSize})`);
  }
}
```

---

## 5. Configuration Design

### 5.1 Required Configuration Parameters

For a TypeScript CLI tool connecting to Azure Blob Storage, the following configuration parameters are required:

#### Authentication Configuration

**Option 1: DefaultAzureCredential (Recommended)**
- `AZURE_STORAGE_ACCOUNT_NAME` - Storage account name (required)
- `AZURE_TENANT_ID` - Azure AD tenant ID (optional, for service principal)
- `AZURE_CLIENT_ID` - Application (client) ID (optional, for service principal)
- `AZURE_CLIENT_SECRET` - Client secret (optional, for service principal)

**Option 2: SAS Token (Fallback)**
- `AZURE_STORAGE_ACCOUNT_NAME` - Storage account name (required)
- `AZURE_STORAGE_SAS_TOKEN` - Shared Access Signature token (required)

**Option 3: Connection String (Not Recommended)**
- `AZURE_STORAGE_CONNECTION_STRING` - Full connection string (required)

#### Container Configuration

- `AZURE_STORAGE_CONTAINER_NAME` - Default container name (required for operations)

#### Optional Configuration

- `AZURE_STORAGE_ENDPOINT_SUFFIX` - Endpoint suffix (default: `core.windows.net`)
- `AZURE_LOG_LEVEL` - Logging level (`info`, `warn`, `error`) (default: `warn`)

---

### 5.2 Environment Variables Approach

**Advantages**:
- Standard practice for cloud applications
- Secure (not committed to source control)
- Easy to set in different environments (dev, staging, prod)
- Supported by container orchestration platforms

**Implementation**:

```typescript
interface AzureStorageConfig {
  accountName: string;
  containerName: string;
  sasToken?: string;
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
  connectionString?: string;
  endpointSuffix?: string;
}

function loadConfigFromEnv(): AzureStorageConfig {
  const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;

  // Required fields - throw if missing
  if (!accountName) {
    throw new Error('AZURE_STORAGE_ACCOUNT_NAME environment variable is required');
  }

  if (!containerName) {
    throw new Error('AZURE_STORAGE_CONTAINER_NAME environment variable is required');
  }

  return {
    accountName,
    containerName,
    sasToken: process.env.AZURE_STORAGE_SAS_TOKEN,
    tenantId: process.env.AZURE_TENANT_ID,
    clientId: process.env.AZURE_CLIENT_ID,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
    connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
    endpointSuffix: process.env.AZURE_STORAGE_ENDPOINT_SUFFIX || 'core.windows.net',
  };
}
```

**.env file example**:
```bash
AZURE_STORAGE_ACCOUNT_NAME=mystorageaccount
AZURE_STORAGE_CONTAINER_NAME=mycontainer
# Use one of the following authentication methods:
# Option 1: DefaultAzureCredential (recommended)
AZURE_TENANT_ID=your-tenant-id
AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret
# Option 2: SAS Token
# AZURE_STORAGE_SAS_TOKEN=sv=2021-06-08&ss=b&srt=sco&sp=rwdlacx&se=...
# Option 3: Connection String (not recommended)
# AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;AccountName=...
```

**Usage**:
```bash
# Install dotenv
npm install dotenv

# Load .env file
import 'dotenv/config';
```

---

### 5.3 Config File Approach

**Advantages**:
- Easy to edit and version control (excluding secrets)
- Can have multiple profiles (dev, staging, prod)
- Supports complex nested configuration
- IDE autocomplete support with TypeScript interfaces

**Implementation**:

```typescript
import * as fs from 'fs';
import * as path from 'path';

interface ConfigFile {
  storage: {
    accountName: string;
    containerName: string;
    authMethod: 'azure-ad' | 'sas' | 'connection-string';
    endpointSuffix?: string;
  };
  logging: {
    level: 'info' | 'warn' | 'error';
  };
}

function loadConfigFromFile(configPath?: string): ConfigFile {
  const defaultPath = path.join(process.cwd(), 'azure-storage-config.json');
  const filePath = configPath || defaultPath;

  if (!fs.existsSync(filePath)) {
    throw new Error(`Configuration file not found: ${filePath}`);
  }

  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const config: ConfigFile = JSON.parse(fileContent);

  // Validate required fields
  if (!config.storage?.accountName) {
    throw new Error('storage.accountName is required in configuration file');
  }

  if (!config.storage?.containerName) {
    throw new Error('storage.containerName is required in configuration file');
  }

  return config;
}
```

**azure-storage-config.json example**:
```json
{
  "storage": {
    "accountName": "mystorageaccount",
    "containerName": "mycontainer",
    "authMethod": "azure-ad",
    "endpointSuffix": "core.windows.net"
  },
  "logging": {
    "level": "info"
  }
}
```

**Security Note**: **Never store secrets (SAS tokens, connection strings, account keys) in config files that are committed to source control.**

---

### 5.4 CLI Flags Approach

**Advantages**:
- Explicit and visible
- Overrides other configuration sources
- Easy to use in scripts and CI/CD
- Self-documenting via `--help`

**Implementation with Commander.js**:

```typescript
import { Command } from 'commander';

interface CliOptions {
  accountName?: string;
  containerName?: string;
  sasToken?: string;
  configFile?: string;
}

const program = new Command();

program
  .name('azure-storage-cli')
  .description('CLI tool for Azure Blob Storage file system operations')
  .version('1.0.0')
  .option('-a, --account-name <name>', 'Azure Storage account name')
  .option('-c, --container-name <name>', 'Container name')
  .option('-s, --sas-token <token>', 'SAS token for authentication')
  .option('--config-file <path>', 'Path to configuration file');

program
  .command('upload')
  .description('Upload a file to blob storage')
  .argument('<source>', 'Source file path')
  .argument('<destination>', 'Destination blob path')
  .action(async (source, destination, options) => {
    // CLI flags override environment variables
    const config = resolveConfig(program.opts());
    await uploadFile(config, source, destination);
  });

program.parse();
```

**Usage**:
```bash
azure-storage-cli upload local.txt remote.txt --account-name myaccount --container-name mycontainer
```

---

### 5.5 Recommended Configuration Strategy

**Layered Configuration Approach** (Priority Order - Highest to Lowest):

1. **CLI Flags** (highest priority)
2. **Environment Variables**
3. **Config File**
4. **Default Values** (lowest priority, only for non-sensitive settings)

**Implementation**:

```typescript
interface ResolvedConfig {
  accountName: string;
  containerName: string;
  sasToken?: string;
  endpointSuffix: string;
  logLevel: 'info' | 'warn' | 'error';
}

function resolveConfig(cliOptions: CliOptions): ResolvedConfig {
  // 1. Try CLI flags first
  let accountName = cliOptions.accountName;
  let containerName = cliOptions.containerName;
  let sasToken = cliOptions.sasToken;

  // 2. Try environment variables
  if (!accountName) {
    accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME;
  }

  if (!containerName) {
    containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;
  }

  if (!sasToken) {
    sasToken = process.env.AZURE_STORAGE_SAS_TOKEN;
  }

  // 3. Try config file
  if (cliOptions.configFile) {
    const fileConfig = loadConfigFromFile(cliOptions.configFile);
    accountName = accountName || fileConfig.storage.accountName;
    containerName = containerName || fileConfig.storage.containerName;
  }

  // 4. Validate required fields - NO FALLBACKS
  if (!accountName) {
    throw new Error(
      'Azure Storage account name is required. Set via:\n' +
      '  - CLI flag: --account-name\n' +
      '  - Environment variable: AZURE_STORAGE_ACCOUNT_NAME\n' +
      '  - Config file: storage.accountName'
    );
  }

  if (!containerName) {
    throw new Error(
      'Container name is required. Set via:\n' +
      '  - CLI flag: --container-name\n' +
      '  - Environment variable: AZURE_STORAGE_CONTAINER_NAME\n' +
      '  - Config file: storage.containerName'
    );
  }

  // 5. Apply defaults ONLY for non-sensitive settings
  const endpointSuffix = process.env.AZURE_STORAGE_ENDPOINT_SUFFIX || 'core.windows.net';
  const logLevel = (process.env.AZURE_LOG_LEVEL as any) || 'warn';

  return {
    accountName,
    containerName,
    sasToken,
    endpointSuffix,
    logLevel,
  };
}
```

**Key Principles**:
- **Never use fallback values for credentials** (per project requirements)
- **Throw clear errors** when required configuration is missing
- **Provide helpful error messages** that explain all configuration methods
- **Allow defaults only for non-sensitive settings** (endpoint suffix, log level)
- **Prefer environment variables** for secrets in production
- **Use CLI flags** for ad-hoc overrides
- **Use config files** for non-sensitive project settings

**Example Error Message**:
```
Error: Azure Storage account name is required. Set via:
  - CLI flag: --account-name <name>
  - Environment variable: AZURE_STORAGE_ACCOUNT_NAME=<name>
  - Config file: { "storage": { "accountName": "<name>" } }
```

---

## 6. CLI Tool Architecture

### 6.1 Recommended CLI Framework

**Commander.js** (Recommended)

**Reasons**:
- **Lightweight**: Minimal dependencies, small bundle size
- **TypeScript Support**: Includes TypeScript definitions
- **Popular**: 28k+ GitHub stars, widely adopted
- **Well-Documented**: Comprehensive documentation and examples
- **Flexible**: Supports subcommands, options, arguments, help text
- **Stable**: Mature project (10+ years)

**Installation**:
```bash
npm install commander
npm install @types/node  # For TypeScript
```

**Alternative: Yargs**
- More feature-rich (automatic completion, advanced parsing)
- Larger bundle size
- Declarative syntax
- Use if you need advanced features like bash/zsh completion

**For this project**: **Use Commander.js** for simplicity and TypeScript-first design.

---

### 6.2 Subcommand Structure

```typescript
import { Command } from 'commander';
import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';

const program = new Command();

program
  .name('azure-fs')
  .description('Azure Blob Storage File System CLI')
  .version('1.0.0')
  .option('-a, --account-name <name>', 'Azure Storage account name')
  .option('-c, --container-name <name>', 'Container name')
  .option('--json', 'Output in JSON format', false);

// Upload command
program
  .command('upload')
  .description('Upload a file to blob storage')
  .argument('<source>', 'Local file path')
  .argument('<destination>', 'Destination blob path')
  .option('-m, --metadata <json>', 'Custom metadata as JSON string')
  .action(async (source, destination, options, command) => {
    const globalOpts = command.parent.opts();
    await handleUpload(source, destination, options, globalOpts);
  });

// Download command
program
  .command('download')
  .alias('dl')
  .description('Download a blob to local file')
  .argument('<source>', 'Source blob path')
  .argument('<destination>', 'Local file path')
  .action(async (source, destination, options, command) => {
    const globalOpts = command.parent.opts();
    await handleDownload(source, destination, globalOpts);
  });

// List command
program
  .command('list')
  .alias('ls')
  .description('List blobs in a container or folder')
  .argument('[path]', 'Folder path (prefix)', '')
  .option('-r, --recursive', 'List recursively', false)
  .option('--include-metadata', 'Include metadata in output', false)
  .action(async (path, options, command) => {
    const globalOpts = command.parent.opts();
    await handleList(path, options, globalOpts);
  });

// Delete command
program
  .command('delete')
  .alias('rm')
  .description('Delete a blob or folder')
  .argument('<path>', 'Blob or folder path')
  .option('--recursive', 'Delete folder recursively', false)
  .action(async (path, options, command) => {
    const globalOpts = command.parent.opts();
    await handleDelete(path, options, globalOpts);
  });

// Exists command
program
  .command('exists')
  .description('Check if a blob exists')
  .argument('<path>', 'Blob path')
  .action(async (path, options, command) => {
    const globalOpts = command.parent.opts();
    await handleExists(path, globalOpts);
  });

// Metadata commands
const metadataCmd = program
  .command('metadata')
  .description('Manage blob metadata');

metadataCmd
  .command('get')
  .description('Get blob metadata')
  .argument('<path>', 'Blob path')
  .action(async (path, options, command) => {
    const globalOpts = command.parent.parent.opts();
    await handleMetadataGet(path, globalOpts);
  });

metadataCmd
  .command('set')
  .description('Set blob metadata')
  .argument('<path>', 'Blob path')
  .argument('<json>', 'Metadata as JSON string')
  .action(async (path, json, options, command) => {
    const globalOpts = command.parent.parent.opts();
    await handleMetadataSet(path, json, globalOpts);
  });

program.parse();
```

**Subcommand Structure**:
```
azure-fs
├── upload <source> <destination>
├── download <source> <destination>
├── list [path] [--recursive]
├── delete <path> [--recursive]
├── exists <path>
├── mkdir <path>
└── metadata
    ├── get <path>
    └── set <path> <json>
```

---

### 6.3 Output Format (JSON for Agent Consumption)

**Design Principles**:
- **Default**: Human-readable output (tables, colored text)
- **--json flag**: Machine-readable JSON output for agent consumption
- **Consistent structure**: All commands return similar JSON structure
- **Error handling**: Errors also formatted as JSON when --json is used

```typescript
interface CommandResult<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metadata?: {
    command: string;
    timestamp: string;
    durationMs: number;
  };
}

function formatOutput(result: CommandResult, jsonMode: boolean): void {
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    // Human-readable format
    if (result.success) {
      console.log('✓ Success');
      if (result.data) {
        console.table(result.data);
      }
    } else {
      console.error('✗ Error:', result.error?.message);
    }
  }
}

async function handleList(
  path: string,
  options: any,
  globalOpts: any
): Promise<void> {
  const startTime = Date.now();

  try {
    const config = resolveConfig(globalOpts);
    const client = createBlobServiceClient(config);
    const containerClient = client.getContainerClient(config.containerName);

    const items = await listBlobsHierarchical(containerClient, path);

    const result: CommandResult = {
      success: true,
      data: items,
      metadata: {
        command: 'list',
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      },
    };

    formatOutput(result, globalOpts.json);
  } catch (error: any) {
    const result: CommandResult = {
      success: false,
      error: {
        code: error.code || 'UNKNOWN_ERROR',
        message: error.message,
        details: error.statusCode ? { statusCode: error.statusCode } : undefined,
      },
      metadata: {
        command: 'list',
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      },
    };

    formatOutput(result, globalOpts.json);
    process.exit(1);
  }
}
```

**Example JSON Output**:

```json
{
  "success": true,
  "data": [
    {
      "name": "documents/",
      "type": "folder"
    },
    {
      "name": "documents/readme.txt",
      "type": "file",
      "size": 1024,
      "lastModified": "2026-02-20T10:30:00Z"
    }
  ],
  "metadata": {
    "command": "list",
    "timestamp": "2026-02-20T10:35:00Z",
    "durationMs": 234
  }
}
```

**Example Error JSON**:

```json
{
  "success": false,
  "error": {
    "code": "CONTAINER_NOT_FOUND",
    "message": "The specified container does not exist.",
    "details": {
      "statusCode": 404
    }
  },
  "metadata": {
    "command": "list",
    "timestamp": "2026-02-20T10:35:00Z",
    "durationMs": 123
  }
}
```

---

### 6.4 Error Handling Patterns

```typescript
class AzureStorageError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode?: number,
    public details?: any
  ) {
    super(message);
    this.name = 'AzureStorageError';
  }
}

function mapAzureError(error: any): AzureStorageError {
  // Map Azure SDK errors to custom error types
  if (error.statusCode === 404) {
    return new AzureStorageError(
      'NOT_FOUND',
      'The specified resource does not exist',
      404,
      { originalMessage: error.message }
    );
  } else if (error.statusCode === 403) {
    return new AzureStorageError(
      'ACCESS_DENIED',
      'Access denied. Check authentication and permissions.',
      403
    );
  } else if (error.statusCode === 409) {
    return new AzureStorageError(
      'CONFLICT',
      'The resource already exists',
      409
    );
  } else if (error.code === 'ENOENT') {
    return new AzureStorageError(
      'FILE_NOT_FOUND',
      'Local file not found',
      undefined,
      { path: error.path }
    );
  }

  return new AzureStorageError(
    'UNKNOWN_ERROR',
    error.message || 'An unknown error occurred',
    error.statusCode,
    { originalError: error }
  );
}

async function executeCommand<T>(
  commandFn: () => Promise<T>,
  commandName: string,
  jsonMode: boolean
): Promise<void> {
  const startTime = Date.now();

  try {
    const data = await commandFn();

    const result: CommandResult = {
      success: true,
      data,
      metadata: {
        command: commandName,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      },
    };

    formatOutput(result, jsonMode);
  } catch (error: any) {
    const mappedError = mapAzureError(error);

    const result: CommandResult = {
      success: false,
      error: {
        code: mappedError.code,
        message: mappedError.message,
        details: mappedError.details,
      },
      metadata: {
        command: commandName,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      },
    };

    formatOutput(result, jsonMode);
    process.exit(1);
  }
}
```

**Error Codes**:

| Code | Meaning | HTTP Status | Action |
|------|---------|-------------|--------|
| `NOT_FOUND` | Resource doesn't exist | 404 | Check path, create resource |
| `ACCESS_DENIED` | Authentication/authorization failed | 403 | Check credentials, RBAC roles |
| `CONFLICT` | Resource already exists | 409 | Use different name or overwrite flag |
| `FILE_NOT_FOUND` | Local file doesn't exist | N/A | Check local file path |
| `INVALID_CONFIG` | Configuration error | N/A | Set required environment variables |
| `NETWORK_ERROR` | Network connectivity issue | N/A | Check internet connection |
| `UNKNOWN_ERROR` | Unexpected error | Any | Check logs, contact support |

---

### 6.5 Stream Handling for Large Files

For large files (> 100 MB), use streaming to avoid loading entire file into memory.

```typescript
import * as fs from 'fs';
import * as path from 'path';

async function uploadLargeFile(
  containerClient: ContainerClient,
  localPath: string,
  blobPath: string
): Promise<void> {
  const stats = fs.statSync(localPath);
  const fileSizeInBytes = stats.size;

  console.log(`Uploading ${fileSizeInBytes} bytes...`);

  // For files > 100 MB, use uploadStream for memory efficiency
  if (fileSizeInBytes > 100 * 1024 * 1024) {
    const stream = fs.createReadStream(localPath);
    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);

    await blockBlobClient.uploadStream(
      stream,
      4 * 1024 * 1024, // 4 MiB buffer size
      10, // 10 concurrent uploads
      {
        onProgress: (progress) => {
          const percent = ((progress.loadedBytes / fileSizeInBytes) * 100).toFixed(2);
          process.stdout.write(`\rProgress: ${percent}%`);
        },
      }
    );

    process.stdout.write('\n');
  } else {
    // For smaller files, use uploadFile (simpler)
    const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
    await blockBlobClient.uploadFile(localPath);
  }

  console.log('Upload complete');
}

async function downloadLargeFile(
  containerClient: ContainerClient,
  blobPath: string,
  localPath: string
): Promise<void> {
  const blobClient = containerClient.getBlobClient(blobPath);

  // Get file size
  const properties = await blobClient.getProperties();
  const fileSizeInBytes = properties.contentLength || 0;

  console.log(`Downloading ${fileSizeInBytes} bytes...`);

  // For large files, download to file directly (streaming)
  if (fileSizeInBytes > 100 * 1024 * 1024) {
    await blobClient.downloadToFile(localPath, 0, undefined, {
      onProgress: (progress) => {
        const percent = ((progress.loadedBytes / fileSizeInBytes) * 100).toFixed(2);
        process.stdout.write(`\rProgress: ${percent}%`);
      },
    });

    process.stdout.write('\n');
  } else {
    // For smaller files, download to buffer
    const downloadResponse = await blobClient.download();
    const writeStream = fs.createWriteStream(localPath);

    if (downloadResponse.readableStreamBody) {
      downloadResponse.readableStreamBody.pipe(writeStream);

      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });
    }
  }

  console.log('Download complete');
}
```

**Handling Binary vs Text Files**:

```typescript
function isBinaryFile(filePath: string): boolean {
  // Simple heuristic: check file extension
  const textExtensions = ['.txt', '.json', '.xml', '.csv', '.md', '.html', '.css', '.js', '.ts'];
  const ext = path.extname(filePath).toLowerCase();
  return !textExtensions.includes(ext);
}

async function uploadFile(
  containerClient: ContainerClient,
  localPath: string,
  blobPath: string
): Promise<void> {
  const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
  const isBinary = isBinaryFile(localPath);

  const options = {
    blobHTTPHeaders: {
      blobContentType: isBinary ? 'application/octet-stream' : 'text/plain',
    },
  };

  if (isBinary) {
    // Binary: use stream
    const stream = fs.createReadStream(localPath);
    await blockBlobClient.uploadStream(stream, 4 * 1024 * 1024, 5, options);
  } else {
    // Text: can read as string
    const content = fs.readFileSync(localPath, 'utf-8');
    await blockBlobClient.upload(content, content.length, options);
  }
}
```

---

## 7. Key Findings and Recommendations

### Recommended Authentication Method

**Primary: DefaultAzureCredential**

For a TypeScript CLI tool used by developers and AI agents locally, `DefaultAzureCredential` is the best choice:

1. **Local Development**: Works seamlessly with `az login` (Azure CLI)
2. **Production Ready**: Same code works with managed identities in Azure
3. **Security**: No credentials in code or configuration files
4. **Flexibility**: Supports multiple authentication mechanisms automatically

**Fallback: User Delegation SAS Token**
- For scenarios where Azure AD is unavailable
- Time-limited, reducing security risks
- Can be generated via CLI or portal

**Avoid**:
- Connection strings (full account access, security risk)
- Account keys (same issues as connection strings)

---

### Recommended Folder Emulation Strategy

**Use Zero-Byte Marker Blobs**

Create explicit folder markers using zero-byte blobs with special metadata:

```typescript
await blockBlobClient.upload('', 0, {
  blobHTTPHeaders: { blobContentType: 'application/x-directory' },
  metadata: { hdi_isfolder: 'true' },
});
```

**Reasons**:
1. **Explicit representation**: Folders are visible in listings
2. **Metadata support**: Can attach metadata to folders
3. **Compatibility**: Works with Azure Portal and Storage Explorer
4. **Empty folder support**: Can represent empty directories
5. **ADLS Gen2 compatible**: Matches hierarchical namespace behavior

**Alternative** (Implicit): Folders created automatically when uploading files with prefixes
- Simpler but folders disappear when all files are deleted
- No metadata on folders
- Cannot distinguish between empty and non-existent folders

---

### Key NPM Packages to Use

```json
{
  "dependencies": {
    "@azure/storage-blob": "^12.31.0",
    "@azure/identity": "^4.0.0",
    "commander": "^12.0.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "typescript": "^5.3.0"
  }
}
```

**Package Descriptions**:
- `@azure/storage-blob`: Azure Blob Storage SDK (required)
- `@azure/identity`: Azure authentication (DefaultAzureCredential)
- `commander`: CLI framework (recommended)
- `dotenv`: Load environment variables from .env file
- `@types/node`: TypeScript definitions for Node.js
- `typescript`: TypeScript compiler

---

### Potential Pitfalls and How to Avoid Them

#### 1. Folder Semantics

**Pitfall**: Treating Azure Blob Storage like a true file system with real directories.

**Solution**:
- Use consistent delimiter (`/`) in blob names
- Create explicit folder markers (zero-byte blobs)
- Use `listBlobsByHierarchy()` for folder-like listings
- Handle folder deletion by deleting all blobs with matching prefix

---

#### 2. Metadata Size Limits

**Pitfall**: Exceeding 8 KB metadata limit, causing upload failures.

**Solution**:
- Validate metadata size before upload
- Use Blob Index Tags for queryable attributes (max 10 tags)
- Store large metadata in separate JSON blob or external database
- Keep metadata concise and essential

```typescript
function validateMetadataSize(metadata: Metadata): void {
  let totalSize = 0;
  for (const [key, value] of Object.entries(metadata)) {
    totalSize += 11 + key.length + value.length + 10; // x-ms-meta- prefix + overhead
  }

  if (totalSize > 8192) {
    throw new Error(`Metadata too large: ${totalSize} bytes (max: 8192)`);
  }
}
```

---

#### 3. Authentication Errors

**Pitfall**: Unclear errors when authentication fails or RBAC roles not assigned.

**Solution**:
- Provide clear error messages with actionable steps
- Check for common issues: role assignment propagation (up to 8 minutes)
- Verify Azure CLI login status: `az account show`
- Test with explicit SAS token first, then switch to DefaultAzureCredential

```typescript
try {
  await containerClient.exists();
} catch (error: any) {
  if (error.statusCode === 403) {
    console.error('Access denied. Troubleshooting steps:');
    console.error('1. Check if logged in: az account show');
    console.error('2. Verify RBAC role assignment (wait up to 8 minutes for propagation)');
    console.error('3. Required role: Storage Blob Data Contributor');
    console.error('4. Check scope: Should be scoped to storage account or container');
  }
  throw error;
}
```

---

#### 4. Case Sensitivity

**Pitfall**: Azure Blob Storage is case-sensitive, but metadata keys are case-insensitive.

**Solution**:
- Use consistent casing conventions (e.g., lowercase for all paths)
- Document casing rules in README
- Normalize paths in CLI tool before operations

```typescript
function normalizeBlobPath(path: string): string {
  // Remove leading slash
  path = path.replace(/^\/+/, '');

  // Normalize slashes
  path = path.replace(/\\/g, '/');

  // Remove duplicate slashes
  path = path.replace(/\/+/g, '/');

  return path;
}
```

---

#### 5. Race Conditions (Concurrent Edits)

**Pitfall**: Two processes editing the same blob simultaneously, causing data loss.

**Solution**:
- Use ETag-based conditional updates
- Implement retry logic with exponential backoff
- Warn users about concurrent modification risks

```typescript
async function editBlobSafe(
  blobClient: BlobClient,
  editFn: (content: string) => string,
  maxRetries: number = 3
): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    const downloadResponse = await blobClient.download();
    const etag = downloadResponse.etag;
    const content = await streamToString(downloadResponse.readableStreamBody!);

    const newContent = editFn(content);

    try {
      await blobClient.upload(newContent, newContent.length, {
        conditions: { ifMatch: etag },
      });
      return; // Success
    } catch (error: any) {
      if (error.statusCode === 412 && i < maxRetries - 1) {
        console.warn(`Retry ${i + 1}: Blob modified concurrently`);
        continue;
      }
      throw error;
    }
  }
}
```

---

#### 6. Large File Memory Issues

**Pitfall**: Loading large files into memory causes out-of-memory errors.

**Solution**:
- Use streaming for files > 100 MB
- Use `uploadStream()` and `downloadToFile()` methods
- Configure chunk size and concurrency appropriately

```typescript
const fileSizeInBytes = fs.statSync(localPath).size;

if (fileSizeInBytes > 100 * 1024 * 1024) {
  // Use streaming for large files
  const stream = fs.createReadStream(localPath);
  await blockBlobClient.uploadStream(stream, 4 * 1024 * 1024, 10);
} else {
  // Use simple upload for small files
  await blockBlobClient.uploadFile(localPath);
}
```

---

#### 7. Environment Variable Configuration

**Pitfall**: Missing or incorrect environment variables causing runtime failures.

**Solution**:
- Validate all required configuration at startup
- Provide clear error messages with all configuration options
- Never use fallback values for credentials (per project requirements)

```typescript
function validateConfig(): void {
  const required = ['AZURE_STORAGE_ACCOUNT_NAME', 'AZURE_STORAGE_CONTAINER_NAME'];
  const missing = required.filter(name => !process.env[name]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Set them in .env file or export as environment variables.'
    );
  }
}

validateConfig();
```

---

#### 8. Blob Naming Restrictions

**Pitfall**: Invalid blob names causing upload failures.

**Solution**:
- Validate blob names before operations
- Azure blob name restrictions:
  - 1-1024 characters
  - Case-sensitive
  - Any URL-safe character
  - Avoid leading/trailing slashes

```typescript
function validateBlobName(name: string): void {
  if (!name || name.length === 0) {
    throw new Error('Blob name cannot be empty');
  }

  if (name.length > 1024) {
    throw new Error('Blob name cannot exceed 1024 characters');
  }

  // Remove leading/trailing slashes
  if (name.startsWith('/') || name.endsWith('/')) {
    console.warn('Warning: Blob name should not start or end with "/"');
  }
}
```

---

### Suggested CLI Command Structure

```bash
# Upload
azure-fs upload <local-path> <blob-path>
azure-fs upload readme.txt documents/readme.txt
azure-fs upload folder/ documents/ --recursive

# Download
azure-fs download <blob-path> <local-path>
azure-fs download documents/readme.txt local-readme.txt
azure-fs download documents/ local-folder/ --recursive

# List
azure-fs list [path] [--recursive] [--json]
azure-fs list documents/
azure-fs list --recursive --json

# Delete
azure-fs delete <path> [--recursive]
azure-fs delete documents/readme.txt
azure-fs delete documents/ --recursive

# Check existence
azure-fs exists <path>
azure-fs exists documents/readme.txt

# Create folder
azure-fs mkdir <path>
azure-fs mkdir documents/projects/

# Metadata operations
azure-fs metadata get <path> [--json]
azure-fs metadata set <path> '{"author":"john","version":"1.0"}'
azure-fs metadata delete <path> <key>

# Properties
azure-fs properties get <path> [--json]
azure-fs properties set <path> --content-type "text/plain"

# Tags (for querying)
azure-fs tags get <path>
azure-fs tags set <path> '{"env":"prod","classification":"public"}'
azure-fs tags find 'env="prod" AND classification="public"'

# Configuration
azure-fs config set --account-name myaccount --container-name mycontainer
azure-fs config show
```

---

## 8. Reference Links

### Official Azure Documentation

1. **[@azure/storage-blob npm package](https://www.npmjs.com/package/@azure/storage-blob)**
   - Latest version information (12.31.0 as of February 2026)
   - Installation instructions
   - Changelog and release notes

2. **[Azure Storage Blob client library for JavaScript - Microsoft Learn](https://learn.microsoft.com/en-us/javascript/api/overview/azure/storage-blob-readme?view=azure-node-latest)**
   - Comprehensive SDK overview
   - Authentication methods
   - Code examples for all major operations
   - TypeScript type definitions reference

3. **[Quickstart: Azure Blob storage library - TypeScript - Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-quickstart-blobs-nodejs-typescript)**
   - Getting started guide
   - Project setup instructions
   - Basic CRUD operations
   - Authentication with DefaultAzureCredential

4. **[Get started with Azure Blob Storage and JavaScript or TypeScript - Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blob-javascript-get-started)**
   - Developer guide overview
   - Environment setup
   - Creating authorized clients
   - Best practices

5. **[List blobs with TypeScript - Azure Storage - Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blobs-list-javascript)**
   - Flat vs hierarchical listing
   - Prefix and delimiter usage
   - Pagination examples
   - Virtual directory emulation

6. **[Upload a blob with JavaScript or TypeScript - Azure Storage - Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blob-upload-javascript)**
   - Upload methods (file, stream, buffer, string)
   - Parallel upload configuration
   - Setting metadata and tags on upload
   - Access tier configuration

7. **[Manage properties and metadata for a blob with JavaScript - Azure Storage - Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blob-properties-metadata-javascript)**
   - System properties vs custom metadata
   - Getting and setting metadata
   - HTTP headers configuration
   - Best practices

8. **[Use blob index tags to manage and find data with JavaScript or TypeScript - Azure Storage - Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blob-tags-javascript)**
   - Setting and getting index tags
   - Querying blobs by tags
   - Tag query syntax
   - Permissions required

9. **[Azure Data Lake Storage hierarchical namespace - Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/blobs/data-lake-storage-namespace)**
   - Flat vs hierarchical namespace comparison
   - Folder emulation patterns
   - Virtual directory behavior
   - Trade-offs and considerations

10. **[Setting and retrieving properties and metadata for Blob service resources - REST API - Microsoft Learn](https://learn.microsoft.com/en-us/rest/api/storageservices/setting-and-retrieving-properties-and-metadata-for-blob-resources)**
    - Metadata naming requirements
    - Size constraints and limits
    - HTTP header requirements
    - REST API reference

11. **[Naming and Referencing Containers, Blobs, and Metadata - Azure Storage - Microsoft Learn](https://learn.microsoft.com/en-us/rest/api/storageservices/naming-and-referencing-containers--blobs--and-metadata)**
    - Blob naming restrictions
    - Container naming rules
    - Metadata naming conventions
    - Character encoding requirements

### Authentication and Security

12. **[Authorize access to blobs using Azure Active Directory - Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/common/storage-auth-aad-app)**
    - Azure AD authentication setup
    - Registering applications
    - Assigning RBAC roles
    - Best practices for production

13. **[Grant limited access to data with shared access signatures (SAS) - Azure Storage - Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/common/storage-sas-overview)**
    - SAS token types (user delegation, service, account)
    - Permissions and scoping
    - Expiration and security
    - Generation examples

14. **[Configure a connection string - Azure Storage - Microsoft Learn](https://learn.microsoft.com/en-us/azure/storage/common/storage-configure-connection-string)**
    - Connection string format
    - Security considerations
    - When to use vs alternatives
    - Best practices

### CLI Tool Development

15. **[Commander.js Documentation](https://github.com/tj/commander.js)**
    - CLI framework documentation
    - Subcommand structure
    - Options and arguments
    - TypeScript usage

16. **[Building CLI apps with TypeScript in 2026](https://hackers.pub/@hongminhee/2026/typescript-cli-2026)**
    - Modern CLI development patterns
    - TypeScript-first design
    - Comparison of CLI frameworks
    - Best practices for 2026

17. **[How to Create a CLI Tool with Node.js](https://oneuptime.com/blog/post/2026-01-22-nodejs-create-cli-tool/view)**
    - Node.js CLI basics
    - Package.json configuration
    - Distribution and installation
    - Testing strategies

### Code Samples and Examples

18. **[Azure Storage Blob TypeScript Samples - GitHub](https://github.com/Azure-Samples/AzureStorageSnippets/tree/master/blobs/howto/TypeScript/NodeJS-v12/dev-guide/src)**
    - Official Microsoft code samples
    - TypeScript examples for all operations
    - Best practices implementations
    - Real-world usage patterns

19. **[Azure SDK for JavaScript - Storage Blob Source Code](https://github.com/Azure/azure-sdk-for-js/tree/main/sdk/storage/storage-blob)**
    - SDK source code
    - Type definitions
    - Advanced usage examples
    - Contribution guidelines

20. **[@azure/storage-blob Changelog](https://github.com/Azure/azure-sdk-for-js/blob/main/sdk/storage/storage-blob/CHANGELOG.md)**
    - Version history
    - Breaking changes
    - New features
    - Bug fixes

### Additional Resources

21. **[Azure Storage Explorer](https://azure.microsoft.com/en-us/products/storage/storage-explorer/)**
    - GUI tool for testing and debugging
    - Visual folder structure
    - Metadata and properties viewer
    - Free download

22. **[Azure CLI Storage Commands](https://learn.microsoft.com/en-us/cli/azure/storage/blob?view=azure-cli-latest)**
    - Command-line reference
    - Alternative CLI tool
    - Scripting examples
    - Integration patterns

---

## Assumptions & Scope

### Assumptions Made

| Assumption | Confidence | Impact if Wrong |
|------------|------------|-----------------|
| Target platform is Node.js 18+ for TypeScript CLI tool | HIGH | Would need to adjust SDK features (e.g., browser-specific methods) |
| Users have Azure CLI installed for local development | MEDIUM | Would need to provide alternative authentication setup instructions |
| DefaultAzureCredential is the preferred authentication method | HIGH | Would need to prioritize connection string or SAS token examples |
| CLI tool will be used primarily by developers, not end-users | HIGH | Would need to simplify error messages and add more user-friendly help text |
| Container name is known at configuration time | HIGH | Would need to add container discovery/selection features |
| Flat namespace (not hierarchical/ADLS Gen2) is sufficient | MEDIUM | Would need to document HNS-specific features and API differences |
| Zero-byte folder markers are acceptable | MEDIUM | Would need to implement implicit folder creation only |
| JSON output format is suitable for agent consumption | HIGH | Would need to support additional formats (XML, YAML, etc.) |
| Metadata size rarely exceeds 4 KB in practice | MEDIUM | Would need to implement metadata storage in separate blobs or external DB |
| Users understand basic Azure concepts (storage accounts, containers, blobs) | MEDIUM | Would need to add more educational content and conceptual explanations |

### Scope Boundaries

**In Scope**:
- Azure Blob Storage SDK for TypeScript/JavaScript
- Block blobs (most common type)
- File system emulation (read, write, list, delete)
- Metadata and properties management
- Authentication methods (Azure AD, SAS, connection string)
- CLI tool architecture and design patterns
- Configuration strategies
- Error handling for agent integration

**Out of Scope**:
- Page blobs and append blobs
- Azure Data Lake Storage Gen2 specific features (ACLs, POSIX permissions)
- Blob versioning and soft delete
- Blob leasing and concurrency control (beyond basic ETags)
- Azure Storage account management (creating accounts, managing keys)
- Blob replication and lifecycle management policies
- Azure Functions or serverless integration
- Performance benchmarking and optimization deep dives
- Security compliance (GDPR, HIPAA, etc.)
- Multi-cloud abstraction (AWS S3, Google Cloud Storage)

### Uncertainties & Gaps

**Areas with Uncertainty**:

1. **Performance Characteristics**:
   - Optimal chunk size and concurrency for different file sizes and network conditions
   - Real-world latency and throughput numbers for various operations
   - Cost implications of different operation patterns (transactions, data transfer)

2. **Edge Cases**:
   - Behavior when blob names contain special Unicode characters
   - Handling of extremely deep folder hierarchies (100+ levels)
   - Behavior when metadata approaches 8 KB limit with non-ASCII characters

3. **Agent-Specific Requirements**:
   - Exact output format preferences for Claude Code agent
   - Error message structure that agents can reliably parse
   - Required verbosity level for agent feedback

4. **Hierarchical Namespace Impact**:
   - API differences when HNS is enabled
   - Migration path from flat to hierarchical namespace
   - Performance comparison between flat and hierarchical

### Clarifying Questions for Follow-up

1. **Authentication**: Should the tool support multiple authentication profiles (dev, staging, prod) or just use environment variables?
   **Answer:** I prefer to use authentication profiles.

2. **Container Management**: Should the tool support creating/deleting containers, or assume containers already exist?
   **Answer:** I want to support container management.

3. **Folder Markers**: Is the 4-byte overhead of zero-byte folder markers acceptable, or should we use implicit folders only?
   **Answer:** It is acceptable

4. **Binary Files**: Should the tool attempt to detect text vs binary automatically, or require explicit flags?
   **Answer:** I want you to support the text detection

5. **Progress Reporting**: For long-running operations (large uploads/downloads), should progress be reported as JSON events or just human-readable progress bars?
   **Answer:** I want the JSON events support

6. **Concurrent Operations**: Should the tool support batch operations (upload multiple files in parallel) or single-file operations only?
   **Answer:** Yes I want to support batch operations. I want the tool to be prepared to be used server side. 

7. **Caching**: Should the tool cache blob metadata locally to reduce API calls, or always fetch fresh data?
   **Answer:** The metadata caching must be the tool's user responsibility. The tool must provide all the necessary content to allow tool user to build his own caching mechanism. 

8. **Error Recovery**: Should failed uploads/downloads be automatically retried, and if so, with what strategy (exponential backoff, fixed retries)?
   **Answer:** I want the tool to offer recovery options: none, exponential, fixed

9.  **Logging**: What level of logging detail is needed? Should all Azure SDK requests be logged?
    **Answer:** I want to log all the request, just ommiting the files' content. The rest of the parameters together with the tools must be logged.  

10. **Testing**: Should the research include integration testing strategies, or just focus on design and implementation patterns?
    **Answer:** I want you to prepare a testing strategy.

---

## Conclusion

This research document provides comprehensive guidance for building a TypeScript CLI tool that uses Azure Blob Storage as a virtual file system. The key recommendations are:

1. **Use DefaultAzureCredential** for authentication (best security and developer experience)
2. **Use zero-byte marker blobs** for explicit folder representation
3. **Implement Commander.js** for CLI framework (lightweight, TypeScript-friendly)
4. **Support JSON output** for agent consumption with structured error responses
5. **Handle large files with streaming** to avoid memory issues
6. **Validate configuration strictly** with clear error messages (no fallback values)

The SDK provides all necessary features for file system emulation, with the main consideration being that folders are virtual (prefix-based) rather than true directories. Proper error handling, metadata management, and streaming support will ensure the tool works reliably for both small and large files.

