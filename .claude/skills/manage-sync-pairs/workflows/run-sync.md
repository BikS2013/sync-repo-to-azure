# Run Sync Workflow

<objective>
Execute sync pair replication via CLI, local Docker API, or Azure-hosted API. Display results in a summary table.
</objective>

<steps>

## Step 1: Ask Sync Target

Ask the user where to execute the sync:

1. **CLI** - Run directly via the local CLI tool
2. **Docker API** - Call the local Docker API at `localhost:4100`
3. **Azure API** - Call the Azure-hosted API (azurewebsites.net URL)

## Step 2: Ask Scope

Ask the user:
- **All pairs** - Sync all configured pairs
- **Specific pairs** - Select which pairs to sync (show list, accept names or indices)

## Step 3: Execute Sync

### Option A: CLI Execution

```bash
cd {project_root} && npx ts-node src/index.ts repo sync --json
```

For specific pairs (filter by name):
```bash
cd {project_root} && npx ts-node src/index.ts repo sync --names "pair1,pair2" --json
```

### Option B: Docker API (localhost:4100)

The API accepts both JSON and YAML request bodies. Set the `Content-Type` header accordingly:
- `application/json` for JSON bodies
- `application/yaml` for YAML bodies

```bash
# Sync all pairs (JSON)
curl -s -X POST http://localhost:4100/api/v1/repo/sync \
  -H "Content-Type: application/json" | jq .

# Sync with inline config (for specific pairs, JSON)
curl -s -X POST http://localhost:4100/api/v1/repo/sync \
  -H "Content-Type: application/json" \
  -d '{sync_pair_config_json}' | jq .

# Sync with YAML config file
curl -s -X POST http://localhost:4100/api/v1/repo/sync \
  -H "Content-Type: application/yaml" \
  --data-binary @sync-settings.yaml | jq .
```

When syncing specific pairs via Docker API:
1. Read the full config
2. Filter to only the selected pairs
3. Send as request body (JSON or YAML matching the config file format)

### Option C: Azure API

Ask user for the Azure API URL if not known. Expected format:
`https://{app-name}.azurewebsites.net`

```bash
# Sync all pairs (JSON)
curl -s -X POST https://{app-name}.azurewebsites.net/api/v1/repo/sync \
  -H "Content-Type: application/json" | jq .

# Sync with inline config (for specific pairs, JSON)
curl -s -X POST https://{app-name}.azurewebsites.net/api/v1/repo/sync \
  -H "Content-Type: application/json" \
  -d '{sync_pair_config_json}' | jq .

# Sync with YAML config file
curl -s -X POST https://{app-name}.azurewebsites.net/api/v1/repo/sync \
  -H "Content-Type: application/yaml" \
  --data-binary @sync-settings.yaml | jq .
```

**Important for API calls with inline config**: The config body must include full credentials (tokens, SAS tokens). Read these from the config file and include them in the request body. Use a temp file approach to avoid exposing tokens in command history. Match the file extension to determine format:

```bash
# For JSON configs
TEMP_FILE=$(mktemp /tmp/sync-request-XXXXXX.json)
cat > "$TEMP_FILE" << 'EOF'
{filtered sync pair config JSON}
EOF

curl -s -X POST {API_URL}/api/v1/repo/sync \
  -H "Content-Type: application/json" \
  -d @"$TEMP_FILE" | jq .

rm -f "$TEMP_FILE"
```

```bash
# For YAML configs
TEMP_FILE=$(mktemp /tmp/sync-request-XXXXXX.yaml)
cat > "$TEMP_FILE" << 'EOF'
syncPairs:
  - name: my-repo
    platform: github
    ...
EOF

curl -s -X POST {API_URL}/api/v1/repo/sync \
  -H "Content-Type: application/yaml" \
  --data-binary @"$TEMP_FILE" | jq .

rm -f "$TEMP_FILE"
```

## Step 4: Display Results

Parse the JSON response and display a results table:

| # | Name | Platform | Source | Status | Files | Size | Duration |
|---|------|----------|--------|--------|-------|------|----------|
| 1 | my-repo | github | owner/repo | Success | 142 | 2.3 MB | 4.2s |
| 2 | devops-repo | azure-devops | org/proj/repo | Failed | - | - | - |

### Result Fields
- **Status**: `Success` or `Failed` (with error message)
- **Files**: `successCount / totalFiles`
- **Size**: `totalBytes` formatted as human-readable (KB, MB, GB)
- **Duration**: `totalDurationMs` formatted as seconds

### Summary
After the table, show:
- Total pairs: X succeeded, Y failed
- Total duration

### On Failure
If any pairs failed, show the error message for each failed pair.

</steps>

<important>
- When sending config via API, use temp files to avoid token exposure in shell history
- Always clean up temp files after API calls
- For Docker API, verify the container is running first (curl health endpoint)
- For Azure API, verify connectivity first (curl health endpoint)
- Display human-readable file sizes and durations
</important>
