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
| `AZURE_STORAGE_ACCOUNT_URL` | Storage account URL (optional for sync-pairs-only deployments) |
| `AZURE_STORAGE_CONTAINER_NAME` | Default container name (optional for sync-pairs-only deployments) |
| `AZURE_FS_AUTH_METHOD` | Auth method: connection-string, sas-token, azure-ad (optional for sync-pairs-only deployments) |
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
| `AZURE_VENV_SAS_TOKEN` | SAS token for Azure Blob Storage URL-based config fetching (no leading `?`). Auto-appended to `.blob.core.windows.net` URLs. |
| `AZURE_VENV_SAS_EXPIRY` | SAS token expiry in ISO 8601 format for proactive warnings (optional) |
| `AZURE_VENV_POLL_INTERVAL` | Watch mode polling interval in milliseconds (default: 30000, range: 5000-3600000) |
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
| `AZURE_FS_SYNC_CONFIG_PATH` | Local path or HTTP(S) URL to sync pair configuration file (JSON/YAML). For Azure Blob URLs, `AZURE_VENV_SAS_TOKEN` is auto-appended. Overridden by CLI `--sync-config` flag. |
| `AZURE_VENV_SAS_WRITE_TOKEN` | SAS token with write+create permissions for writing sync pair config back to Azure Blob Storage (no leading `?`). Used by manage-sync-pairs skill. Falls back to `AZURE_VENV_SAS_TOKEN` if not set. |
| `AZURE_VENV_SAS_WRITE_TOKEN_EXPIRY` | Expiry date for `AZURE_VENV_SAS_WRITE_TOKEN` in ISO 8601 format (optional, warns 7 days before expiry) |

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
      yaml-body-parser.middleware.ts - YAML request body parsing (application/yaml, application/x-yaml, text/yaml)
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
    azure-venv-holder.utils.ts      - In-memory holder for azure-venv SyncResult and watch lifecycle
```

## Claude Code Skills

### manage-sync-pairs

<manage-sync-pairs>
    <objective>
        Manage sync pair configurations for the repo-sync tool via Claude Code slash command. Supports CRUD operations on sync pairs stored in local files or Azure Blob Storage, plus run sync operations via CLI, Docker API, or Azure API.
    </objective>
    <command>
        /manage-sync-pairs [list | add | update | delete | run]
    </command>
    <info>
        A prompt-based Claude Code skill that provides full CRUD management of sync pair configurations
        without requiring new TypeScript code or API endpoints. Changes are written back to the config
        source (local file or Azure Blob Storage). Supports both JSON and YAML config formats with
        format-aware serialization based on file extension.

        Subcommands:
        - list    : Display all configured sync pairs in a table with masked tokens and expiry status
        - add     : Interactively add a new GitHub or Azure DevOps sync pair with validation
        - update  : Select an existing pair, modify fields, validate, and save
        - delete  : Select a pair, confirm by name, remove and save
        - run     : Execute sync via CLI, Docker API (localhost:4100), or Azure API

        Config source is detected from AZURE_FS_SYNC_CONFIG_PATH:
        - Azure Blob URL (.blob.core.windows.net) -> write-back via REST API with SAS token
        - Local file path -> direct file write
        - Not set -> error with instructions

        Format detection from config file extension:
        - .json -> JSON serialization (2-space indent)
        - .yaml / .yml -> YAML serialization
        - Content-Type header set accordingly for Azure blob uploads

        For Azure Blob write-back, uses AZURE_VENV_SAS_WRITE_TOKEN (or AZURE_VENV_SAS_TOKEN as fallback).

        Examples:
        /manage-sync-pairs list           # Show all sync pairs
        /manage-sync-pairs add            # Add a new sync pair interactively
        /manage-sync-pairs update         # Update an existing pair
        /manage-sync-pairs delete         # Delete a sync pair (with confirmation)
        /manage-sync-pairs run            # Run sync operations
        /manage-sync-pairs               # Show interactive menu

        Skill files location:
        - Project: .claude/skills/manage-sync-pairs/
        - User:    ~/ai-coding/claude-workdocs/.claude/skills/manage-sync-pairs/

        Project Structure:
        .claude/
          commands/
            manage-sync-pairs.md                    - Slash command entry point
          skills/
            manage-sync-pairs/
              SKILL.md                              - Main skill with routing and principles
              workflows/
                list-sync-pairs.md                  - List pairs in table format
                add-sync-pair.md                    - Interactive add workflow
                update-sync-pair.md                 - Update existing pair workflow
                delete-sync-pair.md                 - Delete pair workflow
                run-sync.md                         - Execute sync workflow
              references/
                sync-pair-schema.md                 - Type definitions and validation rules
                azure-blob-write.md                 - Azure Blob Storage write-back reference
    </info>
</manage-sync-pairs>
