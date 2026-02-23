# Plan 004: Replacing .env Configuration with Asset Management

## 1. Overview

This document describes how the `azure-fs` CLI tool can replace its current `.env`-based configuration with parameters retrieved from the **NBG-AI Asset Management** system. The Asset Management system uses Git repositories as the source of truth for configuration assets, synchronizes them into PostgreSQL databases, and provides a TypeScript SDK (`@asset-management/client`) for client applications to retrieve configuration at runtime.

### Goal

Eliminate the need for developers and CI/CD pipelines to maintain `.env` files with sensitive and non-sensitive configuration. Instead, configuration is:

1. **Version-controlled** in a Git registry (GitHub or Azure DevOps).
2. **Synchronized** into a PostgreSQL database by the Asset Management backend.
3. **Retrieved at runtime** by the `azure-fs` tool using the Asset Management client SDK.

### Benefits

- Centralized configuration management across environments.
- Full audit trail of every configuration change (via `asset_log`) and every retrieval (via `asset_retrieval`).
- Automatic propagation of configuration updates without redeployment.
- Per-application registration with usage tracking (via `user_key`).
- Version control and change history through Git.
- Consistent configuration distribution across multiple tools and services.

---

## 2. Current Configuration Architecture

The `azure-fs` tool currently loads configuration from three sources, merged in priority order:

```
CLI Flags (highest) > Environment Variables > Config File .azure-fs.json (lowest)
```

### Current Configuration Parameters

| Parameter | Source | Sensitive | Notes |
|-----------|--------|-----------|-------|
| `storage.accountUrl` | Config file / Env / CLI | No | Storage account endpoint |
| `storage.containerName` | Config file / Env / CLI | No | Target container |
| `storage.authMethod` | Config file / Env / CLI | No | `azure-ad`, `sas-token`, or `connection-string` |
| `storage.sasTokenExpiry` | Config file / Env | No | ISO 8601 date (required when `sas-token`) |
| `AZURE_STORAGE_CONNECTION_STRING` | Env only | **Yes** | Full connection string with account key |
| `AZURE_STORAGE_SAS_TOKEN` | Env only | **Yes** | SAS token |
| `logging.level` | Config file / Env | No | `debug`, `info`, `warn`, `error` |
| `logging.logRequests` | Config file / Env | No | Boolean |
| `retry.strategy` | Config file / Env | No | `none`, `exponential`, `fixed` |
| `retry.maxRetries` | Config file / Env | No | Non-negative integer |
| `retry.initialDelayMs` | Config file / Env | No | Milliseconds |
| `retry.maxDelayMs` | Config file / Env | No | Milliseconds |
| `batch.concurrency` | Config file / Env / CLI | No | Positive integer |

---

## 3. Asset Management System Overview

### Architecture

```
  Git Repository (Registry)          PostgreSQL Database           Client Application
  ========================          ====================          ==================

  configs/
    dev/azure-fs.json         -->   Sync Engine (backend)   -->   @asset-management/client
    staging/azure-fs.json            POST /api/database/            (direct DB connection)
    prod/azure-fs.json               sync/:db/:registry
    secrets/
      dev/azure-fs-secrets.json
      prod/azure-fs-secrets.json
```

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Registry** | A Git repository (GitHub or Azure DevOps) serving as the source of truth for configuration assets. |
| **Database** | A PostgreSQL instance where synchronized copies of assets are stored for fast retrieval. |
| **Asset** | A single file from the registry, identified by `asset_registry` + `asset_key`. |
| **Master Copy** | The synchronized version of an asset (`user_key = NULL`). |
| **Registered Copy** | An application-specific copy (`user_key = <app-id>`), automatically created on first retrieval and kept in sync with the master. |
| **Sync** | The process of fetching assets from a Git registry and upserting them into a database. Uses commit SHA comparison for efficiency. |
| **Asset Class** | Automatically inferred: `config` (for files in paths containing "config"/"setting"), `prompt`, or `content`. |
| **Asset Type** | Derived from file extension: `json`, `yaml`, `md`, `txt`, etc. |

### Client SDK

The `@asset-management/client` package provides four client classes:

1. **`AssetClient`** -- Core retrieval with automatic registration and update tracking.
2. **`ConfigurationManager`** -- Typed configuration retrieval with in-memory caching and TTL.
3. **`PromptManager`** -- Prompt template retrieval with variable substitution.
4. **`ResilientAssetClient`** -- Adds offline fallback via preloaded cache.

