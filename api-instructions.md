# REST API Instructions

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
          npm run api          Development mode (ts-node, single run)
          npm run api:dev      Development mode with auto-reload (nodemon + ts-node, restarts on .ts changes)
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

          Development (mounted at /api/dev, only when NODE_ENV=development):
            GET    /api/dev/env                 List all environment variables (masked sensitive values)
            GET    /api/dev/env/:key            Get a specific environment variable by name

          Hotkeys (mounted at /api/dev/hotkeys, only when NODE_ENV=development):
            POST   /api/dev/hotkeys/clear       Clear console output
            POST   /api/dev/hotkeys/freeze      Toggle freeze/unfreeze log output
            POST   /api/dev/hotkeys/verbose     Toggle verbose mode (debug/info)
            GET    /api/dev/hotkeys/config      Inspect resolved configuration (masked)
            GET    /api/dev/hotkeys/status      Get current hotkey state (frozen, verbose)
            GET    /api/dev/hotkeys/help        List available hotkeys and descriptions

        Configuration:
          All 6 AZURE_FS_API_* environment variables plus NODE_ENV and AUTO_SELECT_PORT
          must be set (see Environment Variables section). Alternatively, configure
          via the "api" section in .azure-fs.json.

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

## PortChecker Utility

The `PortChecker` class (`src/utils/port-checker.utils.ts`) provides proactive TCP port conflict detection before Express attempts to listen. It is a standalone utility with no project dependencies.

**Behavior**:
- `isPortAvailable(port, host)`: Attempts to bind a temporary `net.Server`. Returns `true` if binding succeeds, `false` if `EADDRINUSE` or other error.
- `findAvailablePort(startPort, maxAttempts, host)`: Sequentially scans ports from `startPort` to `startPort + maxAttempts - 1`. Returns the first available port or an error.
- `getProcessUsingPort(port)`: Uses `lsof` to identify the process using a port (macOS/Linux only). Returns `null` on Windows or failure. Informational only.

**Server startup flow** (in `src/api/server.ts`):
1. Check if configured port is available via `PortChecker.isPortAvailable()`.
2. If unavailable and `AUTO_SELECT_PORT=true`, find next available port via `PortChecker.findAvailablePort()`.
3. If unavailable and `AUTO_SELECT_PORT=false`, exit with error code 1.
4. The `server.on("error")` handler remains as a safety net for race conditions.

## Container-Aware Swagger URLs

The Swagger/OpenAPI spec (`src/api/swagger/config.ts`) auto-detects the runtime environment to generate correct server URLs in the following priority order:

1. **PUBLIC_URL** - Explicit override for any environment
2. **WEBSITE_HOSTNAME** - Azure App Service (HTTPS when WEBSITE_SITE_NAME is set)
3. **K8S_SERVICE_HOST + K8S_SERVICE_PORT** - Kubernetes (HTTPS when AZURE_FS_API_USE_HTTPS=true)
4. **DOCKER_HOST_URL** - Docker container
5. **Local development** - `http://{host}:{port}`

When `api.swaggerServerVariables` is `true`, the primary server entry uses templated variables (`{protocol}`, `{host}`, `{port}`) for interactive editing in Swagger UI. Additional servers can be added via `api.swaggerAdditionalServers`.


## Console Hotkeys

The `ConsoleCommands` class (`src/utils/console-commands.utils.ts`) provides interactive keyboard controls during API development. Automatically enabled when `NODE_ENV !== "production"`.

**Hotkeys** (type letter + Enter):

| Key | Action |
|-----|--------|
| `c` | Clear console (including scrollback buffer) |
| `f` | Freeze / unfreeze log output |
| `v` | Toggle verbose mode (switches `AZURE_FS_LOG_LEVEL` between debug/info) |
| `i` | Inspect resolved configuration (sensitive values masked) |
| `h` | Show help menu |
| `Ctrl+C` | Graceful exit |

**Integration**: Initialized in `src/api/server.ts` after the HTTP server starts listening. Cleaned up during graceful shutdown. Uses `chalk` for colored terminal output.

## API Usage Guide (curl)

### Base URL

Set the `BASE` variable according to your environment before running any curl command:

