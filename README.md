# repo-sync

A TypeScript CLI and REST API for replicating repositories from **GitHub** and **Azure DevOps** into **Azure Blob Storage**. Archives are streamed directly from the source provider into blob storage with zero local disk usage.

## Features

- Stream-based replication of GitHub (tarball) and Azure DevOps (zip) repositories into Azure Blob Storage — no temp files, no local extraction.
- Per-repo blob metadata and Azure Storage index tags (`source`, `owner`, `repo`, `ref`, `replicatedAt`, etc.) enabling server-side discovery via `findBlobsByTags`.
- Batch replication driven by a sync-pair configuration file (JSON or YAML), with per-pair credentials so different pairs can target different accounts.
- REST API mirror of every CLI operation, with OpenAPI 3.0 / Swagger UI, health and readiness probes, request-timeout middleware, and YAML request-body support.
- Three Azure Storage authentication methods: `azure-ad` (DefaultAzureCredential), `sas-token`, `connection-string`.
- Layered configuration with strict precedence (CLI flags > environment variables > `.repo-sync.json`) and **no fallbacks** — missing required values raise explicit errors.
- Token-expiry warnings for GitHub PATs, Azure DevOps PATs, and SAS tokens (warns 7 days before expiry).
- Remote sync-pair config loading from Azure Blob URLs via the `azure-venv` integration, including watch-mode polling for live updates.
- Development helpers: interactive console hotkeys, `/api/dev/env` inspection, `/api/dev/azure-venv` introspection, auto port selection.
- Docker image and Azure App Service deployment workflow, including multi-architecture builds.

## Requirements

- Node.js `>= 18`
- An Azure Storage account (for the destination container)
- Credentials for the source providers you intend to use:
  - GitHub Personal Access Token (`GITHUB_TOKEN`) — required for private repos
  - Azure DevOps Personal Access Token (`AZURE_DEVOPS_PAT`) or Azure AD

## Install & Build

```bash
npm install
npm run build      # compile TypeScript to dist/
```

## Quick Start

### CLI

```bash
# 1. Create a config file interactively
npm run dev -- config init

# 2. Validate config + Azure connectivity
npm run dev -- config validate

# 3. Replicate a GitHub repo
npm run dev -- repo clone-github --repo owner/repo --dest path/in/container

# 4. Replicate an Azure DevOps repo
npm run dev -- repo clone-devops --org https://dev.azure.com/myorg --project MyProj --repo MyRepo --dest path/in/container

# 5. Batch sync from a sync-pair configuration file
npm run dev -- repo sync --sync-config ./sync-settings.json
```

Full command reference, flags, and examples are in **[cli-instructions.md](cli-instructions.md)**.

### REST API

```bash
npm run api          # development (ts-node)
npm run api:dev      # development with auto-reload (nodemon)
npm run api:start    # production (requires `npm run build` first)
```

- Health:   `GET  http://localhost:3000/api/health`
- Swagger:  `http://localhost:3000/api/docs`
- Replicate GitHub: `POST /api/v1/repo/github`
- Replicate DevOps: `POST /api/v1/repo/devops`
- Batch sync:       `POST /api/v1/repo/sync`
- Search blobs:     `GET  /api/v1/repo/search`

Endpoint reference, curl examples, hotkeys, and port-conflict handling are in **[api-instructions.md](api-instructions.md)**.

## Configuration

Configuration is resolved with strict precedence: **CLI flags > environment variables > `.repo-sync.json`**. There are no defaults for required values — missing required configuration raises an explicit error.

- Full environment variable reference, including token-expiry variables, API settings, and `azure-venv` blob-config loading, is in [CLAUDE.md](CLAUDE.md#environment-variables).
- Detailed per-variable purpose, sourcing, storage recommendations, and expiry handling are in [docs/design/configuration-guide.md](docs/design/configuration-guide.md).
- Example config files: [`.azure-fs.json.example`](.azure-fs.json.example), [`.env.example`](.env.example), [`.env.docker.example`](.env.docker.example).

### Sync-pair credentials

Single-repo CLI commands read credentials from environment variables. **Sync-pair operations** (`repo sync`, `repo list-sync-pairs`) read all credentials exclusively from the sync-pair configuration file — each pair carries its own `source.token` / `source.pat` and `destination.sasToken`, so different pairs can target different accounts and organizations.

## Deployment

Docker build commands, multi-architecture builds, container management, and Azure App Service deployment instructions are in **[deployment-instructions.md](deployment-instructions.md)**.

```bash
docker compose up --build   # local Docker run
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0    | Success |
| 1    | Operation error (network error, replication failure) |
| 2    | Configuration / authentication error |
| 3    | Validation error (invalid parameters) |

## Project Structure

A condensed map is in [CLAUDE.md](CLAUDE.md#project-structure). The full design is in [docs/design/project-design.md](docs/design/project-design.md); functional requirements are in [docs/design/project-functions.md](docs/design/project-functions.md).

## Claude Code Skills

This project ships a Claude Code slash command for managing sync pairs:

- `/manage-sync-pairs [list | add | update | delete | run]` — CRUD over sync-pair configurations, with format-aware (JSON/YAML) write-back to either a local file or an Azure Blob URL.

Details in [CLAUDE.md](CLAUDE.md#manage-sync-pairs).

## Documentation Index

| Document | Purpose |
|----------|---------|
| [CLAUDE.md](CLAUDE.md) | Project conventions, env-var reference, structure |
| [cli-instructions.md](cli-instructions.md) | Complete CLI command reference |
| [api-instructions.md](api-instructions.md) | Complete REST API reference |
| [deployment-instructions.md](deployment-instructions.md) | Docker and Azure deployment |
| [docs/design/project-design.md](docs/design/project-design.md) | Architecture and design decisions |
| [docs/design/project-functions.md](docs/design/project-functions.md) | Functional requirements and features |
| [docs/design/configuration-guide.md](docs/design/configuration-guide.md) | Configuration variable guide |
| [Issues - Pending Items.md](Issues%20-%20Pending%20Items.md) | Known issues and pending work |