The SDK connects **directly to PostgreSQL** (not through the REST API), making it fast and independent of the backend server at runtime.

---

## 4. Integration Design

### 4.1 Registry Asset Structure

The configuration for `azure-fs` would be stored in a Git registry as JSON files, organized by environment:

```
azure-fs-config/                          <-- registry repository
  configs/
    dev/
      azure-fs.json                       <-- non-sensitive config for dev
    staging/
      azure-fs.json                       <-- non-sensitive config for staging
    prod/
      azure-fs.json                       <-- non-sensitive config for prod
  secrets/
    dev/
      azure-fs-secrets.json               <-- sensitive config for dev
    staging/
      azure-fs-secrets.json               <-- sensitive config for staging
    prod/
      azure-fs-secrets.json               <-- sensitive config for prod
```

#### Non-Sensitive Asset: `configs/prod/azure-fs.json`

```json
{
  "storage": {
    "accountUrl": "https://prodaccount.blob.core.windows.net",
    "containerName": "production-data",
    "authMethod": "azure-ad"
  },
  "logging": {
    "level": "warn",
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

#### Sensitive Asset: `secrets/prod/azure-fs-secrets.json`

```json
{
  "connectionString": "DefaultEndpointsProtocol=https;AccountName=...",
  "sasToken": "sv=2021-06-08&ss=b&srt=sco&...",
  "sasTokenExpiry": "2026-12-31T00:00:00Z"
}
```

### 4.2 Asset Identification

Each asset is identified by the combination of:

- **`asset_registry`**: The registry identifier, e.g., `github.com/NBG-AI/application_settings`
- **`asset_key`**: The file path within the registry, e.g., `configs/prod/azure-fs.json`

### 4.3 Configuration Loading Priority (New)

The proposed priority chain adds the Asset Management database as a new layer:

```
CLI Flags (highest) > Environment Variables > Config File > Asset Management Database (lowest)
```

This means:
- The Asset Management database provides the base configuration.
- The local `.azure-fs.json` config file can override specific values.
- Environment variables override further.
- CLI flags have the final word.

This preserves full backward compatibility: existing `.env` and `.azure-fs.json` setups continue to work. The Asset Management layer is additive.

### 4.4 Bootstrap Configuration

There is a **bootstrap problem**: the tool needs configuration to connect to the Asset Management database, but the database is the source of configuration. The following minimal bootstrap parameters must be provided outside of the Asset Management system:

| Bootstrap Parameter | Environment Variable | Purpose |
|--------------------|---------------------|---------|
| Database connection string | `AZURE_FS_AM_DATABASE_URL` | PostgreSQL connection URL for the Asset Management database |
| Application identifier | `AZURE_FS_AM_USER_KEY` | Unique ID for this application instance (e.g., `azure-fs-prod`) |
| Registry identifier | `AZURE_FS_AM_REGISTRY` | The registry containing the config assets (e.g., `github.com/NBG-AI/application_settings`) |
| Config asset key | `AZURE_FS_AM_CONFIG_KEY` | Path to the non-sensitive config file (e.g., `configs/prod/azure-fs.json`) |
| Secrets asset key | `AZURE_FS_AM_SECRETS_KEY` | Path to the sensitive config file (e.g., `secrets/prod/azure-fs-secrets.json`) |
| Cache TTL (ms) | `AZURE_FS_AM_CACHE_TTL` | How long to cache configuration in memory (e.g., `60000` for 1 minute) |

These six parameters are the **only** values that need to be in the environment. Everything else comes from the Asset Management database.

### 4.5 Runtime Flow

```
1. azure-fs command is invoked
2. Config loader checks if AZURE_FS_AM_DATABASE_URL is set
   2a. If NOT set --> fall back to current behavior (config file + env + CLI)
   2b. If SET --> proceed with Asset Management integration
