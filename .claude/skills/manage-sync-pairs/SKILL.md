---
name: manage-sync-pairs
description: Manage sync pair configurations for the repo-sync tool. CRUD operations on sync pairs stored in local files or Azure Blob Storage, plus run sync operations via CLI, Docker API, or Azure API.
triggers:
  - manage sync pairs
  - sync pair
  - add sync pair
  - delete sync pair
  - update sync pair
  - list sync pairs
  - run sync
  - sync settings
  - sync config
---

<essential_principles>

## Core Rules

1. **Never display raw tokens** - Always mask credentials. Show only last 4 characters: `****...x4f2`
2. **No fallback values** - If a required env var or config is missing, raise a clear error with instructions
3. **Validate before saving** - Apply all schema validation rules before writing any changes
4. **Confirm destructive actions** - Require explicit name confirmation before deleting sync pairs
5. **Write back to source** - Changes must be saved to wherever the config is hosted (local file or Azure Blob)

## Config Source Resolution

The sync pair config location is determined by `AZURE_FS_SYNC_CONFIG_PATH`:
- **Azure Blob URL** (contains `.blob.core.windows.net`): Read/write via REST API with SAS token
- **Local file path**: Read/write directly via file tools
- **Not set**: Error - instruct user to set this env var

## Reference Files

- `references/sync-pair-schema.md` - Type definitions, validation rules, example config
- `references/azure-blob-write.md` - How to write changes back to Azure Blob Storage

</essential_principles>

<intake>

## What would you like to do?

When the user invokes this skill, present these options:

1. **List** - View all configured sync pairs
2. **Add** - Add a new sync pair (GitHub or Azure DevOps)
3. **Update** - Modify an existing sync pair
4. **Delete** - Remove a sync pair
5. **Run** - Execute sync operations

If the user provided an argument (e.g., `/manage-sync-pairs list`), route directly to the matching workflow.

</intake>

<routing>

## Workflow Routing

| User Intent | Workflow File | Description |
|-------------|---------------|-------------|
| list, show, view, display | `workflows/list-sync-pairs.md` | Display pairs in table format |
| add, create, new | `workflows/add-sync-pair.md` | Interactive add with validation |
| update, edit, modify, change | `workflows/update-sync-pair.md` | Select pair, modify fields, save |
| delete, remove | `workflows/delete-sync-pair.md` | Select pair, confirm, remove |
| run, sync, execute | `workflows/run-sync.md` | Execute via CLI/Docker/Azure API |

### Routing Rules

1. Match user intent to the closest workflow keyword
2. If the argument contains a known keyword, route directly (skip the intake menu)
3. If ambiguous, present the intake menu
4. After completing any workflow, ask if the user wants to perform another operation

</routing>

<file_index>

## Skill File Index

```
manage-sync-pairs/
  SKILL.md                              # This file - routing and principles
  workflows/
    list-sync-pairs.md                  # List pairs in table format
    add-sync-pair.md                    # Interactive add (GitHub or DevOps)
    update-sync-pair.md                 # Select, modify, validate, save
    delete-sync-pair.md                 # Select, confirm, remove, save
    run-sync.md                         # Execute via CLI/Docker/Azure API
  references/
    sync-pair-schema.md                 # Full type definitions + validation rules
    azure-blob-write.md                 # How to write JSON back to Azure Blob Storage
```

</file_index>
