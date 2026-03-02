# List Sync Pairs Workflow

<objective>
Display all configured sync pairs in a formatted table with masked credentials and token status.
</objective>

<steps>

## Step 1: Get Sync Pair Data

**Preferred method** - Use the CLI tool which handles all config resolution:

```bash
cd {project_root} && source .venv/bin/activate 2>/dev/null; npx ts-node src/index.ts repo list-sync-pairs --json
```

If the CLI command is not available or fails, fall back to reading the config directly:

1. Read `AZURE_FS_SYNC_CONFIG_PATH` env var to find the config file
2. If it's a local path, read the file directly with the Read tool
3. If it's a URL, use curl to fetch it (append `AZURE_VENV_SAS_TOKEN` for Azure blob URLs)
4. Parse the JSON content

## Step 2: Display Results

Present the sync pairs in a markdown table:

| # | Name | Platform | Source | Ref | Destination | Source Token | Dest SAS Token |
|---|------|----------|--------|-----|-------------|--------------|----------------|
| 1 | my-repo | github | owner/repo | main | container/folder | valid | expiring-soon |
| 2 | devops-repo | azure-devops | org/project/repo | develop | container/folder | expired | valid |

### Column Details

- **#**: 1-based index for use in update/delete workflows
- **Name**: The sync pair's unique name
- **Platform**: `github` or `azure-devops`
- **Source**: For GitHub: `owner/repo`. For DevOps: `organization/project/repository`
- **Ref**: Branch/tag/commit or `(default)` if not specified
- **Destination**: `container/folder` format
- **Source Token / Dest SAS Token**: One of `valid`, `expiring-soon`, `expired`, `no-expiry-set`

### Token Status Rules

- `valid`: Expiry date is more than 7 days away
- `expiring-soon`: Expiry date is within 7 days
- `expired`: Expiry date has passed
- `no-expiry-set`: No expiry date configured

## Step 3: Summary

After the table, show:
- Total number of pairs
- Config source path
- Any warnings about expiring/expired tokens

</steps>

<important>
- NEVER display actual token values - they must always be masked
- Always show the config source location so the user knows where data comes from
- Highlight any token expiry warnings prominently
</important>
