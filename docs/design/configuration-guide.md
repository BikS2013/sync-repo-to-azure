# Repo Sync CLI - Configuration Guide

This guide documents every configuration variable used by the `repo-sync` CLI tool, how to obtain each value, the recommended management approach, and what each option means for the project.

The `repo-sync` tool replicates Git repositories (from GitHub and Azure DevOps) to Azure Blob Storage. It supports individual repository cloning and batch sync pair operations.

> **Note:** Environment variables with the `AZURE_FS_` prefix are retained for backward compatibility with earlier versions of this tool (formerly named `azure-fs`).

---

## Configuration Sources and Priority

The tool loads configuration from three sources, merged in the following priority order (highest wins):

| Priority | Source | Description |
|----------|--------|-------------|
| 1 (highest) | **CLI Flags** | Passed directly on the command line (`--account-url`, `--container`, `--auth-method`) |
| 2 | **Environment Variables** | Set in the shell or via a `.env` file |
| 3 (lowest) | **Config File** | JSON file at `.repo-sync.json` (or custom path via `--config`) |

When a value is present in multiple sources, the highest-priority source wins. All required variables must be resolved from at least one source; there are **no default or fallback values**. A missing required variable will raise a `ConfigError` with instructions on how to provide it.

---

## Storage Configuration

### `storage.accountUrl`

| Attribute | Value |
|-----------|-------|
| **Purpose** | The full URL of the Azure Storage account that the tool connects to. This is the root endpoint for all blob operations (repository archive uploads). |
| **Required** | Yes |
| **Type** | String (URL) |
| **Config file key** | `storage.accountUrl` |
| **Environment variable** | `AZURE_STORAGE_ACCOUNT_URL` |
| **CLI flag** | `--account-url` / `-a` |

**How to obtain:**

