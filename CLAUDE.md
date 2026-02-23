# Azure Blob Storage File System CLI Tool (azure-fs)

## Project Overview

A TypeScript CLI tool that presents Azure Blob Storage as a virtual file system. Designed for AI agent and human developer consumption with structured JSON output.

## Build & Run

```bash
npm install        # Install dependencies
npm run build      # Compile TypeScript to dist/
npm run dev        # Run via ts-node (development)
npm start          # Run compiled output
npm run clean      # Remove dist/
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Operation error (blob not found, network error, concurrent modification) |
| 2 | Configuration/authentication error (missing config, invalid auth) |
| 3 | Validation error (invalid path, metadata limits exceeded) |

## Tool Documentation

### Configuration Commands

<azure-fs-config-init>
    <objective>
        Interactively create a .azure-fs.json configuration file
    </objective>
    <command>
        azure-fs config init [--path <output-path>] [--json]
    </command>
    <info>
        Prompts the user for all required configuration values (storage account URL,
        container name, authentication method, logging settings, retry settings)
        and writes a .azure-fs.json configuration file.

        Parameters:
          --path <output-path>  Custom output path for the config file (default: ./.azure-fs.json)
          --json                Output result as structured JSON

        Examples:
          azure-fs config init
          azure-fs config init --path ~/.azure-fs.json
          azure-fs config init --json
    </info>
</azure-fs-config-init>

<azure-fs-config-show>
    <objective>
        Display the resolved configuration with sensitive values masked
    </objective>
    <command>
        azure-fs config show [--json] [--config <path>] [-a <url>] [-c <name>] [--auth-method <method>]
    </command>
    <info>
        Loads configuration from all three sources (config file, environment variables,
        CLI flags) and displays the merged result. Sensitive values (connection strings,
        SAS tokens) are masked. Shows whether environment secrets are set or not.

        This command does NOT validate that all required fields are present.
        Use 'config validate' for full validation.

        Parameters:
          --json                  Output result as structured JSON
          --config <path>         Path to .azure-fs.json config file
          -a, --account-url <url> Override storage account URL
          -c, --container <name>  Override container name
          --auth-method <method>  Override authentication method

        Examples:
          azure-fs config show
          azure-fs config show --json
          azure-fs config show --config /path/to/.azure-fs.json
    </info>
</azure-fs-config-show>

<azure-fs-config-validate>
    <objective>
        Validate configuration and test the connection to Azure Storage
    </objective>
    <command>
        azure-fs config validate [--json] [--config <path>] [-a <url>] [-c <name>] [--auth-method <method>]
    </command>
    <info>
        Loads and validates all configuration (all required fields must be present),
        creates an authenticated Azure Storage client using the configured auth method,
        and tests the connection by checking if the configured container exists.

        Exit codes:
          0  Configuration valid and connection successful
          1  Configuration valid but connection failed
          2  Configuration error (missing or invalid values)

        Parameters:
          --json                  Output result as structured JSON
          --config <path>         Path to .azure-fs.json config file
          -a, --account-url <url> Override storage account URL
          -c, --container <name>  Override container name
          --auth-method <method>  Override authentication method

        Examples:
          azure-fs config validate
          azure-fs config validate --json
          azure-fs config validate -a https://myaccount.blob.core.windows.net -c my-container --auth-method azure-ad --json
    </info>
</azure-fs-config-validate>

### File Commands

<azure-fs-upload>
    <objective>
        Upload a local file to Azure Blob Storage
    </objective>
    <command>
        azure-fs upload <local> <remote> [--metadata <pairs...>] [--json] [-v]
    </command>
    <info>
        Uploads a file from the local file system to the specified remote blob path.
        Auto-detects content type from the file extension. For files larger than 100MB,
        uses streaming upload for memory efficiency.

        Arguments:
          <local>                 Local file path to upload
          <remote>                Remote blob path (e.g., "documents/report.pdf")

        Parameters:
          --metadata <pairs...>   Metadata key=value pairs (e.g., --metadata author=john version=2)
          --json                  Output result as structured JSON
          -v, --verbose           Enable verbose logging

        Examples:
          azure-fs upload ./report.pdf documents/report.pdf
          azure-fs upload ./data.csv data/export.csv --metadata source=etl date=2026-01-01
          azure-fs upload ./config.json settings/config.json --json
    </info>
</azure-fs-upload>

<azure-fs-upload-dir>
    <objective>
        Upload an entire local directory to Azure Blob Storage with parallel uploads
    </objective>
    <command>
        azure-fs upload-dir <local-dir> <remote-prefix> [--concurrency <n>] [--exclude <patterns>] [--metadata <pairs...>] [--json] [-v]
    </command>
    <info>
        Recursively walks the local directory and uploads all files preserving folder
        structure under the specified remote prefix. Uses configurable parallelism for
        high throughput (10x+ faster than sequential single-file uploads).

        Exclusion patterns are matched against file and directory names (not full paths).
        Excluded directories are not descended into.

        Arguments:
          <local-dir>             Local directory path to upload
          <remote-prefix>         Remote blob prefix (e.g., "data/uploads/")

        Parameters:
          --concurrency <n>       Max parallel uploads (overrides AZURE_FS_BATCH_CONCURRENCY config)
          --exclude <patterns>    Comma-separated exclusion patterns (e.g., node_modules,.git,dist)
          --metadata <pairs...>   Metadata key=value pairs applied to all uploaded files
          --json                  Output result as structured JSON
          -v, --verbose           Enable verbose logging

        Examples:
          azure-fs upload-dir ./project data/project-backup/ --exclude node_modules,.git,dist
          azure-fs upload-dir ./docs docs/latest/ --concurrency 20 --json
          azure-fs upload-dir . archive/snapshot/ --exclude node_modules,.git,dist,.env --metadata env=prod version=1.0 --json
    </info>
</azure-fs-upload-dir>

<azure-fs-download>
    <objective>
        Download a blob from Azure Blob Storage
    </objective>
    <command>
        azure-fs download <remote> [local] [--json] [-v]
    </command>
    <info>
        Downloads a blob from the specified remote path. If a local path is provided,
        saves to that file. If no local path is given, outputs the blob content to stdout
        (in human-readable mode) or includes it in the JSON result.

        Arguments:
          <remote>    Remote blob path to download
          [local]     Optional local file path to save the blob to

        Parameters:
          --json      Output result as structured JSON
          -v, --verbose Enable verbose logging

        Examples:
          azure-fs download documents/report.pdf ./report.pdf
          azure-fs download config/settings.json
          azure-fs download config/settings.json --json
    </info>
</azure-fs-download>

<azure-fs-delete>
    <objective>
        Delete a single blob from Azure Blob Storage
    </objective>
    <command>
        azure-fs delete <remote> [--json] [-v]
    </command>
    <info>
        Deletes the blob at the specified remote path. Returns whether the blob
        existed before deletion. Uses deleteIfExists so it does not error if the
        blob is already gone.

        Arguments:
          <remote>    Remote blob path to delete

        Parameters:
          --json      Output result as structured JSON
          -v, --verbose Enable verbose logging

        Examples:
          azure-fs delete documents/old-report.pdf
          azure-fs delete temp/scratch.txt --json
    </info>
</azure-fs-delete>

<azure-fs-replace>
    <objective>
        Replace an existing blob with new content from a local file
    </objective>
    <command>
        azure-fs replace <local> <remote> [--metadata <pairs...>] [--json] [-v]
    </command>
    <info>
        Replaces the content of an existing blob with the content of a local file.
        Verifies the blob exists before uploading and uses ETag-based conditional
        access to prevent race conditions.

        Arguments:
          <local>                 Local file path with replacement content
          <remote>                Remote blob path to replace

        Parameters:
          --metadata <pairs...>   Metadata key=value pairs
          --json                  Output result as structured JSON
          -v, --verbose           Enable verbose logging

        Examples:
          azure-fs replace ./updated-report.pdf documents/report.pdf
          azure-fs replace ./config.json settings/config.json --metadata version=3
          azure-fs replace ./data.csv data/export.csv --json
    </info>
</azure-fs-replace>

<azure-fs-info>
    <objective>
        Show blob properties, metadata, and tags
    </objective>
    <command>
        azure-fs info <remote> [--json] [-v]
    </command>
    <info>
        Retrieves and displays detailed information about a blob including its
        size, content type, last modified date, ETag, user-defined metadata,
        and blob index tags.

        Arguments:
          <remote>    Remote blob path

        Parameters:
          --json      Output result as structured JSON
          -v, --verbose Enable verbose logging

        Examples:
          azure-fs info documents/report.pdf
          azure-fs info config/settings.json --json
    </info>
</azure-fs-info>

<azure-fs-exists>
    <objective>
        Check if a file or folder exists at the given remote path
    </objective>
    <command>
        azure-fs exists <path> [--type <type>] [--json] [-v]
    </command>
    <info>
        Checks whether a blob (file) or virtual folder exists at the specified path.
        By default, checks for a file first and then for a folder if the file is not
        found. Use --type to narrow the check to only files or only folders.

        Arguments:
          <path>            Remote path to check

        Parameters:
          --type <type>     Narrow check to 'file' or 'folder' (default: checks both)
          --json            Output result as structured JSON
          -v, --verbose     Enable verbose logging

        Examples:
          azure-fs exists documents/report.pdf
          azure-fs exists documents/ --type folder
          azure-fs exists config/settings.json --type file --json
    </info>
</azure-fs-exists>

### Folder Commands

<azure-fs-ls>
    <objective>
        List files and folders at the given remote path
    </objective>
    <command>
        azure-fs ls <path> [-r] [--json] [-v]
    </command>
    <info>
        Lists all files and subfolders at one level within the specified path.
        Uses Azure Blob Storage hierarchical listing with '/' as the delimiter.
        Use --recursive to list all nested items in a flat listing.

        Arguments:
          <path>          Remote folder path (use "/" for container root)

        Parameters:
          -r, --recursive List all nested items recursively (flat listing)
          --json          Output result as structured JSON
          -v, --verbose   Enable verbose logging

        Examples:
          azure-fs ls /
          azure-fs ls documents/
          azure-fs ls documents/ --recursive
          azure-fs ls / --json
    </info>
</azure-fs-ls>

<azure-fs-mkdir>
    <objective>
        Create a virtual folder in Azure Blob Storage
    </objective>
    <command>
        azure-fs mkdir <path> [--json] [-v]
    </command>
    <info>
        Creates a virtual directory by uploading a zero-byte marker blob with
        content type 'application/x-directory' and metadata { hdi_isfolder: 'true' }
        for ADLS Gen2 compatibility.

        Arguments:
          <path>        Remote folder path to create

        Parameters:
          --json        Output result as structured JSON
          -v, --verbose Enable verbose logging

        Examples:
          azure-fs mkdir documents/
          azure-fs mkdir data/exports/2026/
          azure-fs mkdir backups/ --json
    </info>
</azure-fs-mkdir>

<azure-fs-rmdir>
    <objective>
        Delete a folder and all its contents recursively
    </objective>
    <command>
        azure-fs rmdir <path> [--json] [-v]
    </command>
    <info>
        Recursively deletes all blobs under the specified folder prefix, including
        the folder marker blob itself. Returns the count and list of deleted items.

        Arguments:
          <path>        Remote folder path to delete

        Parameters:
          --json        Output result as structured JSON
          -v, --verbose Enable verbose logging

        Examples:
          azure-fs rmdir temp/
          azure-fs rmdir old-data/exports/ --json
    </info>
</azure-fs-rmdir>

### Edit Commands

<azure-fs-edit>
    <objective>
        Download a blob to a temp file for editing, or re-upload an edited file
    </objective>
    <command>
        azure-fs edit <remote> [--upload] [--local <path>] [--etag <etag>] [--json] [-v]
    </command>
    <info>
        Two-phase edit workflow for modifying blob content:

        Phase 1 (download): Downloads the blob to a temporary local file and returns
        the local path and the blob's ETag. The user can then edit the file locally.

        Phase 2 (re-upload): With --upload, re-uploads the modified file using the
        ETag for concurrency protection. If the blob was modified by another process
        since download, the upload fails with a ConcurrentModificationError.

        Arguments:
          <remote>          Remote blob path to edit

        Parameters:
          --upload          Re-upload mode: re-upload an edited file (requires --local and --etag)
          --local <path>    Local file path to re-upload (used with --upload)
          --etag <etag>     ETag from original download for concurrency check (used with --upload)
          --json            Output result as structured JSON
          -v, --verbose     Enable verbose logging

        Examples:
          # Phase 1: download for editing
          azure-fs edit documents/readme.md --json
          # Phase 2: re-upload after editing
          azure-fs edit documents/readme.md --upload --local /tmp/azure-fs-edit-abc123.md --etag "0x8DC1234567890AB" --json
    </info>
</azure-fs-edit>

<azure-fs-patch>
    <objective>
        Apply text patches (find-replace) to a blob's content
    </objective>
    <command>
        azure-fs patch <remote> --find <text> --replace <text> [--regex] [--flags <flags>] [--json] [-v]
    </command>
    <info>
        Downloads the blob content, applies a find-and-replace operation, and re-uploads.
        Supports both literal string matching and regular expression patterns.
        Uses ETag-based concurrency protection.

        Arguments:
          <remote>            Remote blob path to patch

        Parameters:
          --find <text>       Text or regex pattern to find (required)
          --replace <text>    Replacement text (required)
          --regex             Treat --find as a regular expression
          --flags <flags>     Regex flags (e.g., 'g', 'gi'); implies --regex
          --json              Output result as structured JSON
          -v, --verbose       Enable verbose logging

        Examples:
          azure-fs patch config/settings.json --find "localhost" --replace "production.example.com"
          azure-fs patch documents/readme.md --find "v1\\.\\d+" --replace "v2.0" --regex --flags gi
          azure-fs patch data/template.txt --find "{{NAME}}" --replace "Azure FS" --json
    </info>
</azure-fs-patch>

<azure-fs-append>
    <objective>
        Append or prepend content to a blob
    </objective>
    <command>
        azure-fs append <remote> --content <text> [--position <position>] [--json] [-v]
    </command>
    <info>
        Downloads the blob content, adds the specified content at the start or end,
        and re-uploads. Uses ETag-based concurrency protection.

        Arguments:
          <remote>                Remote blob path

        Parameters:
          --content <text>        Content to add (required)
          --position <position>   Where to add: 'start' or 'end' (default: end)
          --json                  Output result as structured JSON
          -v, --verbose           Enable verbose logging

        Examples:
          azure-fs append logs/app.log --content "New log entry\n"
          azure-fs append documents/readme.md --content "# Header\n\n" --position start
          azure-fs append data/records.csv --content "2026-02-22,value1,value2\n" --json
    </info>
</azure-fs-append>

### Metadata Commands

<azure-fs-meta-set>
    <objective>
        Set (replace all) user-defined metadata on a blob
    </objective>
    <command>
        azure-fs meta set <remote> <pairs...> [--json] [-v]
    </command>
    <info>
        Replaces all existing metadata on a blob with the provided key=value pairs.
        Any previously set metadata keys that are not included will be removed.
        Validates metadata key names and total size before applying.

        Arguments:
          <remote>        Remote blob path
          <pairs...>      One or more key=value pairs (e.g., author=john version=2)

        Parameters:
          --json          Output result as structured JSON
          -v, --verbose   Enable verbose logging

        Examples:
          azure-fs meta set documents/report.pdf author=john department=engineering
          azure-fs meta set config/app.json env=production version=3.1 --json
    </info>
</azure-fs-meta-set>

<azure-fs-meta-get>
    <objective>
        Get all user-defined metadata from a blob
    </objective>
    <command>
        azure-fs meta get <remote> [--json] [-v]
    </command>
    <info>
        Retrieves and displays all user-defined metadata key=value pairs from the
        specified blob.

        Arguments:
          <remote>        Remote blob path

        Parameters:
          --json          Output result as structured JSON
          -v, --verbose   Enable verbose logging

        Examples:
          azure-fs meta get documents/report.pdf
          azure-fs meta get config/app.json --json
    </info>
</azure-fs-meta-get>

<azure-fs-meta-update>
    <objective>
        Merge metadata into existing blob metadata
    </objective>
    <command>
        azure-fs meta update <remote> <pairs...> [--json] [-v]
    </command>
    <info>
        Merges the provided key=value pairs into the blob's existing metadata.
        Existing keys not mentioned in the update are preserved. Keys that appear
        in both are overwritten with the new values.

        Arguments:
          <remote>        Remote blob path
          <pairs...>      One or more key=value pairs to merge

        Parameters:
          --json          Output result as structured JSON
          -v, --verbose   Enable verbose logging

        Examples:
          azure-fs meta update documents/report.pdf version=4
          azure-fs meta update config/app.json env=staging reviewed=true --json
    </info>
</azure-fs-meta-update>

<azure-fs-meta-delete>
    <objective>
        Delete specific metadata keys from a blob
    </objective>
    <command>
        azure-fs meta delete <remote> <keys...> [--json] [-v]
    </command>
    <info>
        Removes the specified metadata keys from the blob. Other metadata keys
        are preserved. Non-existent keys are silently ignored.

        Arguments:
          <remote>        Remote blob path
          <keys...>       One or more metadata key names to remove

        Parameters:
          --json          Output result as structured JSON
          -v, --verbose   Enable verbose logging

        Examples:
          azure-fs meta delete documents/report.pdf draft
          azure-fs meta delete config/app.json temp_flag debug_mode --json
    </info>
</azure-fs-meta-delete>

### Tags Commands

<azure-fs-tags-set>
    <objective>
        Set (replace all) blob index tags on a blob
    </objective>
    <command>
        azure-fs tags set <remote> <pairs...> [--json] [-v]
    </command>
    <info>
        Replaces all existing blob index tags with the provided key=value pairs.
        Blob index tags enable querying blobs across the storage account.
        Maximum of 10 tags per blob; keys up to 128 chars, values up to 256 chars.

        Arguments:
          <remote>        Remote blob path
          <pairs...>      One or more tag key=value pairs

        Parameters:
          --json          Output result as structured JSON
          -v, --verbose   Enable verbose logging

        Examples:
          azure-fs tags set documents/report.pdf department=engineering status=published
          azure-fs tags set data/export.csv env=prod date=2026-02-22 --json
    </info>
</azure-fs-tags-set>

<azure-fs-tags-get>
    <objective>
        Get all blob index tags from a blob
    </objective>
    <command>
        azure-fs tags get <remote> [--json] [-v]
    </command>
    <info>
        Retrieves and displays all blob index tags (key=value pairs) from the
        specified blob.

        Arguments:
          <remote>        Remote blob path

        Parameters:
          --json          Output result as structured JSON
          -v, --verbose   Enable verbose logging

        Examples:
          azure-fs tags get documents/report.pdf
          azure-fs tags get config/app.json --json
    </info>
</azure-fs-tags-get>

<azure-fs-tags-query>
    <objective>
        Query blobs across the container by an OData tag filter expression
    </objective>
    <command>
        azure-fs tags query <filter> [--json] [-v]
    </command>
    <info>
        Searches for blobs that match the given OData tag filter expression.
        Uses Azure Blob Storage's findBlobsByTags API. Returns a list of
        matching blob names and their tags.

        The filter uses OData syntax for tag comparisons. String values must
        be enclosed in single quotes within the filter expression.

        Arguments:
          <filter>        OData tag filter expression

        Parameters:
          --json          Output result as structured JSON
          -v, --verbose   Enable verbose logging

        Examples:
          azure-fs tags query "env = 'prod'"
          azure-fs tags query "department = 'engineering' AND status = 'published'"
          azure-fs tags query "date >= '2026-01-01'" --json
    </info>
</azure-fs-tags-query>

### REST API

<azure-fs-api>
    <objective>
        Start the REST API server for Azure Blob Storage operations
    </objective>
    <command>
        npm run api
    </command>
    <info>
        Starts an Express-based REST API server that exposes Azure Blob Storage
        operations over HTTP. The API is an alternative to the CLI for programmatic
        access and integration with web applications or AI agents.

        Start commands:
          npm run api          Development mode (ts-node)
          npm run api:start    Production mode (compiled JS, requires npm run build first)

        Endpoints:

          Health:
            GET    /api/health                  Liveness check (always 200 if process is alive)
            GET    /api/health/ready            Readiness check (verifies Azure Storage connectivity)

          Files (mounted at /api/v1/files):
            POST   /api/v1/files               Upload a file (multipart/form-data)
            GET    /api/v1/files/:path          Download a file
            HEAD   /api/v1/files/:path          Check if a file exists
            PUT    /api/v1/files/:path          Replace file content (multipart/form-data)
            DELETE /api/v1/files/:path          Delete a file
            GET    /api/v1/files/:path/info     Get file properties and metadata

          Edit (mounted at /api/v1/files):
            PATCH  /api/v1/files/:path/patch    Find-and-replace in file content
            PATCH  /api/v1/files/:path/append   Append or prepend content to a file
            POST   /api/v1/files/:path/edit     Download file for editing (returns ETag)
            PUT    /api/v1/files/:path/edit     Re-upload edited file (ETag concurrency check)

          Folders (mounted at /api/v1/folders):
            GET    /api/v1/folders/:path        List folder contents
            POST   /api/v1/folders/:path        Create a virtual folder
            DELETE /api/v1/folders/:path        Delete folder and contents recursively
            HEAD   /api/v1/folders/:path        Check if a folder exists

          Metadata (mounted at /api/v1/meta):
            GET    /api/v1/meta/:path           Get all metadata for a blob
            PUT    /api/v1/meta/:path           Set (replace all) metadata
            PATCH  /api/v1/meta/:path           Merge/update metadata
            DELETE /api/v1/meta/:path           Delete specific metadata keys

          Tags (mounted at /api/v1/tags):
            GET    /api/v1/tags                 Query blobs by tag filter (?filter=...)
            GET    /api/v1/tags/:path           Get all tags for a blob
            PUT    /api/v1/tags/:path           Set (replace all) tags

        Configuration:
          All 6 AZURE_FS_API_* environment variables must be set (see Environment
          Variables section). Alternatively, configure via the "api" section in
          .azure-fs.json.

        Health check:
          GET http://localhost:3000/api/health

        Swagger docs (when enabled):
          http://localhost:3000/api/docs
          http://localhost:3000/api/docs.json

        Examples:
          npm run api                         # Start in development mode
          npm run build && npm run api:start  # Start in production mode
          curl http://localhost:3000/api/health
          curl http://localhost:3000/api/v1/files/documents/readme.md
    </info>
</azure-fs-api>

## Global CLI Options

| Flag | Short | Description |
|------|-------|-------------|
| `--json` | | Output structured JSON to stdout |
| `--verbose` | `-v` | Enable verbose/debug logging |
| `--config <path>` | | Path to .azure-fs.json config file |
| `--account-url <url>` | `-a` | Override storage account URL |
| `--container <name>` | `-c` | Override container name |
| `--auth-method <method>` | | Override auth method |

## Configuration Priority

CLI Flags > Environment Variables > Config File (.azure-fs.json)

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AZURE_STORAGE_ACCOUNT_URL` | Storage account URL |
| `AZURE_STORAGE_CONTAINER_NAME` | Default container name |
| `AZURE_FS_AUTH_METHOD` | Auth method: connection-string, sas-token, azure-ad |
| `AZURE_STORAGE_CONNECTION_STRING` | Connection string (for connection-string auth) |
| `AZURE_STORAGE_SAS_TOKEN` | SAS token (for sas-token auth) |
| `AZURE_STORAGE_SAS_TOKEN_EXPIRY` | SAS token expiry in ISO 8601 format (required for sas-token auth) |
| `AZURE_FS_LOG_LEVEL` | Log level: debug, info, warn, error |
| `AZURE_FS_LOG_REQUESTS` | Log Azure SDK requests: true/false |
| `AZURE_FS_RETRY_STRATEGY` | Retry strategy: none, exponential, fixed |
| `AZURE_FS_RETRY_MAX_RETRIES` | Maximum number of retries |
| `AZURE_FS_RETRY_INITIAL_DELAY_MS` | Initial retry delay in ms |
| `AZURE_FS_RETRY_MAX_DELAY_MS` | Maximum retry delay in ms |
| `AZURE_FS_BATCH_CONCURRENCY` | Max parallel uploads for batch operations (upload-dir) |
| `AZURE_FS_API_PORT` | REST API server port (e.g., 3000) |
| `AZURE_FS_API_HOST` | REST API server bind host (e.g., 0.0.0.0) |
| `AZURE_FS_API_CORS_ORIGINS` | Comma-separated allowed CORS origins (e.g., * or specific URLs) |
| `AZURE_FS_API_SWAGGER_ENABLED` | Enable Swagger UI at /api/docs: true/false |
| `AZURE_FS_API_UPLOAD_MAX_SIZE_MB` | Maximum upload file size in MB for API uploads |
| `AZURE_FS_API_REQUEST_TIMEOUT_MS` | Request timeout in milliseconds for API requests |