```bash
# Development (npm run api)
BASE=http://localhost:3000

# Docker container (port 4100 mapped to internal 3000)
BASE=http://localhost:4100

# Azure Web App
BASE=https://azure-fs-api.azurewebsites.net
```

All examples below use `$BASE` as the base URL.

---

### Health Check

```bash
# Liveness check (always 200 if process is alive)
curl -s $BASE/api/health

# Readiness check (verifies Azure Storage connectivity)
curl -s $BASE/api/health/ready
```

---

### Files

#### Upload a file

```bash
curl -s -X POST $BASE/api/v1/files \
  -F "file=@./report.pdf" \
  -F "remotePath=documents/report.pdf"

# With metadata
curl -s -X POST $BASE/api/v1/files \
  -F "file=@./data.csv" \
  -F "remotePath=data/export.csv" \
  -F "metadata[source]=etl" \
  -F "metadata[date]=2026-02-26"
```

#### Download a file

```bash
# Download to stdout (JSON response with content)
curl -s $BASE/api/v1/files/documents/report.pdf

# Save to local file
curl -s $BASE/api/v1/files/documents/report.pdf --output ./report.pdf
```

#### Check if a file exists

```bash
# Returns 200 if exists, 404 if not (HEAD request -- no body)
curl -s -o /dev/null -w "%{http_code}" -X HEAD $BASE/api/v1/files/documents/report.pdf
```

#### Get file info (properties, metadata, tags)

```bash
curl -s $BASE/api/v1/files/documents/report.pdf/info
```

#### Replace file content

```bash
curl -s -X PUT $BASE/api/v1/files/documents/report.pdf \
  -F "file=@./updated-report.pdf"

# With metadata
curl -s -X PUT $BASE/api/v1/files/documents/report.pdf \
  -F "file=@./updated-report.pdf" \
  -F "metadata[version]=3"
```

#### Delete a file

```bash
curl -s -X DELETE $BASE/api/v1/files/documents/report.pdf
```

---

### Folders

#### List folder contents

```bash
# List root (use %2F for the root path)
curl -s $BASE/api/v1/folders/%2F

# List a subfolder
curl -s $BASE/api/v1/folders/documents/

# Recursive listing (query param)
curl -s "$BASE/api/v1/folders/documents/?recursive=true"
```

#### Create a virtual folder

```bash
curl -s -X POST $BASE/api/v1/folders/data/exports/2026/
```

#### Delete a folder (recursive)

```bash
curl -s -X DELETE $BASE/api/v1/folders/temp/
```

#### Check if a folder exists

```bash
curl -s -o /dev/null -w "%{http_code}" -X HEAD $BASE/api/v1/folders/documents/
```

---

### Edit Operations

#### Patch (find-and-replace)

```bash
# Literal string replace
curl -s -X PATCH $BASE/api/v1/edit/patch/config/settings.json \
  -H "Content-Type: application/json" \
  -d '{"find": "localhost", "replace": "production.example.com"}'

# Regex replace
curl -s -X PATCH $BASE/api/v1/edit/patch/documents/readme.md \
  -H "Content-Type: application/json" \
  -d '{"find": "v1\\.\\d+", "replace": "v2.0", "regex": true, "flags": "gi"}'
```

#### Append / Prepend content

```bash
# Append to end (default)
curl -s -X PATCH $BASE/api/v1/edit/append/logs/app.log \
  -H "Content-Type: application/json" \
  -d '{"content": "New log entry\n"}'

# Prepend to start
curl -s -X PATCH $BASE/api/v1/edit/append/documents/readme.md \
  -H "Content-Type: application/json" \
  -d '{"content": "# Header\n\n", "position": "start"}'
```

#### Edit workflow (two-phase: download then re-upload)

```bash
# Phase 1: Download for editing (returns local path + ETag)
curl -s -X POST $BASE/api/v1/edit/download/documents/readme.md

# Phase 2: Re-upload after editing (requires ETag from phase 1)
curl -s -X PUT $BASE/api/v1/edit/upload/documents/readme.md \
  -F "file=@/tmp/azure-fs-edit-abc123.md" \
  -H "If-Match: \"0x8DC1234567890AB\""
```

---

### Metadata

#### Get all metadata

