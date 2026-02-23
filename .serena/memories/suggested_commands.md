# Suggested Commands

## Build
```bash
npm run build          # Compile TypeScript to dist/
npm run clean          # Remove dist/ directory
```

## Run
```bash
npm run dev            # Run via ts-node (development)
npm start              # Run compiled dist/index.js
npx azure-fs --help    # Show all commands
```

## Test (requires live Azure Storage account with env vars set)
```bash
npx ts-node test_scripts/run-all-tests.ts           # Run all 9 test scripts
npx ts-node test_scripts/test-file-operations.ts     # Run individual test
npx ts-node test_scripts/test-folder-operations.ts
npx ts-node test_scripts/test-edit-operations.ts
npx ts-node test_scripts/test-metadata.ts
npx ts-node test_scripts/test-tags.ts
npx ts-node test_scripts/test-config.ts
npx ts-node test_scripts/test-auth.ts
npx ts-node test_scripts/test-error-scenarios.ts
npx ts-node test_scripts/test-cli-integration.ts
```

## Required Environment Variables
```bash
export AZURE_STORAGE_ACCOUNT_URL="https://<account>.blob.core.windows.net"
export AZURE_STORAGE_CONTAINER_NAME="<container>"
export AZURE_FS_AUTH_METHOD="connection-string"  # or "sas-token" or "azure-ad"
export AZURE_STORAGE_CONNECTION_STRING="<conn-string>"  # if using connection-string
export AZURE_STORAGE_SAS_TOKEN="<token>"                # if using sas-token
```

## CLI Commands
```bash
# Configuration
azure-fs config init
azure-fs config show --json
azure-fs config validate --json

# File operations
azure-fs upload <local> <remote> --metadata key=value --json
azure-fs download <remote> [local] --json
azure-fs delete <remote> --json
azure-fs replace <local> <remote> --json
azure-fs info <remote> --json
azure-fs exists <path> [--type file|folder] --json

# Folder operations
azure-fs ls <path> [--recursive] --json
azure-fs mkdir <path> --json
azure-fs rmdir <path> --json

# Edit operations
azure-fs edit <remote> --json
azure-fs edit <remote> --upload --local <path> --etag <etag> --json
azure-fs patch <remote> --find <text> --replace <text> [--regex] --json
azure-fs append <remote> --content <text> [--position start|end] --json

# Metadata
azure-fs meta set <remote> key=value [key=value...] --json
azure-fs meta get <remote> --json
azure-fs meta update <remote> key=value --json
azure-fs meta delete <remote> key [key...] --json

# Tags
azure-fs tags set <remote> key=value [key=value...] --json
azure-fs tags get <remote> --json
azure-fs tags query "<filter>" --json
```

## System Commands (macOS / Darwin)
- `git` — version control
- `npm` — package management
- `npx` — run package binaries
- `ls`, `find`, `grep` — file system
