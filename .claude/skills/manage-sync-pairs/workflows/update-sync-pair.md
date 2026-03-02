# Update Sync Pair Workflow

<objective>
Select an existing sync pair, modify specific fields, validate, and save changes back to the config source.
</objective>

<steps>

## Step 1: List Current Pairs

Execute the list workflow (reference `workflows/list-sync-pairs.md`) to display all pairs with their index numbers.

If there are no sync pairs configured, inform the user and suggest using the add workflow instead.

## Step 2: Ask Which Pair to Update

Ask the user to select a sync pair by:
- **Index number** (from the table)
- **Name** (exact match)

## Step 3: Show Current Values

Display the selected pair's current values in a readable format with masked tokens:

```
Sync Pair: my-github-repo
Platform: github

Source:
  repo: owner/repo
  ref: main
  token: ****...x4f2
  tokenExpiry: 2026-06-01T00:00:00Z

Destination:
  accountUrl: https://myaccount.blob.core.windows.net/
  container: repos
  folder: github/my-repo
  sasToken: ****...ac3d
  sasTokenExpiry: 2026-12-31T00:00:00Z
```

## Step 4: Collect Changes

Ask the user which fields to update. Accept changes in any of these ways:
- **Specific field**: "Change ref to develop"
- **Multiple fields**: "Update token to ghp_newtoken and tokenExpiry to 2027-01-01T00:00:00Z"
- **Interactive**: Ask field by field if the user prefers

### Updatable Fields

**Common fields:**
- `name` (must remain unique)

**Source fields** (platform-dependent):
- GitHub: `repo`, `ref`, `token`, `tokenExpiry`
- DevOps: `organization`, `project`, `repository`, `ref`, `versionType`, `resolveLfs`, `pat`, `patExpiry`, `orgUrl`

**Destination fields:**
- `accountUrl`, `container`, `folder`, `sasToken`, `sasTokenExpiry`

**Not updatable:**
- `platform` (changing platform requires delete + add)

## Step 5: Validate Changes

Apply the same validation rules as the add workflow:
1. If `name` changed, verify uniqueness
2. Required fields must remain non-empty
3. GitHub `repo` must match `owner/repo` format
4. ISO 8601 format for expiry dates

## Step 6: Apply and Save

1. Read current config from source
2. Find the pair by original name
3. Apply the field changes
4. **Detect format from config file extension:**
   - `.json` -> Serialize as pretty-printed JSON (2-space indent)
   - `.yaml` or `.yml` -> Serialize as YAML
5. Write back (local file or Azure blob per `references/azure-blob-write.md`), setting the appropriate `Content-Type` header (`application/json` or `application/yaml`) for Azure blob uploads

## Step 7: Confirm

Show:
- Summary of changes made (old value -> new value, with tokens masked)
- Where the config was saved

</steps>

<important>
- Always show current values before asking for changes
- Platform cannot be changed - instruct user to delete and re-add instead
- If updating a name, ensure the new name is unique
- Mask all token values in display (show only last 4 characters)
- After update, re-validate the entire config to catch any inconsistencies
</important>
