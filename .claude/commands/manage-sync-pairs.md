---
description: Manage sync pair configurations (add, update, delete, list, run sync)
argument-hint: [list | add | update | delete | run]
allowed-tools: Skill(manage-sync-pairs), Read, Write, Bash, AskUserQuestion, Glob, Grep, Edit
---

# Manage Sync Pairs

You are managing sync pair configurations for the repo-sync tool.

Load and follow the `manage-sync-pairs` skill. The skill handles all CRUD operations on sync pairs and sync execution.

If the user provided an argument, pass it to the skill for direct routing:
- `list` - View all configured sync pairs
- `add` - Add a new sync pair
- `update` - Modify an existing sync pair
- `delete` - Remove a sync pair
- `run` - Execute sync operations

If no argument was provided, the skill will present an interactive menu.

$ARGUMENTS