## Authentication Methods

1. **azure-ad** (recommended): Uses DefaultAzureCredential. Requires `az login` or equivalent.
2. **sas-token**: Requires `AZURE_STORAGE_SAS_TOKEN` and `AZURE_STORAGE_SAS_TOKEN_EXPIRY` env vars.
3. **connection-string**: Requires `AZURE_STORAGE_CONNECTION_STRING` env var.

## Project Structure

```
src/
  index.ts                          - CLI entry point
  api/
    server.ts                       - Express app factory and HTTP server startup
    swagger/
      config.ts                     - OpenAPI 3.0 spec generation (swagger-jsdoc)
    routes/
      index.ts                      - Route registration barrel
      health.routes.ts              - GET /api/health, GET /api/health/ready
      file.routes.ts                - /api/v1/files CRUD endpoints
      folder.routes.ts              - /api/v1/folders CRUD endpoints
      edit.routes.ts                - /api/v1/files/:path/patch|append|edit
      meta.routes.ts                - /api/v1/meta CRUD endpoints
      tags.routes.ts                - /api/v1/tags CRUD + query endpoints
    controllers/
      file.controller.ts            - File operation request handlers
      folder.controller.ts          - Folder operation request handlers
      edit.controller.ts            - Edit operation request handlers
      meta.controller.ts            - Metadata operation request handlers
      tags.controller.ts            - Tags operation request handlers
    middleware/
      error-handler.middleware.ts    - Global error handling middleware
      request-logger.middleware.ts   - HTTP request logging
      timeout.middleware.ts          - Request timeout enforcement
      upload.middleware.ts           - Multer file upload handling
  commands/
    index.ts                        - Command registration barrel
    config.commands.ts              - config init | show | validate
    file.commands.ts                - upload | download | delete | replace | info | exists
    folder.commands.ts              - ls | mkdir | rmdir
    edit.commands.ts                - edit | patch | append
    meta.commands.ts                - meta set | get | update | delete
    tags.commands.ts                - tags set | get | query
  services/
    blob-filesystem.service.ts      - Core file system operations
    auth.service.ts                 - Authentication factory (3 methods)
    metadata.service.ts             - Metadata and tag operations
    path.service.ts                 - Path normalization and validation
    config.service.ts               - Configuration loading (if present)
  config/
    config.loader.ts                - Layered config loading (CLI > env > file)
    config.schema.ts                - Config validation (no fallbacks)
  types/
    index.ts                        - Barrel export
    config.types.ts                 - AzureFsConfig, AuthMethod, ResolvedConfig
    command-result.types.ts         - CommandResult<T>
    filesystem.types.ts             - FileSystemItem, FileInfo, FolderInfo
    patch.types.ts                  - PatchInstruction, PatchResult
    errors.types.ts                 - Error code enums
  errors/
    base.error.ts                   - AzureFsError base class
    config.error.ts                 - ConfigError
    auth.error.ts                   - AuthError
    blob-not-found.error.ts         - BlobNotFoundError
    path.error.ts                   - PathError
    metadata.error.ts               - MetadataError
    concurrent-modification.error.ts - ConcurrentModificationError
  utils/
    output.utils.ts                 - JSON/human-readable output formatting
    exit-codes.utils.ts             - Process exit code constants and resolver
    logger.utils.ts                 - Logger with verbose mode
    retry.utils.ts                  - Retry logic
    validation.utils.ts             - Metadata/blob name validation
    content-type.utils.ts           - MIME type detection
    stream.utils.ts                 - Stream helpers
    concurrency.utils.ts            - Promise-based parallel execution limiter
```