1. Go to the [Azure Portal](https://portal.azure.com).
2. Navigate to **Storage accounts** and select your storage account.
3. In the **Overview** page, find the **Blob service** endpoint under **Properties**, or go to **Settings > Endpoints**.
4. Copy the **Blob service** URL (e.g., `https://myaccount.blob.core.windows.net`).

**Recommended management:**
Store in the `.repo-sync.json` config file for project-level usage, or set as an environment variable for CI/CD pipelines. Use the CLI flag only for ad-hoc overrides.

---

### `storage.containerName`

| Attribute | Value |
|-----------|-------|
| **Purpose** | The name of the Azure Blob Storage container to operate on. Repository archives are uploaded to this container. |
| **Required** | Yes |
| **Type** | String |
| **Config file key** | `storage.containerName` |
| **Environment variable** | `AZURE_STORAGE_CONTAINER_NAME` |
| **CLI flag** | `--container` / `-c` |

**How to obtain:**

1. In the Azure Portal, navigate to your Storage account.
2. Go to **Data storage > Containers**.
3. Copy the name of the target container. If no container exists yet, create one from this page.

**Recommended management:**
Store in the `.repo-sync.json` config file. Use the CLI flag when you need to temporarily operate on a different container.

---

### `storage.authMethod`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Determines which authentication mechanism the tool uses to connect to Azure Blob Storage. |
| **Required** | Yes |
| **Type** | String (enum) |
| **Config file key** | `storage.authMethod` |
| **Environment variable** | `AZURE_FS_AUTH_METHOD` |
| **CLI flag** | `--auth-method` |

**Options:**

| Value | Description | When to use |
|-------|-------------|-------------|
| `azure-ad` | Uses Azure Active Directory via `DefaultAzureCredential`. Supports `az login`, managed identities, service principals, and other Azure Identity credential chains. | **Recommended for production and development.** Most secure option; no secrets stored in config files. Requires the user to run `az login` locally or configure a managed identity in cloud environments. |
| `sas-token` | Uses a Shared Access Signature (SAS) token appended to the account URL. | Use when you need time-limited, scoped access without full account credentials. Good for sharing access with external parties or CI jobs with limited scope. |
| `connection-string` | Uses a full connection string containing the account key. | Use only when Azure AD is not available. Provides full account-level access, which is the least restrictive and least secure option. |

**How to obtain:**
This is a choice you make based on your security requirements. See the "Authentication Secrets" section below for how to obtain the corresponding credentials for each method.

**Recommended management:**
Store in the `.repo-sync.json` config file. Default to `azure-ad` for the best security posture.

---

## Authentication Secrets

These variables are **not** stored in the config file. They must be provided as environment variables. The required secret depends on the chosen `authMethod`.

### `AZURE_STORAGE_CONNECTION_STRING`

| Attribute | Value |
|-----------|-------|
| **Purpose** | The full connection string for the storage account. Contains the account name and account key. Required only when `authMethod` is `connection-string`. |
| **Required** | Conditionally (when `authMethod = connection-string`) |
| **Type** | String |
| **Environment variable** | `AZURE_STORAGE_CONNECTION_STRING` |
| **CLI flag** | Not available |
| **Config file key** | Not available (secret) |

**How to obtain:**

1. In the Azure Portal, navigate to your Storage account.
2. Go to **Security + networking > Access keys**.
3. Click **Show** next to one of the two keys.
4. Copy the **Connection string** value (not just the key).

**Recommended management:**
- **Never commit to version control.** Store in a `.env` file that is listed in `.gitignore`.
- For CI/CD, use pipeline secret variables or a secrets manager (Azure Key Vault, GitHub Secrets, etc.).
- Rotate keys periodically. Azure provides two keys so you can rotate without downtime.

---

### `AZURE_STORAGE_SAS_TOKEN`

| Attribute | Value |
|-----------|-------|
| **Purpose** | A Shared Access Signature token granting scoped, time-limited access. Required only when `authMethod` is `sas-token`. |
| **Required** | Conditionally (when `authMethod = sas-token`) |
| **Type** | String |
| **Environment variable** | `AZURE_STORAGE_SAS_TOKEN` |
| **CLI flag** | Not available |
| **Config file key** | Not available (secret) |

**How to obtain:**

1. In the Azure Portal, navigate to your Storage account.
2. Go to **Security + networking > Shared access signature**.
3. Configure the allowed services (Blob), resource types (Container, Object), and permissions (Read, Write, Delete, List, etc.).
4. Set an appropriate start and expiry time.
5. Click **Generate SAS and connection string**.
6. Copy the **SAS token** value (starts with `?sv=`).

Alternatively, generate a SAS token via Azure CLI:
```bash
az storage account generate-sas \
  --account-name myaccount \
  --permissions rwdlac \
  --resource-types sco \
  --services b \
  --expiry 2026-12-31T00:00:00Z \
  --output tsv
```

**Recommended management:**
- **Never commit to version control.** Store in a `.env` file that is listed in `.gitignore`.
- Set short expiry times (hours or days) for better security.
- For CI/CD, generate SAS tokens dynamically as part of the pipeline.

---

### `storage.sasTokenExpiry`

| Attribute | Value |
|-----------|-------|
| **Purpose** | The expiration date/time of the SAS token. The tool checks this value before every operation and raises an error if the token has expired, providing a clear message instead of a cryptic Azure 403 response. |
| **Required** | Conditionally (required when `authMethod = sas-token`) |
| **Type** | String (ISO 8601 date, e.g., `2026-12-31T00:00:00Z`) |
| **Config file key** | `storage.sasTokenExpiry` |
| **Environment variable** | `AZURE_STORAGE_SAS_TOKEN_EXPIRY` |
| **CLI flag** | Not available (use config file or env var) |
| **Default** | None |

**How to obtain:**

The expiry value must match the expiry date set when generating the SAS token:

1. If generated via the Azure Portal, note the **End date/time** you set in the Shared Access Signature form.
2. If generated via Azure CLI (`az storage account generate-sas --expiry ...`), use the same `--expiry` value.
3. The value must be a valid ISO 8601 date string (e.g., `2026-12-31T00:00:00Z`).

**Recommended management:**
- Store in the `.repo-sync.json` config file alongside other storage settings, or set as the `AZURE_STORAGE_SAS_TOKEN_EXPIRY` environment variable.
- Always keep this value in sync with the actual SAS token expiry. When you rotate the SAS token, update this value at the same time.
- For CI/CD pipelines that generate SAS tokens dynamically, set this environment variable to the same expiry used during generation.

---

### Azure AD Credentials (for `authMethod = azure-ad`)

When using `azure-ad`, the tool uses `DefaultAzureCredential` from the `@azure/identity` SDK, which tries multiple credential sources in order:

1. **Environment variables** (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`) for service principal auth.
2. **Azure CLI** (`az login`) for local development.
3. **Managed Identity** for Azure-hosted environments (VMs, App Service, Functions).
4. **Visual Studio Code** credentials.

**How to obtain (local development):**

```bash
az login
```

This is sufficient for local usage. No additional environment variables are needed.

**How to obtain (service principal for CI/CD):**

1. Register an application in Azure AD (Microsoft Entra ID).
2. Create a client secret for the application.
3. Assign the **Storage Blob Data Contributor** role to the service principal on the storage account.
4. Set these environment variables:
   - `AZURE_TENANT_ID` - Your Azure AD tenant ID
   - `AZURE_CLIENT_ID` - The application (client) ID
   - `AZURE_CLIENT_SECRET` - The client secret value

**Recommended management:**
- For local development, use `az login` and no stored credentials.
- For CI/CD, use service principals with secrets stored in a vault or pipeline secret variables.
- For Azure-hosted workloads, use managed identities (no secrets needed at all).

---

## Logging Configuration

### `logging.level`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Controls the verbosity of log output from the tool. |
| **Required** | Yes |
| **Type** | String (enum) |
| **Config file key** | `logging.level` |
| **Environment variable** | `AZURE_FS_LOG_LEVEL` |
| **CLI flag** | Not available (use config file or env var) |

**Options:**

| Value | Description | When to use |
|-------|-------------|-------------|
| `error` | Only errors are logged. | Production environments where minimal output is desired. |
| `warn` | Errors and warnings are logged. | Production environments where you want to catch potential issues. |
| `info` | Errors, warnings, and informational messages are logged. | General-purpose usage; good balance of verbosity. |
| `debug` | All messages are logged, including detailed diagnostics. | Development and troubleshooting. Produces verbose output. |

**Recommended management:**
Store in the `.repo-sync.json` config file. Use `info` for everyday usage and `debug` when troubleshooting. Note that the `--verbose` / `-v` CLI flag provides per-command debug output independently of this setting.

**Runtime toggle (API mode):** When the API server is running with `NODE_ENV` not set to `production`, the console hotkey `v` toggles `AZURE_FS_LOG_LEVEL` between `debug` and `info` at runtime. This modifies the environment variable in the running process and takes effect for subsequent log operations without a server restart.

---

### `logging.logRequests`

| Attribute | Value |
|-----------|-------|
| **Purpose** | When enabled, logs the raw HTTP requests made by the Azure SDK to the storage service. Useful for debugging authentication and network issues. |
| **Required** | Yes |
| **Type** | Boolean |
| **Config file key** | `logging.logRequests` |
| **Environment variable** | `AZURE_FS_LOG_REQUESTS` |
| **CLI flag** | Not available (use config file or env var) |

**Options:**

| Value | Description |
|-------|-------------|
| `true` | HTTP request/response details from the Azure SDK are logged. |
| `false` | HTTP request logging is suppressed. |

**Recommended management:**
Store in the `.repo-sync.json` config file. Keep set to `false` in normal usage. Enable temporarily when diagnosing connectivity, authentication, or performance issues.

---

## Retry Configuration

### `retry.strategy`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Determines how the tool retries failed operations against Azure Blob Storage (e.g., transient network errors, throttling). |
| **Required** | Yes |
| **Type** | String (enum) |
| **Config file key** | `retry.strategy` |
| **Environment variable** | `AZURE_FS_RETRY_STRATEGY` |
| **CLI flag** | Not available (use config file or env var) |

**Options:**

| Value | Description | When to use |
|-------|-------------|-------------|
| `none` | No retries. Failures are raised immediately. | Use in testing or when you want fast-fail behavior. When set, `initialDelayMs` and `maxDelayMs` are not required (forced to `0`). |
| `exponential` | Retries with exponentially increasing delays (e.g., 1s, 2s, 4s, ...), capped at `maxDelayMs`. | **Recommended for production.** Handles transient failures and Azure throttling gracefully. |
| `fixed` | Retries with a constant delay of `initialDelayMs` between each attempt. | Use when you want predictable retry timing. |

**Recommended management:**
Store in the `.repo-sync.json` config file. Use `exponential` as the standard strategy.

---

### `retry.maxRetries`

| Attribute | Value |
|-----------|-------|
| **Purpose** | The maximum number of retry attempts before the operation is considered failed. |
| **Required** | Yes |
| **Type** | Non-negative integer |
| **Config file key** | `retry.maxRetries` |
| **Environment variable** | `AZURE_FS_RETRY_MAX_RETRIES` |
| **CLI flag** | Not available (use config file or env var) |

**How to choose a value:**
- `0` means no retries (equivalent to `strategy: none` in terms of behavior).
- `3` is a reasonable default for most workloads.
- Increase to `5` or higher for critical operations in unreliable network conditions.

**Recommended management:**
Store in the `.repo-sync.json` config file. A value of `3` is recommended for general use.

---

### `retry.initialDelayMs`

| Attribute | Value |
|-----------|-------|
| **Purpose** | The delay (in milliseconds) before the first retry attempt. For `exponential` strategy, subsequent delays are multiples of this value. For `fixed` strategy, every retry uses this delay. |
| **Required** | Yes (when `retry.strategy` is not `none`) |
| **Type** | Non-negative integer (milliseconds) |
| **Config file key** | `retry.initialDelayMs` |
| **Environment variable** | `AZURE_FS_RETRY_INITIAL_DELAY_MS` |
| **CLI flag** | Not available (use config file or env var) |

**How to choose a value:**
- `1000` (1 second) is a good starting point.
- Lower values (e.g., `200`-`500`) for latency-sensitive operations.
- Higher values (e.g., `2000`-`5000`) if you expect throttling from Azure.

**Recommended management:**
Store in the `.repo-sync.json` config file. A value of `1000` is recommended.

---

### `retry.maxDelayMs`

| Attribute | Value |
|-----------|-------|
| **Purpose** | The maximum delay (in milliseconds) between retry attempts. Caps the exponential growth in the `exponential` strategy. Not used by the `fixed` strategy, but still required to be set. |
| **Required** | Yes (when `retry.strategy` is not `none`) |
| **Type** | Non-negative integer (milliseconds) |
| **Config file key** | `retry.maxDelayMs` |
| **Environment variable** | `AZURE_FS_RETRY_MAX_DELAY_MS` |
| **CLI flag** | Not available (use config file or env var) |

**How to choose a value:**
- `30000` (30 seconds) is a reasonable cap for most scenarios.
- Lower the cap (e.g., `10000`) if you need faster failure resolution.
- Raise the cap (e.g., `60000`) for batch or background jobs that can tolerate longer waits.

**Recommended management:**
Store in the `.repo-sync.json` config file. A value of `30000` is recommended.

---

## API Configuration Parameters

These parameters configure the REST API server started via `npm run api`. They are only required when running in API mode and are ignored by the CLI.

### `api.port`

| Attribute | Value |
|-----------|-------|
| **Purpose** | The TCP port number the API server listens on. |
| **Required** | Yes (when running in API mode) |
| **Type** | Integer (1-65535) |
| **Config file key** | `api.port` |
| **Environment variable** | `AZURE_FS_API_PORT` |
| **CLI flag** | Not available |

**How to obtain:**
Choose any available port. Common choices are `3000` (development), `8080` (alternative), or `80`/`443` (production behind a reverse proxy).

**Recommended management:**
Store in the `.env` file for development. Use environment variables in CI/CD and production deployments.

---

### `api.host`

| Attribute | Value |
|-----------|-------|
| **Purpose** | The network interface (IP address) the API server binds to. |
| **Required** | Yes (when running in API mode) |
| **Type** | String (IP address or hostname) |
| **Config file key** | `api.host` |
| **Environment variable** | `AZURE_FS_API_HOST` |
| **CLI flag** | Not available |

**Options:**

| Value | Description |
|-------|-------------|
| `0.0.0.0` | Listen on all network interfaces (accessible from other machines). |
| `127.0.0.1` | Listen only on localhost (accessible only from the same machine). |

**Recommended management:**
Use `0.0.0.0` for containerized/production deployments. Use `127.0.0.1` when running locally and you do not want external access.

---

### `api.corsOrigins`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Controls which origins are allowed to make cross-origin requests to the API. |
| **Required** | Yes (when running in API mode) |
| **Type** | Comma-separated string (env) or array of strings (config file) |
| **Config file key** | `api.corsOrigins` |
| **Environment variable** | `AZURE_FS_API_CORS_ORIGINS` |
| **CLI flag** | Not available |

**Options:**

| Value | Description |
|-------|-------------|
| `*` | Allow all origins (suitable for development or internal APIs). |
| Specific URLs | Comma-separated list of allowed origins (e.g., `http://localhost:3000,https://myapp.com`). |

**Recommended management:**
Use `*` for development. In production, restrict to the specific origins that need access.

---

### `api.swaggerEnabled`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Enables or disables the Swagger UI documentation endpoint at `/api/docs` and the JSON spec at `/api/docs.json`. |
| **Required** | Yes (when running in API mode) |
| **Type** | Boolean |
| **Config file key** | `api.swaggerEnabled` |
| **Environment variable** | `AZURE_FS_API_SWAGGER_ENABLED` |
| **CLI flag** | Not available |

**Options:**

| Value | Description |
|-------|-------------|
| `true` | Swagger UI is served at `/api/docs`. |
| `false` | Swagger endpoints are not mounted. |

**Recommended management:**
Enable in development and staging. Disable in production if the API is not intended for public exploration.

---

### `api.requestTimeoutMs`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Maximum time (in milliseconds) a request is allowed to run before it is automatically aborted. Prevents hung connections from consuming server resources. |
| **Required** | Yes (when running in API mode) |
| **Type** | Positive integer (milliseconds) |
| **Config file key** | `api.requestTimeoutMs` |
| **Environment variable** | `AZURE_FS_API_REQUEST_TIMEOUT_MS` |
| **CLI flag** | Not available |

**How to choose a value:**
- `30000` (30 seconds) is appropriate for most operations.
- Increase for large repository archives or operations over slow connections.
- `60000` (60 seconds) or higher for very large repository replications.

**Recommended management:**
Store in the `.repo-sync.json` config file or `.env` file.

---

### `NODE_ENV`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Controls environment-specific behavior for the API server: error stack traces in responses, Swagger server description, and gating of development-only routes (`/api/dev/*`). |
| **Required** | Yes (when running in API mode) |
| **Type** | String (enum) |
| **Config file key** | `api.nodeEnv` |
| **Environment variable** | `NODE_ENV` |
| **CLI flag** | Not available |

**Options:**

| Value | Description | When to use |
|-------|-------------|-------------|
| `development` | Error responses include stack traces. Swagger shows "Development server". Dev routes (`/api/dev/env`) and hotkey routes (`/api/dev/hotkeys/*`) are mounted. Console hotkeys are active. | Local development, debugging, and Docker containers that need remote hotkey access. |
| `production` | Stack traces are suppressed in error responses. Swagger shows "Production server". Dev routes and hotkey routes are NOT mounted. Console hotkeys are disabled. | Production deployments. |
| `test` | Same as production (no stack traces, no dev routes, no hotkey routes). | Automated testing environments. |

**Recommended management:**
Set as an environment variable. Use `development` locally, `production` in deployed environments, and `test` in CI/CD test runners. This follows the standard Node.js convention.

**Console hotkeys note:**
When `NODE_ENV` is not `production`, the API server activates interactive console hotkeys after startup. These allow clearing the console (`c`), freezing/unfreezing log output (`f`), toggling verbose mode (`v`), inspecting the resolved configuration (`i`), and viewing help (`h`). The verbose toggle changes `AZURE_FS_LOG_LEVEL` at runtime between `debug` and `info`, affecting subsequent log output without requiring a server restart. In `production` mode, the console hotkeys are completely disabled and no stdin listener is created. No additional configuration variables are required for this feature.

**Hotkey API endpoints note:**
When `NODE_ENV=development`, the same hotkey actions are also available as HTTP endpoints under `/api/dev/hotkeys/*`. This allows remote access to hotkey functionality in Docker containers, cloud deployments, and other environments where stdin is not reachable. The endpoints are: `POST /api/dev/hotkeys/clear`, `POST /api/dev/hotkeys/freeze`, `POST /api/dev/hotkeys/verbose`, `GET /api/dev/hotkeys/config`, `GET /api/dev/hotkeys/status`, and `GET /api/dev/hotkeys/help`.

---

### `AUTO_SELECT_PORT`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Controls whether the API server automatically finds an available port when the configured port is already in use. |
| **Required** | Yes (when running in API mode) |
| **Type** | Boolean |
| **Config file key** | `api.autoSelectPort` |
| **Environment variable** | `AUTO_SELECT_PORT` |
| **CLI flag** | Not available |

**Options:**

| Value | Description |
|-------|-------------|
| `true` | If the configured port is in use, the server scans up to 10 subsequent ports to find an available one. The actual port is logged and reflected in the Swagger docs. |
| `false` | If the configured port is in use, the server exits immediately with error code 1 and a helpful message identifying which process holds the port (macOS/Linux). |

**Recommended management:**
Set to `true` for development (avoids port conflicts when running multiple instances). Set to `false` for production (you want deterministic port assignment).

---

### `api.swaggerAdditionalServers`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Adds extra server entries to the Swagger/OpenAPI spec, allowing testing against multiple environments from the Swagger UI. |
| **Required** | No (optional) |
| **Type** | Comma-separated string (env) or array of strings (config file) |
| **Config file key** | `api.swaggerAdditionalServers` |
| **Environment variable** | `AZURE_FS_API_SWAGGER_ADDITIONAL_SERVERS` |
| **CLI flag** | Not available |

**How to use:**
Provide one or more full URLs separated by commas. Each URL appears as an additional server in the Swagger UI dropdown.

Example: `https://staging.example.com,https://prod.example.com`

**Recommended management:**
Set as an environment variable in environments where you need to test against multiple backends from Swagger UI. Not needed for most setups.

---

### `api.swaggerServerVariables`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Enables OpenAPI server variables (`{protocol}`, `{host}`, `{port}`) in the Swagger spec, allowing users to interactively edit the target server URL in the Swagger UI. |
| **Required** | No (optional) |
| **Type** | Boolean |
| **Config file key** | `api.swaggerServerVariables` |
| **Environment variable** | `AZURE_FS_API_SWAGGER_SERVER_VARIABLES` |
| **CLI flag** | Not available |

**Options:**

| Value | Description |
|-------|-------------|
| `true` | The primary server entry uses a templated URL (`{protocol}://{host}:{port}`) with editable variables in Swagger UI. Defaults are inferred from the detected base URL. |
| `false` or unset | The primary server entry uses a fixed URL. |

**Recommended management:**
Enable in development if you frequently switch between hosts or protocols. Leave disabled in production.

---

### Container and Cloud Environment Variables (Optional)

These variables are auto-detected or manually set to control how the Swagger server URL is generated. They are all optional and do not go through the config validation system (they are detection signals, not required configuration).

| Variable | Source | Purpose |
|----------|--------|---------|
| `PUBLIC_URL` | Manual | Explicit public URL override. Highest priority. Use when none of the auto-detection methods apply. |
| `WEBSITE_HOSTNAME` | Azure App Service (auto-set) | Hostname of the Azure App Service instance. HTTPS is used when `WEBSITE_SITE_NAME` is also set. |
| `WEBSITE_SITE_NAME` | Azure App Service (auto-set) | App Service site name. Signals that HTTPS should be used. |
| `K8S_SERVICE_HOST` | Kubernetes (auto-injected) | Kubernetes service host. Used together with `K8S_SERVICE_PORT`. |
| `K8S_SERVICE_PORT` | Kubernetes (auto-injected) | Kubernetes service port. |
| `DOCKER_HOST_URL` | Manual | Full URL for Docker container environments (e.g., `http://host.docker.internal:3000`). |
| `AZURE_FS_API_USE_HTTPS` | Manual | Set to `true` to force HTTPS in Kubernetes environments. |

**Detection priority order:**
1. `PUBLIC_URL` (explicit override)
2. `WEBSITE_HOSTNAME` (Azure App Service)
3. `K8S_SERVICE_HOST` + `K8S_SERVICE_PORT` (Kubernetes)
4. `DOCKER_HOST_URL` (Docker)
5. `http://{host}:{port}` (local development fallback)

**Recommended management:**
Do not set any of these for local development. In container/cloud environments, the platform-injected variables are set automatically. Use `PUBLIC_URL` only when automatic detection does not produce the correct URL.

---

## Repository Replication Configuration

These parameters configure authentication and defaults for the repository replication feature (`repo clone-github` and `repo clone-devops` commands, and the corresponding API endpoints). They are provided exclusively as environment variables (never stored in the config file) because they contain secrets.

---

### `GITHUB_TOKEN`

| Attribute | Value |
|-----------|-------|
| **Purpose** | GitHub Personal Access Token used to authenticate when downloading repository archives. Required for private repositories; optional for public repositories (but recommended to avoid GitHub API rate limits). |
| **Required** | Conditionally (required for private GitHub repositories) |
| **Type** | String |
| **Environment variable** | `GITHUB_TOKEN` |
| **CLI flag** | Not available |
| **Config file key** | Not available (secret) |

**How to obtain:**

1. Go to [GitHub Settings](https://github.com/settings/tokens).
2. Navigate to **Developer settings > Personal access tokens > Fine-grained tokens** (recommended) or **Tokens (classic)**.
3. For fine-grained tokens: select the target repository or repositories, and grant the **Contents: Read-only** permission under "Repository permissions".
4. For classic tokens: select the **repo** scope (full control of private repositories).
5. Click **Generate token** and copy the value.

**Recommended management:**
- **Never commit to version control.** Store in a `.env` file that is listed in `.gitignore`.
- For CI/CD, use pipeline secret variables or a secrets manager (GitHub Secrets, Azure Key Vault, etc.).
- Prefer fine-grained tokens scoped to specific repositories over classic tokens for better security.
- Set a short expiry (30-90 days) and rotate regularly.

---

### `GITHUB_TOKEN_EXPIRY`

| Attribute | Value |
|-----------|-------|
| **Purpose** | The expiration date of the GitHub token. When set, the tool checks this value before each operation and logs a warning 7 days before the token expires. This prevents unexpected authentication failures by giving advance notice to renew the token. |
| **Required** | No (optional, but recommended when `GITHUB_TOKEN` is set) |
| **Type** | String (ISO 8601 date, e.g., `2026-06-30T00:00:00Z`) |
| **Environment variable** | `GITHUB_TOKEN_EXPIRY` |
| **CLI flag** | Not available |
| **Config file key** | Not available |

**How to obtain:**

When generating a GitHub Personal Access Token, note the expiration date you selected. Convert it to ISO 8601 format (e.g., `2026-06-30T00:00:00Z`).

**Recommended management:**
Store alongside `GITHUB_TOKEN` in the `.env` file. Update whenever the token is rotated.

---

### `AZURE_DEVOPS_PAT`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Azure DevOps Personal Access Token used to authenticate when downloading repository archives. Required when `AZURE_DEVOPS_AUTH_METHOD` is `pat` (default). |
| **Required** | Conditionally (required when `AZURE_DEVOPS_AUTH_METHOD = pat`) |
| **Type** | String |
| **Environment variable** | `AZURE_DEVOPS_PAT` |
| **CLI flag** | Not available |
| **Config file key** | Not available (secret) |

**How to obtain:**

1. Sign in to Azure DevOps (`https://dev.azure.com/{yourorg}`).
2. Click your profile icon in the top-right corner and select **User settings > Personal access tokens**.
3. Click **New Token**.
4. Give the token a descriptive name (e.g., "repo-sync replication").
5. Set the organization scope to the target organization.
6. Under **Scopes**, select **Code > Read**.
7. Set an appropriate expiry date.
8. Click **Create** and copy the token value.

**Recommended management:**
- **Never commit to version control.** Store in a `.env` file that is listed in `.gitignore`.
- For CI/CD, use pipeline secret variables or Azure Key Vault.
- Scope the PAT to the minimum required permission (Code Read).
- Set a short expiry (30-90 days) and rotate regularly.

---

### `AZURE_DEVOPS_PAT_EXPIRY`

| Attribute | Value |
|-----------|-------|
| **Purpose** | The expiration date of the Azure DevOps PAT. When set, the tool checks this value before each operation and logs a warning 7 days before the PAT expires. This prevents unexpected authentication failures by giving advance notice to renew the PAT. |
| **Required** | No (optional, but recommended when `AZURE_DEVOPS_PAT` is set) |
| **Type** | String (ISO 8601 date, e.g., `2026-06-30T00:00:00Z`) |
| **Environment variable** | `AZURE_DEVOPS_PAT_EXPIRY` |
| **CLI flag** | Not available |
| **Config file key** | Not available |

**How to obtain:**

When generating an Azure DevOps PAT, note the expiration date you selected. Convert it to ISO 8601 format (e.g., `2026-06-30T00:00:00Z`).

**Recommended management:**
Store alongside `AZURE_DEVOPS_PAT` in the `.env` file. Update whenever the PAT is rotated.

---

### `AZURE_DEVOPS_AUTH_METHOD`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Determines which authentication mechanism the tool uses to access Azure DevOps repositories. |
| **Required** | No (defaults to `pat` if `AZURE_DEVOPS_PAT` is set) |
| **Type** | String (enum) |
| **Environment variable** | `AZURE_DEVOPS_AUTH_METHOD` |
| **CLI flag** | Not available |
| **Config file key** | Not available |

**Options:**

| Value | Description | When to use |
|-------|-------------|-------------|
| `pat` | Uses a Personal Access Token for authentication. Requires `AZURE_DEVOPS_PAT` to be set. | Default method. Use for quick setup and CI/CD pipelines. |
| `azure-ad` | Uses Azure AD (DefaultAzureCredential) for authentication. No PAT needed. | Use in Azure-hosted environments with managed identities, or locally after `az login`. |

**Recommended management:**
Set as an environment variable. Use `pat` for simple setups and `azure-ad` for Azure-hosted production workloads.

---

### `AZURE_DEVOPS_ORG_URL`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Default Azure DevOps organization URL. When set, provides a default organization for the `repo clone-devops` command, reducing the need to specify `--org` on every invocation. |
| **Required** | No (optional) |
| **Type** | String (URL, e.g., `https://dev.azure.com/myorg`) |
| **Environment variable** | `AZURE_DEVOPS_ORG_URL` |
| **CLI flag** | Not available |
| **Config file key** | Not available |

**How to obtain:**

Your Azure DevOps organization URL follows the pattern `https://dev.azure.com/{organization}`. You can find it by navigating to your organization's home page in Azure DevOps.

**Recommended management:**
Store in the `.env` file. Useful when most of your DevOps operations target a single organization.

---

## Sync Pair Configuration Path

### `AZURE_FS_SYNC_CONFIG_PATH`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Path to the sync pair configuration file (JSON or YAML). Overridden by the CLI `--sync-config` flag. |
| **Required** | No (optional; can be provided via CLI flag instead) |
| **Type** | String (file path) |
| **Environment variable** | `AZURE_FS_SYNC_CONFIG_PATH` |
| **CLI flag** | `--sync-config` |
| **Config file key** | Not available |

**Recommended management:**
Store in the `.env` file for development. Use the CLI flag for ad-hoc overrides.

---

## Config File Reference

The config file (`.repo-sync.json`) is the recommended way to store non-secret configuration. Below is a complete example with all fields:

```json
{
  "storage": {
    "accountUrl": "https://myaccount.blob.core.windows.net",
    "containerName": "my-container",
    "authMethod": "azure-ad",
    "sasTokenExpiry": "2026-12-31T00:00:00Z"
  },
  "logging": {
    "level": "info",
    "logRequests": false
  },
  "retry": {
    "strategy": "exponential",
    "maxRetries": 3,
    "initialDelayMs": 1000,
    "maxDelayMs": 30000
  },
  "api": {
    "port": 3000,
    "host": "0.0.0.0",
    "corsOrigins": ["*"],
    "swaggerEnabled": true,
    "requestTimeoutMs": 30000,
    "nodeEnv": "development",
    "autoSelectPort": true
  }
}
```

**File location:**
- By default, the tool looks for `.repo-sync.json` in the current working directory.
- Use `--config <path>` to specify an alternative path.
- Use `repo-sync config init` to interactively create the file.

**Important:** The config file must **not** contain secrets (connection strings, SAS tokens, PATs). Those must be provided as environment variables.

---

## Environment Variables Reference

| Variable | Maps to | Required |
|----------|---------|----------|
| `AZURE_STORAGE_ACCOUNT_URL` | `storage.accountUrl` | Yes (if not in config file or CLI) |
| `AZURE_STORAGE_CONTAINER_NAME` | `storage.containerName` | Yes (if not in config file or CLI) |
| `AZURE_FS_AUTH_METHOD` | `storage.authMethod` | Yes (if not in config file or CLI) |
| `AZURE_STORAGE_CONNECTION_STRING` | Auth secret | Only when `authMethod = connection-string` |
| `AZURE_STORAGE_SAS_TOKEN` | Auth secret | Only when `authMethod = sas-token` |
| `AZURE_STORAGE_SAS_TOKEN_EXPIRY` | `storage.sasTokenExpiry` | Only when `authMethod = sas-token` |
| `AZURE_FS_LOG_LEVEL` | `logging.level` | Yes (if not in config file) |
| `AZURE_FS_LOG_REQUESTS` | `logging.logRequests` | Yes (if not in config file) |
| `AZURE_FS_RETRY_STRATEGY` | `retry.strategy` | Yes (if not in config file) |
| `AZURE_FS_RETRY_MAX_RETRIES` | `retry.maxRetries` | Yes (if not in config file) |
| `AZURE_FS_RETRY_INITIAL_DELAY_MS` | `retry.initialDelayMs` | Yes (if not in config file, when strategy is not `none`) |
| `AZURE_FS_RETRY_MAX_DELAY_MS` | `retry.maxDelayMs` | Yes (if not in config file, when strategy is not `none`) |
| `AZURE_FS_API_PORT` | `api.port` | Yes (API mode only) |
| `AZURE_FS_API_HOST` | `api.host` | Yes (API mode only) |
| `AZURE_FS_API_CORS_ORIGINS` | `api.corsOrigins` | Yes (API mode only) |
| `AZURE_FS_API_SWAGGER_ENABLED` | `api.swaggerEnabled` | Yes (API mode only) |
| `AZURE_FS_API_REQUEST_TIMEOUT_MS` | `api.requestTimeoutMs` | Yes (API mode only) |
| `NODE_ENV` | `api.nodeEnv` | Yes (API mode only) |
| `AUTO_SELECT_PORT` | `api.autoSelectPort` | Yes (API mode only) |
| `AZURE_FS_API_SWAGGER_ADDITIONAL_SERVERS` | `api.swaggerAdditionalServers` | No (optional) |
| `AZURE_FS_API_SWAGGER_SERVER_VARIABLES` | `api.swaggerServerVariables` | No (optional) |
| `AZURE_FS_SYNC_CONFIG_PATH` | Sync pair config file path | No (optional) |
| `AZURE_VENV` | Azure Blob Storage URL for remote config sync | No (optional, both AZURE_VENV and AZURE_VENV_SAS_TOKEN must be set together) |
| `AZURE_VENV_SAS_TOKEN` | SAS token for azure-venv (Read + List) | No (paired with AZURE_VENV) |
| `AZURE_VENV_SAS_EXPIRY` | SAS token expiry for proactive warnings | No (optional) |
| `PUBLIC_URL` | Swagger URL override | No (optional, auto-detection) |
| `WEBSITE_HOSTNAME` | Swagger URL detection | No (auto-set by Azure App Service) |
| `WEBSITE_SITE_NAME` | Swagger HTTPS detection | No (auto-set by Azure App Service) |
| `K8S_SERVICE_HOST` | Swagger URL detection | No (auto-injected by Kubernetes) |
| `K8S_SERVICE_PORT` | Swagger URL detection | No (auto-injected by Kubernetes) |
| `DOCKER_HOST_URL` | Swagger URL detection | No (optional, Docker) |
| `AZURE_FS_API_USE_HTTPS` | Swagger HTTPS for K8s | No (optional) |
| `GITHUB_TOKEN` | GitHub PAT for repo replication | Conditionally (private repos) |
| `GITHUB_TOKEN_EXPIRY` | GitHub token expiry date | No (optional) |
| `AZURE_DEVOPS_PAT` | Azure DevOps PAT for repo replication | Conditionally (when auth method = pat) |
| `AZURE_DEVOPS_PAT_EXPIRY` | Azure DevOps PAT expiry date | No (optional) |
| `AZURE_DEVOPS_AUTH_METHOD` | DevOps auth method: pat, azure-ad | No (defaults to pat) |
| `AZURE_DEVOPS_ORG_URL` | Default DevOps organization URL | No (optional) |

---

## CLI Flags Reference

Only a subset of configuration can be overridden via CLI flags:

| Flag | Short | Maps to | Scope |
|------|-------|---------|-------|
| `--account-url <url>` | `-a` | `storage.accountUrl` | Per-command |
| `--container <name>` | `-c` | `storage.containerName` | Per-command |
| `--auth-method <method>` | | `storage.authMethod` | Per-command |
| `--config <path>` | | Config file path | Per-command |
| `--sync-config <path>` | | Sync pair config file path | Per-command (repo sync) |
| `--json` | | JSON output mode | Per-command |
| `--verbose` | `-v` | Debug logging for command | Per-command |

Logging and retry settings are not available as global CLI flags. They must be configured via the config file or environment variables.

---

## Recommended Setup by Environment

### Local Development

1. Run `repo-sync config init` to create `.repo-sync.json`.
2. Set `authMethod` to `azure-ad`.
3. Run `az login` to authenticate.
4. Add `.repo-sync.json` to `.gitignore` if it contains environment-specific values.

### CI/CD Pipeline

1. Use environment variables for all configuration.
2. For Azure Storage authentication, prefer a service principal with `azure-ad`:
   - Set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` as pipeline secrets.
   - Set `AZURE_FS_AUTH_METHOD=azure-ad`.
3. Alternatively, generate a short-lived SAS token in the pipeline and use `sas-token`.
4. For repository access, set `GITHUB_TOKEN` and/or `AZURE_DEVOPS_PAT` as pipeline secrets.
5. Set logging to `warn` or `error` to reduce pipeline output.

### Production / Azure-Hosted

1. Use `azure-ad` with a managed identity (no secrets to manage) for Azure Storage.
2. Set `retry.strategy` to `exponential` with `maxRetries: 3` or higher.
3. Set `logging.level` to `warn` and `logging.logRequests` to `false`.

---

## Validation

Use `repo-sync config validate` to verify that:

1. All required configuration variables are present.
2. All values are valid (correct enum values, non-negative integers).
3. The authentication credentials work.
4. The target container exists and is accessible.

Use `repo-sync config show` to inspect the merged configuration without validation (sensitive values are masked in the output).

---

## Azure VENV (Remote Config Sync)

The API integrates the `azure-venv` library to sync files and environment variables from Azure Blob Storage on startup. This enables centralized configuration management across environments. If neither `AZURE_VENV` nor `AZURE_VENV_SAS_TOKEN` is set, the library is a no-op and the API starts normally.

### `AZURE_VENV`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Azure Blob Storage URL pointing to the remote config prefix. All blobs under this prefix are synced to the local app root on startup. A `.env` file under this prefix is loaded with three-tier precedence (OS env > remote .env > local .env). |
| **Required** | Yes (both `AZURE_VENV` and `AZURE_VENV_SAS_TOKEN` must be set together, or both absent) |
| **Type** | String (URL) |
| **Environment variable** | `AZURE_VENV` |
| **Format** | `https://<account>.blob.core.windows.net/<container>/<prefix>` |

**How to obtain:**
Compose the URL from your Azure Storage account name, container name, and the virtual directory prefix where your config files are stored.

**Example:** `https://myaccount.blob.core.windows.net/config/repo-sync/prod` syncs all blobs under the `config/repo-sync/prod/` prefix.

**Recommended management:**
Store in the `.env` file. Use different values per environment (dev/staging/prod) to point to different config prefixes.

---

### `AZURE_VENV_SAS_TOKEN`

| Attribute | Value |
|-----------|-------|
| **Purpose** | SAS token granting Read and List permissions to the blob container referenced in `AZURE_VENV`. |
| **Required** | Yes (paired with `AZURE_VENV`) |
| **Type** | String (no leading `?`) |
| **Environment variable** | `AZURE_VENV_SAS_TOKEN` |

**How to obtain:**

Generate via Azure CLI:
```bash
az storage container generate-sas \
  --account-name <account> \
  --name <container> \
  --permissions rl \
  --expiry 2027-12-31 \
  --output tsv
```

Or via Azure Portal: Storage Account > Shared access signature (select Read + List permissions).

**Recommended management:**
- **Never commit to version control.** Store in `.env` (gitignored).
- For CI/CD, use pipeline secret variables or a secrets manager.

---

### `AZURE_VENV_SAS_EXPIRY`

| Attribute | Value |
|-----------|-------|
| **Purpose** | The expiration date of the `AZURE_VENV_SAS_TOKEN`. When set, the library warns 7 days before expiry. |
| **Required** | No (optional, but recommended) |
| **Type** | String (ISO 8601 date, e.g., `2027-12-31T00:00:00Z`) |
| **Environment variable** | `AZURE_VENV_SAS_EXPIRY` |

**Recommended management:**
Always set when using `AZURE_VENV_SAS_TOKEN` to get proactive expiry warnings. Update when rotating the SAS token.

---

### Environment Variable Precedence (azure-venv)

When `azure-venv` is active, environment variables are resolved in this order (highest wins):

| Priority | Source | Description |
|----------|--------|-------------|
| 1 (highest) | **OS environment** | Variables already in `process.env` before any `.env` loading |
| 2 | **Remote `.env`** | Downloaded from Azure Blob Storage (`<prefix>/.env`) |
| 3 (lowest) | **Local `.env`** | On disk at the project root |

This means OS-level environment variables (e.g., set in Docker Compose, Azure App Service, or CI/CD) always take precedence over remote or local `.env` files.

---

## Sync Pair Configuration

The sync pair configuration is a **separate file** (not part of `.repo-sync.json`) used by the `repo sync` CLI command and the `POST /api/v1/repo/sync` API endpoint. It defines one or more repository-to-blob-storage replication pairs, each with its own source credentials and Azure Storage destination.

### Why a Separate File

- Contains secrets (PAT tokens, SAS tokens) that may need different access controls than `.repo-sync.json`.
- Has a fundamentally different structure (array of pairs vs. flat config).
- Has a different lifecycle: updated when repositories or storage targets change, not when the tool configuration changes.
- Avoids bloating the main config validation.

### File Format Detection

The file format is detected by extension:

| Extension | Format |
|-----------|--------|
| `.json` | JSON (parsed with `JSON.parse()`) |
| `.yaml` | YAML (parsed with `js-yaml` using `JSON_SCHEMA` safe mode) |
| `.yml` | YAML (parsed with `js-yaml` using `JSON_SCHEMA` safe mode) |

Any other extension raises a `ConfigError` with code `CONFIG_INVALID_VALUE`.

**Dependency:** The YAML support requires the `js-yaml` npm package (added as a project dependency).

### Configuration Structure

The root object must contain a `syncPairs` array with one or more sync pair entries. Each entry has four top-level fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique identifier for the sync pair. Must be unique across all pairs in the file. Used in logs, results, and token expiry warnings. |
| `platform` | string | Yes | Source platform discriminator. Must be `"github"` or `"azure-devops"`. |
| `source` | object | Yes | Source repository configuration. Structure depends on `platform`. |
| `destination` | object | Yes | Azure Storage destination configuration. |

### Destination Fields

All destination fields are the same regardless of platform.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `accountUrl` | string | Yes | Azure Storage account URL (e.g., `https://myaccount.blob.core.windows.net`). |
| `container` | string | Yes | Container name in the storage account. |
| `folder` | string | **Yes** | Destination folder path within the container. **This field is required with no default value.** Explicit routing prevents accidental overwrites at the container root. Use `"/"` to write to the container root. |
| `sasToken` | string | Yes | SAS token for authenticating to the storage account (no leading `?`). Must have Write and Create permissions on the container. |
| `sasTokenExpiry` | string | No | SAS token expiry in ISO 8601 format (e.g., `2026-12-31T00:00:00Z`). When set, the tool warns 7 days before expiry. |

**How to obtain `sasToken`:**

Generate via Azure CLI:
```bash
az storage container generate-sas \
  --account-name <account> \
  --name <container> \
  --permissions rwdlac \
  --expiry 2027-12-31 \
  --output tsv
```

Or via Azure Portal: Storage Account > Shared access signature (select Read, Write, Delete, List, Add, Create permissions).

### GitHub Source Fields

Used when `platform` is `"github"`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `repo` | string | Yes | GitHub repository in `owner/repo` format (e.g., `microsoft/typescript`). |
| `ref` | string | No | Branch name, tag, or commit SHA. If omitted, the repository's default branch is used. |
| `token` | string | No | GitHub Personal Access Token. Optional for public repositories, required for private repositories. Must have `repo` scope for private repos. |
| `tokenExpiry` | string | No | Token expiry in ISO 8601 format. When set, the tool warns 7 days before expiry. |

### Azure DevOps Source Fields

Used when `platform` is `"azure-devops"`. DevOps sync pairs use **PAT authentication only** (no azure-ad). Azure AD uses machine-level DefaultAzureCredential, which is not a per-pair credential and would be semantically misleading in a per-pair config.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `organization` | string | Yes | Azure DevOps organization name. |
| `project` | string | Yes | Project name. |
| `repository` | string | Yes | Repository name or GUID. |
| `ref` | string | No | Version identifier (branch name, tag, or commit SHA). If omitted, the default branch is used. |
| `versionType` | string | No | How to interpret `ref`: `"branch"`, `"tag"`, or `"commit"`. Defaults to `"branch"`. |
| `resolveLfs` | boolean | No | Whether to resolve LFS pointers. Defaults to `false`. |
| `pat` | string | **Yes** | Personal Access Token with Code Read scope. Required for all DevOps sync pairs (PAT-only auth). |
| `patExpiry` | string | No | PAT expiry in ISO 8601 format. When set, the tool warns 7 days before expiry. |
| `orgUrl` | string | No | Organization URL override (e.g., `https://dev.azure.com/myorg`). If not set, constructed from the organization name. |

### Token Expiry Checking

Before processing begins, all token expiry dates in the configuration are checked using the `checkTokenExpiry()` utility:

- **Expired tokens** cause an immediate error, halting processing for that pair.
- **Tokens expiring within 7 days** produce a warning log message.
- Each warning is prefixed with `sync:<pairName>:<tokenType>` for easy identification (e.g., `sync:my-github-repo:GITHUB_TOKEN`).

The following tokens are checked per pair:
- GitHub pairs: `source.tokenExpiry` (only if `source.token` is present)
- DevOps pairs: `source.patExpiry`
- All pairs: `destination.sasTokenExpiry`

### Complete Example: JSON Format

```json
{
  "syncPairs": [
    {
      "name": "typescript-repo",
      "platform": "github",
      "source": {
        "repo": "microsoft/typescript",
        "ref": "main",
        "token": "ghp_xxxxxxxxxxxxxxxxxxxx",
        "tokenExpiry": "2026-12-31T00:00:00Z"
      },
      "destination": {
        "accountUrl": "https://myaccount.blob.core.windows.net",
        "container": "repos",
        "folder": "github/typescript",
        "sasToken": "sv=2022-11-02&ss=b&srt=co&sp=rwdlacyx&se=2027-01-01T00:00:00Z&st=2026-01-01T00:00:00Z&spr=https&sig=xxxxx",
        "sasTokenExpiry": "2027-01-01T00:00:00Z"
      }
    },
    {
      "name": "internal-api",
      "platform": "azure-devops",
      "source": {
        "organization": "myorg",
        "project": "platform",
        "repository": "internal-api",
        "ref": "release/v2",
        "versionType": "branch",
        "pat": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        "patExpiry": "2026-06-30T00:00:00Z",
        "orgUrl": "https://dev.azure.com/myorg"
      },
      "destination": {
        "accountUrl": "https://myaccount.blob.core.windows.net",
        "container": "repos",
        "folder": "devops/internal-api",
        "sasToken": "sv=2022-11-02&ss=b&srt=co&sp=rwdlacyx&se=2027-01-01T00:00:00Z&st=2026-01-01T00:00:00Z&spr=https&sig=xxxxx",
        "sasTokenExpiry": "2027-01-01T00:00:00Z"
      }
    }
  ]
}
```

### Complete Example: YAML Format

```yaml
syncPairs:
  - name: typescript-repo
    platform: github
    source:
      repo: microsoft/typescript
      ref: main
      token: ghp_xxxxxxxxxxxxxxxxxxxx
      tokenExpiry: "2026-12-31T00:00:00Z"
    destination:
      accountUrl: https://myaccount.blob.core.windows.net
      container: repos
      folder: github/typescript
      sasToken: "sv=2022-11-02&ss=b&srt=co&sp=rwdlacyx&se=2027-01-01T00:00:00Z&st=2026-01-01T00:00:00Z&spr=https&sig=xxxxx"
      sasTokenExpiry: "2027-01-01T00:00:00Z"

  - name: internal-api
    platform: azure-devops
    source:
      organization: myorg
      project: platform
      repository: internal-api
      ref: release/v2
      versionType: branch
      pat: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
      patExpiry: "2026-06-30T00:00:00Z"
      orgUrl: https://dev.azure.com/myorg
    destination:
      accountUrl: https://myaccount.blob.core.windows.net
      container: repos
      folder: devops/internal-api
      sasToken: "sv=2022-11-02&ss=b&srt=co&sp=rwdlacyx&se=2027-01-01T00:00:00Z&st=2026-01-01T00:00:00Z&spr=https&sig=xxxxx"
      sasTokenExpiry: "2027-01-01T00:00:00Z"
```

### Recommended Management

- **Never commit sync pair config files to version control** -- they contain secrets (PAT tokens, SAS tokens).
- Add `sync-pairs.json`, `sync-pairs.yaml`, `sync-pairs.yml` to `.gitignore`.
- For CI/CD, generate the config file dynamically from pipeline secrets or use the API endpoint with the configuration passed in the request body.
- Use short-lived tokens and always set expiry fields for proactive warnings.
- Keep separate config files per environment (dev, staging, prod) with different storage targets and credentials.

---

## Docker Deployment Configuration

When running the API in a Docker container, all configuration must be provided via environment variables. The config file (`.repo-sync.json`) is excluded from the image by `.dockerignore`.

### Setup

1. Copy the Docker-specific template:
   ```bash
   cp .env.docker.example .env
   ```

2. Fill in the required Azure Storage credentials in `.env`.

3. Start the container:
   ```bash
   docker compose up
   ```

### Docker-Specific Defaults

The following values are pre-set in `.env.docker.example` with production-oriented defaults:

| Variable | Docker Default | Rationale |
|----------|---------------|-----------|
| `NODE_ENV` | `development` | Enables dev features, console hotkeys, hotkey API endpoints, stack traces in errors |
| `AZURE_FS_API_HOST` | `0.0.0.0` | Required for container networking (bind to all interfaces) |
| `AZURE_FS_API_PORT` | `3000` | Standard API port; mapped to host via Docker port binding |
| `AUTO_SELECT_PORT` | `false` | Deterministic port assignment in containers |
| `AZURE_FS_LOG_LEVEL` | `info` | Balanced logging for production |
| `AZURE_FS_LOG_REQUESTS` | `false` | Reduce log noise in production |
| `AZURE_FS_RETRY_STRATEGY` | `exponential` | Resilient to transient failures |

### Reverse Proxy / Load Balancer

When the container runs behind a reverse proxy (e.g., NGINX, Azure Application Gateway, Kubernetes Ingress):

- Set `PUBLIC_URL` to the external URL (e.g., `https://api.example.com`) so Swagger docs show the correct server URL.
- The container still binds to `0.0.0.0:3000` internally; the proxy handles TLS termination and port mapping.

### Docker Compose Override

The `docker-compose.yml` file sets environment variables that override any values from `.env`:

```yaml
environment:
  - NODE_ENV=development
  - AZURE_FS_API_HOST=0.0.0.0
  - AZURE_FS_API_PORT=3000
  - AUTO_SELECT_PORT=false
```

These ensure the container always runs with correct networking settings regardless of what is in `.env`.

### Configuration Priority in Docker

The priority order remains the same as the standard tool, but in practice:

1. **Docker Compose `environment` section** (overrides everything)
2. **`.env` file** (loaded by Docker Compose `env_file` directive)
3. Config file is not available (excluded from image)
