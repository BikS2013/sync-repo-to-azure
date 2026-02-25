# Plan: Add Conditional Swagger & Double-Signal Shutdown to create-api-base Skill

**Date**: 2026-02-23
**Scope**: Two small, localized features added to the skill's `01-model-api-option.md`

---

## Feature 1: Conditional Swagger (enable/disable via env var)

### What changes

Currently the skill's `createApp()` always mounts Swagger UI and the JSON endpoint. The current azure-fs implementation wraps them in `if (config.api.swaggerEnabled)`.

### Changes required

1. **Required Environment Variables** (line ~31): Add `SWAGGER_ENABLED` variable
2. **.env file** (line ~133): Add `SWAGGER_ENABLED=true`
3. **.env.example** (line ~165): Add `SWAGGER_ENABLED=`
4. **AppConfigurationManager** (Section 2): Add `getSwaggerEnabled(): boolean` method
5. **createApp() in app.ts** (Section 4, line ~796): Wrap Swagger mount in `if (appConfigManager.getSwaggerEnabled())`
6. **server.ts** (Section 18, line ~2248, ~2262): Conditionally show docs URL in startup output

---

## Feature 2: Double-Signal Force-Exit in Graceful Shutdown

### What changes

Currently the skill's `gracefulShutdown()` doesn't track whether a shutdown is already in progress. The current azure-fs implementation uses a `shutdownInProgress` flag and force-exits on the second signal.

### Changes required

1. **server.ts** (Section 18, line ~2268): Replace the simple `gracefulShutdown` function with one that:
   - Tracks `shutdownInProgress` boolean
   - On second signal, logs a warning and force-exits via `process.exit(1)`
   - Passes the signal name for better logging
   - Uses `.unref()` on the timeout to not keep the event loop alive

---

## Implementation Order

Both changes are independent. They can be applied in any order. I'll apply them together since they're small.

## Acceptance Criteria

- [ ] `SWAGGER_ENABLED` env var documented in required variables, .env, and .env.example
- [ ] `getSwaggerEnabled()` method in AppConfigurationManager
- [ ] `createApp()` conditionally mounts Swagger when enabled
- [ ] Startup output conditionally shows docs URL
- [ ] `gracefulShutdown()` has `shutdownInProgress` flag
- [ ] Double-signal causes immediate force-exit
- [ ] Signal name is logged
- [ ] Timeout uses `.unref()`
- [ ] No other existing content is modified
