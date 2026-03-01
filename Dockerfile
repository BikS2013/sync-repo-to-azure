# ============================================================
# Stage 1: Builder - Compile TypeScript to JavaScript
# ============================================================
FROM --platform=$BUILDPLATFORM node:20-alpine AS builder

WORKDIR /app

# Copy package files for dependency installation
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for TypeScript compilation)
RUN npm ci

# Copy source code and TypeScript configuration
COPY src/ ./src/
COPY tsconfig.json ./

# Build azure-venv dependency (GitHub source package, no prebuilt dist)
RUN cd node_modules/azure-venv && npx tsc || true

# Compile TypeScript to JavaScript
RUN npm run build

# ============================================================
# Stage 2: Production - Minimal runtime image
# ============================================================
FROM node:20-alpine AS production

# Add labels for image identification (OCI standard labels)
LABEL maintainer="repo-sync"
LABEL description="Repository Sync to Azure Blob Storage REST API"
LABEL org.opencontainers.image.title="sync-repo-to-azure"
LABEL org.opencontainers.image.description="REST API for replicating GitHub and Azure DevOps repositories to Azure Blob Storage"
LABEL org.opencontainers.image.source="https://github.com/sync-repo-to-azure"

WORKDIR /app

# Copy package files for production dependency installation
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled JavaScript from builder stage
COPY --from=builder /app/dist ./dist

# Copy built azure-venv dist (GitHub source package, not prebuilt)
COPY --from=builder /app/node_modules/azure-venv/dist ./node_modules/azure-venv/dist

# Grant ownership to node user so azure-venv can write synced files
RUN chown -R node:node /app

# Run as non-root user for security
USER node

# Expose the default API port
EXPOSE 3000

# Health check using wget (available in Alpine, no need for curl)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start the API server
CMD ["node", "dist/api/server.js"]
