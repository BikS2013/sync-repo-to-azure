# Azure Blob Storage File System CLI Tool - Functional Requirements

**Project Name**: azure-fs
**Date**: 2026-02-22
**Version**: 1.0.0

---

## Priority Classification

- **P0**: Must-have for the tool to be functional. Blocks agent usage if absent.
- **P1**: Important for complete functionality. Tool is usable without these but with limitations.
- **P2**: Nice-to-have. Enhances developer/agent experience.

---

## 1. Configuration Management

### F1.1 Configuration File Loading (P0)

**Description**: Load tool configuration from a JSON file (`.azure-fs.json`).

**Inputs**:
- Config file path (explicit via `--config` or auto-discovered at CWD/HOME)

**Outputs**:
- Parsed `ResolvedConfig` object with all required fields

**Behavior**:
- Search order: `--config` path > CWD `.azure-fs.json` > HOME `.azure-fs.json`
- Parse JSON content, validate all fields
- Throw `ConfigError` with detailed message if file not found or malformed

**Edge cases**:
- File exists but is empty JSON `{}` -- throw error for missing required fields
- File has extra unknown fields -- ignore them (forward compatibility)
- File has invalid JSON syntax -- throw parse error with line number if possible
- Multiple config files exist (CWD and HOME) -- CWD takes precedence

---

### F1.2 Environment Variable Configuration (P0)

**Description**: Load configuration from environment variables.

**Inputs**:
- Standard Azure env vars: `AZURE_STORAGE_ACCOUNT_URL`, `AZURE_STORAGE_CONTAINER_NAME`, `AZURE_FS_AUTH_METHOD`
- Auth-specific env vars: `AZURE_STORAGE_CONNECTION_STRING`, `AZURE_STORAGE_SAS_TOKEN`
- Tool-specific env vars: `AZURE_FS_LOG_LEVEL`, `AZURE_FS_RETRY_STRATEGY`, etc.

**Outputs**:
- Partial config object (may not have all fields -- will be merged)

**Edge cases**:
- Env var set to empty string -- treated as not set (throw if required)
- Env var has leading/trailing whitespace -- trim before use

---

### F1.3 CLI Flag Configuration Overrides (P0)

**Description**: Override configuration via CLI flags. Highest priority source.

**Inputs**:
- `--account-url`, `--container`, `--auth-method`, `--config`

**Outputs**:
- Partial config object merged with highest priority

**Edge cases**:
- Both `--config` and `--account-url` provided -- CLI flags override config file values
- Flag provided with empty value -- throw validation error

---

### F1.4 Configuration Validation (P0)

**Description**: Validate that all required configuration is present and valid. No fallbacks or defaults for any required parameter.

**Inputs**:
- Merged config from all sources

**Outputs**:
- `ResolvedConfig` (valid) or throws `ConfigError`

**Behavior**:
- Every required field missing triggers `ConfigError` with:
  - Name of missing field
  - All 3 ways to provide it (CLI flag, env var, config file key)
  - Example value

**Edge cases**:
- All sources return nothing -- error must list ALL missing required fields, not just the first one
- `authMethod` is set but corresponding credential env var is missing -- auth-specific error message

---

### F1.5 Interactive Configuration Init (P1)

**Description**: `azure-fs config init` -- interactively create a `.azure-fs.json` file.

**Inputs**:
- User responses to interactive prompts (account URL, container name, auth method, logging, retry)

**Outputs**:
- `.azure-fs.json` file created in current directory

**Edge cases**:
- File already exists -- prompt for overwrite confirmation
- User cancels mid-flow -- no file created

---

### F1.6 Configuration Display (P1)

**Description**: `azure-fs config show` -- display the fully resolved configuration (with sensitive values masked).

**Inputs**:
- Resolved config from all sources

**Outputs**:
- JSON or human-readable display of all config values
- Connection strings and SAS tokens shown as `***masked***`

---

### F1.7 Connection Validation (P0)

**Description**: `azure-fs config validate` -- test the connection to Azure Storage.

**Inputs**:
- Resolved config

**Outputs**:
- `ConnectionTestResult` with: success, authMethod, accountUrl, containerName, containerExists

