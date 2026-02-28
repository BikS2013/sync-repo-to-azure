# Repo Sync Tool - Project Overview

## Purpose
`repo-sync` is a TypeScript CLI tool and REST API for replicating repositories from GitHub and Azure DevOps into Azure Blob Storage. It streams repository archives (tarball/zip) directly into blob storage with zero local disk usage. Supports single-repo replication and batch sync pair configuration.

## Tech Stack
- **Language**: TypeScript 5+ (strict mode)
- **Runtime**: Node.js 18+
- **CLI framework**: Commander.js
- **Azure SDK**: @azure/storage-blob (v12.31.0), @azure/identity
- **GitHub SDK**: @octokit/rest (v22)
- **HTTP framework**: Express.js 5.x (REST API)
- **API docs**: swagger-jsdoc + swagger-ui-express
- **Archive handling**: tar-stream, unzipper
- **Config formats**: dotenv, js-yaml
- **Build**: tsc (CommonJS output to dist/)
- **Dev tools**: ts-node, nodemon

## Core Functionality
1. **GitHub repo replication** — stream GitHub tarball archives to Azure Blob Storage
2. **Azure DevOps repo replication** — stream DevOps zip archives to Azure Blob Storage
3. **Sync pair batch processing** — JSON/YAML config-driven batch replication of multiple repos
4. **REST API** — Express.js API exposing all replication operations with Swagger docs
5. **Console hotkeys** — interactive dev/debug controls

## Authentication
### Azure Blob Storage (3 methods):
1. **azure-ad** (recommended): DefaultAzureCredential
2. **sas-token**: Requires `AZURE_STORAGE_SAS_TOKEN` + `AZURE_STORAGE_SAS_TOKEN_EXPIRY`
3. **connection-string**: Requires `AZURE_STORAGE_CONNECTION_STRING`

### GitHub:
- Personal Access Token (`GITHUB_TOKEN`), required for private repos

### Azure DevOps:
- PAT (`AZURE_DEVOPS_PAT`) or Azure AD (`AZURE_DEVOPS_AUTH_METHOD`)

## Configuration
- Layered: CLI flags > environment variables > config file (`.azure-fs.json`)
- **CRITICAL**: No fallback/default values. Missing config raises `ConfigError` with instructions.
- Token expiry monitoring with 7-day advance warnings

## Key Design Decisions
- Streaming archives directly to blob storage (zero local disk)
- Tar (GitHub) and Zip (DevOps) archive format handling
- Small file threshold for memory vs streaming upload strategy
- Path safety validation to prevent directory traversal
- Structured JSON output (`CommandResult<T>`) for agent consumption
- Custom error hierarchy with machine-readable error codes
- Exit codes: 0=success, 1=operation error, 2=config error, 3=validation error

## Package Identity
- **name**: repo-sync
- **bin**: repo-sync
- **version**: 1.0.0
