# Sync Pair Schema Reference

<schema>

## Top-Level Structure

```typescript
interface SyncPairConfig {
  syncPairs: SyncPair[];  // Array of sync pair definitions (must not be empty)
}

type SyncPair = GitHubSyncPair | DevOpsSyncPair;
```

## GitHub Sync Pair

```typescript
interface GitHubSyncPair {
  name: string;              // Unique identifier for this sync pair (required)
  platform: "github";        // Discriminator (required, literal)
  source: GitHubSyncPairSource;
  destination: SyncPairDestination;
}

interface GitHubSyncPairSource {
  repo: string;              // "owner/repo" format (required)
  ref?: string;              // Branch, tag, or commit SHA (optional, defaults to default branch)
  token?: string;            // GitHub PAT (required for private repos)
  tokenExpiry?: string;      // ISO 8601 date (optional, warns 7 days before expiry)
}
```

## Azure DevOps Sync Pair

```typescript
interface DevOpsSyncPair {
  name: string;              // Unique identifier for this sync pair (required)
  platform: "azure-devops";  // Discriminator (required, literal)
  source: DevOpsSyncPairSource;
  destination: SyncPairDestination;
}

interface DevOpsSyncPairSource {
  organization: string;      // Azure DevOps org name (required)
  project: string;           // Project name (required)
  repository: string;        // Repository name or GUID (required)
  ref?: string;              // Version identifier (optional)
  versionType?: "branch" | "tag" | "commit";  // How to interpret ref (optional)
  resolveLfs?: boolean;      // Resolve LFS pointers (optional)
  pat: string;               // Personal Access Token (required)
  patExpiry?: string;        // ISO 8601 date (optional, warns 7 days before expiry)
  orgUrl?: string;           // Override org URL e.g. https://dev.azure.com/myorg (optional)
}
```

## Destination (shared)

```typescript
interface SyncPairDestination {
  accountUrl: string;        // e.g. https://myaccount.blob.core.windows.net/ (required)
  container: string;         // Container name (required)
  folder: string;            // Destination folder path, use "/" for root (required)
  sasToken: string;          // SAS token for authentication (required)
  sasTokenExpiry?: string;   // ISO 8601 date (optional, warns before expiry)
}
```

</schema>

<validation_rules>

## Validation Rules

Applied by `sync-pair.loader.ts` during load:

1. **Config must be a non-null object** with a `syncPairs` array property
2. **syncPairs array must not be empty**
3. **Each sync pair must have:**
   - `name` (string, required) - should be unique across all pairs
   - `platform` (must be exactly `"github"` or `"azure-devops"`)
   - `source` (object, required)
   - `destination` (object, required)
4. **Destination required fields (all strings):** `accountUrl`, `container`, `folder`, `sasToken`
5. **GitHub source required:** `repo` (string, "owner/repo" format)
6. **DevOps source required (all strings):** `organization`, `project`, `repository`, `pat`
7. **Token expiry dates** must be valid ISO 8601 format when provided
8. **Supported file formats:** `.json`, `.yaml`, `.yml`

</validation_rules>

<example_config>

## Example sync-settings.json

```json
{
  "syncPairs": [
    {
      "name": "my-github-repo",
      "platform": "github",
      "source": {
        "repo": "owner/repo-name",
        "ref": "main",
        "token": "ghp_xxxxxxxxxxxx",
        "tokenExpiry": "2026-06-01T00:00:00Z"
      },
      "destination": {
        "accountUrl": "https://myaccount.blob.core.windows.net/",
        "container": "repos",
        "folder": "github/my-repo",
        "sasToken": "sv=2022-11-02&ss=b&srt=co&sp=rwdlac...",
        "sasTokenExpiry": "2026-12-31T00:00:00Z"
      }
    },
    {
      "name": "my-devops-repo",
      "platform": "azure-devops",
      "source": {
        "organization": "myorg",
        "project": "MyProject",
        "repository": "my-repo",
        "ref": "main",
        "versionType": "branch",
        "pat": "xxxxxxxxxxxxxxxxxxxx",
        "patExpiry": "2026-06-01T00:00:00Z",
        "orgUrl": "https://dev.azure.com/myorg"
      },
      "destination": {
        "accountUrl": "https://myaccount.blob.core.windows.net/",
        "container": "repos",
        "folder": "devops/my-repo",
        "sasToken": "sv=2022-11-02&ss=b&srt=co&sp=rwdlac...",
        "sasTokenExpiry": "2026-12-31T00:00:00Z"
      }
    }
  ]
}
```

## Example sync-settings.yaml

```yaml
syncPairs:
  - name: my-github-repo
    platform: github
    source:
      repo: owner/repo-name
      ref: main
      token: ghp_xxxxxxxxxxxx
      tokenExpiry: "2026-06-01T00:00:00Z"
    destination:
      accountUrl: https://myaccount.blob.core.windows.net/
      container: repos
      folder: github/my-repo
      sasToken: sv=2022-11-02&ss=b&srt=co&sp=rwdlac...
      sasTokenExpiry: "2026-12-31T00:00:00Z"

  - name: my-devops-repo
    platform: azure-devops
    source:
      organization: myorg
      project: MyProject
      repository: my-repo
      ref: main
      versionType: branch
      pat: xxxxxxxxxxxxxxxxxxxx
      patExpiry: "2026-06-01T00:00:00Z"
      orgUrl: https://dev.azure.com/myorg
    destination:
      accountUrl: https://myaccount.blob.core.windows.net/
      container: repos
      folder: devops/my-repo
      sasToken: sv=2022-11-02&ss=b&srt=co&sp=rwdlac...
      sasTokenExpiry: "2026-12-31T00:00:00Z"
```

</example_config>
