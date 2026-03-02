# REST API Instructions

### REST API

<repo-sync-api>
    <objective>
        Start the REST API server for repository synchronization operations
    </objective>
    <command>
        npm run api
    </command>
    <info>
        Starts an Express-based REST API server that exposes repository synchronization
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

          Repository Replication (mounted at /api/v1/repo):
            POST   /api/v1/repo/github           Clone a GitHub repo to blob storage
            POST   /api/v1/repo/devops           Clone an Azure DevOps repo to blob storage
            POST   /api/v1/repo/sync             Batch-replicate repos from sync pair config (30-min timeout)
            GET    /api/v1/repo/sync-pairs        List configured sync pairs with token status

          Development (mounted at /api/dev, only when NODE_ENV=development):
            GET    /api/dev/env                 List all environment variables (masked sensitive values)
            GET    /api/dev/env/:key            Get a specific environment variable by name
            GET    /api/dev/azure-venv          Inspect azure-venv sync result and watch status

          Hotkeys (mounted at /api/dev/hotkeys, only when NODE_ENV=development):
            POST   /api/dev/hotkeys/clear       Clear console output
            POST   /api/dev/hotkeys/freeze      Toggle freeze/unfreeze log output
            POST   /api/dev/hotkeys/verbose     Toggle verbose mode (debug/info)
            GET    /api/dev/hotkeys/config      Inspect resolved configuration (masked)
            GET    /api/dev/hotkeys/status      Get current hotkey state (frozen, verbose)
            GET    /api/dev/hotkeys/help        List available hotkeys and descriptions

        Configuration:
          All AZURE_FS_API_* environment variables plus NODE_ENV and AUTO_SELECT_PORT
          must be set (see Environment Variables section). Alternatively, configure
          via the "api" section in .repo-sync.json.

        Health check:
          GET http://localhost:3000/api/health

        Swagger docs (when enabled):
          http://localhost:3000/api/docs
          http://localhost:3000/api/docs.json

        Examples:
          npm run api                         # Start in development mode
          npm run build && npm run api:start  # Start in production mode
          curl http://localhost:3000/api/health
    </info>
</repo-sync-api>

## PortChecker Utility

The `PortChecker` class (`src/utils/port-checker.utils.ts`) provides proactive TCP port conflict detection before Express attempts to listen. It is a standalone utility with no project dependencies.

**Behavior**:
- `isPortAvailable(port, host)`: Attempts to bind a temporary `net.Server`. Returns `true` if binding succeeds, `false` if `EADDRINUSE` or other error.
- `findAvailablePort(startPort, maxAttempts, host)`: Sequentially scans ports from `startPort` to `startPort + maxAttempts - 1`. Returns the first available port or an error.
- `getProcessUsingPort(port)`: Uses `lsof` to identify the process using a port (macOS/Linux only). Returns `null` on Windows or failure. Informational only.

**Server startup flow** (in `src/api/server.ts`):
0. `watchAzureVenv()` performs initial sync and starts background polling for blob changes (configurable via `AZURE_VENV_POLL_INTERVAL`, default 30s). No-op if `AZURE_VENV` is not set.
1. Check if configured port is available via `PortChecker.isPortAvailable()`.
2. If unavailable and `AUTO_SELECT_PORT=true`, find next available port via `PortChecker.findAvailablePort()`.
3. If unavailable and `AUTO_SELECT_PORT=false`, exit with error code 1.
4. The `server.on("error")` handler remains as a safety net for race conditions.
5. On graceful shutdown (SIGTERM/SIGINT): stop azure-venv watcher, cleanup console hotkeys, drain connections.

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
| `b` | Inspect azure-venv (blobs, env sources, watch status) |
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
BASE=https://repo-sync-api.azurewebsites.net
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

### Repository Replication

The single-repo endpoints (`/github`, `/devops`) have a 5-minute timeout (300,000 ms) instead of the default request timeout, because repository replication is a long-running streaming operation. The batch sync endpoint (`/sync`) has a 30-minute timeout (1,800,000 ms) to accommodate multi-pair operations.

#### Clone a GitHub repository

```bash
# Clone a public repository (default branch)
curl -s -X POST $BASE/api/v1/repo/github \
  -H "Content-Type: application/json" \
  -d '{"repo": "microsoft/typescript", "destPath": "repos/typescript"}'

# Clone a specific branch
curl -s -X POST $BASE/api/v1/repo/github \
  -H "Content-Type: application/json" \
  -d '{"repo": "facebook/react", "destPath": "repos/react", "ref": "v18.2.0"}'

# Clone a private repository (requires GITHUB_TOKEN env var on the server)
curl -s -X POST $BASE/api/v1/repo/github \
  -H "Content-Type: application/json" \
  -d '{"repo": "owner/private-repo", "destPath": "backups/private-repo"}'
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `repo` | string | Yes | GitHub repository in "owner/repo" format |
| `destPath` | string | Yes | Destination folder path in Azure Blob Storage |
| `ref` | string | No | Branch name, tag, or commit SHA. Omit for default branch |

#### Clone an Azure DevOps repository

```bash
# Clone from Azure DevOps (default branch)
curl -s -X POST $BASE/api/v1/repo/devops \
  -H "Content-Type: application/json" \
  -d '{"organization": "myorg", "project": "myproject", "repository": "myrepo", "destPath": "repos/myrepo"}'