**Behavior**:
- Create client using configured auth method
- Call `containerClient.exists()` to verify connectivity and permissions
- On 403: provide troubleshooting steps (check RBAC role, wait for propagation)

**Edge cases**:
- Container does not exist -- report `containerExists: false` but `success: true` (connection works)
- Network timeout -- report with retry suggestion

---

## 2. Authentication

### F2.1 Azure AD Authentication (P0)

**Description**: Authenticate using `DefaultAzureCredential` from `@azure/identity`.

**Inputs**:
- `storage.accountUrl` from config
- `storage.authMethod` = `"azure-ad"`

**Outputs**:
- `BlobServiceClient` authenticated via Azure AD

**Behavior**:
- Creates `DefaultAzureCredential` which auto-discovers credentials (Azure CLI, env vars, managed identity)
- Works with `az login` for local development

**Edge cases**:
- User not logged in via Azure CLI -- `DefaultAzureCredential` throws; tool wraps with helpful message
- RBAC role not assigned -- 403 error with troubleshooting steps
- Role assignment propagation delay (up to 8 minutes) -- mentioned in error guidance

---

### F2.2 SAS Token Authentication (P0)

**Description**: Authenticate using a Shared Access Signature token.

**Inputs**:
- `storage.accountUrl` from config
- `AZURE_STORAGE_SAS_TOKEN` environment variable
- `storage.authMethod` = `"sas-token"`

**Outputs**:
- `BlobServiceClient` authenticated via SAS token

**Edge cases**:
- SAS token expired -- 403 error with "SAS token may be expired" message
- SAS token missing required permissions -- 403 with permission guidance
- SAS token has `?` prefix vs without -- handle both formats
- Env var not set -- `AuthError` with instructions

---

### F2.3 Connection String Authentication (P0)

**Description**: Authenticate using a full connection string.

**Inputs**:
- `AZURE_STORAGE_CONNECTION_STRING` environment variable
- `storage.authMethod` = `"connection-string"`

**Outputs**:
- `BlobServiceClient` authenticated via connection string

**Edge cases**:
- Malformed connection string -- SDK error wrapped with helpful message
- Env var not set -- `AuthError` with instructions
- Connection string for wrong account -- operations may fail with 404

---

## 3. File Operations

### F3.1 Upload File (P0)

**Description**: Upload a local file or string content to a blob path.

**Inputs**:
- `local`: Local file path
- `remote`: Destination blob path
- `--metadata key=value`: Optional metadata pairs
- `--content-type`: Optional content type override

**Outputs**:
```json
{
  "path": "docs/readme.txt",
  "size": 1024,
  "etag": "\"0x8D...\"",
  "contentType": "text/plain",
  "metadata": { "author": "john" }
}
```

**Behavior**:
- Auto-detect content type from file extension if not specified
- For files > 100 MB, use stream upload for memory efficiency
- Set metadata on upload if provided
- Overwrites existing blob by default

**Edge cases**:
- Local file does not exist -- `PathError` with file path
- Remote path needs normalization (leading slash, backslashes)
- Empty file (0 bytes) -- upload succeeds
- Binary file -- content type set to `application/octet-stream`
- Very long blob name (> 1024 chars) -- validation error
- Metadata key with invalid characters -- `MetadataError` before upload attempt

---

### F3.2 Download File (P0)

**Description**: Download a blob to a local file or return content as string.

**Inputs**:
- `remote`: Source blob path
- `[local]`: Optional local file destination (if omitted, content returned in JSON output)

**Outputs**:
- If `local` provided: `{ path, localPath, size, contentType, etag }`
- If `local` omitted: `{ path, content, size, contentType, etag }`

**Behavior**:
- If local path provided, write to file (streaming for large files)
- If local path omitted, download to string and include in JSON output
- Include metadata and system properties in response

**Edge cases**:
- Blob does not exist -- `BlobNotFoundError`
- Local directory for destination does not exist -- create parent directories
- File > 100 MB without local path -- warn about large content in JSON output
- Binary content without local path -- return base64-encoded content or error

---

### F3.3 Delete File (P0)

**Description**: Delete a single blob.

**Inputs**:
- `remote`: Blob path to delete
- `--force`: Skip confirmation (for non-interactive use)

**Outputs**:
```json
{
  "path": "docs/readme.txt",
  "deleted": true,
  "existed": true
}
```

