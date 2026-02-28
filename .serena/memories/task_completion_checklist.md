# Task Completion Checklist

When completing a task on this project, follow these steps:

## 1. Build Verification
```bash
npm run build
```
Must compile with zero errors.

## 2. Code Quality
- No unused imports
- No `any` types except in catch blocks
- Error handling follows project pattern (try/catch + formatErrorFromException)
- Streaming patterns maintained (zero local disk for archive processing)

## 3. Configuration Rules
- Verify no fallback/default values for config settings
- Every missing config throws ConfigError with clear message
- Token expiry dates tracked where applicable

## 4. Documentation Updates (CRITICAL - per CLAUDE.md highest priority)
When adding operations, ALL of the following must be updated:
- `docs/design/project-design.md` — architecture and design
- `docs/design/project-functions.md` — functional requirements
- `docs/design/configuration-guide.md` — config variables
- `CLAUDE.md` — tool and API documentation
- `api-instructions.md` — if API endpoints changed
- `cli-instructions.md` — if CLI commands changed
- `Issues - Pending Items.md` — register any gaps or inconsistencies

## 5. API Alignment
- Swagger/OpenAPI spec must match actual endpoints
- API routes must mirror CLI functionality where applicable

## 6. Type Exports
- New types added to appropriate `types/*.ts` file
- Barrel export updated in `types/index.ts`

## 7. Test Coverage
- New features should have test scripts in `test_scripts/`
- Both CLI and API tests where applicable

## 8. Version Control
- Do NOT commit unless explicitly asked
- Do NOT push unless explicitly asked
