# Highest Priority Instructions
- Each time you add an operation to the tool you must ensure that the following part have been updated accordingly
  - The project-design.md and project-functions.md documents. If you detect any gap or inconsistency between the actual code and these documents you must register it to the "Issues - Pending Items.md" document.
  - The api which must be aligned with the functionalities offered by the tool. Again any gap or incosistency must be registered to the "Issues - Pending Items.md" document.
  - The api swagger content must be updated according to the api endpoints. Any gap or incosistency must be registered to the "Issues - Pending Items.md" document.
  - The project CLAUDE.md document must be updated with both the api and the tool options. Any gap or incosistency must be registered to the "Issues - Pending Items.md" document.
  - The configuration-guide.md document must be updated to the latest status. Any gap or incosistency must be registered to the "Issues - Pending Items.md" document.

# Repo Sync Tool (repo-sync)

## Project Overview

A TypeScript CLI tool and REST API for replicating repositories from GitHub and Azure DevOps into Azure Blob Storage. Streams repository archives (tarball/zip) directly into blob storage with zero local disk usage. Supports single-repo replication and batch sync pair configuration.

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
| 1 | Operation error (network error, repo replication failure) |
| 2 | Configuration/authentication error (missing config, invalid auth) |
| 3 | Validation error (invalid parameters) |

## CLI Tool Instructions

All CLI command documentation (config, repo commands), global CLI options, and configuration priority are in **[cli-instructions.md](cli-instructions.md)**.

Read `cli-instructions.md` when you need to execute a CLI command or look up CLI tool syntax, options, and examples.

## REST API Instructions

All REST API documentation including how to start the API server, endpoint reference, curl usage examples, console hotkeys, PortChecker utility, and Swagger URL configuration are in **[api-instructions.md](api-instructions.md)**.

Read `api-instructions.md` when you need to invoke API endpoints, write curl commands, configure the API server, or reference API-related utilities.

## Deployment Instructions

All Docker build commands, container management, multi-architecture builds, Azure App Service deployment, and container configuration are in **[deployment-instructions.md](deployment-instructions.md)**.

Read `deployment-instructions.md` when you need to build Docker images, deploy to Azure, manage containers, or configure deployment settings.

## Environment Variables

**Note:** Environment variable prefix `AZURE_FS_` is retained for backward compatibility with deployed configurations.

