# Plan 009: Strip Generic Storage, Keep Repo-Sync, Rename to repo-sync

## Status: Completed

## Date: 2026-02-28

## Context

The project started as a generic Azure Blob Storage file system CLI tool (`azure-fs`) but evolved to focus primarily on repository replication/synchronization from GitHub and Azure DevOps to Azure Blob Storage. The generic file system operations (upload, download, edit, metadata, tags) were no longer needed. This plan removed all generic storage functionality, kept only the repo-sync features, and renamed the project to `repo-sync`.

## Changes Made

### Phase 1: Deleted Generic Storage Files (29 files)

**Commands (5 files):**
- `src/commands/file.commands.ts`
- `src/commands/folder.commands.ts`
- `src/commands/edit.commands.ts`
- `src/commands/meta.commands.ts`
- `src/commands/tags.commands.ts`

**API Routes (5 files):**
- `src/api/routes/file.routes.ts`
- `src/api/routes/folder.routes.ts`
- `src/api/routes/edit.routes.ts`
- `src/api/routes/meta.routes.ts`
- `src/api/routes/tags.routes.ts`

**API Controllers (5 files):**
- `src/api/controllers/file.controller.ts`
- `src/api/controllers/folder.controller.ts`
- `src/api/controllers/edit.controller.ts`
- `src/api/controllers/meta.controller.ts`
- `src/api/controllers/tags.controller.ts`

**Services (2 files):**
- `src/services/blob-filesystem.service.ts`
- `src/services/metadata.service.ts`

**Utils (4 files):**
- `src/utils/content-type.utils.ts`
- `src/utils/validation.utils.ts`
- `src/utils/stream.utils.ts`
- `src/utils/concurrency.utils.ts`

**Errors (4 files):**
- `src/errors/path.error.ts`
- `src/errors/blob-not-found.error.ts`
- `src/errors/metadata.error.ts`
- `src/errors/concurrent-modification.error.ts`

**Types (3 files):**
- `src/types/filesystem.types.ts`
- `src/types/metadata.types.ts`
- `src/types/patch.types.ts`

**Middleware (1 file):**
- `src/api/middleware/upload.middleware.ts`

### Phase 2: Deleted Old Test Scripts (11 files)

- `test_scripts/test-file-operations.ts`
- `test_scripts/test-folder-operations.ts`
- `test_scripts/test-edit-operations.ts`
- `test_scripts/test-metadata.ts`
- `test_scripts/test-tags.ts`
- `test_scripts/test-error-scenarios.ts`
- `test_scripts/test-bulk-upload.ts`
- `test_scripts/test-cli-integration.ts`
- `test_scripts/run-all-tests.ts`
- `test_scripts/test-config.ts`
- `test_scripts/test-config-source-tracking.ts`

### Phase 3: Updated Integration Files

- `src/index.ts` - Removed generic command imports, renamed CLI to "repo-sync"
- `src/commands/index.ts` - Removed generic command exports
- `src/api/routes/index.ts` - Removed generic route imports and registrations, removed BlobFileSystemService and MetadataService from ApiServices
- `src/api/server.ts` - Removed BlobFileSystemService and MetadataService instantiation
- `src/types/index.ts` - Removed generic type exports (filesystem, metadata, patch, BlobErrorCode, PathErrorCode, MetadataErrorCode)
- `src/types/errors.types.ts` - Removed BlobErrorCode, PathErrorCode, MetadataErrorCode enums
- `src/types/config.types.ts` - Removed `batch` section, renamed `AzureFsConfigFile` to `RepoSyncConfigFile`, removed `uploadMaxSizeMb` from api config
- `src/types/api-config.types.ts` - Removed `uploadMaxSizeMb` field
- `src/config/config.schema.ts` - Removed batch validation, removed uploadMaxSizeMb validation
- `src/config/config.loader.ts` - Removed batch env var loading, updated config file name to `.repo-sync.json`
- `src/services/path.service.ts` - Removed PathError dependency, kept only `normalizePath` and `joinPath`
- `src/utils/exit-codes.utils.ts` - Removed PathError and MetadataError references
- `src/api/middleware/error-handler.middleware.ts` - Removed BlobNotFoundError, PathError, MetadataError, ConcurrentModificationError imports and handling, removed MulterError handling
- `src/utils/console-commands.utils.ts` - Removed batch.concurrency and uploadMaxSizeMb from inspector
- `src/commands/config.commands.ts` - Renamed AzureFsConfigFile to RepoSyncConfigFile, updated file name references

### Phase 4: Renamed Project

- `package.json`: name → "repo-sync", description updated, bin → "repo-sync", removed multer and @types/multer dependencies, removed test script (old test file deleted)

### Phase 5: Updated Swagger/OpenAPI

- `src/api/swagger/config.ts` - Updated title to "Repo Sync API", description to focus on repo synchronization, removed generic storage tags (Files, Folders, Edit, Metadata, Tags), added "Repository" tag

### Phase 6: Updated Documentation

- `CLAUDE.md` - Complete rewrite with new project name and structure
- `cli-instructions.md` - Removed all generic storage commands, kept config and repo commands, renamed from azure-fs to repo-sync
- `api-instructions.md` - Removed all generic storage endpoints, kept health, repo, dev, hotkeys, renamed from azure-fs to repo-sync
- `docs/design/project-design.md` - Rewritten for repo-sync focus
- `docs/design/project-functions.md` - Rewritten for repo-sync focus
- `docs/design/configuration-guide.md` - Removed generic storage config variables
- `.env.example` - Removed AZURE_FS_BATCH_CONCURRENCY and AZURE_FS_API_UPLOAD_MAX_SIZE_MB, added GitHub/DevOps sections
- `Issues - Pending Items.md` - Removed generic storage items

## Environment Variable Prefix Decision

The `AZURE_FS_` prefix was **kept** for backward compatibility with deployed configurations. The rename is cosmetic (package/CLI name) but env vars stay stable to avoid breaking existing deployments.

## Verification

- `npm run build` compiles cleanly with no errors
- `npm install` succeeds with updated dependencies (multer removed)
- No dead imports or references to deleted files
