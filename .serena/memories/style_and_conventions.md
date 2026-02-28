# Style and Conventions

## TypeScript
- **Strict mode** enabled in tsconfig.json
- **Target**: ES2022, **Module**: CommonJS
- All code strongly typed — no `any` except in catch blocks
- Interfaces for all data transfer objects (types/ directory)
- Type barrel exports via `types/index.ts`

## Naming Conventions
- **Files**: kebab-case with suffix: `repo-replication.service.ts`, `config.types.ts`, `base.error.ts`
- **Classes**: PascalCase: `RepoReplicationService`, `GitHubClientService`, `DevOpsClientService`
- **Interfaces**: PascalCase, no prefix: `RepoReplicationResult`, `ResolvedConfig`, `SyncPairConfig`
- **Functions**: camelCase: `resolveConfig`, `createRepoController`, `formatSuccess`
- **Constants**: PascalCase for enum-like: `ExitCode`, camelCase for regular: `program`
- **Error classes**: PascalCase with Error suffix: `ConfigError`, `RepoReplicationError`, `AuthError`

## Architecture Patterns
- **Service layer**: Classes with constructor injection (config, logger)
- **Factory pattern**: Auth service (3 methods), controller factory (`createRepoController`)
- **Error hierarchy**: All errors extend `AzureFsError` base class with `code`, `statusCode`, `details`
- **Error factories**: Static factory methods on error classes
- **Command pattern**: Each command group in separate file with `registerXxxCommands(program)` function
- **Retry wrapper**: `withRetry<T>(fn, config)` wraps Azure SDK calls
- **Streaming pattern**: Archives streamed entry-by-entry to blob storage (no local disk)

## API Patterns
- Express 5.x with factory functions (`createApp`, `startServer`)
- Controller factories returning handler functions
- Route files registering Express routers
- Middleware: error handler, request logger, timeout enforcement
- Swagger/OpenAPI 3.0 auto-generated spec
- CORS configurable via env vars
- Graceful shutdown on SIGINT/SIGTERM

## Configuration Rules (CRITICAL)
- **NEVER** use fallback/default values for configuration settings
- Every missing required config value throws `ConfigError` with instructions
- Exception must explain all ways to provide the value (CLI flag, env var, config file)
- Token expiry dates tracked for proactive warning (7 days before)

## Documentation Rules
- CLI tools documented in CLAUDE.md using `<toolName>` XML format
- Plans in `docs/design/plan-xxx-<description>.md`
- Test scripts in `test_scripts/` folder
- Issues tracked in `Issues - Pending Items.md`
- CLI docs in `cli-instructions.md`, API docs in `api-instructions.md`, deploy docs in `deployment-instructions.md`
- project-design.md, project-functions.md, configuration-guide.md must stay in sync with code

## Testing
- Mix of shell scripts (.sh) for CLI/API integration tests and TypeScript scripts
- Tests require live Azure Storage account + GitHub token / DevOps PAT
- Shell tests use curl for API endpoints and CLI commands directly