**Edge cases**:
- Blob does not exist -- `existed: false`, `deleted: false` (not an error with `deleteIfExists`)
- Path points to a folder marker -- delete it as a regular blob
- Blob has snapshots -- delete with `deleteSnapshots: 'include'`

---

### F3.4 Replace File (P0)

**Description**: Replace the content of an existing blob. Fails if blob does not exist.

**Inputs**:
- `local`: New content source (local file path)
- `remote`: Blob path to replace
- `--metadata key=value`: Optional new metadata

**Outputs**:
- Same as upload result

**Behavior**:
- Check blob exists before uploading
- Use ETag-based conditional write to prevent race conditions
- If blob does not exist, throw `BlobNotFoundError` (unlike upload which creates)

**Edge cases**:
- Blob modified between exists check and upload -- 412 Precondition Failed; retry per config
- Blob deleted between exists check and upload -- 404 error

---

### F3.5 File Exists (P0)

**Description**: Check if a blob exists at the given path.

**Inputs**:
- `path`: Blob path to check
- `--type file|folder`: Narrow the check to file or folder

**Outputs**:
```json
{
  "path": "docs/readme.txt",
  "exists": true,
  "type": "file"
}
```

**Edge cases**:
- Path matches a folder marker blob -- `type: "folder"` if checking without `--type` filter
- Empty path (root) -- always returns `exists: true, type: "folder"`

---

### F3.6 File Info (P0)

**Description**: Get detailed properties and metadata for a blob.

**Inputs**:
- `remote`: Blob path
- `--include-tags`: Also fetch blob index tags

**Outputs**:
```json
{
  "path": "docs/readme.txt",
  "size": 1024,
  "contentType": "text/plain",
  "contentEncoding": "utf-8",
  "lastModified": "2026-02-22T10:30:00Z",
  "etag": "\"0x8D...\"",
  "metadata": { "author": "john" },
  "tags": { "env": "prod" }
}
```

**Edge cases**:
- Blob does not exist -- `BlobNotFoundError`
- Tags not requested -- `tags` field omitted from output
- Blob has no metadata -- `metadata: {}`

---

## 4. Folder Operations

### F4.1 Create Folder (P0)

**Description**: Create a virtual directory using a zero-byte marker blob.

**Inputs**:
- `path`: Folder path to create

**Outputs**:
```json
{
  "path": "docs/projects/",
  "created": true
}
```

**Behavior**:
- Normalize path and ensure it ends with `/`
- Upload zero-byte blob with `contentType: 'application/x-directory'` and `metadata: { hdi_isfolder: 'true' }`

**Edge cases**:
- Folder already exists (marker blob present) -- `created: false` (not an error)
- Nested path where parent doesn't exist -- create only the requested folder (parent created implicitly when child has content)
- Path does not end with `/` -- normalize to add trailing slash

---

### F4.2 List Folder (P0)

**Description**: List files and subfolders at a given path level.

**Inputs**:
- `path`: Folder path (prefix) to list
- `--recursive`: List all items recursively
- `--include-metadata`: Include metadata for each item

**Outputs**:
```json
{
  "path": "docs/",
  "items": [
    { "name": "projects/", "fullPath": "docs/projects/", "type": "folder" },
    { "name": "readme.txt", "fullPath": "docs/readme.txt", "type": "file", "size": 1024, "lastModified": "..." }
  ],
  "totalItems": 2
}
```

**Behavior**:
- Non-recursive: Use `listBlobsByHierarchy('/', { prefix })` for one-level listing
- Recursive: Use `listBlobsFlat({ prefix })` for all nested items
- Extract relative names by removing the prefix
- Filter out folder marker blobs from file results (they appear as `type: "folder"`)

**Edge cases**:
- Empty folder -- return empty items array (folder marker exists but no children)
- Root listing (empty path) -- list everything at the top level
- Path without trailing slash -- add it before listing
- Thousands of items -- paginate internally (SDK handles this), return complete list
- Include metadata flag -- adds `metadata` field to each item

---

### F4.3 Delete Folder (P0)

**Description**: Recursively delete all blobs under a folder prefix.

**Inputs**:
- `path`: Folder path to delete
- `--force`: Skip confirmation

