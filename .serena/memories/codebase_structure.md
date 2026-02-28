# Codebase Structure

```
sync-repo-to-azure/
├── src/
│   ├── index.ts                          # CLI entry point (Commander.js bootstrap)
│   ├── commands/
│   │   ├── index.ts                      # Command registration barrel
│   │   ├── config.commands.ts            # config init | show | validate
│   │   └── repo.commands.ts              # repo clone-github | clone-devops | sync
│   ├── services/
│   │   ├── repo-replication.service.ts   # Core RepoReplicationService class
│   │   ├── github-client.service.ts      # GitHubClientService (Octokit-based)
│   │   ├── devops-client.service.ts      # DevOpsClientService (REST/PAT-based)
│   │   ├── auth.service.ts               # Authentication factory (3 blob storage methods)
│   │   └── path.service.ts               # Path normalization
│   ├── api/
│   │   ├── server.ts                     # Express app factory (createApp) and HTTP server (startServer)
│   │   ├── swagger/
│   │   │   └── config.ts                 # OpenAPI 3.0 spec generation
│   │   ├── routes/
│   │   │   ├── index.ts                  # Route registration barrel
│   │   │   ├── health.routes.ts          # GET /api/health, /api/health/ready
│   │   │   ├── repo.routes.ts            # /api/v1/repo/* endpoints
│   │   │   ├── dev.routes.ts             # /api/dev/env dev-only routes
│   │   │   └── hotkeys.routes.ts         # /api/dev/hotkeys remote hotkey routes
│   │   ├── controllers/
│   │   │   ├── repo.controller.ts        # Repo replication handlers (createRepoController factory)
│   │   │   ├── dev.controller.ts         # Dev diagnostic handlers
│   │   │   └── hotkeys.controller.ts     # Remote hotkey action handlers
│   │   └── middleware/
│   │       ├── error-handler.middleware.ts
│   │       ├── request-logger.middleware.ts
│   │       └── timeout.middleware.ts
│   ├── config/
│   │   ├── config.loader.ts              # Layered config loading (CLI > env > file)
│   │   └── config.schema.ts              # Config validation (no fallbacks)
│   ├── types/
│   │   ├── index.ts                      # Barrel export
│   │   ├── config.types.ts               # RepoSyncConfigFile, AuthMethod, ResolvedConfig, ConfigSourceTracker
│   │   ├── api-config.types.ts           # ApiConfig, ApiResolvedConfig, NodeEnvironment
│   │   ├── command-result.types.ts       # CommandResult<T>
│   │   ├── errors.types.ts              # Error code enums
│   │   ├── repo-replication.types.ts    # All repo/sync types (see Key Types below)
│   │   └── azure-venv.d.ts             # Azure venv type declarations
│   ├── errors/
│   │   ├── base.error.ts               # AzureFsError base class
│   │   ├── config.error.ts             # ConfigError
│   │   ├── auth.error.ts               # AuthError
│   │   └── repo-replication.error.ts   # RepoReplicationError
│   └── utils/
│       ├── output.utils.ts             # JSON/human-readable output formatting
│       ├── exit-codes.utils.ts         # Exit code constants and resolver
│       ├── logger.utils.ts             # Logger with verbose mode
│       ├── retry.utils.ts             # Retry logic (none/exponential/fixed)
│       ├── port-checker.utils.ts      # TCP port availability check
│       ├── console-commands.utils.ts  # Interactive console hotkeys
│       └── token-expiry.utils.ts      # Token expiry checking utility
├── test_scripts/                       # Test scripts (shell + TypeScript)
│   ├── test-repo-clone-github-cli.sh
│   ├── test-repo-clone-github-api.sh
│   ├── test-repo-clone-devops-cli.sh
│   ├── test-repo-clone-devops-api.sh
│   ├── test-sync-pair-cli.sh
│   ├── test-sync-pair-api.sh
│   ├── test-sync-pair-config.ts
│   ├── test-container-swagger.ts
│   ├── test-port-checker.ts
│   ├── test-dev-routes.ts
│   └── test-auth.ts
├── docs/
│   ├── design/
│   │   ├── project-design.md
│   │   ├── project-functions.md
│   │   ├── configuration-guide.md
│   │   └── plan-*.md                  # 9 plan documents
│   └── reference/                     # 5 investigation/research docs
├── cli-instructions.md               # CLI tool documentation
├── api-instructions.md               # REST API documentation
├── deployment-instructions.md        # Docker & Azure deployment docs
├── CLAUDE.md                          # Project instructions
├── Issues - Pending Items.md         # Issue tracking
├── Dockerfile / docker-compose.yml
├── package.json
└── tsconfig.json
```

## Key Classes and Services

### RepoReplicationService (repo-replication.service.ts)
Central service. Constructor: `(config, logger)` → creates containerClient internally.
Public methods:
- `replicateGitHub(params)` — stream GitHub tarball to blob
- `replicateDevOps(params)` — stream DevOps zip to blob
- `replicateFromSyncConfig(configPath)` — batch sync from JSON/YAML config
Private helpers:
- `replicateGitHubSyncPair`, `replicateDevOpsSyncPair` — sync pair item processing
- `executeSyncPair` — orchestrates individual sync pair
- `streamTarToBlob`, `streamZipToBlob` — archive format handlers
- `uploadEntryToBlob` — single file upload within archive
- `stripFirstComponent`, `isPathSafe`, `parseGitHubRepo`

### GitHubClientService (github-client.service.ts)
Octokit-based. Methods: `validateAuth()`, `getRepoInfo(owner, repo)`, `getArchiveStream(owner, repo, ref?)`

### DevOpsClientService (devops-client.service.ts)
REST/PAT-based. Methods: `validateAuth()`, `getArchiveStream(project, repo, ref?)`

### API Layer
- `createApp()` — Express app factory with CORS, middleware, routes
- `startServer()` — HTTP server with graceful shutdown (SIGINT/SIGTERM)
- `createRepoController()` — factory returning route handlers

## Key Types (repo-replication.types.ts)
- `RepoPlatform` — 'github' | 'azure-devops'
- `GitHubRepoParams`, `DevOpsRepoParams` — single repo clone params
- `GitHubSyncPair`, `DevOpsSyncPair` (union: `SyncPair`) — sync pair definitions
- `SyncPairConfig` — batch config with `syncPairs` array
- `SyncPairBatchResult`, `SyncPairItemResult` — batch execution results
- `RepoReplicationResult`, `RepoFileUploadResult` — single repo results
- `DevOpsAuthMethod` — 'pat' | 'azure-ad'
- `DevOpsVersionType` — 'branch' | 'tag' | 'commit'