| Variable | Description |
|----------|-------------|
| `AZURE_DEVOPS_AUTH_METHOD` | Azure DevOps auth method: pat, azure-ad |
| `AZURE_DEVOPS_ORG_URL` | Default Azure DevOps organization URL (e.g., https://dev.azure.com/myorg) |
| `AZURE_DEVOPS_PAT` | Azure DevOps Personal Access Token for repo replication |
| `AZURE_DEVOPS_PAT_EXPIRY` | Azure DevOps PAT expiry in ISO 8601 format (optional, warns 7 days before expiry) |
| `AZURE_STORAGE_ACCOUNT_URL` | Storage account URL |
| `AZURE_STORAGE_CONTAINER_NAME` | Default container name |
| `AZURE_FS_AUTH_METHOD` | Auth method: connection-string, sas-token, azure-ad |
| `AZURE_STORAGE_CONNECTION_STRING` | Connection string (for connection-string auth) |
| `AZURE_STORAGE_SAS_TOKEN` | SAS token (for sas-token auth) |
| `AZURE_STORAGE_SAS_TOKEN_EXPIRY` | SAS token expiry in ISO 8601 format (required for sas-token auth) |
| `GITHUB_TOKEN` | GitHub Personal Access Token for repo replication (required for private repos) |
| `GITHUB_TOKEN_EXPIRY` | GitHub token expiry in ISO 8601 format (optional, warns 7 days before expiry) |
| `AZURE_FS_LOG_LEVEL` | Log level: debug, info, warn, error |
| `AZURE_FS_LOG_REQUESTS` | Log Azure SDK requests: true/false |
| `AZURE_FS_RETRY_STRATEGY` | Retry strategy: none, exponential, fixed |
| `AZURE_FS_RETRY_MAX_RETRIES` | Maximum number of retries |
| `AZURE_FS_RETRY_INITIAL_DELAY_MS` | Initial retry delay in ms |
| `AZURE_FS_RETRY_MAX_DELAY_MS` | Maximum retry delay in ms |
| `AZURE_VENV` | Azure Blob Storage URL for remote config sync (format: `https://<account>.blob.core.windows.net/<container>/<prefix>`) |
| `AZURE_VENV_SAS_TOKEN` | SAS token with Read + List permissions for azure-venv (no leading `?`) |
| `AZURE_VENV_SAS_EXPIRY` | SAS token expiry in ISO 8601 format for proactive warnings (optional) |
| `AZURE_FS_API_PORT` | REST API server port (e.g., 3000) |
| `AZURE_FS_API_HOST` | REST API server bind host (e.g., 0.0.0.0) |
| `AZURE_FS_API_CORS_ORIGINS` | Comma-separated allowed CORS origins (e.g., * or specific URLs) |
| `AZURE_FS_API_SWAGGER_ENABLED` | Enable Swagger UI at /api/docs: true/false |
| `AZURE_FS_API_REQUEST_TIMEOUT_MS` | Request timeout in milliseconds for API requests |
| `NODE_ENV` | Application environment: development, production, test (required for API mode) |
| `AUTO_SELECT_PORT` | Auto-select available port on conflict: true/false (required for API mode) |
| `AZURE_FS_API_SWAGGER_ADDITIONAL_SERVERS` | Comma-separated additional Swagger server URLs (optional) |
| `AZURE_FS_API_SWAGGER_SERVER_VARIABLES` | Enable Swagger server variables for URL editing: true/false (optional) |
| `PUBLIC_URL` | Explicit public URL override for Swagger server URL (optional, any environment) |
| `WEBSITE_HOSTNAME` | Auto-set by Azure App Service (used for Swagger URL detection) |
| `WEBSITE_SITE_NAME` | Auto-set by Azure App Service (used for HTTPS detection) |
| `K8S_SERVICE_HOST` | Auto-injected by Kubernetes (used for Swagger URL detection) |
| `K8S_SERVICE_PORT` | Auto-injected by Kubernetes (used for Swagger URL detection) |
| `DOCKER_HOST_URL` | Docker container public URL for Swagger URL detection (optional) |
| `AZURE_FS_API_USE_HTTPS` | Force HTTPS for Kubernetes environments: true/false (optional) |
| `AZURE_FS_SYNC_CONFIG_PATH` | Path to sync pair configuration file (JSON/YAML). Overridden by CLI `--sync-config` flag. |

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
      repo.routes.ts                - /api/v1/repo/github, /api/v1/repo/devops, /api/v1/repo/sync endpoints
      dev.routes.ts                 - /api/dev/env development-only routes
      hotkeys.routes.ts             - /api/dev/hotkeys remote console hotkey routes
    controllers/
      repo.controller.ts            - Repo replication request handlers
      dev.controller.ts             - Development diagnostic endpoint handlers
      hotkeys.controller.ts         - Remote console hotkey action handlers
    middleware/
      error-handler.middleware.ts    - Global error handling middleware
      request-logger.middleware.ts   - HTTP request logging
      timeout.middleware.ts          - Request timeout enforcement
  commands/
    index.ts                        - Command registration barrel
    config.commands.ts              - config init | show | validate
    repo.commands.ts                - repo clone-github | clone-devops | sync
  services/
    auth.service.ts                 - Authentication factory (3 methods)
    path.service.ts                 - Path normalization
    github-client.service.ts        - GitHub API client (archive stream download)
    devops-client.service.ts        - Azure DevOps API client (archive stream download)
    repo-replication.service.ts     - Streaming archive-to-blob orchestration (single repo + sync pairs)
  config/
    config.loader.ts                - Layered config loading (CLI > env > file)
    config.schema.ts                - Config validation (no fallbacks)
    sync-pair.loader.ts             - Sync pair config loader (JSON/YAML via js-yaml)
  types/
    index.ts                        - Barrel export
    config.types.ts                 - RepoSyncConfigFile, AuthMethod, ResolvedConfig, ConfigSourceTracker
    api-config.types.ts             - ApiConfig, ApiResolvedConfig, NodeEnvironment
    command-result.types.ts         - CommandResult<T>
    errors.types.ts                 - Error code enums
    repo-replication.types.ts       - RepoReplicationResult, GitHubRepoParams, DevOpsRepoParams, SyncPair*, SyncPairConfig, SyncPairBatchResult
    azure-venv.d.ts                 - Azure venv type declarations
  errors/
    base.error.ts                   - AzureFsError base class
    config.error.ts                 - ConfigError
    auth.error.ts                   - AuthError
    repo-replication.error.ts       - RepoReplicationError
  utils/
    output.utils.ts                 - JSON/human-readable output formatting
    exit-codes.utils.ts             - Process exit code constants and resolver
    logger.utils.ts                 - Logger with verbose mode
    retry.utils.ts                  - Retry logic
    port-checker.utils.ts           - TCP port availability check and process identification
    console-commands.utils.ts       - Interactive console hotkeys for development/debugging
    token-expiry.utils.ts           - Token expiry checking utility
```