**Outputs**:
```json
{
  "path": "docs/projects/",
  "deletedCount": 15,
  "deletedItems": ["docs/projects/", "docs/projects/file1.txt", "..."]
}
```

**Behavior**:
- List all blobs with `listBlobsFlat({ prefix })`
- Delete each blob including the folder marker
- Return count and list of deleted items

**Edge cases**:
- Folder does not exist (no blobs with prefix) -- `deletedCount: 0` (not an error)
- Very large folder (thousands of blobs) -- delete in batches, report progress
- Nested folders -- all are deleted (flat listing with prefix catches everything)

---

### F4.4 Folder Exists (P0)

**Description**: Check if a folder exists (either as marker blob or by having children).

**Inputs**:
- `path`: Folder path to check

**Outputs**:
```json
{
  "path": "docs/projects/",
  "exists": true,
  "hasMarker": true,
  "hasChildren": true
}
```

**Behavior**:
- Check for marker blob existence
- If no marker, check if any blobs have this prefix (fetch 1 item)
- Return both checks for full information

**Edge cases**:
- Marker exists but no children (empty folder) -- `exists: true`
- No marker but children exist (implicit folder) -- `exists: true`
- Neither marker nor children -- `exists: false`

---

## 5. Edit Operations

### F5.1 Edit File - Read-Modify-Write (P0)

**Description**: Download a blob to a temporary local file for external editing, then re-upload.

**Inputs**:
- `remote`: Blob path to edit
- `--temp-dir`: Override temporary directory

**Outputs** (on download phase):
```json
{
  "path": "docs/readme.txt",
  "tempFile": "/tmp/azure-fs-edit-abc123/readme.txt",
  "etag": "\"0x8D...\"",
  "size": 1024,
  "instruction": "Edit the file at tempFile, then run: azure-fs upload /tmp/.../readme.txt docs/readme.txt"
}
```

**Behavior**:
- Download blob to a temp directory
- Return the temp file path and the ETag
- The caller (agent or human) modifies the file
- Caller uses `upload` or a dedicated `commit-edit` to re-upload

**Edge cases**:
- Blob does not exist -- `BlobNotFoundError`
- Temp directory is not writable -- throw with directory path
- Blob modified by another process between download and re-upload -- 412 on conditional upload

---

### F5.2 Patch File - In-Place Text Patching (P0)

**Description**: Download a blob, apply text replacements (literal or regex), re-upload.

**Inputs**:
- `remote`: Blob path to patch
- `--find <text>`: Text to search for
- `--replace <text>`: Replacement text
- `--regex`: Treat `--find` as a regular expression

**Outputs**:
```json
{
  "path": "docs/readme.txt",
  "patchesApplied": 1,
  "matchesFound": 3,
  "originalSize": 1024,
  "newSize": 1030,
  "etag": "\"0x8D...\"",
  "details": [
    { "find": "old text", "replace": "new text", "matchesFound": 3, "applied": true }
  ]
}
```

**Behavior**:
- Download blob content as string
- For literal find-replace: use `String.replaceAll(find, replace)`
- For regex: compile regex from find with optional flags, use `String.replace(regex, replace)`
- Re-upload with ETag conditional write

**Edge cases**:
- No matches found -- `patchesApplied: 0`, content unchanged, no re-upload needed
- Invalid regex pattern -- throw with regex error message before download
- Binary file -- throw error (patch only works on text content)
- Find text is empty string -- throw validation error
- Replace results in identical content -- skip re-upload, return `patchesApplied: 0`

---

### F5.3 Append/Prepend Content (P0)

**Description**: Add content to the beginning or end of an existing blob.

**Inputs**:
- `remote`: Blob path
- `--content <text>`: Content to add
- `--position start|end`: Where to add (default: end)

**Outputs**:
```json
{
  "path": "docs/log.txt",
  "originalSize": 500,
  "newSize": 550,
  "addedBytes": 50,
  "position": "end",
  "etag": "\"0x8D...\""
}
```

**Behavior**:
- Download existing content
- Concatenate: start -> `newContent + existing`, end -> `existing + newContent`
- Re-upload with ETag conditional write

