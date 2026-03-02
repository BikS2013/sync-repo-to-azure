# Add Sync Pair Workflow

<objective>
Interactively collect sync pair configuration, validate it, and append it to the config file (local or Azure Blob).
</objective>

<steps>

## Step 1: Ask Platform

Ask the user which platform:
- **github** - GitHub repository
- **azure-devops** - Azure DevOps repository

## Step 2: Collect Source Fields

### For GitHub:
| Field | Required | Description | Example |
|-------|----------|-------------|---------|
| name | Yes | Unique sync pair name | `my-github-repo` |
| source.repo | Yes | Repository in owner/repo format | `microsoft/vscode` |
| source.ref | No | Branch, tag, or commit SHA | `main` |
| source.token | No* | GitHub PAT (* required for private repos) | `ghp_xxxx...` |
| source.tokenExpiry | No | ISO 8601 expiry date | `2026-06-01T00:00:00Z` |

### For Azure DevOps:
| Field | Required | Description | Example |
|-------|----------|-------------|---------|
| name | Yes | Unique sync pair name | `my-devops-repo` |
| source.organization | Yes | Azure DevOps org name | `myorg` |
| source.project | Yes | Project name | `MyProject` |
| source.repository | Yes | Repository name | `my-repo` |
| source.ref | No | Version identifier | `main` |
| source.versionType | No | branch, tag, or commit | `branch` |
| source.resolveLfs | No | Resolve LFS pointers | `false` |
| source.pat | Yes | Personal Access Token | `xxxx...` |
| source.patExpiry | No | ISO 8601 expiry date | `2026-06-01T00:00:00Z` |
| source.orgUrl | No | Org URL override | `https://dev.azure.com/myorg` |

## Step 3: Collect Destination Fields

| Field | Required | Description | Example |
|-------|----------|-------------|---------|
| destination.accountUrl | Yes | Storage account URL | `https://myaccount.blob.core.windows.net/` |
| destination.container | Yes | Container name | `repos` |
| destination.folder | Yes | Destination folder (/ for root) | `github/my-repo` |
| destination.sasToken | Yes | SAS token | `sv=2022-11-02&ss=b...` |
| destination.sasTokenExpiry | No | ISO 8601 expiry date | `2026-12-31T00:00:00Z` |

**Tip:** If the user has existing sync pairs, offer to reuse destination fields from an existing pair.

## Step 4: Validate

Before saving, validate:
1. **Name uniqueness**: Check that `name` doesn't already exist in the config
2. **Required fields**: All required fields are present and non-empty strings
3. **GitHub repo format**: Must match `owner/repo` pattern (contains exactly one `/`)
4. **Platform value**: Must be exactly `"github"` or `"azure-devops"`
5. **ISO 8601 dates**: If expiry dates are provided, validate format

If validation fails, show the specific error and ask the user to correct it.

## Step 5: Read Current Config

Follow the config source detection from `references/azure-blob-write.md`:
1. Read `AZURE_FS_SYNC_CONFIG_PATH` env var
2. Load current config (local file or Azure blob)
3. Parse as JSON or YAML (based on file extension)

If the config file doesn't exist yet, start with `{ "syncPairs": [] }`.

## Step 6: Append and Save

1. Build the new sync pair object following the schema in `references/sync-pair-schema.md`
2. Append to the `syncPairs` array
3. **Detect format from config file extension:**
   - `.json` -> Serialize as pretty-printed JSON (2-space indent)
   - `.yaml` or `.yml` -> Serialize as YAML
4. Write back:
   - **Local file**: Use the Write tool to overwrite the file
   - **Azure Blob**: Follow the curl upload procedure in `references/azure-blob-write.md`, setting `Content-Type` to `application/json` or `application/yaml` based on the file extension

## Step 7: Confirm

Show the user:
- The newly added sync pair (with masked tokens)
- Total number of pairs now configured
- Where the config was saved

</steps>

<important>
- Always validate name uniqueness before saving
- Never display raw token values - mask them as `****...last4chars`
- If the user provides a token with a leading `?`, strip it (common SAS token mistake)
- Suggest setting expiry dates for tokens when the user doesn't provide them
</important>