3. Create a ConfigurationManager from the SDK with bootstrap params
4. Retrieve the non-sensitive config asset (configs/<env>/azure-fs.json)
5. Retrieve the sensitive secrets asset (secrets/<env>/azure-fs-secrets.json)
6. Merge the two into a single configuration object
7. Continue with the existing merge chain: AM < config file < env < CLI
8. Validate the final merged configuration (existing validateConfig function)
9. Execute the requested command
```

### 4.6 Mapping Current .env Variables to Asset Management

| Current .env Variable | Target Asset | JSON Field | Notes |
|----------------------|-------------|------------|-------|
| `AZURE_STORAGE_ACCOUNT_URL` | `configs/<env>/azure-fs.json` | `storage.accountUrl` | Non-sensitive |
| `AZURE_STORAGE_CONTAINER_NAME` | `configs/<env>/azure-fs.json` | `storage.containerName` | Non-sensitive |
| `AZURE_FS_AUTH_METHOD` | `configs/<env>/azure-fs.json` | `storage.authMethod` | Non-sensitive |
| `AZURE_STORAGE_SAS_TOKEN_EXPIRY` | `secrets/<env>/azure-fs-secrets.json` | `sasTokenExpiry` | Stored with secrets for co-management |
| `AZURE_STORAGE_CONNECTION_STRING` | `secrets/<env>/azure-fs-secrets.json` | `connectionString` | **Sensitive** |
| `AZURE_STORAGE_SAS_TOKEN` | `secrets/<env>/azure-fs-secrets.json` | `sasToken` | **Sensitive** |
| `AZURE_FS_LOG_LEVEL` | `configs/<env>/azure-fs.json` | `logging.level` | Non-sensitive |
| `AZURE_FS_LOG_REQUESTS` | `configs/<env>/azure-fs.json` | `logging.logRequests` | Non-sensitive |
| `AZURE_FS_RETRY_STRATEGY` | `configs/<env>/azure-fs.json` | `retry.strategy` | Non-sensitive |
| `AZURE_FS_RETRY_MAX_RETRIES` | `configs/<env>/azure-fs.json` | `retry.maxRetries` | Non-sensitive |
| `AZURE_FS_RETRY_INITIAL_DELAY_MS` | `configs/<env>/azure-fs.json` | `retry.initialDelayMs` | Non-sensitive |
| `AZURE_FS_RETRY_MAX_DELAY_MS` | `configs/<env>/azure-fs.json` | `retry.maxDelayMs` | Non-sensitive |
| `AZURE_FS_BATCH_CONCURRENCY` | `configs/<env>/azure-fs.json` | `batch.concurrency` | Non-sensitive |

---

## 5. Implementation Plan

### 5.1 New Dependencies

```bash
npm install @asset-management/client
```

The `@asset-management/client` SDK requires only `pg` as a peer dependency (for direct PostgreSQL access).

### 5.2 New Types

Add to `src/types/config.types.ts`:

```typescript
export interface AssetManagementBootstrap {
  databaseUrl: string;       // PostgreSQL connection string
  userKey: string;           // Application identifier
  registry: string;          // e.g., "github.com/NBG-AI/application_settings"
  configKey: string;         // e.g., "configs/prod/azure-fs.json"
  secretsKey: string;        // e.g., "secrets/prod/azure-fs-secrets.json"
  cacheTtl: number;          // Cache TTL in milliseconds
}

export interface AssetSecretsConfig {
  connectionString?: string;
  sasToken?: string;
  sasTokenExpiry?: string;
}
```

### 5.3 New Module: `src/config/asset-management.loader.ts`

This module is responsible for:

1. Reading bootstrap environment variables.
2. Creating a `ConfigurationManager` from the SDK.
3. Retrieving and parsing the config and secrets assets.
4. Mapping secrets to environment variables (so the existing auth service works unchanged).
5. Returning a partial config object that feeds into the existing merge chain.

```typescript
import { ConfigurationManager } from '@asset-management/client';

export function getAssetManagementBootstrap(): AssetManagementBootstrap | null {
  const databaseUrl = process.env.AZURE_FS_AM_DATABASE_URL;
  if (!databaseUrl) return null; // AM not configured, fall back to existing behavior

  const userKey = process.env.AZURE_FS_AM_USER_KEY;
  if (!userKey) throw ConfigError.missingRequired('AZURE_FS_AM_USER_KEY', ...);

  const registry = process.env.AZURE_FS_AM_REGISTRY;
  if (!registry) throw ConfigError.missingRequired('AZURE_FS_AM_REGISTRY', ...);

  const configKey = process.env.AZURE_FS_AM_CONFIG_KEY;
  if (!configKey) throw ConfigError.missingRequired('AZURE_FS_AM_CONFIG_KEY', ...);

  const secretsKey = process.env.AZURE_FS_AM_SECRETS_KEY;
  if (!secretsKey) throw ConfigError.missingRequired('AZURE_FS_AM_SECRETS_KEY', ...);

  const cacheTtl = Number(process.env.AZURE_FS_AM_CACHE_TTL);
  if (isNaN(cacheTtl) || cacheTtl < 0) throw ConfigError.invalidValue(...);

  return { databaseUrl, userKey, registry, configKey, secretsKey, cacheTtl };
}

