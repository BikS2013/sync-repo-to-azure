# Delete Sync Pair Workflow

<objective>
Select a sync pair, confirm deletion, remove it from the config, and save changes.
</objective>

<steps>

## Step 1: List Current Pairs

Execute the list workflow (reference `workflows/list-sync-pairs.md`) to display all pairs with their index numbers.

If there are no sync pairs configured, inform the user there is nothing to delete.

## Step 2: Ask Which Pair to Delete

Ask the user to select a sync pair by:
- **Index number** (from the table)
- **Name** (exact match)

## Step 3: Show Pair Details

Display the selected pair's details (with masked tokens) so the user can verify they're deleting the right one.

## Step 4: Confirm Deletion

**Require explicit confirmation** by asking the user to type the pair's name:

> To confirm deletion, please type the sync pair name: `my-github-repo`

### Special Warnings

- **Last pair**: If this is the only sync pair, warn:
  > "This is the last sync pair in the configuration. Deleting it will leave the config with an empty syncPairs array. Note: the CLI validation requires at least one sync pair. Are you sure?"

  If the user confirms, delete the pair but note that the resulting config `{ "syncPairs": [] }` will fail CLI validation until a new pair is added.

## Step 5: Remove and Save

1. Read current config from source
2. Find and remove the pair by name
3. **Detect format from config file extension:**
   - `.json` -> Serialize as pretty-printed JSON (2-space indent)
   - `.yaml` or `.yml` -> Serialize as YAML
4. Write back (local file or Azure blob per `references/azure-blob-write.md`), setting the appropriate `Content-Type` header (`application/json` or `application/yaml`) for Azure blob uploads

## Step 6: Confirm

Show:
- Name of the deleted pair
- Remaining number of pairs
- Where the config was saved

</steps>

<important>
- ALWAYS require explicit name confirmation before deleting
- Warn prominently when deleting the last sync pair
- Never delete without user confirmation, even if the user seems certain
- After deletion, show the updated pair count
</important>
