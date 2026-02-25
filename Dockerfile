# ============================================================
# Stage 1: Builder - Compile TypeScript to JavaScript
# ============================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files for dependency installation
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for TypeScript compilation)
RUN npm ci

# Copy source code and TypeScript configuration
COPY src/ ./src/
COPY tsconfig.json ./

# Compile TypeScript to JavaScript
RUN npm run build

# ============================================================
# Stage 2: Production - Minimal runtime image
# ============================================================
FROM node:20-alpine AS production

# Add labels for image identification
LABEL maintainer="azure-fs"
LABEL description="Azure Blob Storage File System REST API"

WORKDIR /app

# Copy package files for production dependency installation
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled JavaScript from builder stage
COPY --from=builder /app/dist ./dist

# Run as non-root user for security
USER node

# Expose the default API port
EXPOSE 3000

# Health check using wget (available in Alpine, no need for curl)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start the API server
CMD ["node", "dist/api/server.js"]
