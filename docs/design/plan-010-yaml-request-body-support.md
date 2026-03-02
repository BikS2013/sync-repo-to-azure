# Plan 010: Add YAML Request Body Support to API + Update Skills

**Date**: 2026-03-02
**Status**: Implemented

---

## Context

The repo-sync tool already supports JSON and YAML for **reading** sync pair config files (CLI + `sync-pair.loader.ts` using `js-yaml`). However, the REST API only accepted `application/json` request bodies — sending YAML to `POST /api/v1/repo/sync` failed. The manage-sync-pairs skill also hardcoded JSON serialization for write-back. This plan adds full JSON+YAML parity across CLI, API, and skills.

**Before:**

| Area | JSON | YAML |
|------|------|------|
| CLI config reading | Yes | Yes |
| API request bodies | Yes | No |
| API Swagger docs | Yes | No |
| Skill write-back | Yes | No |

**After:**

| Area | JSON | YAML |
|------|------|------|
| CLI config reading | Yes | Yes |
| API request bodies | Yes | Yes |
| API Swagger docs | Yes | Yes |
| Skill write-back | Yes | Yes |

---

## Implementation Steps

### 1. Create YAML body parser middleware (new file)

**File:** `src/api/middleware/yaml-body-parser.middleware.ts`

- Uses `express.text()` for content types `application/yaml`, `application/x-yaml`, `text/yaml` (limit: `10mb` matching JSON parser)
- Parses text body with `yaml.load()` from `js-yaml` (already installed `^4.1.1`)
- Replaces `req.body` with parsed object
- On parse failure, returns 400 with `YAML_PARSE_ERROR` code and parse error details
- Passes through non-YAML requests untouched
- Follows existing middleware patterns from `error-handler.middleware.ts`

### 2. Register middleware in server.ts

**File:** `src/api/server.ts`

Added after `express.json()`:
```typescript
app.use(express.json({ limit: "10mb" }));          // existing
app.use(createYamlBodyParserMiddleware("10mb"));    // new
```

Express routes by content-type, so JSON still goes through `express.json()` and YAML through the new middleware.

### 3. Update Swagger annotations for POST /api/v1/repo/sync

**File:** `src/api/routes/repo.routes.ts`

- Added `application/yaml` content type alongside `application/json` in the requestBody spec (same schema)
- Updated endpoint description to mention YAML support
- Schema definition stays identical — only the content-type key is duplicated

### 4. Update skill workflow files for format-aware serialization

**Files:**
- `.claude/skills/manage-sync-pairs/workflows/add-sync-pair.md`
- `.claude/skills/manage-sync-pairs/workflows/update-sync-pair.md`
- `.claude/skills/manage-sync-pairs/workflows/delete-sync-pair.md`
- `.claude/skills/manage-sync-pairs/workflows/run-sync.md`

**Changes:**
- **add/update/delete**: In the save step, detect config file extension (`.json` vs `.yaml`/`.yml`). Serialize accordingly — JSON with 2-space indent or YAML. Set matching `Content-Type` header for Azure blob uploads.
- **run-sync**: Added YAML curl examples for Docker API and Azure API calls.

### 5. Update skill reference files

**File:** `.claude/skills/manage-sync-pairs/references/azure-blob-write.md`
- Added format detection section from file extension
- Updated curl upload script to set `Content-Type` dynamically based on file extension
- Updated local file write note for format-aware writing

**File:** `.claude/skills/manage-sync-pairs/references/sync-pair-schema.md`
- Added YAML example config alongside existing JSON example

### 6. Re-deploy skill to user level

```bash
cp -r .claude/skills/manage-sync-pairs ~/ai-coding/claude-workdocs/.claude/skills/
```

### 7. Update project documentation

| File | Changes |
|------|---------|
| `CLAUDE.md` | Added `yaml-body-parser.middleware.ts` to project structure; updated manage-sync-pairs skill docs to mention YAML format support |
| `docs/design/project-functions.md` | Updated F4.3 (API sync) with YAML content types and error codes; updated F10.1 for format-aware serialization |
| `docs/design/project-design.md` | Added yaml-body-parser middleware to both project structure listings and API data flow diagram |
| `api-instructions.md` | Added YAML curl examples and content type documentation for sync endpoint |
| `docs/design/configuration-guide.md` | Added note about API YAML request body support |

---

## Critical Files

| File | Action |
|------|--------|
| `src/api/middleware/yaml-body-parser.middleware.ts` | **Created** |
| `src/api/server.ts` | **Edited** |
| `src/api/routes/repo.routes.ts` | **Edited** |
| `.claude/skills/manage-sync-pairs/workflows/add-sync-pair.md` | **Edited** |
| `.claude/skills/manage-sync-pairs/workflows/update-sync-pair.md` | **Edited** |
| `.claude/skills/manage-sync-pairs/workflows/delete-sync-pair.md` | **Edited** |
| `.claude/skills/manage-sync-pairs/workflows/run-sync.md` | **Edited** |
| `.claude/skills/manage-sync-pairs/references/azure-blob-write.md` | **Edited** |
| `.claude/skills/manage-sync-pairs/references/sync-pair-schema.md` | **Edited** |
| `CLAUDE.md` | **Edited** |
| `docs/design/project-functions.md` | **Edited** |
| `docs/design/project-design.md` | **Edited** |
| `api-instructions.md` | **Edited** |
| `docs/design/configuration-guide.md` | **Edited** |

---

## Reusable Existing Code

- `js-yaml` + `@types/js-yaml` — already in `package.json`
- `validateSyncPairConfig()` from `src/config/sync-pair.loader.ts` — works on plain objects regardless of source format
- Middleware pattern from `src/api/middleware/error-handler.middleware.ts`

---

## Verification

1. **API JSON (existing)**: `curl -X POST localhost:3000/api/v1/repo/sync -H "Content-Type: application/json" -d @sync-settings.json` — still works
2. **API YAML (new)**: `curl -X POST localhost:3000/api/v1/repo/sync -H "Content-Type: application/yaml" --data-binary @sync-settings.yaml` — parses and executes
3. **API invalid YAML**: Send malformed YAML with `Content-Type: application/yaml` — returns 400 with `YAML_PARSE_ERROR`
4. **Swagger UI**: `/api/docs` shows both JSON and YAML content types for sync endpoint
5. **Build check**: `npm run build` — no TypeScript errors (verified)
6. **Skill**: `/manage-sync-pairs list` — still works
