# Plan 003: Batch Upload Command with Parallel Uploads

**Date**: 2026-02-23
**Status**: Implemented

## Context

Performance testing of the azure-fs tool revealed that uploading 61 files sequentially takes ~67s (avg 1,100ms/file). The bottleneck is **per-invocation overhead** (~1s ts-node startup per CLI call), not data transfer. A 70-byte file takes as long as a 97KB file.

The fix: a single `upload-dir` command that uploads an entire directory tree in one process invocation with configurable parallelism.

## Changes Implemented

### 1. New types (`src/types/filesystem.types.ts`)
- `UploadDirectoryResult` — aggregate result with file count, byte count, timing, per-file details
- `UploadDirectoryFileResult` — per-file result with path, size, duration, success/error

### 2. Concurrency utility (`src/utils/concurrency.utils.ts`)
- `parallelLimit<T>(tasks, concurrency)` — Promise-based semaphore, zero external dependencies
- Worker pool pattern: spawns N workers that pull from a shared task queue

### 3. Batch configuration (`batch.concurrency`)
- Added `batch: { concurrency: number }` to `ResolvedConfig` and `AzureFsConfigFile`
- Schema validation: must be a positive integer, no fallback/default
- Environment variable: `AZURE_FS_BATCH_CONCURRENCY`
- Config file key: `batch.concurrency`
- CLI override: `--concurrency <n>` on `upload-dir` command only

### 4. `uploadDirectory()` method (`src/services/blob-filesystem.service.ts`)
- Recursive directory walk using `fs.readdirSync` with `withFileTypes`
- Exclusion by file/directory name (not full path)
- Builds task array of upload closures
- Executes via `parallelLimit` with configured concurrency
- Per-file error isolation (one failure doesn't abort others)
- Returns aggregate `UploadDirectoryResult`

### 5. `upload-dir` CLI command (`src/commands/file.commands.ts`)
```
azure-fs upload-dir <local-dir> <remote-prefix> [options]
  --concurrency <n>     Max parallel uploads (overrides batch.concurrency config)
  --exclude <patterns>  Comma-separated exclusion patterns (e.g., node_modules,.git,dist)
  --metadata key=value  Metadata to apply to all uploaded files
  --json                Structured JSON output
```

### 6. Updated test script (`test_scripts/test-bulk-upload.ts`)
- Supports three modes: `seq`, `batch`, `both`
- Compares sequential per-file CLI invocation vs single `upload-dir` command
- Reports speedup factor and throughput comparison

## Files Modified/Created

| File | Action |
|------|--------|
| `src/types/filesystem.types.ts` | Added `UploadDirectoryResult`, `UploadDirectoryFileResult` |
| `src/types/config.types.ts` | Added `batch.concurrency` to `ResolvedConfig` and `AzureFsConfigFile` |
| `src/types/index.ts` | Exported new types |
| `src/config/config.schema.ts` | Added batch config validation |
| `src/config/config.loader.ts` | Added `AZURE_FS_BATCH_CONCURRENCY` env var loading, batch merge |
| `src/utils/concurrency.utils.ts` | **New** — `parallelLimit()` utility |
| `src/services/blob-filesystem.service.ts` | Added `uploadDirectory()` and `_collectLocalFiles()` |
| `src/commands/file.commands.ts` | Added `upload-dir` command |
| `CLAUDE.md` | Documented `upload-dir`, env var, project structure |
| `.env.example` | Added `AZURE_FS_BATCH_CONCURRENCY` |
| `.env` | Added `AZURE_FS_BATCH_CONCURRENCY=10` |
| `.azure-fs.json.example` | Added `batch.concurrency` field |
| `docs/design/configuration-guide.md` | Added `batch.concurrency` parameter docs |
| `docs/design/project-design.md` | Added `concurrency.utils` to module table |
| `docs/design/project-functions.md` | Marked batch upload and recursive upload as implemented |
| `test_scripts/test-bulk-upload.ts` | Rewritten for comparative performance testing |
| `Issues - Pending Items.md` | Logged feature as completed |

## Expected Performance

- Sequential: ~67s for 61 files (1,100ms/file overhead)
- Batch with concurrency=10: ~5-15s (eliminates per-invocation overhead, parallelizes network I/O)
- Speedup: 5x-13x depending on network latency and file count

## Verification

1. `npm run build` — zero errors
2. `azure-fs upload-dir --help` — shows command with all options
3. `azure-fs upload-dir . test-prefix/ --exclude node_modules,.git,dist --json` — uploads project
4. `npx ts-node test_scripts/test-bulk-upload.ts batch` — runs batch test only
5. `npx ts-node test_scripts/test-bulk-upload.ts both` — compares sequential vs batch