```bash
curl -s $BASE/api/v1/meta/documents/report.pdf
```

#### Set metadata (replace all)

```bash
curl -s -X PUT $BASE/api/v1/meta/documents/report.pdf \
  -H "Content-Type: application/json" \
  -d '{"author": "john", "department": "engineering"}'
```

#### Update metadata (merge)

```bash
curl -s -X PATCH $BASE/api/v1/meta/documents/report.pdf \
  -H "Content-Type: application/json" \
  -d '{"version": "4", "reviewed": "true"}'
```

#### Delete metadata keys

```bash
curl -s -X DELETE $BASE/api/v1/meta/documents/report.pdf \
  -H "Content-Type: application/json" \
  -d '{"keys": ["draft", "temp_flag"]}'
```

---

### Tags

#### Get all tags

```bash
curl -s $BASE/api/v1/tags/documents/report.pdf
```

#### Set tags (replace all)

```bash
curl -s -X PUT $BASE/api/v1/tags/documents/report.pdf \
  -H "Content-Type: application/json" \
  -d '{"department": "engineering", "status": "published"}'
```

#### Query blobs by tag filter

```bash
# OData tag filter expression
curl -s "$BASE/api/v1/tags?filter=department%20%3D%20%27engineering%27"

# Multiple conditions
curl -s "$BASE/api/v1/tags?filter=department%20%3D%20%27engineering%27%20AND%20status%20%3D%20%27published%27"
```

---

### Development Endpoints (NODE_ENV=development only)

#### Environment Variables

```bash
# List all environment variables (sensitive values masked)
curl -s $BASE/api/dev/env

# Get a specific environment variable
curl -s $BASE/api/dev/env/AZURE_STORAGE_ACCOUNT_URL
```

#### Hotkeys (remote console commands)

```bash
# Get current hotkey state (frozen, verbose)
curl -s $BASE/api/dev/hotkeys/status

# Toggle verbose mode (debug/info)
curl -s -X POST $BASE/api/dev/hotkeys/verbose

# Toggle freeze/unfreeze log output
curl -s -X POST $BASE/api/dev/hotkeys/freeze

# Inspect resolved configuration (sensitive values masked)
curl -s $BASE/api/dev/hotkeys/config

# Clear console output
curl -s -X POST $BASE/api/dev/hotkeys/clear

# List available hotkeys and descriptions
curl -s $BASE/api/dev/hotkeys/help
```

---

### Swagger Documentation

```bash
# Open Swagger UI in browser
open $BASE/api/docs

# Download OpenAPI JSON spec
curl -s $BASE/api/docs.json
```

---

### Quick Smoke Test

Run this sequence to verify the API is fully operational:

```bash
BASE=http://localhost:3000  # or http://localhost:4100 for Docker, or https://azure-fs-api.azurewebsites.net for Azure

# 1. Health check
curl -s $BASE/api/health

# 2. Create a folder
curl -s -X POST $BASE/api/v1/folders/test-smoke/

# 3. Upload a file
echo "Hello Azure FS" > /tmp/smoke-test.txt
curl -s -X POST $BASE/api/v1/files \
  -F "file=@/tmp/smoke-test.txt" \
  -F "remotePath=test-smoke/hello.txt"

# 4. Download the file
curl -s $BASE/api/v1/files/test-smoke/hello.txt

# 5. Get file info
curl -s $BASE/api/v1/files/test-smoke/hello.txt/info

# 6. Set metadata
curl -s -X PUT $BASE/api/v1/meta/test-smoke/hello.txt \
  -H "Content-Type: application/json" \
  -d '{"env": "test"}'

# 7. Get metadata
curl -s $BASE/api/v1/meta/test-smoke/hello.txt

# 8. Patch content
curl -s -X PATCH $BASE/api/v1/edit/patch/test-smoke/hello.txt \
  -H "Content-Type: application/json" \
  -d '{"find": "Hello", "replace": "Goodbye"}'

# 9. List folder contents
curl -s $BASE/api/v1/folders/test-smoke/

# 10. Cleanup: delete folder and contents
curl -s -X DELETE $BASE/api/v1/folders/test-smoke/

# Cleanup temp file
rm /tmp/smoke-test.txt
```
