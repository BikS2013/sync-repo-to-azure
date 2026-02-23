# Investigation: Adding a REST API Layer to azure-fs CLI Tool

**Date:** 2026-02-23
**Status:** Research Complete
**Author:** Technical Investigation

---

## Executive Summary

This document investigates the technical approaches, trade-offs, and recommendations for adding an Express.js 5.x REST API layer to the existing `azure-fs` TypeScript CLI tool. The CLI already has well-structured service classes (`BlobFileSystemService`, `MetadataService`, `AuthService`), a layered configuration system, custom error hierarchies, and retry utilities. The goal is to expose these capabilities over HTTP while reusing the existing service layer without modification.

Six areas were investigated:

1. **Express.js 5.x with TypeScript** -- Significant route syntax changes and built-in async error handling eliminate boilerplate.
2. **Swagger/OpenAPI 3.0** -- Three viable approaches; `swagger-jsdoc` recommended for lowest friction given existing codebase.
3. **File upload via REST** -- Multer with memory storage, then pass buffer to existing `BlobFileSystemService`.
4. **Bridging CLI config and API config** -- Extend existing `ConfigLoader` with API-specific settings; single source of truth.
5. **ETag-based concurrency over HTTP** -- Forward Azure ETags as HTTP ETags; enforce `If-Match` on mutations.
6. **Error mapping** -- Centralized Express error middleware mapping `AzureFsError` subclasses to HTTP status codes.

---

## 1. Express.js 5.x with TypeScript

### Context

Express 5.0 was released on October 15, 2024, after 10 years of development. It requires Node.js 18+ (our project already requires `>=18.0.0`). Express 5 brings breaking changes to route patterns, async handling, and several API signatures.

### Key Breaking Changes from v4

| Area | Express 4 | Express 5 |
|------|-----------|-----------|
| **Wildcard routes** | `app.get('*', handler)` | `app.get('/{*splat}', handler)` |
| **Optional params** | `/user/:id?` | `/user{/:id}` |
| **Regex in routes** | `?`, `+`, `*`, `[]`, `()` supported | Reserved characters; must use named params or arrays |
| **Async errors** | Manual `try/catch` + `next(err)` required | Rejected promises auto-forwarded to error middleware |
| **`req.body`** | Defaults to `{}` | Defaults to `undefined` |
| **`req.query`** | Writable | Read-only getter |
| **`res.status()`** | Accepts any value | Only integers 100-999 |
| **`app.listen` callback** | `() => {}` | `(error) => {}` -- receives error as argument |
| **`res.redirect`** | `res.redirect(url, status)` | `res.redirect(status, url)` (reversed) |
| **`res.redirect('back')`** | Supported | Removed; use `req.get('Referrer')` |

### TypeScript Types

- Use `@types/express@5.x` with `express@5.x`. The major versions **must** match.
- Current stable: `@types/express@5.0.6` (December 2025), supporting TypeScript 5.2 through 6.0.
- Types include `@types/body-parser`, `@types/express-serve-static-core`, and `@types/serve-static` as dependencies.

### Route Pattern Syntax (path-to-regexp v8)

Express 5 upgrades `path-to-regexp` from v0.x to v8.x. This is the most disruptive change:

