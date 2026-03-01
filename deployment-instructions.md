# Deployment Instructions

## Docker Deployment

### Local Container Commands

**Build image (native architecture):**
```bash
docker build -t sync-repo-to-azure .
```

**Start container:**
```bash
docker run -d --name sync-repo-to-azure --env-file .env -e DOCKER_HOST_URL=http://localhost:4100 -p 4100:3000 sync-repo-to-azure
```

**Stop container:**
```bash
docker stop sync-repo-to-azure
```

**Delete container:**
```bash
docker rm sync-repo-to-azure
```

**Rebuild image (stop, delete, rebuild, redeploy):**
```bash
docker stop sync-repo-to-azure 2>/dev/null; docker rm sync-repo-to-azure 2>/dev/null; docker rmi sync-repo-to-azure 2>/dev/null; docker build -t sync-repo-to-azure . && docker run -d --name sync-repo-to-azure --env-file .env -e DOCKER_HOST_URL=http://localhost:4100 -p 4100:3000 sync-repo-to-azure
```

### Multi-Architecture Build (amd64 + arm64)

The image supports dual architecture for both Azure App Service (amd64) and Apple Silicon local development (arm64).

**One-time setup** (create a buildx builder):
```bash
docker buildx create --name multiarch --driver docker-container --use
docker buildx inspect --bootstrap
```

**Build and load locally (current platform only):**
```bash
docker buildx build --platform linux/$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/') -t sync-repo-to-azure --load .
```

**Build dual-arch and push to Azure Container Registry (ACR):**
```bash
# Login to ACR
az acr login --name 914dockerregistry

# Build and push both architectures
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t 914dockerregistry.azurecr.io/sync-repo-to-azure:latest \
  -t 914dockerregistry.azurecr.io/sync-repo-to-azure:$(date +%Y%m%d) \
  --push .
```

**Build dual-arch and push to Docker Hub:**
```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t <your-dockerhub-user>/sync-repo-to-azure:latest \
  --push .
```

### Azure App Service Deployment

**Azure Container Registry:** `914dockerregistry.azurecr.io`

### Current Azure Deployment

| Setting | Value |
|---------|-------|
| **Resource Group** | `BikSTestRG` |
| **App Service Plan** | `azure-webapp-plan` (B1, Linux) |
| **Web App Name** | `sync-repo-to-azure` |
| **Region** | West Europe |
| **URL** | `https://sync-repo-to-azure.azurewebsites.net` |
| **Health** | `https://sync-repo-to-azure.azurewebsites.net/api/health` |
| **Readiness** | `https://sync-repo-to-azure.azurewebsites.net/api/health/ready` |
| **Swagger UI** | `https://sync-repo-to-azure.azurewebsites.net/api/docs` |
| **Swagger JSON** | `https://sync-repo-to-azure.azurewebsites.net/api/docs.json` |
| **Image** | `914dockerregistry.azurecr.io/sync-repo-to-azure:latest` |
| **NODE_ENV** | `development` (dev routes + hotkey endpoints enabled) |

**Quick redeploy after image push:**
```bash
# Push new image
docker buildx build --platform linux/amd64,linux/arm64 \
  -t 914dockerregistry.azurecr.io/sync-repo-to-azure:latest \
  -t 914dockerregistry.azurecr.io/sync-repo-to-azure:$(date +%Y%m%d) \
  --push .

# Restart to pull latest
az webapp restart --name sync-repo-to-azure --resource-group BikSTestRG
```

