# Suggested Commands

## Build
```bash
npm run build          # Compile TypeScript to dist/
npm run clean          # Remove dist/ directory
```

## Run CLI
```bash
npm run dev            # Run CLI via ts-node (development)
npm start              # Run compiled dist/index.js
npx repo-sync --help   # Show all commands
```

## Run API
```bash
npm run api            # Run API via ts-node (development)
npm run api:dev        # Run API with nodemon (auto-reload)
npm run api:start      # Run compiled API (production)
```

## CLI Commands
```bash
# Configuration
repo-sync config init
repo-sync config show --json
repo-sync config validate --json

# Repository replication
repo-sync repo clone-github --owner <owner> --repo <repo> [--ref <branch/tag>] --json
repo-sync repo clone-devops --project <project> --repo <repo> [--ref <branch/tag>] --json
repo-sync repo sync --sync-config <path-to-config.json|yaml> --json
```

## API Endpoints
```
GET  /api/health                    # Health check
GET  /api/health/ready              # Readiness check
POST /api/v1/repo/github            # Clone GitHub repo
POST /api/v1/repo/devops            # Clone Azure DevOps repo
POST /api/v1/repo/sync              # Run sync pair batch
GET  /api/dev/env                   # Dev: show env (development only)
POST /api/dev/hotkeys/:action       # Dev: trigger console hotkey
GET  /api/docs                      # Swagger UI
GET  /api/docs.json                 # OpenAPI spec JSON
```

## Test Scripts
```bash
# Shell-based integration tests
bash test_scripts/test-repo-clone-github-cli.sh
bash test_scripts/test-repo-clone-github-api.sh
bash test_scripts/test-repo-clone-devops-cli.sh
bash test_scripts/test-repo-clone-devops-api.sh
bash test_scripts/test-sync-pair-cli.sh
bash test_scripts/test-sync-pair-api.sh

# TypeScript test scripts
npx ts-node test_scripts/test-sync-pair-config.ts
npx ts-node test_scripts/test-container-swagger.ts
npx ts-node test_scripts/test-port-checker.ts
npx ts-node test_scripts/test-dev-routes.ts
npx ts-node test_scripts/test-auth.ts
```

## Required Environment Variables (minimum)
```bash
# Azure Blob Storage
export AZURE_STORAGE_ACCOUNT_URL="https://<account>.blob.core.windows.net"
export AZURE_STORAGE_CONTAINER_NAME="<container>"
export AZURE_FS_AUTH_METHOD="connection-string"  # or sas-token, azure-ad
export AZURE_STORAGE_CONNECTION_STRING="<conn-string>"

# GitHub (for private repos)
export GITHUB_TOKEN="<pat>"

# Azure DevOps
export AZURE_DEVOPS_ORG_URL="https://dev.azure.com/<org>"
export AZURE_DEVOPS_PAT="<pat>"
export AZURE_DEVOPS_AUTH_METHOD="pat"
```

## Docker
```bash
docker build -t repo-sync .
docker compose up
```