**Edge cases**:
- Blob does not exist -- `BlobNotFoundError`
- Content is empty string -- no-op, return unchanged info
- Position not specified -- throw `ConfigError` (no default value per project conventions)
- Appending to a very large file -- memory considerations for download + concatenation

---

## 6. Metadata Operations

### F6.1 Set Metadata (P0)

**Description**: Set (replace all) custom metadata on a blob.

**Inputs**:
- `remote`: Blob path
- `key=value` pairs: One or more metadata entries

**Outputs**:
```json
{
  "path": "docs/readme.txt",
  "metadata": { "author": "john", "version": "2.0" }
}
```

**Behavior**:
- Parse `key=value` pairs from command arguments
- Validate all keys against C# identifier rules: `/^[a-zA-Z_][a-zA-Z0-9_]*$/`
- Validate total metadata size does not exceed 8 KB
- Call `blobClient.setMetadata()` -- this REPLACES all existing metadata

**Edge cases**:
- Key contains hyphens or dots -- `MetadataError` with valid key format explanation
- Key starts with digit -- `MetadataError`
- Total size exceeds 8 KB -- `MetadataError` with current size and limit
- Duplicate keys (case-insensitive) -- `MetadataError`
- Blob does not exist -- `BlobNotFoundError`

---

### F6.2 Get Metadata (P0)

**Description**: Retrieve all custom metadata for a blob.

**Inputs**:
- `remote`: Blob path

**Outputs**:
```json
{
  "path": "docs/readme.txt",
  "metadata": { "author": "john", "version": "1.0", "created_at": "2026-02-22" }
}
```

**Edge cases**:
- Blob has no metadata -- `metadata: {}`
- Blob does not exist -- `BlobNotFoundError`

---

### F6.3 Update Metadata (P1)

**Description**: Merge new metadata with existing metadata (preserving unmentioned keys).

**Inputs**:
- `remote`: Blob path
- `key=value` pairs: Metadata entries to add or update

**Outputs**:
```json
{
  "path": "docs/readme.txt",
  "metadata": { "author": "john", "version": "2.0", "created_at": "2026-02-22" }
}
```

**Behavior**:
- Read existing metadata via `getProperties()`
- Merge: `{ ...existing, ...newPairs }`
- Validate merged result (keys and size)
- Write back via `setMetadata()`

**Edge cases**:
- Merged metadata exceeds 8 KB -- `MetadataError` with details
- Updating a key that doesn't exist yet -- creates it (merge behavior)
- Concurrent modification between read and write -- retry per config

---

### F6.4 Delete Metadata Keys (P1)

**Description**: Remove specific metadata keys from a blob.

**Inputs**:
- `remote`: Blob path
- `keys`: One or more key names to remove

**Outputs**:
```json
{
  "path": "docs/readme.txt",
  "removedKeys": ["version"],
  "remainingMetadata": { "author": "john", "created_at": "2026-02-22" }
}
```

**Behavior**:
- Read existing metadata
- Remove specified keys
- Write back remaining metadata

**Edge cases**:
- Key does not exist in current metadata -- silently skip (not an error)
- Removing all keys -- set empty metadata `{}`
- Concurrent modification -- retry per config

---

## 7. Tag Operations

### F7.1 Set Tags (P1)

**Description**: Set blob index tags on a blob.

**Inputs**:
- `remote`: Blob path
- `key=value` pairs: Tag entries

**Outputs**:
```json
{
  "path": "docs/readme.txt",
  "tags": { "env": "prod", "status": "active" }
}
```

**Behavior**:
- Validate max 10 tags
- Validate key length 1-128 characters, value length 0-256 characters
- Call `blobClient.setTags()`

**Edge cases**:
- More than 10 tags -- `MetadataError` with count
- Key or value exceeds length limits -- `MetadataError` with sizes
- Blob does not exist -- `BlobNotFoundError`

---

### F7.2 Get Tags (P1)

**Description**: Retrieve blob index tags for a blob.

**Inputs**:
- `remote`: Blob path

**Outputs**:
```json
{
  "path": "docs/readme.txt",
  "tags": { "env": "prod", "status": "active" }
}
```

**Edge cases**:
- Blob has no tags -- `tags: {}`
- Blob does not exist -- `BlobNotFoundError`

---

### F7.3 Query Blobs by Tags (P1)

