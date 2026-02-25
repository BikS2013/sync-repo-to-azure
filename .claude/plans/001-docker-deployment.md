# Plan: Docker Deployment Preparation

## Metadata
- **Created:** 2026-02-25 12:00:00
- **Project:** /Users/giorgosmarinos/aiwork/agent-platform/azure-storage-tool
- **Trigger:** manual

---

## Original Request

"I want you to prepare the api for docker deployment"

---

## Summary / Objective

Containerize the Azure FS REST API for production Docker deployment using a multi-stage build, with proper .dockerignore, docker-compose for local testing, and production env template.

---

## Implementation Plan

### Files to Create

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage production image (Node 20 Alpine) |
| `.dockerignore` | Exclude unnecessary files from build context |
| `docker-compose.yml` | Local dev/testing convenience |
| `.env.docker.example` | Docker-specific env template with production defaults |

### Files to Update

| File | Change |
|------|--------|
| `CLAUDE.md` | Add Docker section with build/run commands |
| `docs/design/project-design.md` | Add Docker deployment section |
| `docs/design/configuration-guide.md` | Add Docker deployment notes |
| `docs/design/project-functions.md` | Add Docker deployment feature |

### Dockerfile (Multi-Stage)

**Stage 1 - Builder:** Node 20 Alpine, npm ci (full deps), tsc build
**Stage 2 - Production:** Node 20 Alpine, npm ci --omit=dev, copy dist/, non-root user, EXPOSE 3000, HEALTHCHECK, entrypoint node dist/api/server.js

### docker-compose.yml

- Service `azure-fs-api`, port 3000:3000, env_file .env, health check, restart unless-stopped

### .env.docker.example

Production defaults: NODE_ENV=production, host 0.0.0.0, port 3000, log level info, AUTO_SELECT_PORT=false. Secrets left blank.

---

## Lessons Learned

- The project already binds to 0.0.0.0 (correct for containers)
- Health check endpoints already exist (/api/health, /api/health/ready)
- Graceful shutdown (SIGTERM/SIGINT) already implemented
- No fallback config values by design -- all env vars must be explicitly provided
- Console hotkeys auto-disable in production (NODE_ENV=production)

---

## Critical Files

- `src/api/server.ts` - Server entry point, graceful shutdown
- `src/config/config.loader.ts` - Configuration loading (env vars)
- `.env.example` - Env var template reference
- `package.json` - Build scripts, dependencies, overrides
- `tsconfig.json` - TypeScript build config (outDir: dist/)