**Deploy from ACR to Azure App Service (reference commands):**
```bash
# Create App Service Plan (Linux)
az appservice plan create \
  --name azure-webapp-plan \
  --resource-group <your-rg> \
  --sku B1 \
  --is-linux

# Create Web App from ACR image
az webapp create \
  --name <your-app-name> \
  --resource-group <your-rg> \
  --plan azure-webapp-plan \
  --deployment-container-image-name 914dockerregistry.azurecr.io/sync-repo-to-azure:latest

# Configure environment variables
az webapp config appsettings set \
  --name <your-app-name> \
  --resource-group <your-rg> \
  --settings \
    NODE_ENV=production \
    AZURE_FS_API_HOST=0.0.0.0 \
    AZURE_FS_API_PORT=3000 \
    AUTO_SELECT_PORT=false \
    AZURE_STORAGE_ACCOUNT_URL=<your-account-url> \
    AZURE_STORAGE_CONTAINER_NAME=<your-container> \
    AZURE_FS_AUTH_METHOD=azure-ad \
    AZURE_FS_LOG_LEVEL=info \
    AZURE_FS_LOG_REQUESTS=false \
    AZURE_FS_RETRY_STRATEGY=exponential \
    AZURE_FS_RETRY_MAX_RETRIES=3 \
    AZURE_FS_RETRY_INITIAL_DELAY_MS=1000 \
    AZURE_FS_RETRY_MAX_DELAY_MS=30000 \
    AZURE_FS_BATCH_CONCURRENCY=10 \
    AZURE_FS_API_CORS_ORIGINS=* \
    AZURE_FS_API_SWAGGER_ENABLED=true \
    AZURE_FS_API_UPLOAD_MAX_SIZE_MB=100 \
    AZURE_FS_API_REQUEST_TIMEOUT_MS=30000 \
    WEBSITES_PORT=3000

# Enable managed identity for Azure AD auth (recommended)
az webapp identity assign \
  --name <your-app-name> \
  --resource-group <your-rg>

# Grant Storage Blob Data Contributor role to the managed identity
az role assignment create \
  --assignee <managed-identity-principal-id> \
  --role "Storage Blob Data Contributor" \
  --scope /subscriptions/<sub-id>/resourceGroups/<rg>/providers/Microsoft.Storage/storageAccounts/<account>
```

**Key Azure App Service notes:**
- Set `WEBSITES_PORT=3000` so App Service routes traffic to the container's port
- `WEBSITE_HOSTNAME` and `WEBSITE_SITE_NAME` are auto-set by App Service (Swagger URL auto-detection uses these)
- Use `azure-ad` auth with managed identity -- no secrets needed
- Set `NODE_ENV=production` for production deployments (disables dev routes and hotkeys)
- Set `NODE_ENV=development` if you need remote hotkey access via `/api/dev/hotkeys/*`

### Docker Image Details

- **Base image**: `node:20-alpine` (minimal footprint)
- **Multi-architecture**: `linux/amd64` + `linux/arm64` via `docker buildx`
- **Multi-stage build**: Builder stage compiles TypeScript, production stage contains only compiled JS and production dependencies
- **Non-root user**: Runs as the `node` user for security
- **Health check**: Built-in `wget` check against `/api/health` every 30s
- **Exposed port**: 3000 (configurable via `AZURE_FS_API_PORT` env var)
- **OCI labels**: Standard `org.opencontainers.image.*` labels for registry metadata (`sync-repo-to-azure`)

### Docker Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage, multi-arch production image (builder + runtime) |
| `.dockerignore` | Excludes unnecessary files from build context |
| `docker-compose.yml` | Local dev/testing with multi-arch build support |
| `.env.docker.example` | Docker-specific env template with development defaults |

### Configuration for Docker

All configuration is passed via environment variables. Copy `.env.docker.example` to `.env` and fill in the required values:

```bash
cp .env.docker.example .env
# Edit .env with your Azure Storage credentials
docker compose up
```

Key Docker-specific settings:
- `NODE_ENV=development` (enables dev features, console hotkeys, hotkey API endpoints)
- `AZURE_FS_API_HOST=0.0.0.0` (required for container networking)
- `AUTO_SELECT_PORT=false` (deterministic port in containers)
- `PUBLIC_URL` (optional, set if behind a reverse proxy)
- `WEBSITES_PORT=3000` (required for Azure App Service)
