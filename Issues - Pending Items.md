# Issues - Pending Items

## Pending

_No pending items at this time._

---

## Completed

### Feature - Batch Upload with Parallel Uploads (IMPLEMENTED)

**Detected**: 2026-02-23 (performance testing revealed ~67s for 61 sequential uploads)
**Implemented**: 2026-02-23
**Plan**: `docs/design/plan-003-batch-upload-parallel.md`

**Resolution**: Added `upload-dir` CLI command with configurable parallelism (`batch.concurrency` / `AZURE_FS_BATCH_CONCURRENCY`). New `uploadDirectory()` method in `BlobFileSystemService` walks a local directory recursively, skips excluded patterns, and uploads files in parallel using a zero-dependency `parallelLimit()` utility. Expected 5x-13x speedup over sequential per-file CLI invocations.

---

### P2 - Unexported Utility: `streamToBuffer` (FIXED)

**Detected**: 2026-02-23 (Serena analysis)
**Fixed**: 2026-02-23
**Location**: `src/utils/stream.utils.ts`

**Resolution**: Removed `export` keyword from `streamToBuffer`. It is now a module-private function, only consumed internally by `streamToString` in the same file.

---

### P1 - Architectural Inconsistency: Service Constructor Patterns (FIXED)

**Detected**: 2026-02-23 (Serena analysis)
**Fixed**: 2026-02-23
**Location**: `src/services/metadata.service.ts`, `src/commands/meta.commands.ts`, `src/commands/tags.commands.ts`

**Resolution**: Refactored `MetadataService` constructor to accept `(config: ResolvedConfig, logger: Logger)` — matching the `BlobFileSystemService` pattern. The service now creates its own `ContainerClient` and `RetryConfig` internally. Removed boilerplate `createContainerClient()` and `retryConfigFromResolved()` calls from `meta.commands.ts` and `tags.commands.ts`. Updated dependency graph in `docs/design/project-design.md`.