**Description**: Find blobs matching a tag filter expression.

**Inputs**:
- `filter`: Tag query expression (e.g., `"env='prod' AND status='active'"`)

**Outputs**:
```json
{
  "filter": "env='prod' AND status='active'",
  "results": [
    { "name": "docs/readme.txt", "containerName": "my-container", "tags": { "env": "prod", "status": "active" } },
    { "name": "docs/config.json", "containerName": "my-container", "tags": { "env": "prod", "status": "active" } }
  ],
  "totalResults": 2
}
```

**Behavior**:
- Call `blobServiceClient.findBlobsByTags(filter)`
- Iterate all results

**Edge cases**:
- No matching blobs -- `results: [], totalResults: 0`
- Invalid filter syntax -- Azure SDK error wrapped with syntax guidance
- Tags not enabled on storage account -- specific error message
- Requires `Microsoft.Storage/.../blobs/filter/action` permission -- 403 with permission guidance

---

## 8. Cross-Cutting Features

### F8.1 JSON Output Mode (P0)

**Description**: All commands support `--json` flag for structured JSON output.

**Outputs**:
```json
{
  "success": true,
  "data": { ... },
  "error": null,
  "metadata": {
    "command": "upload",
    "timestamp": "2026-02-22T10:30:00Z",
    "durationMs": 234
  }
}
```

**Edge cases**:
- Error in JSON mode -- error formatted as JSON to stdout, process exits with non-zero code
- Command produces no data -- `data: null` with `success: true`

---

### F8.2 Verbose Logging (P1)

**Description**: `--verbose` flag enables detailed logging of Azure SDK requests.

**Behavior**:
- Log all request parameters (method, URL, headers)
- Log response status codes and timing
- Omit file content from logs (per research clarification)
- Log to stderr to keep stdout clean for JSON output

---

### F8.3 Configurable Retry (P1)

**Description**: Transient Azure errors (429, 503) are retried based on configured strategy.

**Strategies**:
- `none`: No retry, fail immediately
- `fixed`: Retry up to N times with fixed delay between each
- `exponential`: Retry with exponential backoff (delay doubles each attempt, capped at maxDelay)

**Edge cases**:
- Max retries exceeded -- throw the last error
- Non-retryable error (404, 403) -- fail immediately regardless of strategy
- Strategy is "none" -- `initialDelayMs` and `maxDelayMs` are not required

---

### F8.4 Path Normalization (P0)

**Description**: All blob paths are normalized before operations.

**Rules**:
1. Backslashes converted to forward slashes
2. Leading slashes removed
3. Double slashes collapsed
4. `.` segments removed
5. `..` segments resolved
6. Trailing slash preserved only for folder operations

**Edge cases**:
- Path `../escape/attempt` -- resolved relative to root (becomes `escape/attempt`)
- Path with only slashes `///` -- becomes empty string (root)
- Unicode characters in path -- preserved (Azure supports them)
- Path longer than 1024 characters -- `PathError`

---

### F8.5 Request Logging (P1)

**Description**: Log all Azure Storage requests with parameters but without file content.

**Logged fields**:
- Operation name (upload, download, delete, etc.)
- Blob path
- Request timestamp
- Response status code
- Response duration
- Content type and size (but not content itself)
- Metadata keys (but sensitive values masked)

**Not logged**:
- File content / body data
- Connection strings
- SAS tokens
- Account keys

---

### F8.6 Content Type Auto-Detection (P1)

**Description**: Automatically detect MIME type from file extension when uploading.

**Supported extensions**:

