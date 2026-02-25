# Plan: Add Hotkey API Endpoints to azure-fs

## Context

The azure-fs API has interactive console hotkeys (c/f/v/i/h) for development, but these are inaccessible in Docker containers or remote deployments where stdin is not reachable. We need HTTP endpoints that invoke the exact same logic, following the existing dev routes pattern.

## Files to Modify

| File | Change |
|------|--------|
| `src/utils/console-commands.utils.ts` | Make action methods public, return structured results |
| `src/api/routes/index.ts` | Add `consoleCommands?` to `ApiServices`, register hotkey routes |
| `src/api/server.ts` | Move ConsoleCommands init before `createApp`, pass into services |
| `src/api/swagger/config.ts` | Add "Hotkeys" tag |

## Files to Create

| File | Purpose |
|------|---------|
| `src/api/routes/hotkeys.routes.ts` | Router with OpenAPI annotations (pattern: `dev.routes.ts`) |
| `src/api/controllers/hotkeys.controller.ts` | Controller factory (pattern: `dev.controller.ts`) |

## Docs to Update

`CLAUDE.md`, `docs/design/project-design.md`, `docs/design/project-functions.md`, `docs/design/configuration-guide.md`

## Implementation

### 1. Refactor `src/utils/console-commands.utils.ts`

Make the 4 action methods public and return structured data. The `handleCommand` dispatcher calls the same public methods:

```typescript
public executeClear(): { action: string; success: boolean }
public executeFreeze(): { action: string; frozen: boolean }
public executeVerbose(): { action: string; verbose: boolean }
public executeInspect(): { action: string; config: Record<string, unknown> }
public getStatus(): { frozen: boolean; verbose: boolean }
```

The private `handleCommand` calls these same methods. Console logging stays. Return values allow the API to return structured JSON.

### 2. Create `src/api/controllers/hotkeys.controller.ts`

Follow `dev.controller.ts` pattern: factory function closing over `services`, defense-in-depth `NODE_ENV` check, 503 if `consoleCommands` is null. Five handlers: `clear`, `freeze`, `verbose`, `config`, `status`.

### 3. Create `src/api/routes/hotkeys.routes.ts`

Follow `dev.routes.ts` pattern with full `@openapi` JSDoc. Endpoints:

```
POST /api/dev/hotkeys/clear     - Clear console
POST /api/dev/hotkeys/freeze    - Toggle freeze/unfreeze
POST /api/dev/hotkeys/verbose   - Toggle verbose mode
GET  /api/dev/hotkeys/config    - Inspect configuration
GET  /api/dev/hotkeys/status    - Get current state
```

Tag: "Hotkeys". Mount under `/api/dev/hotkeys` (nested under existing dev gate).

### 4. Modify `src/api/routes/index.ts`

- Add `consoleCommands?: ConsoleCommands` to `ApiServices`
- Register `app.use("/api/dev/hotkeys", createHotkeyRoutes(services))` inside the existing `if (nodeEnv === "development")` block

### 5. Modify `src/api/server.ts`

Move ConsoleCommands instantiation before `createApp` so it can be passed into services. Call `setup()` after `server.listen` (readline needs running event loop). Update `createApp` signature to accept optional `consoleCommands`.

### 6. Add "Hotkeys" tag to `src/api/swagger/config.ts`

### 7. Update Docker commands to use `NODE_ENV=development`

Change `NODE_ENV=production` to `NODE_ENV=development` in:
- `CLAUDE.md` Docker container commands (`docker run -e` flags)
- `docker-compose.yml` environment section

This enables hotkey endpoints and dev routes in the container.

### 8. Update documentation (CLAUDE.md, project-design.md, project-functions.md, configuration-guide.md)

## Verification

1. `npm run build` compiles
2. Rebuild Docker image, start container on port 4100
3. `curl -X POST http://localhost:4100/api/dev/hotkeys/verbose` toggles verbose
4. `curl http://localhost:4100/api/dev/hotkeys/status` returns state
5. `curl http://localhost:4100/api/dev/hotkeys/config` returns masked config
6. Endpoints appear in Swagger UI under "Hotkeys" tag
7. Console keyboard hotkeys still work locally via `npm run api`
