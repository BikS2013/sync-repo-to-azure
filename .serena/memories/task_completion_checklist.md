# Task Completion Checklist

When completing a task on this project, follow these steps:

## 1. Build Verification
```bash
npm run build
```
Must compile with zero errors.

## 2. Code Quality
- No unused imports (TypeScript will warn)
- No `any` types except in catch blocks
- All public methods/functions have JSDoc comments
- Error handling follows the project pattern (try/catch + formatErrorFromException)

## 3. Configuration Rules
- Verify no fallback/default values for config settings
- Every missing config throws ConfigError with clear message

## 4. Documentation Updates
- If new CLI commands added: update CLAUDE.md with `<toolName>` documentation
- If new issues found: update `Issues - Pending Items.md`
- If design changed: update `docs/design/project-design.md`

## 5. Type Exports
- New types added to the appropriate `types/*.ts` file
- Barrel export updated in `types/index.ts`

## 6. Test Coverage
- New features should have corresponding test cases in `test_scripts/`
- Run relevant test scripts to verify (requires live Azure account)

## 7. Version Control
- Do NOT commit unless explicitly asked
- Do NOT push unless explicitly asked