# Clone a specific tag
curl -s -X POST $BASE/api/v1/repo/devops \
  -H "Content-Type: application/json" \
  -d '{"organization": "myorg", "project": "myproject", "repository": "myrepo", "destPath": "releases/v1.0", "ref": "v1.0.0", "versionType": "tag"}'
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `organization` | string | Yes | Azure DevOps organization name |
| `project` | string | Yes | Project name |
| `repository` | string | Yes | Repository name or GUID |
| `destPath` | string | Yes | Destination folder path in Azure Blob Storage |
| `ref` | string | No | Version identifier (branch name, tag, commit SHA). Omit for default branch |
| `versionType` | string | No | How to interpret ref: `branch`, `tag`, or `commit`. Defaults to `branch` |
| `resolveLfs` | boolean | No | Resolve LFS pointers. Defaults to `false` |

#### Batch sync repositories from sync pair configuration

This endpoint has a **30-minute timeout** (1,800,000 ms) instead of the 5-minute default on other repo routes, because multi-pair operations can be long-running.

Accepts both **JSON** and **YAML** request bodies. Set `Content-Type` accordingly:
- `application/json` for JSON bodies
- `application/yaml` (or `application/x-yaml`, `text/yaml`) for YAML bodies

```bash
# Sync with JSON body
curl -s -X POST $BASE/api/v1/repo/sync \
  -H "Content-Type: application/json" \
  -d '{
    "syncPairs": [
      {
        "name": "my-github-repo",
        "platform": "github",
        "source": {
          "repo": "microsoft/typescript",
          "ref": "main"
        },
        "destination": {
          "accountUrl": "https://myaccount.blob.core.windows.net",
          "container": "repos",
          "folder": "typescript",
          "sasToken": "sv=2022-11-02&ss=b&srt=co&sp=rwdlacyx..."
        }
      }
    ]
  }'

# Sync with YAML config file
curl -s -X POST $BASE/api/v1/repo/sync \
  -H "Content-Type: application/yaml" \
  --data-binary @sync-settings.yaml
```

**Response codes:**

| Status | Meaning |
|--------|---------|
| 200 | All sync pairs completed successfully |
| 207 | Partial success (some pairs succeeded, some failed) |
| 400 | Invalid sync pair configuration (validation error or YAML parse error) |
| 500 | All sync pairs failed, or server error |

#### List configured sync pairs

```bash
# List all configured sync pairs (requires AZURE_FS_SYNC_CONFIG_PATH env var on the server)
curl -s $BASE/api/v1/repo/sync-pairs
```

**Response codes:**

| Status | Meaning |
|--------|---------|
| 200 | Sync pairs listed successfully |
| 400 | AZURE_FS_SYNC_CONFIG_PATH not configured on the server |
| 500 | Config file read/parse failure |

---

### Development Endpoints (NODE_ENV=development only)

#### Environment Variables

```bash
# List all environment variables (sensitive values masked)
curl -s $BASE/api/dev/env

# Get a specific environment variable
curl -s $BASE/api/dev/env/AZURE_STORAGE_ACCOUNT_URL
```

#### Azure-venv Introspection

```bash
# Inspect azure-venv sync result: blobs, file tree, env sources, watch status
curl -s $BASE/api/dev/azure-venv
```

**Response fields:**

| Field | Type | Description |
|-------|------|-------------|
| `watching` | boolean | Whether the azure-venv watcher is actively polling for blob changes |
| `attempted` | boolean | Whether azure-venv initialization was attempted |
| `totalBlobs` | integer | Total number of blobs found |
| `downloaded` | integer | Number of blobs successfully downloaded |
| `failed` | integer | Number of blobs that failed to download |
| `durationMs` | number | Duration of the initial sync in milliseconds |
| `remoteEnvLoaded` | boolean | Whether a remote `.env` file was loaded |
| `blobs` | array | Blob metadata (relativePath, size, etag, lastModified) — no content |
| `fileTree` | array | Hierarchical file tree built from blob paths |
| `envSources` | array | Environment variable source mapping (key, source) |
| `envTierCounts` | object | Count of env vars by tier (os, remote, local) |

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
