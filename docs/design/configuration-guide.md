# Azure Blob Storage File System CLI - Configuration Guide

This guide documents every configuration variable used by the `azure-fs` CLI tool, how to obtain each value, the recommended management approach, and what each option means for the project.

---

## Configuration Sources and Priority

The tool loads configuration from three sources, merged in the following priority order (highest wins):

| Priority | Source | Description |
|----------|--------|-------------|
| 1 (highest) | **CLI Flags** | Passed directly on the command line (`--account-url`, `--container`, `--auth-method`) |
| 2 | **Environment Variables** | Set in the shell or via a `.env` file |
| 3 (lowest) | **Config File** | JSON file at `.azure-fs.json` (or custom path via `--config`) |

When a value is present in multiple sources, the highest-priority source wins. All required variables must be resolved from at least one source; there are **no default or fallback values**. A missing required variable will raise a `ConfigError` with instructions on how to provide it.

---

## Storage Configuration

### `storage.accountUrl`

| Attribute | Value |
|-----------|-------|
| **Purpose** | The full URL of the Azure Storage account that the tool connects to. This is the root endpoint for all blob operations. |
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
Store in the `.azure-fs.json` config file for project-level usage, or set as an environment variable for CI/CD pipelines. Use the CLI flag only for ad-hoc overrides.

---

### `storage.containerName`

| Attribute | Value |
|-----------|-------|
| **Purpose** | The name of the Azure Blob Storage container to operate on. All file/folder commands target this container. |
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
Store in the `.azure-fs.json` config file. Use the CLI flag when you need to temporarily operate on a different container.

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
Store in the `.azure-fs.json` config file. Default to `azure-ad` for the best security posture.

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
- Store in the `.azure-fs.json` config file alongside other storage settings, or set as the `AZURE_STORAGE_SAS_TOKEN_EXPIRY` environment variable.
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
Store in the `.azure-fs.json` config file. Use `info` for everyday usage and `debug` when troubleshooting. Note that the `--verbose` / `-v` CLI flag provides per-command debug output independently of this setting.

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
Store in the `.azure-fs.json` config file. Keep set to `false` in normal usage. Enable temporarily when diagnosing connectivity, authentication, or performance issues.

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
Store in the `.azure-fs.json` config file. Use `exponential` as the standard strategy.

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
Store in the `.azure-fs.json` config file. A value of `3` is recommended for general use.

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
Store in the `.azure-fs.json` config file. A value of `1000` is recommended.

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
Store in the `.azure-fs.json` config file. A value of `30000` is recommended.

---

### `batch.concurrency`

| Property | Value |
|----------|-------|
| **Purpose** | Maximum number of parallel file uploads for the `upload-dir` batch command |
| **Config file key** | `batch.concurrency` |
| **Environment variable** | `AZURE_FS_BATCH_CONCURRENCY` |
| **CLI override** | `--concurrency <n>` (only on `upload-dir` command) |
| **Required** | Yes |
| **Type** | Positive integer |
| **Default** | None (must be explicitly configured) |

**How to obtain:**
Choose a value based on your network bandwidth and Azure Storage account limits. Azure Blob Storage supports high concurrency; typical values are 5–20. Higher values use more memory and network connections.

**Options and meaning:**
- `1`: Sequential uploads (no parallelism)
- `5–10`: Conservative parallelism, suitable for most use cases
- `10–20`: Higher throughput for fast networks and large batch uploads
- `20+`: Aggressive parallelism; may hit Azure throttling limits on lower-tier accounts

**Recommended management:**
Store in the `.azure-fs.json` config file. A value of `10` is recommended as a starting point.

---

## Config File Reference

The config file (`.azure-fs.json`) is the recommended way to store non-secret configuration. Below is a complete example with all fields:

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
  "batch": {
    "concurrency": 10
  }
}
```

**File location:**
- By default, the tool looks for `.azure-fs.json` in the current working directory.
- Use `--config <path>` to specify an alternative path.
- Use `azure-fs config init` to interactively create the file.

**Important:** The config file must **not** contain secrets (connection strings, SAS tokens). Those must be provided as environment variables.

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
| `AZURE_FS_BATCH_CONCURRENCY` | `batch.concurrency` | Yes (if not in config file) |

---

## CLI Flags Reference

Only a subset of configuration can be overridden via CLI flags:

| Flag | Short | Maps to | Scope |
|------|-------|---------|-------|
| `--account-url <url>` | `-a` | `storage.accountUrl` | Per-command |
| `--container <name>` | `-c` | `storage.containerName` | Per-command |
| `--auth-method <method>` | | `storage.authMethod` | Per-command |
| `--config <path>` | | Config file path | Per-command |
| `--json` | | JSON output mode | Per-command |
| `--verbose` | `-v` | Debug logging for command | Per-command |

The `upload-dir` command also supports `--concurrency <n>` to override `batch.concurrency` for that invocation.

Logging, retry, and batch settings (other than `--concurrency` on `upload-dir`) are not available as global CLI flags. They must be configured via the config file or environment variables.

---

## Recommended Setup by Environment

### Local Development

1. Run `azure-fs config init` to create `.azure-fs.json`.
2. Set `authMethod` to `azure-ad`.
3. Run `az login` to authenticate.
4. Add `.azure-fs.json` to `.gitignore` if it contains environment-specific values.

### CI/CD Pipeline

1. Use environment variables for all configuration.
2. For authentication, prefer a service principal with `azure-ad`:
   - Set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` as pipeline secrets.
   - Set `AZURE_FS_AUTH_METHOD=azure-ad`.
3. Alternatively, generate a short-lived SAS token in the pipeline and use `sas-token`.
4. Set logging to `warn` or `error` to reduce pipeline output.

### Production / Azure-Hosted

1. Use `azure-ad` with a managed identity (no secrets to manage).
2. Set `retry.strategy` to `exponential` with `maxRetries: 3` or higher.
3. Set `logging.level` to `warn` and `logging.logRequests` to `false`.

---

## Validation

Use `azure-fs config validate` to verify that:

1. All required configuration variables are present.
2. All values are valid (correct enum values, non-negative integers).
3. The authentication credentials work.
4. The target container exists and is accessible.

Use `azure-fs config show` to inspect the merged configuration without validation (sensitive values are masked in the output).