| Extension | Content Type |
|-----------|-------------|
| `.txt` | `text/plain` |
| `.json` | `application/json` |
| `.xml` | `application/xml` |
| `.html` | `text/html` |
| `.css` | `text/css` |
| `.js` | `application/javascript` |
| `.ts` | `text/typescript` |
| `.md` | `text/markdown` |
| `.csv` | `text/csv` |
| `.yaml`, `.yml` | `application/x-yaml` |
| `.png` | `image/png` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.gif` | `image/gif` |
| `.pdf` | `application/pdf` |
| `.zip` | `application/zip` |
| (unknown) | `application/octet-stream` |

**Edge cases**:
- No extension -- `application/octet-stream`
- `--content-type` flag provided -- override auto-detection
- Multiple extensions (`.tar.gz`) -- use last extension (`.gz`)

---

## 9. Error Handling

### F9.1 Structured Error Responses (P0)

**Description**: All errors return structured responses with machine-readable codes.

**Error codes**:

| Code | Category | Description |
|------|----------|-------------|
| `CONFIG_MISSING_REQUIRED` | Configuration | Required config parameter not found |
| `CONFIG_INVALID_VALUE` | Configuration | Config value fails validation |
| `CONFIG_FILE_NOT_FOUND` | Configuration | Config file path does not exist |
| `AUTH_MISSING_CONNECTION_STRING` | Authentication | Connection string env var not set |
| `AUTH_MISSING_SAS_TOKEN` | Authentication | SAS token env var not set |
| `AUTH_AZURE_AD_FAILED` | Authentication | DefaultAzureCredential failed |
| `AUTH_ACCESS_DENIED` | Authentication | 403 from Azure (RBAC issue) |
| `AUTH_INVALID_METHOD` | Authentication | Unknown auth method specified |
| `BLOB_NOT_FOUND` | Operations | 404 from Azure (blob does not exist) |
| `PATH_TOO_LONG` | Validation | Blob path exceeds 1024 characters |
| `PATH_INVALID` | Validation | Path contains invalid characters |
| `META_INVALID_KEY` | Metadata | Key does not match C# identifier rules |
| `META_SIZE_EXCEEDED` | Metadata | Total metadata exceeds 8 KB |
| `META_MAX_TAGS` | Tags | More than 10 blob index tags |
| `NET_CONNECTION_FAILED` | Network | Cannot reach Azure Storage |
| `NET_TIMEOUT` | Network | Request timed out |
| `NET_TRANSIENT_ERROR` | Network | 429 or 503 from Azure |
| `CONFLICT` | Operations | 409 from Azure (resource conflict) |
| `PRECONDITION_FAILED` | Operations | 412 from Azure (ETag mismatch) |
| `UNKNOWN_ERROR` | General | Unexpected error |

---

## 10. Feature Summary by Priority

### P0 -- Must-Have (24 features)

| ID | Feature |
|----|---------|
| F1.1 | Config file loading |
| F1.2 | Environment variable configuration |
| F1.3 | CLI flag overrides |
| F1.4 | Configuration validation (no fallbacks) |
| F1.7 | Connection validation |
| F2.1 | Azure AD authentication |
| F2.2 | SAS Token authentication |
| F2.3 | Connection String authentication |
| F3.1 | Upload file |
| F3.2 | Download file |
| F3.3 | Delete file |
| F3.4 | Replace file |
| F3.5 | File exists |
| F3.6 | File info |
| F4.1 | Create folder |
| F4.2 | List folder |
| F4.3 | Delete folder |
| F4.4 | Folder exists |
| F5.1 | Edit file (read-modify-write) |
| F5.2 | Patch file (text replacement) |
| F5.3 | Append/Prepend content |
| F8.1 | JSON output mode |
| F8.4 | Path normalization |
| F9.1 | Structured error responses |

### P1 -- Important (10 features)

| ID | Feature |
|----|---------|
| F1.5 | Interactive config init |
| F1.6 | Config display |
| F6.1 | Set metadata |
| F6.2 | Get metadata |
| F6.3 | Update metadata (merge) |
| F6.4 | Delete metadata keys |
| F7.1 | Set tags |
| F7.2 | Get tags |
| F7.3 | Query blobs by tags |
| F8.2 | Verbose logging |
| F8.3 | Configurable retry |
| F8.5 | Request logging |
| F8.6 | Content type auto-detection |

### P2 -- Nice-to-Have (future)

| Feature | Description |
|---------|-------------|
| ~~Batch upload~~ | ~~Upload multiple files in parallel~~ — **Implemented** as `upload-dir` command |
| Batch download | Download multiple files in parallel |
| Container management | Create/delete containers |
| ~~Recursive upload~~ | ~~Mirror local directory to blob storage~~ — **Implemented** as `upload-dir` command |
| Watch mode | Monitor and sync file changes |
| Progress events | JSON progress events for large file transfers |
| Shell completion | Bash/Zsh auto-completion for commands |
