# Azure Blob Storage Write-Back Reference

<overview>
When sync pair configuration is hosted in Azure Blob Storage, changes must be written back via the Azure Blob REST API using a SAS token with write permissions.
</overview>

<config_source_detection>

## Detecting Config Source

1. Read the `AZURE_FS_SYNC_CONFIG_PATH` environment variable
2. If the value contains `.blob.core.windows.net` -> **Azure Blob mode**
3. If the value is a local file path -> **Local file mode** (use Write tool directly)
4. If not set -> **Error**: instruct user to set `AZURE_FS_SYNC_CONFIG_PATH`

</config_source_detection>

<format_detection>

## Format Detection

Detect the serialization format from the config file extension in `AZURE_FS_SYNC_CONFIG_PATH`:
- `.json` -> JSON format (pretty-printed with 2-space indentation)
- `.yaml` or `.yml` -> YAML format (using `js-yaml` `dump()` or equivalent)

Set the matching `Content-Type` header for Azure blob uploads:
- JSON: `Content-Type: application/json`
- YAML: `Content-Type: application/yaml`

</format_detection>

<local_file_write>

## Local File Write

For local config paths, use the Write tool directly to overwrite the file with the updated content. Use the appropriate format based on the file extension (JSON with 2-space indentation, or YAML).

</local_file_write>

<azure_blob_write>

## Azure Blob Write-Back

### Construct the Blob URL

The full blob URL comes from `AZURE_FS_SYNC_CONFIG_PATH`. For example:
```
https://myaccount.blob.core.windows.net/mycontainer/config/sync-settings.json
```

### SAS Token Selection

1. First try `AZURE_VENV_SAS_WRITE_TOKEN` (dedicated write token)
2. If not set, fall back to `AZURE_VENV_SAS_TOKEN` (may have write perms)
3. If neither is set, error with instructions to configure a SAS token

### Upload via curl

```bash
# Write updated JSON to temp file
TEMP_FILE=$(mktemp /tmp/sync-settings-XXXXXX.json)
cat > "$TEMP_FILE" << 'HEREDOC_EOF'
{updated JSON content here}
HEREDOC_EOF

# Determine SAS token
SAS_TOKEN="${AZURE_VENV_SAS_WRITE_TOKEN:-$AZURE_VENV_SAS_TOKEN}"

# Determine Content-Type from file extension
case "${AZURE_FS_SYNC_CONFIG_PATH}" in
  *.yaml|*.yml) CONTENT_TYPE="application/yaml" ;;
  *)            CONTENT_TYPE="application/json" ;;
esac

# Upload to Azure Blob Storage
curl -sf -X PUT "${AZURE_FS_SYNC_CONFIG_PATH}?${SAS_TOKEN}" \
  -H "x-ms-blob-type: BlockBlob" \
  -H "Content-Type: ${CONTENT_TYPE}" \
  -H "x-ms-version: 2022-11-02" \
  --data-binary "@${TEMP_FILE}"

# Check result
UPLOAD_STATUS=$?

# Clean up temp file
rm -f "$TEMP_FILE"

# Report result
if [ $UPLOAD_STATUS -eq 0 ]; then
  echo "Upload successful"
else
  echo "Upload failed with status $UPLOAD_STATUS"
fi
```

### Error Handling

- If curl returns HTTP 403: the SAS token lacks write permissions
  - Instruct user to set `AZURE_VENV_SAS_WRITE_TOKEN` with `sp=rwc` (read+write+create) permissions
  - Do NOT silently fall back or use defaults
- If curl returns HTTP 404: the container or path does not exist
- If curl returns any other error: report the full error message

### Post-Write Notes

- The azure-venv watcher (if running) picks up changes on the next poll cycle
- Default poll interval is 30 seconds (`AZURE_VENV_POLL_INTERVAL`)
- No manual refresh needed - changes propagate automatically

</azure_blob_write>

<sas_token_requirements>

## SAS Token Permission Requirements

For write-back to work, the SAS token needs these minimum permissions:
- **Read (r)**: to read existing config
- **Write (w)**: to overwrite the blob
- **Create (c)**: to create the blob if it doesn't exist

Example SAS token parameter: `sp=rwc`

The `AZURE_VENV_SAS_WRITE_TOKEN` env var should NOT include the leading `?`.

</sas_token_requirements>
