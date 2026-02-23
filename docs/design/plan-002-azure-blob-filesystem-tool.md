# Plan 002: Azure Blob Storage File System CLI Tool - Implementation Plan

**Date**: 2026-02-22
**Status**: Draft
**Research Reference**: `docs/reference/azure-blob-storage-filesystem-research.md`

---

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [Configuration System](#2-configuration-system)
3. [Authentication Module](#3-authentication-module)
4. [File System Service Layer](#4-file-system-service-layer)
5. [CLI Command Structure](#5-cli-command-structure)
6. [Path Normalization](#6-path-normalization)
7. [Error Handling Strategy](#7-error-handling-strategy)
8. [Testing Strategy](#8-testing-strategy)
9. [Implementation Phases](#9-implementation-phases)

---

## 1. Project Structure

### 1.1 Directory Layout

```
azure-storage-tool/
├── src/
│   ├── index.ts                          # CLI entry point (shebang, Commander bootstrap)
│   ├── commands/
│   │   ├── index.ts                      # Command registration barrel
│   │   ├── config.commands.ts            # config init | show | validate
│   │   ├── file.commands.ts              # upload | download | delete | replace | info
│   │   ├── folder.commands.ts            # ls | mkdir | rmdir | exists
│   │   ├── edit.commands.ts              # edit | patch | append
│   │   ├── meta.commands.ts              # meta set | get | update | delete
│   │   └── tags.commands.ts              # tags set | get | query
│   ├── services/
│   │   ├── blob-filesystem.service.ts    # Core BlobFileSystemService class
│   │   ├── auth.service.ts               # Authentication factory
│   │   ├── config.service.ts             # Configuration loading & validation
│   │   ├── metadata.service.ts           # Metadata & tag operations
│   │   └── path.service.ts              # Path normalization & validation
│   ├── config/
│   │   ├── config.schema.ts              # Configuration interfaces & validation
│   │   └── config.loader.ts              # Layered config loading (CLI > env > file)
│   ├── types/
│   │   ├── index.ts                      # Type barrel export
│   │   ├── config.types.ts               # Configuration type definitions
│   │   ├── command-result.types.ts       # CommandResult<T> and related types
│   │   ├── filesystem.types.ts           # FileSystemItem, FileInfo, FolderInfo
│   │   ├── patch.types.ts               # PatchInstruction, PatchResult
│   │   └── errors.types.ts              # Error code enums and error types
│   ├── utils/
│   │   ├── output.utils.ts              # JSON/human-readable output formatter
│   │   ├── stream.utils.ts              # streamToString, streamToBuffer helpers
│   │   ├── content-type.utils.ts        # MIME type detection from file extension
│   │   ├── retry.utils.ts              # Retry logic (none, exponential, fixed)
│   │   ├── validation.utils.ts          # Metadata key/size validation, blob name validation
│   │   └── logger.utils.ts             # Request logging (omitting file content)
│   └── errors/
│       ├── index.ts                      # Error barrel export
│       ├── base.error.ts                # BaseAppError
│       ├── config.error.ts              # ConfigError
│       ├── auth.error.ts               # AuthError
│       ├── blob-not-found.error.ts      # BlobNotFoundError
│       ├── path.error.ts               # PathError
│       ├── metadata.error.ts            # MetadataError
│       └── network.error.ts             # NetworkError
├── test_scripts/
│   ├── test-config.ts                    # Configuration loading tests
│   ├── test-auth.ts                      # Authentication method tests
│   ├── test-file-operations.ts           # Upload, download, delete, replace tests
│   ├── test-folder-operations.ts         # mkdir, ls, rmdir, exists tests
│   ├── test-edit-operations.ts           # edit, patch, append tests
│   ├── test-metadata.ts                  # Metadata CRUD tests
│   ├── test-tags.ts                      # Tag set, get, query tests
│   ├── test-error-scenarios.ts           # Error handling tests
│   └── test-cli-integration.ts           # End-to-end CLI command tests
├── docs/
│   ├── design/
│   │   ├── project-design.md
│   │   ├── project-functions.md
│   │   └── plan-002-azure-blob-filesystem-tool.md  (this file)
│   └── reference/
│       └── azure-blob-storage-filesystem-research.md
├── prompts/                              # AI prompts used during development
├── package.json
├── tsconfig.json
├── .azure-fs.json.example                # Example config file (committed)
├── .env.example                          # Example env vars (committed)
├── .gitignore
├── CLAUDE.md                             # Tool documentation
└── Issues - Pending Items.md             # Issues tracker
```

### 1.2 Entry Point and CLI Bootstrap

**File**: `src/index.ts`

```
#!/usr/bin/env node
```

The entry point will:
1. Import Commander.js and create the root `program` instance named `azure-fs`
2. Register global options: `--json`, `--verbose`, `--config <path>`, `--account-name`, `--container-name`, `--auth-method`
3. Import and register all command modules from `commands/`
4. Call `program.parseAsync(process.argv)` with global error handler wrapping

### 1.3 TypeScript Configuration

**File**: `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "moduleResolution": "node"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test_scripts"]
}
```

**Rationale**:
- `target: ES2022` -- supports top-level await, Node 18+ features
- `module: commonjs` -- Commander.js works best with CJS
- `strict: true` -- enforces type safety throughout
- `declaration: true` -- enables using the service layer as a library

### 1.4 Package.json

```json
{
  "name": "azure-fs",
  "version": "1.0.0",
  "description": "Azure Blob Storage virtual file system CLI tool",
  "main": "dist/index.js",
  "bin": {
    "azure-fs": "dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node src/index.ts",
    "clean": "rm -rf dist",
    "lint": "eslint src/",
    "test": "ts-node test_scripts/test-cli-integration.ts"
  },
  "dependencies": {
    "@azure/storage-blob": "^12.31.0",
    "@azure/identity": "^4.0.0",
    "commander": "^12.0.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "typescript": "^5.3.0",
    "ts-node": "^10.9.0",
    "eslint": "^9.0.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

### 1.5 Build and Run Scripts

| Command | Purpose |
|---------|---------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Run directly via ts-node (development) |
| `npm start` | Run compiled output |
| `npm run clean` | Remove dist/ directory |
| `npm run lint` | Run ESLint |
| `npm test` | Run integration test suite |

After build, the tool is invokable as:
```bash
node dist/index.js ls /documents
# or after npm link:
azure-fs ls /documents
```

---

## 2. Configuration System

### 2.1 Configuration File Format

**File name**: `.azure-fs.json`
**Location search order**:
1. Path specified by `--config` CLI flag
2. Current working directory (`./.azure-fs.json`)
3. User home directory (`~/.azure-fs.json`)

**Schema**:

```typescript
interface AzureFsConfigFile {
  storage: {
    accountUrl: string;          // e.g., "https://myaccount.blob.core.windows.net"
    containerName: string;       // e.g., "my-container"
    authMethod: "connection-string" | "sas-token" | "azure-ad";
  };
  logging: {
    level: "debug" | "info" | "warn" | "error";
    logRequests: boolean;        // Log all Azure SDK requests (omitting file content)
  };
  retry: {
    strategy: "none" | "exponential" | "fixed";
    maxRetries: number;          // e.g., 3
    initialDelayMs: number;      // e.g., 1000 (for exponential/fixed)
    maxDelayMs: number;          // e.g., 30000 (for exponential)
  };
}
```

**Example `.azure-fs.json`**:

```json
{
  "storage": {
    "accountUrl": "https://myaccount.blob.core.windows.net",
    "containerName": "agent-files",
    "authMethod": "azure-ad"
  },
  "logging": {
    "level": "info",
    "logRequests": true
  },
  "retry": {
    "strategy": "exponential",
    "maxRetries": 3,
    "initialDelayMs": 1000,
    "maxDelayMs": 30000
  }
}
```

### 2.2 Environment Variable Mappings

| Config Property | Environment Variable | Description |
|----------------|---------------------|-------------|
| `storage.accountUrl` | `AZURE_STORAGE_ACCOUNT_URL` | Full storage account URL |
| `storage.containerName` | `AZURE_STORAGE_CONTAINER_NAME` | Default container |
| `storage.authMethod` | `AZURE_FS_AUTH_METHOD` | `connection-string`, `sas-token`, or `azure-ad` |
| (auth credential) | `AZURE_STORAGE_CONNECTION_STRING` | Connection string (when authMethod = connection-string) |
| (auth credential) | `AZURE_STORAGE_SAS_TOKEN` | SAS token (when authMethod = sas-token) |
| `logging.level` | `AZURE_FS_LOG_LEVEL` | Log level |
| `retry.strategy` | `AZURE_FS_RETRY_STRATEGY` | Retry strategy |

### 2.3 CLI Flag Overrides

| Flag | Short | Description |
|------|-------|-------------|
| `--account-url <url>` | `-a` | Storage account URL |
| `--container <name>` | `-c` | Container name |
| `--auth-method <method>` | | Auth method override |
| `--config <path>` | | Path to config file |
| `--json` | | Output JSON format |
| `--verbose` | `-v` | Enable verbose logging |

### 2.4 Configuration Loading Priority

```
CLI Flags  >  Environment Variables  >  Config File
  (highest)                              (lowest)
```

**Implementation** (`src/config/config.loader.ts`):

```typescript
function loadConfig(cliOptions: CliOptions): ResolvedConfig {
  // 1. Load config file (if found)
  const fileConfig = loadConfigFile(cliOptions.configPath);

  // 2. Load environment variables
  const envConfig = loadEnvConfig();

  // 3. Merge: CLI > Env > File
  const merged = mergeConfigs(fileConfig, envConfig, cliOptions);

  // 4. Validate -- throw if ANY required field is missing
  validateConfig(merged);

  return merged;
}
```

### 2.5 Configuration Validation (NO Fallbacks)

**CRITICAL RULE**: Every required configuration parameter must be explicitly provided. If any required value is missing, the tool MUST throw a `ConfigError` with:
- Which parameter is missing
- All methods to provide it (CLI flag, env var, config file field)
- Example of how to set it

**Required parameters (always)**:
- `storage.accountUrl` -- no fallback, no default
- `storage.containerName` -- no fallback, no default
- `storage.authMethod` -- no fallback, no default

**Required per auth method**:
- `connection-string`: `AZURE_STORAGE_CONNECTION_STRING` must be set
- `sas-token`: `AZURE_STORAGE_SAS_TOKEN` must be set
- `azure-ad`: No additional credential required (DefaultAzureCredential handles it)

**Required parameters (always, no fallback)**:
- `logging.level` -- no fallback
- `logging.logRequests` -- no fallback
- `retry.strategy` -- no fallback
- `retry.maxRetries` -- no fallback
- `retry.initialDelayMs` -- no fallback (except when strategy is "none")
- `retry.maxDelayMs` -- no fallback (except when strategy is "none")

**Example error message**:

```
ConfigError: Missing required configuration: storage.accountUrl

Provide it via one of the following methods:
  - CLI flag:          --account-url https://myaccount.blob.core.windows.net
  - Environment var:   export AZURE_STORAGE_ACCOUNT_URL=https://myaccount.blob.core.windows.net
  - Config file:       { "storage": { "accountUrl": "https://myaccount.blob.core.windows.net" } }

Run 'azure-fs config init' to create a configuration file interactively.
```

---

## 3. Authentication Module

### 3.1 Architecture

The authentication module uses a **factory pattern** to create the appropriate Azure Storage client based on the configured `authMethod`.

**File**: `src/services/auth.service.ts`

```
┌─────────────────────────────────────────────────────┐
│                  AuthService                         │
│                                                     │
│  createClient(config: ResolvedConfig)               │
│     │                                               │
│     ├── authMethod === "connection-string"           │
│     │   └── createConnectionStringClient()          │
│     │       └── BlobServiceClient.fromConnectionString()
│     │                                               │
│     ├── authMethod === "sas-token"                  │
│     │   └── createSasTokenClient()                  │
│     │       └── new BlobServiceClient(url + sasToken)│
│     │                                               │
│     └── authMethod === "azure-ad"                   │
│         └── createAzureAdClient()                   │
│             └── new BlobServiceClient(url, credential)│
│                 with DefaultAzureCredential          │
└─────────────────────────────────────────────────────┘
```

### 3.2 Interface

```typescript
interface AuthService {
  createBlobServiceClient(config: ResolvedConfig): BlobServiceClient;
  createContainerClient(config: ResolvedConfig): ContainerClient;
  validateConnection(config: ResolvedConfig): Promise<ConnectionTestResult>;
}

interface ConnectionTestResult {
  success: boolean;
  authMethod: string;
  accountUrl: string;
  containerName: string;
  containerExists: boolean;
  error?: string;
}
```

### 3.3 Authentication Method Details

#### Connection String Method

**Required env var**: `AZURE_STORAGE_CONNECTION_STRING`

```typescript
function createConnectionStringClient(config: ResolvedConfig): BlobServiceClient {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) {
    throw new AuthError(
      'MISSING_CONNECTION_STRING',
      'AZURE_STORAGE_CONNECTION_STRING environment variable is required when authMethod is "connection-string".\n' +
      'Set it via: export AZURE_STORAGE_CONNECTION_STRING="DefaultEndpointsProtocol=https;AccountName=..."\n' +
      'Find it in: Azure Portal > Storage Account > Access Keys'
    );
  }
  return BlobServiceClient.fromConnectionString(connectionString);
}
```

#### SAS Token Method

**Required env var**: `AZURE_STORAGE_SAS_TOKEN`

```typescript
function createSasTokenClient(config: ResolvedConfig): BlobServiceClient {
  const sasToken = process.env.AZURE_STORAGE_SAS_TOKEN;
  if (!sasToken) {
    throw new AuthError(
      'MISSING_SAS_TOKEN',
      'AZURE_STORAGE_SAS_TOKEN environment variable is required when authMethod is "sas-token".\n' +
      'Set it via: export AZURE_STORAGE_SAS_TOKEN="sv=2021-06-08&ss=b&srt=sco&..."\n' +
      'Generate it in: Azure Portal > Storage Account > Shared Access Signature'
    );
  }
  const separator = config.storage.accountUrl.includes('?') ? '&' : '?';
  return new BlobServiceClient(`${config.storage.accountUrl}${separator}${sasToken}`);
}
```

#### Azure AD Method (Recommended)

**No additional env vars required** -- `DefaultAzureCredential` discovers credentials automatically.

```typescript
function createAzureAdClient(config: ResolvedConfig): BlobServiceClient {
  const credential = new DefaultAzureCredential();
  return new BlobServiceClient(config.storage.accountUrl, credential);
}
```

**Error guidance when Azure AD fails**:

```
AuthError: Azure AD authentication failed.

Troubleshooting steps:
  1. Check if logged in: az account show
  2. Log in if needed: az login
  3. Verify RBAC role: Storage Blob Data Contributor
  4. Check scope: Storage account or container level
  5. Note: Role assignments can take up to 8 minutes to propagate
```

### 3.4 Connection Validation

The `config validate` command will:
1. Create the client using the configured auth method
2. Attempt `containerClient.exists()` to verify connectivity and permissions
3. Return a `ConnectionTestResult` with detailed diagnostics

---

## 4. File System Service Layer

### 4.1 Core Service Class

**File**: `src/services/blob-filesystem.service.ts`

The `BlobFileSystemService` is the central service class. It wraps all Azure Blob Storage operations behind a file-system-oriented API. Every method:
- Accepts normalized paths (via `PathService`)
- Returns typed results
- Throws custom errors from `src/errors/`
- Supports the configured retry strategy
- Logs requests (omitting file content) via the logger

```
┌──────────────────────────────────────────────────────────────┐
│                   BlobFileSystemService                       │
│                                                              │
│  constructor(containerClient, config, logger)                │
│                                                              │
│  ┌─────────────────┐  ┌──────────────────┐                  │
│  │ Folder Operations│  │ File Operations  │                  │
│  │                 │  │                  │                  │
│  │ createFolder()  │  │ uploadFile()     │                  │
│  │ listFolder()    │  │ downloadFile()   │                  │
│  │ deleteFolder()  │  │ deleteFile()     │                  │
│  │ folderExists()  │  │ fileExists()     │                  │
│  └─────────────────┘  │ replaceFile()    │                  │
│                       │ getFileInfo()    │                  │
│  ┌─────────────────┐  └──────────────────┘                  │
│  │ Edit Operations │                                        │
│  │                 │  ┌──────────────────┐                  │
│  │ editFile()      │  │ Metadata Ops     │                  │
│  │ patchFile()     │  │                  │                  │
│  │ appendToFile()  │  │ setMetadata()    │                  │
│  └─────────────────┘  │ getMetadata()    │                  │
│                       │ updateMetadata() │                  │
│                       │ deleteMetadata() │                  │
│                       │ setTags()        │                  │
│                       │ getTags()        │                  │
│                       │ queryByTags()    │                  │
│                       └──────────────────┘                  │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 Folder Operations

#### createFolder(path: string): Promise\<FolderCreateResult\>

Creates a virtual directory using a zero-byte marker blob (per research recommendation).

- Normalize path, ensure it ends with `/`
- Create zero-byte blob at the normalized path
- Set `blobContentType: 'application/x-directory'`
- Set metadata `{ hdi_isfolder: 'true' }` for ADLS Gen2 compatibility
- Return `{ path, created: true }` or `{ path, created: false, reason: 'already_exists' }`

#### listFolder(path: string, options?: ListOptions): Promise\<FileSystemItem[]\>

Lists files and subfolders at one level using `listBlobsByHierarchy('/', { prefix })`.

```typescript
interface ListOptions {
  recursive?: boolean;         // Use flat listing instead of hierarchy
  includeMetadata?: boolean;
  includeTags?: boolean;
}

interface FileSystemItem {
  name: string;                // Relative name (not full path)
  fullPath: string;            // Full blob path
  type: 'file' | 'folder';
  size?: number;               // In bytes, undefined for folders
  lastModified?: string;       // ISO 8601
  contentType?: string;
  metadata?: Record<string, string>;
}
```

- For hierarchical listing: iterate `blobPrefixes` (folders) and `blobItems` (files)
- For recursive listing: use `listBlobsFlat({ prefix })` and return all items
- Filter out the folder marker blob itself from file results
- Extract relative names by stripping the prefix

#### deleteFolder(path: string): Promise\<FolderDeleteResult\>

Recursively deletes all blobs under the given prefix.

```typescript
interface FolderDeleteResult {
  path: string;
  deletedCount: number;
  deletedItems: string[];
}
```

- Normalize path, ensure it ends with `/`
- List all blobs with `listBlobsFlat({ prefix })`
- Delete each blob (including the folder marker)
- Return count and list of deleted blob names

#### folderExists(path: string): Promise\<boolean\>

- Normalize path, ensure it ends with `/`
- Check for folder marker blob existence first (`blobClient.exists()`)
- If no marker, check if any blobs have this prefix (fetch 1 item)
- Return true if either check succeeds

### 4.3 File Operations

#### uploadFile(remotePath, source, options?): Promise\<UploadResult\>

```typescript
interface UploadOptions {
  metadata?: Record<string, string>;
  tags?: Record<string, string>;
  contentType?: string;        // Override auto-detection
  overwrite?: boolean;         // Default: true
}

interface UploadResult {
  path: string;
  size: number;
  etag: string;
  contentType: string;
  metadata?: Record<string, string>;
}
```

- `source` can be a local file path (string) or content (Buffer/string)
- Auto-detect content type from extension using `content-type.utils.ts`
- For files > 100MB, use `uploadStream()` for memory efficiency (per research)
- For smaller files, use `uploadFile()` or `upload()` directly
- Validate metadata keys and size before upload
- Log the request parameters (path, size, content type) but NOT the file content

#### downloadFile(remotePath, localPath?): Promise\<DownloadResult\>

```typescript
interface DownloadResult {
  path: string;
  content?: string;           // Present when no localPath given
  localPath?: string;         // Present when localPath given
  size: number;
  contentType: string;
  etag: string;
  metadata?: Record<string, string>;
}
```

- If `localPath` is provided, use `downloadToFile()` for large files or stream-to-file for smaller ones
- If `localPath` is omitted, download to string and return in `content`
- For files > 100MB, always use `downloadToFile()` (per research recommendation)

#### deleteFile(remotePath): Promise\<DeleteResult\>

```typescript
interface DeleteResult {
  path: string;
  deleted: boolean;
  existed: boolean;
}
```

- Use `blobClient.deleteIfExists({ deleteSnapshots: 'include' })`
- Return whether the blob existed before deletion

#### fileExists(remotePath): Promise\<boolean\>

- Use `blobClient.exists()`
- Return boolean

#### replaceFile(remotePath, source, options?): Promise\<UploadResult\>

- Verify the blob exists first; throw `BlobNotFoundError` if not
- Upload with ETag-based conditional access to prevent race conditions (per research)
- Same parameters and return type as `uploadFile`

#### getFileInfo(remotePath): Promise\<FileInfo\>

```typescript
interface FileInfo {
  path: string;
  size: number;
  contentType: string;
  contentEncoding?: string;
  lastModified: string;
  etag: string;
  metadata: Record<string, string>;
  tags?: Record<string, string>;
}
```

- Use `blobClient.getProperties()` for system properties and metadata
- Optionally fetch tags with `blobClient.getTags()`

### 4.4 Edit Operations

All three editing strategies are encapsulated in the service layer. Each operates on the fundamental pattern that blobs are immutable -- all editing requires download, modify, re-upload.

#### Strategy 1: Read-Modify-Write (`editFile`)

```typescript
editFile(remotePath: string, localPath: string): Promise<EditResult>
```

```typescript
interface EditResult {
  path: string;
  originalSize: number;
  newSize: number;
  etag: string;
}
```

**Flow**:
1. Download blob content to the specified `localPath`
2. Return control to the caller (the caller modifies the file locally)
3. Caller invokes a second method `commitEdit(remotePath, localPath)` to re-upload
4. Use ETag-based conditional upload to prevent concurrent modification

**Alternative (single-call for programmatic use)**:
```typescript
editFileWithFn(remotePath: string, editFn: (content: string) => string): Promise<EditResult>
```

This downloads, applies `editFn`, and re-uploads in one operation with ETag protection.

#### Strategy 2: In-Place Patch (`patchFile`)

```typescript
patchFile(remotePath: string, patches: PatchInstruction[]): Promise<PatchResult>
```

```typescript
interface PatchInstruction {
  type: 'find-replace' | 'regex';
  find: string;                 // Text to find (literal or regex pattern)
  replace: string;              // Replacement text
  flags?: string;               // Regex flags (e.g., 'g', 'gi') -- only for type: 'regex'
}

interface PatchResult {
  path: string;
  patchesApplied: number;
  patchesFailed: number;
  originalSize: number;
  newSize: number;
  etag: string;
  details: PatchDetail[];
}

interface PatchDetail {
  instruction: PatchInstruction;
  matchesFound: number;
  applied: boolean;
  error?: string;
}
```

**Flow**:
1. Download blob content as string
2. Apply each `PatchInstruction` sequentially:
   - For `find-replace`: use `String.prototype.replaceAll(find, replace)`
   - For `regex`: compile regex from `find` with `flags`, use `String.prototype.replace(regex, replace)`
3. Re-upload modified content with ETag-based conditional write
4. Return detailed results for each patch

#### Strategy 3: Append/Prepend (`appendToFile`)

```typescript
appendToFile(remotePath: string, content: string, position: 'start' | 'end'): Promise<AppendResult>
```

```typescript
interface AppendResult {
  path: string;
  originalSize: number;
  newSize: number;
  addedBytes: number;
  position: 'start' | 'end';
  etag: string;
}
```

**Flow**:
1. Download existing blob content
2. Concatenate: `position === 'start' ? content + existing : existing + content`
3. Re-upload with ETag-based conditional write
4. Return size information

### 4.5 Metadata Operations

**File**: `src/services/metadata.service.ts`

All metadata operations are also available through `BlobFileSystemService` but are implemented in a dedicated service for separation of concerns.

#### setMetadata(remotePath, metadata): Promise\<void\>

- Validate keys using regex: `/^[a-zA-Z_][a-zA-Z0-9_]*$/`
- Validate total size does not exceed 8 KB (per research: 8192 bytes)
- Call `blobClient.setMetadata(metadata)` -- this REPLACES all existing metadata

#### getMetadata(remotePath): Promise\<Record\<string, string\>\>

- Call `blobClient.getProperties()`
- Return `properties.metadata` or `{}`

#### updateMetadata(remotePath, partial): Promise\<Record\<string, string\>\>

- Read current metadata via `getProperties()`
- Merge: `{ ...current, ...partial }`
- Validate merged result
- Write back via `setMetadata(merged)`
- Return the merged metadata

#### deleteMetadata(remotePath, keys: string[]): Promise\<Record\<string, string\>\>

- Read current metadata
- Remove specified keys
- Write back remaining metadata
- Return remaining metadata

#### setTags(remotePath, tags): Promise\<void\>

- Validate max 10 tags (per research)
- Validate key length 1-128, value length 0-256
- Call `blobClient.setTags(tags)`

#### getTags(remotePath): Promise\<Record\<string, string\>\>

- Call `blobClient.getTags()`
- Return `response.tags`

#### queryByTags(tagFilter: string): Promise\<TagQueryResult[]\>

```typescript
interface TagQueryResult {
  name: string;
  containerName: string;
  tags: Record<string, string>;
}
```

- Call `blobServiceClient.findBlobsByTags(tagFilter)`
- Iterate all results and return as array

---

## 5. CLI Command Structure

### 5.1 Command Tree

```
azure-fs
├── config
│   ├── init                              # Interactive configuration setup
│   ├── show                              # Display current resolved config
│   └── validate                          # Validate config and test connection
│
├── ls <path>                             # List files and folders
│   ├── --recursive / -r                  # List all nested items
│   └── --include-metadata                # Include metadata in output
│
├── mkdir <path>                          # Create virtual folder
│
├── rmdir <path>                          # Delete folder recursively
│   └── --force / -f                      # Skip confirmation
│
├── exists <path>                         # Check file or folder existence
│   └── --type file|folder               # Narrow check type
│
├── upload <local> <remote>               # Upload local file to blob
│   ├── --metadata key=value [...]        # Set metadata on upload
│   └── --content-type <mime>             # Override content type
│
├── download <remote> [local]             # Download blob (to file or stdout)
│
├── delete <remote>                       # Delete a single blob
│   └── --force / -f                      # Skip confirmation
│
├── replace <local> <remote>              # Replace existing blob content
│   └── --metadata key=value [...]        # Update metadata on replace
│
├── info <remote>                         # Show file properties and metadata
│   └── --include-tags                    # Also fetch blob index tags
│
├── edit <remote>                         # Download to temp dir, re-upload
│   └── --temp-dir <path>                # Override temp directory
│
├── patch <remote>                        # Apply text patches
│   ├── --find <text>                    # Text to find
│   ├── --replace <text>                 # Replacement text
│   └── --regex                          # Treat --find as regex
│
├── append <remote>                       # Append or prepend content
│   ├── --content <text>                 # Content to add
│   └── --position start|end            # Where to add (default: end)
│
├── meta
│   ├── set <remote> key=value [...]     # Set (replace all) metadata
│   ├── get <remote>                     # Get all metadata
│   ├── update <remote> key=value [...]  # Merge metadata
│   └── delete <remote> key [key...]     # Remove metadata keys
│
└── tags
    ├── set <remote> key=value [...]     # Set blob index tags
    ├── get <remote>                     # Get blob index tags
    └── query <filter-expression>        # Find blobs by tag filter
```

### 5.2 Global Options (on root program)

| Flag | Description |
|------|-------------|
| `--json` | Output structured JSON (default for agent consumption) |
| `--verbose` / `-v` | Enable verbose logging |
| `--config <path>` | Path to `.azure-fs.json` config file |
| `--account-url <url>` / `-a` | Override storage account URL |
| `--container <name>` / `-c` | Override container name |
| `--auth-method <method>` | Override authentication method |

### 5.3 Structured Output Format

**Every command returns this structure**:

```typescript
interface CommandResult<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;              // Machine-readable error code
    message: string;           // Human-readable message
    details?: any;             // Additional context
  };
  metadata: {
    command: string;           // Command name (e.g., "ls", "upload")
    timestamp: string;         // ISO 8601
    durationMs: number;        // Execution time
  };
}
```

**Output formatting** (`src/utils/output.utils.ts`):
- When `--json` is set: `JSON.stringify(result, null, 2)` to stdout
- When `--json` is not set: formatted human-readable output to stdout; errors to stderr

### 5.4 Command Implementation Pattern

Each command file follows this pattern:

```typescript
// src/commands/file.commands.ts
import { Command } from 'commander';
import { resolveConfig } from '../config/config.loader';
import { createContainerClient } from '../services/auth.service';
import { BlobFileSystemService } from '../services/blob-filesystem.service';
import { formatOutput } from '../utils/output.utils';

export function registerFileCommands(program: Command): void {
  program
    .command('upload')
    .description('Upload a local file to blob storage')
    .argument('<local>', 'Local file path')
    .argument('<remote>', 'Remote blob path')
    .option('--metadata <pairs...>', 'Metadata key=value pairs')
    .option('--content-type <type>', 'Override content type')
    .action(async (local, remote, options, cmd) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent.opts();

      try {
        const config = resolveConfig(globalOpts);
        const containerClient = createContainerClient(config);
        const service = new BlobFileSystemService(containerClient, config);

        const metadata = parseKeyValuePairs(options.metadata);
        const result = await service.uploadFile(remote, local, {
          metadata,
          contentType: options.contentType,
        });

        formatOutput({
          success: true,
          data: result,
          metadata: { command: 'upload', timestamp: new Date().toISOString(), durationMs: Date.now() - startTime }
        }, globalOpts.json);

      } catch (error) {
        formatOutput({
          success: false,
          error: mapError(error),
          metadata: { command: 'upload', timestamp: new Date().toISOString(), durationMs: Date.now() - startTime }
        }, globalOpts.json);
        process.exit(1);
      }
    });
}
```

---

## 6. Path Normalization

### 6.1 Path Rules

**File**: `src/services/path.service.ts`

All paths are normalized before any Azure SDK operation:

1. Convert backslashes to forward slashes: `docs\readme.txt` -> `docs/readme.txt`
2. Remove leading slashes: `/docs/readme.txt` -> `docs/readme.txt`
3. Remove trailing slashes for file paths (keep for folder paths)
4. Collapse double slashes: `docs//readme.txt` -> `docs/readme.txt`
5. Remove `.` segments: `docs/./readme.txt` -> `docs/readme.txt`
6. Resolve `..` segments: `docs/old/../readme.txt` -> `docs/readme.txt`
7. Root path: both `""` and `"/"` represent the container root (empty prefix)

### 6.2 Path Validation

```typescript
function validateBlobPath(path: string): void {
  if (path.length > 1024) {
    throw new PathError('PATH_TOO_LONG', `Blob path exceeds 1024 characters: ${path.length}`);
  }
  // Additional checks for disallowed characters if needed
}

function normalizePath(rawPath: string): string {
  let path = rawPath;
  path = path.replace(/\\/g, '/');           // Backslash to forward slash
  path = path.replace(/\/+/g, '/');           // Collapse multiple slashes
  path = path.replace(/^\/+/, '');            // Remove leading slashes
  path = path.replace(/\/\.\//g, '/');        // Remove /./
  path = resolveDotDot(path);                 // Resolve /../
  return path;
}

function normalizeFolderPath(rawPath: string): string {
  let path = normalizePath(rawPath);
  if (path !== '' && !path.endsWith('/')) {
    path += '/';
  }
  return path;
}
```

### 6.3 Edge Cases

| Input | Normalized (file context) | Normalized (folder context) |
|-------|--------------------------|----------------------------|
| `/` | `""` (root) | `""` (root) |
| `""` | `""` (root) | `""` (root) |
| `/docs/readme.txt` | `docs/readme.txt` | `docs/readme.txt/` |
| `docs//nested//file.txt` | `docs/nested/file.txt` | `docs/nested/file.txt/` |
| `docs/./file.txt` | `docs/file.txt` | `docs/file.txt/` |
| `docs/old/../file.txt` | `docs/file.txt` | `docs/file.txt/` |
| `\windows\path` | `windows/path` | `windows/path/` |

---

## 7. Error Handling Strategy

### 7.1 Custom Error Hierarchy

```
BaseAppError
├── ConfigError          (code prefix: CONFIG_)
│   ├── MISSING_REQUIRED_CONFIG
│   ├── INVALID_CONFIG_VALUE
│   └── CONFIG_FILE_NOT_FOUND
├── AuthError            (code prefix: AUTH_)
│   ├── MISSING_CONNECTION_STRING
│   ├── MISSING_SAS_TOKEN
│   ├── AZURE_AD_FAILED
│   └── INVALID_AUTH_METHOD
├── BlobNotFoundError    (code prefix: BLOB_)
│   └── BLOB_NOT_FOUND
├── PathError            (code prefix: PATH_)
│   ├── PATH_TOO_LONG
│   ├── INVALID_PATH
│   └── EMPTY_PATH
├── MetadataError        (code prefix: META_)
│   ├── INVALID_KEY
│   ├── SIZE_EXCEEDED
│   └── MAX_TAGS_EXCEEDED
└── NetworkError         (code prefix: NET_)
    ├── CONNECTION_FAILED
    ├── TIMEOUT
    └── TRANSIENT_ERROR
```

### 7.2 Base Error Class

```typescript
// src/errors/base.error.ts
export class BaseAppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode?: number,
    public readonly details?: any,
  ) {
    super(message);
    this.name = this.constructor.name;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}
```

### 7.3 Azure Error Mapping

```typescript
function mapAzureError(error: any): BaseAppError {
  if (error.statusCode === 404) {
    return new BlobNotFoundError(error.message);
  }
  if (error.statusCode === 403) {
    return new AuthError('AUTH_ACCESS_DENIED',
      'Access denied. Check authentication and RBAC role assignments.\n' +
      'Required role: Storage Blob Data Contributor', 403);
  }
  if (error.statusCode === 409) {
    return new BaseAppError('CONFLICT', 'Resource conflict: ' + error.message, 409);
  }
  if (error.statusCode === 412) {
    return new BaseAppError('PRECONDITION_FAILED',
      'Resource was modified concurrently. Retry the operation.', 412);
  }
  if (error.statusCode === 429 || error.statusCode === 503) {
    return new NetworkError('TRANSIENT_ERROR',
      'Azure service temporarily unavailable. The operation will be retried.', error.statusCode);
  }
  if (error.code === 'ENOENT') {
    return new PathError('LOCAL_FILE_NOT_FOUND', `Local file not found: ${error.path}`);
  }
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
    return new NetworkError('CONNECTION_FAILED',
      'Cannot connect to Azure Storage. Check your network and account URL.');
  }
  return new BaseAppError('UNKNOWN_ERROR', error.message || 'An unexpected error occurred');
}
```

### 7.4 Retry Logic

**File**: `src/utils/retry.utils.ts`

Three configurable strategies per the clarifying questions in the research:

```typescript
interface RetryConfig {
  strategy: 'none' | 'exponential' | 'fixed';
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
}

async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig,
  isRetryable: (error: any) => boolean
): Promise<T> {
  // strategy === 'none': execute once, throw on error
  // strategy === 'fixed': retry up to maxRetries with initialDelayMs between each
  // strategy === 'exponential': retry with delay = initialDelayMs * 2^attempt, capped at maxDelayMs
}
```

**Retryable conditions**: HTTP 429, 503, network timeouts, `ECONNRESET`.

### 7.5 Process Exit Codes

| Exit Code | Meaning |
|-----------|---------|
| 0 | Success |
| 1 | Operation error (blob not found, auth failed, etc.) |
| 2 | Configuration error (missing required config) |
| 3 | Input validation error (invalid path, bad arguments) |

---

## 8. Testing Strategy

### 8.1 Test Environment

All tests run against a **live Azure Storage account**. Test configuration is provided via environment variables:

```bash
# Required for all tests
export AZURE_STORAGE_ACCOUNT_URL="https://testaccount.blob.core.windows.net"
export AZURE_STORAGE_CONTAINER_NAME="test-container"
export AZURE_FS_AUTH_METHOD="azure-ad"
export AZURE_FS_LOG_LEVEL="info"
export AZURE_FS_RETRY_STRATEGY="exponential"
export AZURE_FS_RETRY_MAX_RETRIES="3"
export AZURE_FS_RETRY_INITIAL_DELAY_MS="1000"
export AZURE_FS_RETRY_MAX_DELAY_MS="30000"
export AZURE_FS_LOG_REQUESTS="true"
```

### 8.2 Test Scripts

All test scripts are placed in `./test_scripts/` per project conventions. Each test script:
- Is written in TypeScript
- Runs with `ts-node`
- Creates test data, performs operations, validates results, cleans up
- Outputs results as JSON
- Returns non-zero exit code on failure

| Script | Tests |
|--------|-------|
| `test-config.ts` | Config loading from file, env, CLI; missing config errors; validation |
| `test-auth.ts` | Connection string auth, SAS token auth, Azure AD auth; invalid credentials |
| `test-file-operations.ts` | Upload (string, file, large file), download (to string, to file), delete, replace, exists, info |
| `test-folder-operations.ts` | mkdir, listFolder (hierarchical, recursive), rmdir, folderExists |
| `test-edit-operations.ts` | editFile (download + re-upload), patchFile (find-replace, regex), appendToFile (start, end) |
| `test-metadata.ts` | setMetadata, getMetadata, updateMetadata, deleteMetadata; validation (invalid keys, size limits) |
| `test-tags.ts` | setTags, getTags, queryByTags; validation (max 10 tags) |
| `test-error-scenarios.ts` | Missing file operations, invalid paths, auth failures, concurrent modifications |
| `test-cli-integration.ts` | End-to-end: invoke CLI commands via child_process, validate JSON output structure |

### 8.3 Test Data Management

Each test script:
1. Creates a unique test folder prefix: `test-{timestamp}-{random}/`
2. Performs all operations within that prefix
3. Cleans up the folder after tests complete (even on failure, via try/finally)

### 8.4 Test Execution

```bash
# Run all tests
npm test

# Run individual test
npx ts-node test_scripts/test-file-operations.ts

# Run with verbose output
AZURE_FS_LOG_LEVEL=debug npx ts-node test_scripts/test-file-operations.ts
```

### 8.5 Test Coverage Matrix

| Area | Happy Path | Error Cases | Edge Cases |
|------|-----------|-------------|------------|
| Config loading | 3 sources | Missing required values | Empty config file |
| Auth methods | All 3 methods | Invalid credentials | Expired SAS token |
| Upload | String, file, large file | Missing local file, container not found | Unicode filenames, empty file |
| Download | To string, to file | Blob not found | Large file, binary file |
| Delete | Single file | Non-existent blob | Delete folder with nested files |
| List | Root, subfolder | Empty folder | Deep nesting, many items |
| Edit (RMW) | Download and re-upload | Concurrent modification | Empty file edit |
| Patch | find-replace, regex | No matches found | Multiple matches, overlapping patches |
| Append | Start, end | Non-existent blob | Append to empty file |
| Metadata | Set, get, update, delete | Invalid key names | 8 KB limit boundary |
| Tags | Set, get, query | > 10 tags | Complex query syntax |

---

## 9. Implementation Phases

### Phase 1: Project Setup, Configuration, and Authentication

**Dependencies**: None (starting point)
**Estimated complexity**: Moderate

**Files to create**:
- `package.json`
- `tsconfig.json`
- `.gitignore`
- `.env.example`
- `.azure-fs.json.example`
- `src/index.ts` (minimal bootstrap)
- `src/types/config.types.ts`
- `src/types/command-result.types.ts`
- `src/types/errors.types.ts`
- `src/config/config.schema.ts`
- `src/config/config.loader.ts`
- `src/services/auth.service.ts`
- `src/errors/base.error.ts`
- `src/errors/config.error.ts`
- `src/errors/auth.error.ts`
- `src/utils/output.utils.ts`
- `src/utils/logger.utils.ts`
- `src/commands/config.commands.ts` (init, show, validate)

**Deliverables**:
1. Runnable `azure-fs config init` command that creates `.azure-fs.json` interactively
2. `azure-fs config show` that displays resolved config (from all 3 sources)
3. `azure-fs config validate` that tests the connection to Azure Storage
4. All 3 auth methods working (connection-string, sas-token, azure-ad)
5. Config validation throws clear errors when required fields are missing

**Acceptance criteria**:
- [ ] `npm run build` compiles without errors
- [ ] `azure-fs config validate` connects to Azure Storage and reports success/failure
- [ ] Missing required config values produce clear error messages listing all input methods
- [ ] All 3 auth methods can produce a working `BlobServiceClient`
- [ ] No configuration parameter has a fallback/default value (per project conventions)

---

### Phase 2: Core File Operations

**Dependencies**: Phase 1
**Estimated complexity**: Moderate

**Files to create**:
- `src/services/blob-filesystem.service.ts` (initial: file operations only)
- `src/services/path.service.ts`
- `src/types/filesystem.types.ts`
- `src/errors/blob-not-found.error.ts`
- `src/errors/path.error.ts`
- `src/utils/stream.utils.ts`
- `src/utils/content-type.utils.ts`
- `src/utils/retry.utils.ts`
- `src/commands/file.commands.ts`

**Deliverables**:
1. `BlobFileSystemService` with: `uploadFile`, `downloadFile`, `deleteFile`, `fileExists`, `replaceFile`, `getFileInfo`
2. Path normalization working for all edge cases
3. CLI commands: `upload`, `download`, `delete`, `replace`, `info`, `exists`
4. Content type auto-detection from file extensions
5. Retry logic integrated for transient Azure errors
6. Streaming for large files (> 100MB)

**Acceptance criteria**:
- [ ] `azure-fs upload local.txt remote/path/file.txt` uploads successfully
- [ ] `azure-fs download remote/path/file.txt local.txt` downloads successfully
- [ ] `azure-fs delete remote/path/file.txt` deletes the blob
- [ ] `azure-fs replace local.txt remote/path/file.txt` replaces an existing blob
- [ ] `azure-fs info remote/path/file.txt` shows size, content type, metadata, etag
- [ ] `azure-fs exists remote/path/file.txt` returns `{ exists: true/false }`
- [ ] All commands output structured JSON with `--json` flag
- [ ] Paths are normalized correctly (no leading slash, no double slashes)
- [ ] Large file upload uses streaming

---

### Phase 3: Folder Operations

**Dependencies**: Phase 2
**Estimated complexity**: Simple

**Files to create/modify**:
- Extend `src/services/blob-filesystem.service.ts` with folder methods
- `src/commands/folder.commands.ts`

**Deliverables**:
1. `createFolder`, `listFolder`, `deleteFolder`, `folderExists` methods
2. CLI commands: `mkdir`, `ls`, `rmdir`
3. Zero-byte marker blobs for folder creation (per research recommendation)
4. Hierarchical listing using `listBlobsByHierarchy`
5. Recursive listing option using `listBlobsFlat`

**Acceptance criteria**:
- [ ] `azure-fs mkdir docs/projects` creates a zero-byte marker blob at `docs/projects/`
- [ ] `azure-fs ls docs/` lists files and subfolders at one level
- [ ] `azure-fs ls docs/ --recursive` lists all nested items
- [ ] `azure-fs rmdir docs/projects` deletes all blobs under the prefix
- [ ] `azure-fs exists docs/projects --type folder` checks folder existence
- [ ] Empty folders are visible in `ls` output (marker blobs)
- [ ] Folder marker blobs are excluded from file listings

---

### Phase 4: Edit Operations (3 Strategies)

**Dependencies**: Phase 2
**Estimated complexity**: Complex

**Files to create/modify**:
- Extend `src/services/blob-filesystem.service.ts` with edit methods
- `src/types/patch.types.ts`
- `src/commands/edit.commands.ts`

**Deliverables**:
1. `editFile` -- read-modify-write pattern with temp file download
2. `patchFile` -- in-place text patching (find-replace and regex)
3. `appendToFile` -- append or prepend content
4. All three strategies use ETag-based conditional writes for concurrency safety
5. CLI commands: `edit`, `patch`, `append`

**Acceptance criteria**:
- [ ] `azure-fs edit remote/file.txt` downloads to temp, returns path for editing
- [ ] `azure-fs patch remote/file.txt --find "old text" --replace "new text"` applies text replacement
- [ ] `azure-fs patch remote/file.txt --find "pattern.*" --replace "new" --regex` applies regex replacement
- [ ] `azure-fs append remote/file.txt --content "new line" --position end` appends content
- [ ] `azure-fs append remote/file.txt --content "header\n" --position start` prepends content
- [ ] Concurrent modification is detected and reported (ETag check)
- [ ] Patch results include match counts and success status for each instruction

---

### Phase 5: Metadata and Tags

**Dependencies**: Phase 2
**Estimated complexity**: Moderate

**Files to create/modify**:
- `src/services/metadata.service.ts`
- `src/errors/metadata.error.ts`
- `src/utils/validation.utils.ts`
- `src/commands/meta.commands.ts`
- `src/commands/tags.commands.ts`

**Deliverables**:
1. Full metadata CRUD: `setMetadata`, `getMetadata`, `updateMetadata`, `deleteMetadata`
2. Tag operations: `setTags`, `getTags`, `queryByTags`
3. Metadata key validation (C# identifier rules)
4. Metadata size validation (8 KB limit)
5. Tag count validation (max 10 per blob)
6. CLI commands: `meta set|get|update|delete`, `tags set|get|query`

**Acceptance criteria**:
- [ ] `azure-fs meta set path key1=val1 key2=val2` sets metadata (replaces all)
- [ ] `azure-fs meta get path` returns all metadata
- [ ] `azure-fs meta update path key=newval` merges with existing metadata
- [ ] `azure-fs meta delete path key1 key2` removes specific keys
- [ ] `azure-fs tags set path env=prod status=active` sets blob index tags
- [ ] `azure-fs tags get path` returns blob index tags
- [ ] `azure-fs tags query "env='prod' AND status='active'"` finds matching blobs
- [ ] Invalid metadata key names produce clear error messages
- [ ] Metadata exceeding 8 KB is rejected with size information
- [ ] More than 10 tags is rejected

---

### Phase 6: CLI Commands Wiring and Polish

**Dependencies**: Phases 1-5
**Estimated complexity**: Moderate

**Files to create/modify**:
- `src/commands/index.ts` (barrel that registers all commands)
- `src/index.ts` (finalize bootstrap)
- Update all command files for consistent error handling and output
- `CLAUDE.md` (document all tool commands)
- `Issues - Pending Items.md`

**Deliverables**:
1. All commands wired to the root program
2. Global `--json` and `--verbose` flags working on all commands
3. Consistent error handling across all commands
4. Request logging (all parameters except file content)
5. Process exit codes (0=success, 1=operation error, 2=config error, 3=validation error)
6. Help text for all commands and options
7. Tool documentation in CLAUDE.md per project conventions

**Acceptance criteria**:
- [ ] `azure-fs --help` shows all commands with descriptions
- [ ] `azure-fs upload --help` shows upload-specific options
- [ ] All commands return consistent `CommandResult<T>` JSON structure
- [ ] `--verbose` enables detailed logging including request parameters
- [ ] Request logging omits file content but includes all other parameters
- [ ] Process exits with correct exit codes
- [ ] CLAUDE.md documents every command in the required format

---

### Phase 7: Testing and Polish

**Dependencies**: Phase 6
**Estimated complexity**: Complex

**Files to create**:
- `test_scripts/test-config.ts`
- `test_scripts/test-auth.ts`
- `test_scripts/test-file-operations.ts`
- `test_scripts/test-folder-operations.ts`
- `test_scripts/test-edit-operations.ts`
- `test_scripts/test-metadata.ts`
- `test_scripts/test-tags.ts`
- `test_scripts/test-error-scenarios.ts`
- `test_scripts/test-cli-integration.ts`

**Deliverables**:
1. All 9 test scripts covering the complete test matrix (Section 8.5)
2. Each test creates isolated test data and cleans up afterward
3. CLI integration tests invoke commands via `child_process.execSync` and validate JSON output
4. Error scenario tests verify error codes, messages, and exit codes
5. All tests pass against live Azure Storage account

**Acceptance criteria**:
- [ ] All test scripts pass: `npx ts-node test_scripts/test-*.ts`
- [ ] Test scripts create unique test data and clean up
- [ ] Error scenarios produce expected error codes and messages
- [ ] CLI integration tests validate JSON output structure
- [ ] Large file operations (upload/download) work via streaming
- [ ] Concurrent modification detection works (ETag-based)
- [ ] All 3 auth methods are tested
- [ ] All 3 edit strategies are tested
- [ ] Metadata validation (key format, size limit) is tested
- [ ] Tag validation (count limit) is tested

---

## Summary: Phase Dependencies

```
Phase 1: Setup, Config, Auth
    │
    v
Phase 2: Core File Operations
    │
    ├───────────────┐
    v               v
Phase 3: Folders   Phase 4: Edit Ops   Phase 5: Metadata/Tags
    │               │                    │
    └───────────────┼────────────────────┘
                    v
            Phase 6: CLI Wiring & Polish
                    │
                    v
            Phase 7: Testing & Polish
```

Phases 3, 4, and 5 can be implemented in parallel once Phase 2 is complete. Phase 6 integrates everything. Phase 7 validates the complete system.

---

## Appendix A: Key Research Findings Applied

| Research Finding | Plan Application |
|-----------------|------------------|
| DefaultAzureCredential recommended for local dev + production | Primary auth method, with SAS and connection string as alternatives |
| Zero-byte marker blobs for folder emulation | `createFolder` uses zero-byte blob with `hdi_isfolder` metadata |
| `listBlobsByHierarchy` for folder-like listings | `listFolder` uses hierarchical listing by default |
| Metadata size limit: 8 KB | Validation in `MetadataService` before every set/update |
| Metadata keys must be valid C# identifiers | Regex validation: `/^[a-zA-Z_][a-zA-Z0-9_]*$/` |
| Blob index tags: max 10 per blob | Validation in tag operations |
| ETag-based conditional writes for concurrency | All edit operations use `ifMatch` conditions |
| Streaming for large files > 100 MB | `uploadFile`/`downloadFile` switch to stream mode based on size |
| Commander.js recommended for CLI | Used as CLI framework |
| JSON output for agent consumption | All commands return `CommandResult<T>` structure |
| No fallback values for config | `ConfigError` thrown for every missing required parameter |
| Authentication profiles support | Config file can be at multiple locations, CLI flags for overrides |
| Container management support | `config validate` checks container existence |
| Text detection for binary vs text | Content type auto-detection via file extension mapping |
| JSON progress events | Structured JSON output for all operations including progress |
| Batch operation preparedness | Service layer accepts array-based operations where applicable |
| User-controlled caching | Service returns all data needed for external caching (eTags, timestamps) |
| Recovery options: none, exponential, fixed | Retry utility with 3 strategies, configurable per project config |
| Request logging omitting file content | Logger utility logs all parameters except `content` and `data` bodies |