- **Named wildcards required:** `*` must be followed by a parameter name (e.g., `*splat`).
- **Braces for optional segments:** `{` and `}` wrap optional path segments.
- **Regex characters reserved:** `?`, `+`, `*`, `[]`, `()` cannot be used as regex. Escape with `\`.
- **Wildcard params return arrays:** `req.params.splat` is `['foo', 'bar']` for `/foo/bar`.

### Async Error Handling (Major Improvement)

Express 5 automatically catches rejected promises from `async` route handlers and forwards them to error middleware. This eliminates the need for `express-async-errors` or wrapper functions:

```typescript
// Express 5 -- no try/catch needed
app.get('/api/files/:path', async (req, res) => {
  const result = await blobService.getFileInfo(req.params.path);
  res.json(result);
  // If getFileInfo throws, error middleware receives it automatically
});
```

### Migration Tooling

Express provides codemods: `npx codemod@latest @expressjs/v5-migration-recipe`

### Recommendation

**Use Express 5.x.** The built-in async error handling alone justifies the choice for a new API layer. Since we are writing new code (not migrating existing Express 4 code), the route syntax changes are not a migration burden but simply the patterns we adopt from the start.

**Install:** `express@5` + `@types/express@5`

### References

- [Express 5 Migration Guide](https://expressjs.com/en/guide/migrating-5.html)
- [What's New in Express.js v5.0 -- Better Stack](https://betterstack.com/community/guides/scaling-nodejs/express-5-new-features/)
- [Express.js 5 Migration Guide -- LogRocket](https://blog.logrocket.com/express-js-5-migration-guide/)
- [Express v4 -> v5 Migration Issue #5944](https://github.com/expressjs/express/issues/5944)
- [@types/express on npm](https://www.npmjs.com/package/@types/express)
- [path-to-regexp v8 on npm](https://www.npmjs.com/package/path-to-regexp)

---

## 2. Swagger/OpenAPI 3.0 with Express

### Options Analysis

Three main approaches exist for generating OpenAPI documentation in a TypeScript Express project:

#### Option A: swagger-jsdoc + swagger-ui-express

- **Approach:** JSDoc comment blocks with `@openapi` annotations above route handlers; `swagger-jsdoc` parses them into an OpenAPI spec; `swagger-ui-express` serves the interactive UI.
- **Weekly downloads:** ~1.1M (swagger-jsdoc)
- **Pros:** Framework-agnostic, no runtime behavior changes, no decorators needed, mature ecosystem, works with any Express route structure.
- **Cons:** Documentation is in comments (can drift from code), you must write OpenAPI YAML/JSON manually in comments, no compile-time validation that docs match code.
- **TypeScript note:** Include both `.ts` source paths and compiled `.js` paths in the `apis` glob, or use only source paths during development.

#### Option B: tsoa (TypeScript OpenAPI)

- **Approach:** Decorator-based controllers; tsoa generates both routes and OpenAPI spec from TypeScript types and decorators.
- **Weekly downloads:** ~300K
- **Pros:** Single source of truth (code IS the spec), built-in runtime validation, generates OpenAPI 2.0/3.0/3.1, very TypeScript-native.
- **Cons:** Requires adopting tsoa's controller pattern (decorator-heavy), adds a build step for route generation, framework lock-in to tsoa's patterns, heavier abstraction layer.
- **Risk:** Adopting tsoa means rewriting how routes are defined. This is a significant architectural commitment.

#### Option C: Tspec

- **Approach:** Uses TypeScript types directly (no decorators, no JSDoc) to generate OpenAPI specs.
- **Pros:** Most lightweight, leverages TypeScript type system naturally, minimal code changes.
- **Cons:** Very early stage (v0.x), only 2 dependents on npm, published ~1 year ago with uncertain maintenance, limited community support.
- **Risk:** Maturity and maintenance concerns make this unsuitable for production.

### Recommendation

**Option A: swagger-jsdoc + swagger-ui-express.** This is the lowest-friction approach for our project:

- We already have well-defined service classes. The API layer will be thin controllers calling services. We do not need tsoa's route generation.
- swagger-jsdoc lets us add documentation incrementally without changing our application architecture.
- The spec can be exported as a JSON endpoint (`/api/docs.json`) for client SDK generation.
- For schema reuse, define OpenAPI component schemas in a central file (e.g., `src/api/swagger/schemas.ts`) and reference them via `$ref` in route annotations.

**Packages to install:**
- `swagger-jsdoc` + `@types/swagger-jsdoc`
- `swagger-ui-express` + `@types/swagger-ui-express`

**Key configuration:**

```typescript
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: { title: 'Azure FS REST API', version: '1.0.0' },
    servers: [{ url: '/api/v1' }],
  },
  apis: ['./src/api/routes/**/*.ts'],
};
```

### References

- [swagger-jsdoc on npm](https://www.npmjs.com/package/swagger-jsdoc)
- [swagger-ui-express on npm](https://www.npmjs.com/package/swagger-ui-express)
- [tsoa on GitHub](https://github.com/lukeautry/tsoa)
- [Tspec on npm](https://www.npmjs.com/package/tspec)
- [Documenting Express API with Swagger -- LogRocket](https://blog.logrocket.com/documenting-express-js-api-swagger/)
- [swagger-jsdoc vs tsoa vs typescript-rest-swagger -- npm trends](https://npmtrends.com/swagger-jsdoc-vs-tsoa-vs-typescript-rest-swagger)

---

## 3. File Upload via REST (Multer)

### Context

The `azure-fs upload` CLI command reads a local file and uploads it to Azure Blob Storage via `BlobFileSystemService.uploadFile()`. The REST API equivalent must accept multipart form data over HTTP.

### Options Analysis

#### Option A: Multer Memory Storage + Manual Upload (Recommended)

- Use `multer({ storage: multer.memoryStorage() })` to receive the file into `req.file.buffer`.
- Pass the buffer to the existing `BlobFileSystemService.uploadFile()` method (or a new method that accepts a `Buffer`/`Readable` stream).
- **Pros:** Full control over the upload pipeline, reuses our existing `@azure/storage-blob` client, no additional Azure SDKs, works with our existing auth and retry logic.
- **Cons:** Entire file is held in memory. For very large files (>100MB), this could be problematic.
- **Mitigation:** Set `multer({ limits: { fileSize: 100 * 1024 * 1024 } })` to cap uploads. For larger files, consider streaming (Option B).

#### Option B: Multer Disk Storage + Stream Upload

- Use `multer({ dest: '/tmp/azure-fs-uploads/' })` to write to a temp file.
- Stream the temp file to Azure using `BlobFileSystemService`'s existing streaming upload logic (which already handles files >100MB).
- **Pros:** Memory-efficient for large files, reuses existing streaming code path.
- **Cons:** Requires temp directory management and cleanup, adds disk I/O.

#### Option C: multer-azure-blob-storage (Dedicated Engine)

- A drop-in multer storage engine that streams directly to Azure Blob Storage.
- **Pros:** Zero intermediate storage, purpose-built.
- **Cons:** Bypasses our existing `BlobFileSystemService`, duplicates Azure auth configuration, does not benefit from our retry logic, tight coupling to a third-party package (last published ~2023).

### Recommendation

**Option A (Memory Storage) for files up to 100MB, with Option B (Disk Storage) as a configurable fallback for larger files.**

The API controller should:
1. Accept multipart upload via multer.
2. Extract `req.file.buffer` (or `req.file.path` for disk storage).
3. Call `BlobFileSystemService.uploadFile()` or a new `uploadFromBuffer()` method.
4. Return structured JSON with blob path, size, content type, and ETag.

**Key implementation details:**
- Field name: `file` (for the uploaded file)
- Additional form fields: `remotePath` (required), `metadata` (optional JSON string)
- File type validation via multer's `fileFilter` callback
- Size limits configurable via API config

**Packages to install:**
- `multer` + `@types/multer`

### References

- [Multer GitHub Repository](https://github.com/expressjs/multer)
- [Multer Express Middleware Docs](https://expressjs.com/en/resources/middleware/multer.html)
- [multer-azure-blob-storage on npm](https://www.npmjs.com/package/multer-azure-blob-storage)
- [Uploading Files with Multer in Node.js -- Better Stack](https://betterstack.com/community/guides/scaling-nodejs/multer-in-nodejs/)

---

## 4. Bridging CLI Config and API Config

### Context

The existing CLI has a layered config system: `CLI Flags > Environment Variables > Config File (.azure-fs.json)`. This handles Azure Storage settings (account URL, container, auth method, retry, logging). The REST API needs additional settings: port, host, CORS origins, upload limits, Swagger enable/disable, etc.

### Options Analysis

#### Option A: Extend Existing Config Loader (Recommended)

- Add an `api` section to the existing `AzureFsConfig` type and `.azure-fs.json` schema.
- The existing `ConfigLoader` already supports layered loading. Extend it with API-specific environment variables (e.g., `AZURE_FS_API_PORT`, `AZURE_FS_API_HOST`, `AZURE_FS_API_CORS_ORIGINS`).
- **Pros:** Single config file, single loading mechanism, consistent behavior, the CLI ignores the `api` section, the API uses both sections.
- **Cons:** Config file grows larger; CLI users see API settings they may not need.

#### Option B: Separate Config File for API

- A dedicated `.azure-fs-api.json` or `api.config.json` file with its own loader.
- **Pros:** Clean separation, each entry point only sees its own config.
- **Cons:** Two config systems to maintain, Azure settings (account URL, container, auth) must be duplicated or cross-referenced, violates DRY.

#### Option C: EnvironmentManager Pattern (from create-api-base)

- A dedicated `EnvironmentManager` class that reads only environment variables for API settings, while the existing config loader handles Azure settings.
- **Pros:** Follows 12-factor app patterns, clean separation of concerns.
- **Cons:** Two different approaches to config in the same project, potential confusion.

### Recommendation

**Option A: Extend the existing ConfigLoader** with an API-specific section. This follows the principle of having a single source of truth.

**Proposed config structure addition:**

```json
{
  "storageAccountUrl": "...",
  "containerName": "...",
  "authMethod": "...",
  "api": {
    "port": 3000,
    "host": "0.0.0.0",
    "corsOrigins": ["http://localhost:3000"],
    "swaggerEnabled": true,
    "uploadMaxSizeMb": 100,
    "requestTimeoutMs": 30000
  }
}
```

**Proposed environment variable mapping:**

| Variable | Description |
|----------|-------------|
| `AZURE_FS_API_PORT` | API server port |
| `AZURE_FS_API_HOST` | API server bind address |
| `AZURE_FS_API_CORS_ORIGINS` | Comma-separated CORS origins |
| `AZURE_FS_API_SWAGGER_ENABLED` | Enable/disable Swagger UI |
| `AZURE_FS_API_UPLOAD_MAX_SIZE_MB` | Maximum upload file size in MB |
| `AZURE_FS_API_REQUEST_TIMEOUT_MS` | Request timeout in milliseconds |

**Priority remains:** CLI Flags > Environment Variables > Config File

**Important:** Following the project's configuration rules, all required settings must raise an exception if missing. No fallbacks or default values. The API port, host, and CORS origins are all required.

### References

- [The Twelve-Factor App: Config](https://12factor.net/config)
- [How to Structure an Express.js REST API -- Treblle](https://treblle.com/blog/egergr)
- [Modern API Development with Clean Architecture](https://baguilar6174.medium.com/modern-api-development-with-node-js-express-and-typescript-using-clean-architecture-0868607b76de)

---

## 5. ETag-Based Concurrency over HTTP

### Context

The existing CLI tool already uses Azure's ETags for concurrency protection. The `edit` command downloads a blob with its ETag, and the `--upload` phase uses `If-Match` to prevent lost updates. The `patch` and `append` commands also use ETags internally. The REST API must expose this mechanism to HTTP clients using standard HTTP headers.

### How It Works

1. **GET response:** Include the Azure blob's ETag in the HTTP `ETag` response header.
2. **PUT/PATCH/DELETE request:** Client sends `If-Match: "<etag>"` header. The API forwards this to `BlobFileSystemService`, which passes it to Azure's conditional access APIs.
3. **Conflict detection:** If the blob was modified since the client's last read, Azure returns 412 (Precondition Failed). The API returns HTTP 412 to the client.
4. **Cache validation:** For GET requests, clients can send `If-None-Match: "<etag>"`. If the blob hasn't changed, return HTTP 304 Not Modified.

### Design Decisions

#### Should `If-Match` be required on mutations?

**Option A: Required (Strict)**
- All PUT/PATCH/DELETE requests MUST include `If-Match`. Return 428 (Precondition Required) if missing.
- **Pros:** Prevents accidental overwrites, forces clients to be concurrency-aware.
- **Cons:** Higher client complexity, especially for simple scripts or quick integrations.

**Option B: Optional (Lenient)**
- If `If-Match` is present, enforce it. If absent, proceed without concurrency check.
- **Pros:** Lower friction for simple use cases.
- **Cons:** Risk of lost updates for clients that don't send ETags.

**Option C: Required for some, optional for others**
- Require `If-Match` for `edit --upload` (replace), `patch`, and `append` operations (which already use ETags internally).
- Make it optional for `delete` and `upload` (new file creation).
- **Pros:** Balances safety with usability.

### Recommendation

**Option C: Required for update operations, optional for creates and deletes.**

Specifically:
- **Required `If-Match`:** PUT (replace), PATCH (patch/append) -- return 428 if missing
- **Optional `If-Match`:** DELETE -- honor if present, skip if absent
- **Not applicable:** POST (upload new file) -- no existing resource to version
- **Always returned:** `ETag` header on all GET and mutation responses

**HTTP Status Code Mapping:**
| Scenario | Status Code |
|----------|-------------|
| ETag matches, update succeeds | 200 OK |
| ETag mismatch (concurrent modification) | 412 Precondition Failed |
| `If-Match` missing on required endpoint | 428 Precondition Required |
| `If-None-Match` matches (resource unchanged) | 304 Not Modified |

**Implementation pattern:**

```typescript
// In route handler
const etag = req.headers['if-match'];
if (!etag) {
  return res.status(428).json({ error: 'If-Match header required' });
}
// Pass to service
await blobService.replaceFile(remotePath, buffer, { etag: etag.replace(/"/g, '') });
// Return new ETag
res.set('ETag', `"${newEtag}"`);
res.json({ success: true });
```

### References

- [Optimizing REST APIs with Conditional Requests and ETags -- Zuplo](https://zuplo.com/learning-center/optimizing-rest-apis-with-conditional-requests-and-etags)
- [How to use ETag header for optimistic concurrency -- Event-Driven.io](https://event-driven.io/en/how_to_use_etag_header_for_optimistic_concurrency/)
- [Handling Optimistic Concurrency with ETags -- Ed-Fi Alliance](https://docs.ed-fi.org/reference/data-exchange/api-guidelines/design-and-implementation-guidelines/api-implementation-guidelines/handling-optimistic-concurrency-with-etags/)
- [ETags and Optimistic Concurrency Control -- Fideloper](https://fideloper.com/etags-and-optimistic-concurrency-control)
- [A Complete Guide to ETag Headers -- BrowserStack](https://www.browserstack.com/guide/etag-header-api)
- [How to Implement API ETag Headers -- OneUptime](https://oneuptime.com/blog/post/2026-01-30-api-etag-headers/view)

---

## 6. Error Mapping: Custom Error Classes to HTTP Status Codes

### Context

The CLI tool has a well-structured error hierarchy:

```
AzureFsError (base)
  |-- ConfigError (codes: CONFIG_MISSING_REQUIRED, CONFIG_INVALID_VALUE, etc.)
  |-- AuthError (codes: AUTH_MISSING_CONNECTION_STRING, AUTH_ACCESS_DENIED, etc.)
  |-- BlobNotFoundError (code: BLOB_NOT_FOUND)
  |-- PathError (codes: PATH_INVALID, PATH_EMPTY, PATH_TOO_LONG, etc.)
  |-- MetadataError (codes: META_INVALID_KEY, META_SIZE_EXCEEDED, etc.)
  |-- ConcurrentModificationError (code: BLOB_PRECONDITION_FAILED)
```

The base `AzureFsError` already has a `statusCode` property and a `toJSON()` method. The REST API needs centralized middleware to map these to HTTP responses.

### Pattern: Centralized Error Handling Middleware

Express 5's four-argument error middleware (`err, req, res, next`) is the standard pattern. Combined with the automatic async error forwarding in Express 5, this provides a clean, centralized approach.

### Proposed Error-to-HTTP Mapping

| Error Class | Error Code | HTTP Status | HTTP Reason |
|---|---|---|---|
| `ConfigError` | CONFIG_MISSING_REQUIRED | 500 | Internal Server Error (config is server-side) |
| `ConfigError` | CONFIG_INVALID_VALUE | 500 | Internal Server Error |
| `AuthError` | AUTH_ACCESS_DENIED | 403 | Forbidden |
| `AuthError` | AUTH_MISSING_* | 500 | Internal Server Error (auth is server-side) |
| `AuthError` | AUTH_CONNECTION_FAILED | 502 | Bad Gateway |
| `BlobNotFoundError` | BLOB_NOT_FOUND | 404 | Not Found |
| `BlobNotFoundError` | BLOB_CONTAINER_NOT_FOUND | 500 | Internal Server Error (container is config) |
| `PathError` | PATH_INVALID, PATH_EMPTY | 400 | Bad Request |
| `PathError` | PATH_TOO_LONG | 400 | Bad Request (URI Too Long) |
| `PathError` | PATH_LOCAL_FILE_NOT_FOUND | 400 | Bad Request |
| `MetadataError` | META_INVALID_KEY | 400 | Bad Request |
| `MetadataError` | META_SIZE_EXCEEDED | 400 | Bad Request |
| `MetadataError` | META_MAX_TAGS_EXCEEDED | 400 | Bad Request |
| `ConcurrentModificationError` | BLOB_PRECONDITION_FAILED | 412 | Precondition Failed |
| (Network errors) | NET_CONNECTION_FAILED, NET_TIMEOUT | 502 | Bad Gateway |
| (Unknown) | UNKNOWN_ERROR | 500 | Internal Server Error |

### Implementation Approach

The base `AzureFsError` already has an optional `statusCode` field. The recommended approach is:

1. **Set `statusCode` in each error subclass constructor** (if not already done) to embed the HTTP mapping at the error definition level.
2. **Centralized middleware** checks `instanceof AzureFsError`:
   - If true: use `err.statusCode` (or a mapping table if statusCode is not set) and `err.toJSON()`.
   - If false: log the full error, return 500 with a generic message (never expose internal errors to clients).

**Middleware structure:**

```typescript
function errorHandler(err: Error, req: Request, res: Response, next: NextFunction): void {
  if (err instanceof AzureFsError) {
    const status = err.statusCode || errorCodeToStatus[err.code] || 500;
    res.status(status).json({
      success: false,
      error: err.toJSON(),
    });
    return;
  }

  // Multer errors
  if (err instanceof multer.MulterError) {
    res.status(400).json({
      success: false,
      error: { code: 'UPLOAD_ERROR', message: err.message },
    });
    return;
  }

  // Unknown errors -- never expose details
  logger.error('Unhandled error', err);
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred' },
  });
}
```

### Recommendation

Use the **centralized error middleware pattern** with a mapping table for error codes that do not have `statusCode` set. This approach:

- Requires no changes to existing error classes (they already have `toJSON()` and optional `statusCode`).
- Keeps controllers clean (just throw errors, Express 5 auto-forwards them).
- Provides a single place to update error-to-HTTP mappings.
- Handles unknown errors safely by never exposing internal details.

### References

- [Express Error Handling Official Guide](https://expressjs.com/en/guide/error-handling.html)
- [Express Error Handling Patterns -- Better Stack](https://betterstack.com/community/guides/scaling-nodejs/error-handling-express/)
- [How to Handle Errors in Express with TypeScript -- Code Concisely](https://www.codeconcisely.com/posts/how-to-handle-errors-in-express-with-typescript/)
- [Express Error Handling Like a Pro with TypeScript -- Mason Hu](https://medium.com/@xiaominghu19922/proper-error-handling-in-express-server-with-typescript-8cd4ffb67188)
- [Handling Errors in Express: Custom Middleware -- Sebastian Kut](https://medium.com/@sebastian_kut/handling-errors-in-express-js-custom-middleware-and-reusable-code-with-typescript-90e6d1902868)

---

## 7. Supplementary Topics

### 7.1 Graceful Shutdown

Express provides official guidance on graceful shutdown. The pattern involves:

1. Listen for `SIGTERM` and `SIGINT` signals.
2. Stop accepting new connections (`server.close()`).
3. Wait for in-flight requests to complete (with a timeout).
4. Clean up resources (close Azure SDK clients, flush logs).
5. Exit the process.

**Recommended package:** `http-graceful-shutdown` (handles connection tracking, timeout, and cleanup callbacks) or implement manually with ~30 lines of code.

**Manual pattern:**

```typescript
const server = app.listen(port, host, (error) => {
  if (error) throw error;
});

function shutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
  // Force close after timeout
  setTimeout(() => {
    logger.warn('Forcing shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

### References

- [Express Health Checks and Graceful Shutdown](https://expressjs.com/en/advanced/healthcheck-graceful-shutdown.html)
- [How to Build a Graceful Shutdown Handler in Node.js -- OneUptime](https://oneuptime.com/blog/post/2026-01-06-nodejs-graceful-shutdown-handler/view)
- [Graceful Shutdown in Express -- Code Concisely](https://www.codeconcisely.com/posts/graceful-shutdown-in-express/)

### 7.2 Port Conflict Detection

Node.js emits an `error` event on `server.listen()` if the port is in use (`EADDRINUSE`). Handle this in the `app.listen` callback (Express 5 passes the error as an argument) or via the `server.on('error', ...)` event.

```typescript
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(`Port ${port} is already in use`);
    process.exit(1);
  }
  throw err;
});
```

### 7.3 Health Check Endpoint

Standard pattern: `/api/health` or `/health` endpoint returning:

```json
{
  "status": "ok",
  "timestamp": "2026-02-23T10:00:00Z",
  "uptime": 3600,
  "checks": {
    "azureStorage": "connected"
  }
}
```

The health check can optionally verify Azure Storage connectivity by calling `containerClient.exists()`. For liveness probes (Kubernetes), a simple 200 OK is sufficient. For readiness probes, include the storage connectivity check.

### 7.4 CORS Configuration

Use the `cors` npm package with explicit origin allowlists. Key recommendations:

- Never use `origin: '*'` in production.
- Load allowed origins from environment variables (`AZURE_FS_API_CORS_ORIGINS`).
- Set `credentials: true` if auth cookies/headers are used.
- Set `maxAge` to cache preflight responses.
- Pre-flight requests are handled automatically when using `app.use(cors(options))`.

**Packages to install:** `cors` + `@types/cors`

### References

- [CORS Cheat Sheet for Express + TypeScript](https://gist.github.com/adjeim/a2dbc5214c92ce5d708fb0a3d6f073f6)
- [Express CORS Middleware Docs](https://expressjs.com/en/resources/middleware/cors.html)
- [Add CORS Support to Express + TypeScript API -- Twilio](https://www.twilio.com/en-us/blog/add-cors-support-express-typescript-api)

---

## 8. Architecture Summary

### Service Reuse Pattern

The CLI commands (`file.commands.ts`, `folder.commands.ts`, etc.) and the REST API controllers are both **thin wrappers** around the same service layer:

```
CLI Entry Point (Commander.js)         REST API Entry Point (Express 5)
         |                                        |
    CLI Commands                            API Controllers
    (parse argv,                            (parse req,
     call services,                          call services,
     format output)                          format response)
         |                                        |
         +------ Shared Service Layer ------------+
         |     BlobFileSystemService              |
         |     MetadataService                    |
         |     AuthService                        |
         |     ConfigLoader                       |
         +----------------------------------------+
```

Controllers should:
- Extract parameters from `req.params`, `req.query`, `req.body`, `req.file`.
- Call service methods with plain TypeScript arguments (never pass `req` or `res` to services).
- Return results via `res.json()`.
- Let Express 5 error middleware handle all thrown errors.

### Proposed API Project Structure Addition

```
src/
  api/
    server.ts                    - Express app setup, middleware, listen
    routes/
      index.ts                   - Route registration barrel
      file.routes.ts             - /api/v1/files/* routes
      folder.routes.ts           - /api/v1/folders/* routes
      edit.routes.ts             - /api/v1/edit/* routes
      meta.routes.ts             - /api/v1/meta/* routes
      tags.routes.ts             - /api/v1/tags/* routes
      health.routes.ts           - /api/health
    controllers/
      file.controller.ts         - Thin wrappers calling BlobFileSystemService
      folder.controller.ts       - Thin wrappers calling BlobFileSystemService
      edit.controller.ts         - Thin wrappers calling BlobFileSystemService
      meta.controller.ts         - Thin wrappers calling MetadataService
      tags.controller.ts         - Thin wrappers calling MetadataService
    middleware/
      error-handler.middleware.ts - Centralized error-to-HTTP mapping
      etag.middleware.ts          - ETag/If-Match header processing
      upload.middleware.ts        - Multer configuration
    swagger/
      config.ts                  - swagger-jsdoc options
      schemas.ts                 - Reusable OpenAPI component schemas
    config/
      api-config.types.ts        - ApiConfig type definitions
```

### New npm Dependencies Required

| Package | Purpose | Type |
|---------|---------|------|
| `express@5` | HTTP framework | production |
| `cors` | CORS middleware | production |
| `multer` | File upload middleware | production |
| `swagger-jsdoc` | OpenAPI spec generation | production |
| `swagger-ui-express` | Swagger UI serving | production |
| `@types/express@5` | TypeScript types | dev |
| `@types/cors` | TypeScript types | dev |
| `@types/multer` | TypeScript types | dev |
| `@types/swagger-jsdoc` | TypeScript types | dev |
| `@types/swagger-ui-express` | TypeScript types | dev |

### New npm Scripts

```json
{
  "api": "ts-node src/api/server.ts",
  "api:build": "tsc",
  "api:start": "node dist/api/server.js"
}
```

---

## 9. Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Express 5 is relatively new (Oct 2024); some middleware may not be fully compatible | Medium | Test multer, cors, swagger-ui-express with Express 5 before committing |
| `@types/express@5` may have gaps or breaking changes | Low | Pin specific version, monitor DefinitelyTyped issues |
| Large file uploads exhaust memory with multer memory storage | Medium | Set size limits, implement disk storage fallback for large files |
| Swagger annotations can drift from actual code | Low | Add CI validation step (e.g., `swagger-jsdoc --validate`) |
| Two entry points (CLI + API) complicate deployment | Low | Document clearly, consider Docker multi-stage builds |
| Config file grows with API settings | Low | Use clear section separation (`api: { ... }`) |

---

## 10. Conclusion

Adding a REST API layer to `azure-fs` is well-supported by the existing architecture. The service classes are already framework-agnostic, the error hierarchy maps cleanly to HTTP status codes, and the config system can be extended naturally. Express 5's built-in async error handling is a significant advantage for this use case, eliminating boilerplate. The primary technical decisions are:

1. **Express 5** for the HTTP framework (clear winner over Express 4 for new projects).
2. **swagger-jsdoc** for API documentation (lowest friction, highest adoption).
3. **Multer memory storage** for file uploads (with size limits and optional disk fallback).
4. **Extended ConfigLoader** for unified configuration (single source of truth).
5. **Standard HTTP ETag headers** for concurrency control (leveraging existing Azure ETag support).
6. **Centralized error middleware** for error mapping (leveraging existing `AzureFsError` hierarchy).