export async function loadAssetManagementConfig(
  bootstrap: AssetManagementBootstrap
): Promise<{ config: Record<string, unknown>; secrets: AssetSecretsConfig }> {
  const mgr = new ConfigurationManager(
    { connectionString: bootstrap.databaseUrl, userKey: bootstrap.userKey },
    bootstrap.cacheTtl
  );

  const config = await mgr.getConfig<Record<string, unknown>>(
    `${bootstrap.registry}/${bootstrap.configKey}`
  );

  const secrets = await mgr.getConfig<AssetSecretsConfig>(
    `${bootstrap.registry}/${bootstrap.secretsKey}`
  );

  return { config, secrets };
}

export function applySecretsToEnvironment(secrets: AssetSecretsConfig): void {
  // Inject secrets into process.env so the existing auth.service.ts
  // can read them without any changes.
  if (secrets.connectionString && !process.env.AZURE_STORAGE_CONNECTION_STRING) {
    process.env.AZURE_STORAGE_CONNECTION_STRING = secrets.connectionString;
  }
  if (secrets.sasToken && !process.env.AZURE_STORAGE_SAS_TOKEN) {
    process.env.AZURE_STORAGE_SAS_TOKEN = secrets.sasToken;
  }
}
```

### 5.4 Modifications to `src/config/config.loader.ts`

The `loadConfig` function must become `async` to support the Asset Management retrieval. The updated merge chain:

```typescript
export async function loadConfig(cliOptions: CliOptions): Promise<ResolvedConfig> {
  // 0. Load from Asset Management (lowest priority, if configured)
  let amConfig: Record<string, unknown> = {};
  const bootstrap = getAssetManagementBootstrap();
  if (bootstrap) {
    const { config, secrets } = await loadAssetManagementConfig(bootstrap);
    amConfig = config;

    // Map sasTokenExpiry from secrets into storage section
    if (secrets.sasTokenExpiry) {
      const storage = (amConfig.storage as Record<string, unknown>) || {};
      storage.sasTokenExpiry = secrets.sasTokenExpiry;
      amConfig.storage = storage;
    }

    // Inject auth secrets into process.env for auth.service.ts
    applySecretsToEnvironment(secrets);
  }

  // 1. Load config file
  const fileConfig = loadConfigFile(cliOptions.config);

  // 2. Load environment variables
  const envConfig = loadEnvConfig();

  // 3. Load CLI flags (highest priority)
  const cliConfig = loadCliConfig(cliOptions);

  // 4. Merge: AM < file < env < CLI
  const merged: Record<string, unknown> = {
    storage: mergeConfigSection(
      (amConfig.storage as Record<string, unknown>) || {},
      (fileConfig.storage as Record<string, unknown>) || {},
      envConfig["storage"],
      cliConfig["storage"],
    ),
    logging: mergeConfigSection(
      (amConfig.logging as Record<string, unknown>) || {},
      (fileConfig.logging as Record<string, unknown>) || {},
      envConfig["logging"],
      cliConfig["logging"],
    ),
    retry: mergeConfigSection(
      (amConfig.retry as Record<string, unknown>) || {},
      (fileConfig.retry as Record<string, unknown>) || {},
      envConfig["retry"],
      cliConfig["retry"],
    ),
    batch: mergeConfigSection(
      (amConfig.batch as Record<string, unknown>) || {},
      (fileConfig.batch as Record<string, unknown>) || {},
      envConfig["batch"],
      cliConfig["batch"],
    ),
  };

  // 5. Validate
  return validateConfig(merged);
}
```

### 5.5 Modifications to `mergeConfigSection`

Currently accepts three sources. Must be generalized to accept an arbitrary number:

```typescript
function mergeConfigSection(
  ...sections: Record<string, unknown>[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const section of sections) {
    for (const [key, value] of Object.entries(section)) {
      if (value !== undefined && value !== null && value !== "") {
        result[key] = value;
      }
    }
  }
  return result;
}
```

### 5.6 Command Handlers -- Async Propagation

Since `loadConfig` becomes async, all command action callbacks that call it must `await` the result. Currently, `config validate` and all file/folder/edit/meta/tags commands call `resolveConfig` (which calls `loadConfig`). These are already inside `async` action callbacks, so the change is straightforward: replace `resolveConfig(opts)` with `await resolveConfig(opts)` and make `resolveConfig` async.

### 5.7 Changes to `auth.service.ts`

No changes needed. The `applySecretsToEnvironment` function injects secrets into `process.env` before `createBlobServiceClient` reads them. The existing environment-variable-based auth flow remains intact.

---

## 6. Files to Create or Modify

| File | Action | Description |
|------|--------|-------------|
| `src/types/config.types.ts` | Modify | Add `AssetManagementBootstrap` and `AssetSecretsConfig` interfaces |
| `src/config/asset-management.loader.ts` | **Create** | Bootstrap detection, SDK integration, secrets injection |
| `src/config/config.loader.ts` | Modify | Make `loadConfig`/`resolveConfig` async; add AM layer to merge chain; generalize `mergeConfigSection` |
| `src/commands/config.commands.ts` | Modify | Await async `resolveConfig`; add AM bootstrap info to `config show` output |
| `src/commands/file.commands.ts` | Modify | Await async `resolveConfig` |
| `src/commands/folder.commands.ts` | Modify | Await async `resolveConfig` |
| `src/commands/edit.commands.ts` | Modify | Await async `resolveConfig` |
| `src/commands/meta.commands.ts` | Modify | Await async `resolveConfig` |
| `src/commands/tags.commands.ts` | Modify | Await async `resolveConfig` |
| `.env.example` | Modify | Add AM bootstrap variables section |
| `CLAUDE.md` | Modify | Add AM environment variables to the table |
| `docs/design/configuration-guide.md` | Modify | Add AM integration section |
| `package.json` | Modify | Add `@asset-management/client` dependency |

---

## 7. New Environment Variables (Bootstrap Only)

| Variable | Required | Description |
|----------|----------|-------------|
| `AZURE_FS_AM_DATABASE_URL` | No (enables AM integration when set) | PostgreSQL connection string for the Asset Management database |
| `AZURE_FS_AM_USER_KEY` | Yes (when AM enabled) | Unique application identifier for registration/tracking (e.g., `azure-fs-prod`) |
| `AZURE_FS_AM_REGISTRY` | Yes (when AM enabled) | Registry identifier (e.g., `github.com/NBG-AI/application_settings`) |
| `AZURE_FS_AM_CONFIG_KEY` | Yes (when AM enabled) | Asset key for non-sensitive config (e.g., `configs/prod/azure-fs.json`) |
| `AZURE_FS_AM_SECRETS_KEY` | Yes (when AM enabled) | Asset key for sensitive config (e.g., `secrets/prod/azure-fs-secrets.json`) |
| `AZURE_FS_AM_CACHE_TTL` | Yes (when AM enabled) | Cache TTL in milliseconds (e.g., `60000`) |

When `AZURE_FS_AM_DATABASE_URL` is **not set**, the tool behaves exactly as it does today. This ensures full backward compatibility.

---

## 8. Operational Prerequisites

Before the `azure-fs` tool can retrieve configuration from Asset Management, the following must be in place:

### 8.1 Registry Setup

1. Create or designate a Git repository to hold `azure-fs` configuration assets.
2. Organize configuration files by environment (e.g., `configs/dev/`, `configs/prod/`, `secrets/dev/`, `secrets/prod/`).
3. Register the repository in the Asset Management `registry-config.yaml`.

### 8.2 Database Setup

1. A PostgreSQL database must be available and registered in the Asset Management `database-config.yaml`.
2. The database tables must be initialized: `POST /api/database/:databaseName/init`.

### 8.3 Initial Sync

1. Synchronize the registry into the database: `POST /api/database/sync/:databaseName/:registryName`.
2. Verify assets are available: `GET /api/database/:databaseName/:registryName/asset`.

### 8.4 Ongoing Sync

Synchronization can be triggered:
- **Manually** via the REST API or local-tool CLI.
- **On a schedule** (e.g., cron job calling the sync endpoint).
- **Via Git webhooks** (push event triggers sync).

When a configuration file is updated in the Git repository and synchronized, the next retrieval by the `azure-fs` tool will automatically get the updated version (the SDK detects master/registered copy hash mismatches and updates transparently).

---

## 9. Security Considerations

### 9.1 Secrets in Git

Storing secrets (connection strings, SAS tokens) in a Git repository -- even a private one -- requires careful consideration:

- The Git repository must be **private** with restricted access.
- Consider using **encrypted secrets** in the repository with decryption at retrieval time.
- Alternatively, store only non-sensitive configuration in the registry and continue providing secrets via environment variables (a hybrid approach).

### 9.2 Database Access

- The PostgreSQL database connection string (`AZURE_FS_AM_DATABASE_URL`) grants access to all assets, including secrets.
- Use PostgreSQL roles with **read-only** permissions for the `azure-fs` client. It only needs `SELECT` on the `asset` table and `INSERT` on `asset_retrieval`.
- Use SSL/TLS for database connections in production (`?sslmode=require`).

### 9.3 Hybrid Approach (Recommended)

For maximum security, use a hybrid approach:

- **Non-sensitive configuration** (storage URLs, logging, retry, batch settings): managed entirely through Asset Management.
- **Sensitive secrets** (connection strings, SAS tokens): continue to be provided via environment variables or a secrets manager (Azure Key Vault), **not** stored in the Git registry.

In this approach, the `AZURE_FS_AM_SECRETS_KEY` bootstrap variable and the `secrets/` folder in the registry become unnecessary. The secrets continue to flow through `AZURE_STORAGE_CONNECTION_STRING` and `AZURE_STORAGE_SAS_TOKEN` environment variables as they do today.

---

## 10. Testing Strategy

| Test Scenario | Method |
|---------------|--------|
| AM not configured (no `AZURE_FS_AM_DATABASE_URL`) | Verify existing behavior is unchanged |
| AM configured with valid bootstrap | Verify config is retrieved from database and merged correctly |
| AM configured but database unreachable | Verify clear error message with exit code 2 |
| AM config + local overrides | Verify merge priority: AM < config file < env < CLI |
| AM secrets injection | Verify `process.env` is populated before auth service reads it |
| AM config asset missing | Verify `AssetNotFoundError` is caught and reported clearly |
| Cache behavior | Verify repeated calls within TTL don't hit the database |
| SAS token expiry from AM | Verify expiry is correctly read from secrets asset |

---

## 11. Migration Path

### Phase 1: Add AM Support (Non-Breaking)

- Implement the integration as described above.
- AM is opt-in via `AZURE_FS_AM_DATABASE_URL`.
- Existing users experience zero changes.

### Phase 2: Migrate Non-Sensitive Config

- Create the registry structure with `configs/<env>/azure-fs.json` files.
- Sync to database.
- Set bootstrap environment variables in target environments.
- Remove corresponding values from `.env` files and `.azure-fs.json` (AM provides them now).

### Phase 3: Evaluate Secrets Migration

- Decide whether to store secrets in the Asset Management registry (with appropriate security controls) or continue using environment variables.
- If migrating secrets: create `secrets/<env>/azure-fs-secrets.json` files, sync, and remove `AZURE_STORAGE_CONNECTION_STRING` / `AZURE_STORAGE_SAS_TOKEN` from `.env`.
- If keeping secrets in env: set `AZURE_FS_AM_SECRETS_KEY` to empty or do not set it, and continue with existing env-var-based secrets.

---

## 12. Summary

The Asset Management integration adds a new, lowest-priority configuration source to the existing merge chain. It is fully backward-compatible and opt-in. The integration requires:

- **6 new bootstrap environment variables** (only `AZURE_FS_AM_DATABASE_URL` is needed to enable the feature).
- **1 new source file** (`asset-management.loader.ts`).
- **Async propagation** through the config loading chain.
- **No changes** to the authentication service or existing validation logic.
- **Operational setup**: registry with config assets, initialized database, completed sync.

The recommended approach is a hybrid model where non-sensitive configuration is managed through Asset Management while secrets continue to be provided via environment variables or a dedicated secrets manager.
