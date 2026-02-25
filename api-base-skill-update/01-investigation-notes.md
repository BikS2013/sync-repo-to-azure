# Investigation: 5 Key Features for API Skill Template Generalization

**Date**: 2026-02-23
**Source Project**: azure-storage-tool (`/Users/giorgosmarinos/aiwork/agent-platform/azure-storage-tool/`)
**Purpose**: Deep analysis of 5 features to inform the update of the `01-model-api-option.md` skill template.

---

## 1. Executive Summary

This investigation examines five production-quality patterns implemented in the azure-fs REST API that are currently absent from (or underspecified in) the generic API skill template. Each feature is analyzed with full code excerpts, design rationale, and notes on what must change for generalization.

**Key findings**:

1. **Granular Error Handling** -- A centralized Express error middleware maps a typed error hierarchy to HTTP status codes, sanitizes sensitive server-side errors, handles Multer upload errors, and wraps everything in a consistent `{ success, error, metadata }` envelope.

2. **Request Logging Middleware** -- A factory-function middleware that captures per-request timing via `res.on("finish")` and logs method/URL/status/duration to stderr. Never logs bodies (privacy by design).

3. **Timeout Middleware** -- A configurable per-request timer that fires HTTP 408 if the handler exceeds `requestTimeoutMs`. Cleans up on both `finish` and `close` events.

4. **Detailed Config Error Messages** -- A `ConfigError.missingRequired()` factory that generates multi-line error messages showing all three remediation paths (CLI flag, env var, config file) plus a command to auto-generate the config.

5. **Controller Separation** -- A three-layer architecture (route file -> controller factory -> service) where controllers are created via factory functions that receive services as arguments, and routes are thin wiring that maps HTTP verbs to controller methods.

**Cross-cutting patterns** shared across all five:
- Factory function pattern for dependency injection (no `new` keyword for middleware/controllers)
- Consistent response envelope: `{ success: boolean, data?: T, error?: { code, message, details? }, metadata: { timestamp, command?, durationMs? } }`
- Logger class injected via constructor parameter (not a global singleton)
- Every middleware is a `create*()` factory returning the actual Express middleware function

---

## 2. Feature 1: Granular Error Handling

**File**: `src/api/middleware/error-handler.middleware.ts` (154 lines)

### 2.1 Error Hierarchy

The application defines a typed error hierarchy rooted at `AzureFsError`:

```
AzureFsError (base)
  |-- ConfigError        -> 500 (server-side; sanitized message)
  |-- AuthError          -> 500 (most codes) / 403 (ACCESS_DENIED) / 502 (CONNECTION_FAILED)
  |-- BlobNotFoundError  -> 404
  |-- PathError          -> 400
  |-- MetadataError      -> 400
  |-- ConcurrentModificationError -> 412
```

**Base error class** (`src/errors/base.error.ts`):

```typescript
export class AzureFsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode?: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): { code: string; message: string; details?: unknown } {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}
```

Key design decisions:
- `code` is a machine-readable string (e.g., `"BLOB_NOT_FOUND"`, `"AUTH_MISSING_CONNECTION_STRING"`)
- `statusCode` is an optional hint embedded in the error itself (used as fallback in the middleware)
- `toJSON()` produces the standard error object shape for API responses
- `Object.setPrototypeOf` ensures `instanceof` works correctly with TypeScript class inheritance

### 2.2 HTTP Status Code Mapping

```typescript
function mapErrorToHttpStatus(err: AzureFsError): number {
  if (err instanceof ConfigError) return 500;
  if (err instanceof AuthError) {
    switch (err.code) {
      case "AUTH_ACCESS_DENIED":      return 403;
      case "AUTH_CONNECTION_FAILED":   return 502;
      default:                         return 500;
    }
  }
  if (err instanceof BlobNotFoundError)         return 404;
  if (err instanceof PathError)                  return 400;
  if (err instanceof MetadataError)              return 400;
  if (err instanceof ConcurrentModificationError) return 412;
  return err.statusCode || 500;  // fallback
}
```

**Design**: Uses `instanceof` checks in a priority chain. The final fallback reads `err.statusCode` (if the error class embedded one) or defaults to 500.

### 2.3 Message Sanitization

```typescript
function getSanitizedMessage(err: AzureFsError): string | null {
  if (err instanceof ConfigError) {
    return "Server configuration error. Contact the administrator.";
  }
  if (err instanceof AuthError) {
    if (err.code === "AUTH_ACCESS_DENIED" || err.code === "AUTH_CONNECTION_FAILED") {
      return null; // original message is safe
    }
    return "Server authentication error. Contact the administrator.";
  }
  return null; // original message is safe
}
```

**Rationale**: Config errors may contain file paths, env var names, or internal structure hints. Auth errors for missing credentials may reveal which auth method is configured. These are replaced with generic messages. Client-facing errors (not found, bad path, metadata validation, concurrency conflict) keep their original detailed messages.

### 2.4 The Middleware Factory

```typescript
export function createErrorHandlerMiddleware(logger: Logger) {
  return function errorHandlerMiddleware(
    err: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
  ): void {
    const timestamp = new Date().toISOString();

    // --- AzureFsError subclasses ---
    if (err instanceof AzureFsError) {
      const httpStatus = mapErrorToHttpStatus(err);
      const sanitizedMessage = getSanitizedMessage(err);
      logger.error(`[${err.code}] ${err.message}`, {
        code: err.code,
        httpStatus,
        ...(err.details ? { details: err.details as Record<string, unknown> } : {}),
      });
      const errorBody = sanitizedMessage
        ? { code: err.code, message: sanitizedMessage }
        : err.toJSON();
      res.status(httpStatus).json({
        success: false,
        error: errorBody,
        metadata: { timestamp },
      });
      return;
    }

    // --- MulterError (file upload errors) ---
    if (err && typeof err === "object" && "name" in err
        && (err as { name: string }).name === "MulterError") {
      const multerErr = err as unknown as { code: string; message: string; field?: string };
      logger.error(`MulterError: ${multerErr.code} - ${multerErr.message}`, {
        code: multerErr.code, field: multerErr.field,
      });
      const httpStatus = multerErr.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      const errorCode = multerErr.code === "LIMIT_FILE_SIZE"
        ? "UPLOAD_FILE_TOO_LARGE" : "UPLOAD_ERROR";
      res.status(httpStatus).json({
        success: false,
        error: { code: errorCode, message: multerErr.message },
        metadata: { timestamp },
      });
      return;
    }

    // --- Unknown errors ---
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;
    logger.error(`Unhandled error: ${errorMessage}`, { stack: errorStack });
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "An internal server error occurred." },
      metadata: { timestamp },
    });
  };
}
```

### 2.5 Response Envelope (Error Case)

All error responses follow this shape:

```json
{
  "success": false,
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Human-readable message",
    "details": {}  // optional, only for client-safe errors
  },
  "metadata": {
    "timestamp": "2026-02-23T12:00:00.000Z"
  }
}
```

### 2.6 Error Subclass Details

**ConfigError** (`src/errors/config.error.ts`) -- two factory methods:
- `ConfigError.missingRequired(paramName, cliFlagHint, envVarHint, configFileHint)` -- generates remediation guidance
- `ConfigError.invalidValue(paramName, value, allowedValues?)` -- shows what was wrong and what is allowed

**AuthError** (`src/errors/auth.error.ts`) -- five factory methods:
- `missingConnectionString()`, `missingSasToken()`, `sasTokenExpired(expiry)`, `azureAdFailed(originalError?)`, `invalidAuthMethod(method)`

**BlobNotFoundError** (`src/errors/blob-not-found.error.ts`) -- single constructor taking `blobPath`. Sets `statusCode: 404` directly.

**PathError** (`src/errors/path.error.ts`) -- four factory methods: `emptyPath()`, `tooLong(path)`, `invalidPath(path, reason)`, `localFileNotFound(filePath)`

**MetadataError** (`src/errors/metadata.error.ts`) -- three factory methods: `invalidKeyName(key)`, `totalSizeExceeded(size, max)`, `tooManyTags(count, max)`

**ConcurrentModificationError** (`src/errors/concurrent-modification.error.ts`) -- single constructor. Sets `statusCode: 412` directly.

---

## 3. Feature 2: Request Logging Middleware

**File**: `src/api/middleware/request-logger.middleware.ts` (26 lines)

### 3.1 Complete Implementation

```typescript
export function createRequestLoggerMiddleware(logger: Logger) {
  return function requestLoggerMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const startTime = Date.now();

    res.on("finish", () => {
      const durationMs = Date.now() - startTime;
      logger.info(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs}ms)`);
    });

    next();
  };
}
```

### 3.2 Analysis

| Aspect | Detail |
|--------|--------|
| **Pattern** | Factory function accepting `Logger` instance |
| **Timing mechanism** | `Date.now()` before `next()`, subtracted on `res.on("finish")` |
| **Log format** | `GET /api/v1/files/foo.txt -> 200 (12ms)` |
| **Output destination** | Logger writes to stderr (keeps stdout clean for JSON output) |
| **Privacy** | Never logs request body, response body, or headers |
| **Registration order** | Registered as step 3 in `server.ts`, after CORS and JSON parser |

### 3.3 Logger Utility

The `Logger` class (`src/utils/logger.utils.ts`) is a lightweight level-based logger:

```typescript
export class Logger {
  private level: LogLevel;
  private verbose: boolean;

  constructor(level: LogLevel, verbose: boolean = false) {
    this.level = level;
    this.verbose = verbose;
    if (this.verbose) this.level = "debug";
  }

  // debug(), info(), warn(), error() methods
  // All write to process.stderr in format:
  // [2026-02-23T12:00:00.000Z] [INFO] message {"key":"value"}
}
```

Also provides a `NullLogger` subclass (all methods are no-ops) for pre-configuration scenarios.

---

## 4. Feature 3: Timeout Middleware

**File**: `src/api/middleware/timeout.middleware.ts` (44 lines)

### 4.1 Complete Implementation

```typescript
export function createTimeoutMiddleware(timeoutMs: number) {
  return function timeoutMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({
          success: false,
          error: {
            code: "REQUEST_TIMEOUT",
            message: `Request timed out after ${timeoutMs}ms.`,
          },
          metadata: {
            timestamp: new Date().toISOString(),
          },
        });
      }
    }, timeoutMs);

    // Clear the timer when the response finishes
    res.on("finish", () => {
      clearTimeout(timer);
    });

    // Also clear on close (client disconnect)
    res.on("close", () => {
      clearTimeout(timer);
    });

    next();
  };
}
```

### 4.2 Analysis

| Aspect | Detail |
|--------|--------|
| **Pattern** | Factory function accepting `timeoutMs: number` |
| **Guard** | `!res.headersSent` prevents writing after response is already sent |
| **HTTP status** | 408 Request Timeout |
| **Response format** | Same `{ success, error, metadata }` envelope as all other errors |
| **Cleanup: finish** | `res.on("finish")` clears timer when response completes normally |
| **Cleanup: close** | `res.on("close")` clears timer when client disconnects early |
| **Registration order** | Step 4 in `server.ts`, after request logger |
| **Configuration source** | `config.api.requestTimeoutMs` (validated as integer >= 1000) |

### 4.3 Design Note

The timeout does NOT abort the underlying handler. If the handler continues running after the 408 is sent, it will eventually finish, but the response is already sent. This is a pragmatic approach -- the client gets a fast failure signal while the server-side work may or may not complete.

---

## 5. Feature 4: Detailed Config Error Messages

**Files**:
- `src/config/config.schema.ts` (364 lines)
- `src/config/config.loader.ts` (275 lines)
- `src/errors/config.error.ts` (53 lines)

### 5.1 The `ConfigError.missingRequired()` Factory

```typescript
static missingRequired(
  paramName: string,
  cliFlagHint: string,
  envVarHint: string,
  configFileHint: string,
): ConfigError {
  const message =
    `Missing required configuration: ${paramName}\n\n` +
    `Provide it via one of the following methods:\n` +
    `  - CLI flag:          ${cliFlagHint}\n` +
    `  - Environment var:   ${envVarHint}\n` +
    `  - Config file:       ${configFileHint}\n\n` +
    `Run 'azure-fs config init' to create a configuration file interactively.`;

  return new ConfigError("CONFIG_MISSING_REQUIRED", message, { paramName });
}
```

### 5.2 Usage Pattern in `config.schema.ts`

Every required field follows this exact pattern:

```typescript
if (!storage["accountUrl"]) {
  throw ConfigError.missingRequired(
    "storage.accountUrl",
    "--account-url https://myaccount.blob.core.windows.net",
    "export AZURE_STORAGE_ACCOUNT_URL=https://myaccount.blob.core.windows.net",
    '{ "storage": { "accountUrl": "https://myaccount.blob.core.windows.net" } }',
  );
}
```

Each call provides:
1. **Parameter name** (dot-path in config): `"storage.accountUrl"`
2. **CLI flag hint**: `"--account-url https://myaccount.blob.core.windows.net"`
3. **Env var hint**: `"export AZURE_STORAGE_ACCOUNT_URL=https://myaccount.blob.core.windows.net"`
4. **Config file hint**: `'{ "storage": { "accountUrl": "https://..." } }'`

For parameters not available via CLI, the hint says: `"(not available as CLI flag, use env var or config file)"`

### 5.3 The `ConfigError.invalidValue()` Factory

```typescript
static invalidValue(
  paramName: string,
  value: unknown,
  allowedValues?: string[],
): ConfigError {
  let message = `Invalid configuration value for ${paramName}: "${value}"`;
  if (allowedValues && allowedValues.length > 0) {
    message += `\nAllowed values: ${allowedValues.join(", ")}`;
  }
  return new ConfigError("CONFIG_INVALID_VALUE", message, {
    paramName, value, allowedValues,
  });
}
```

Used for enum validation:

```typescript
const authMethod = storage["authMethod"] as string;
if (!VALID_AUTH_METHODS.includes(authMethod as AuthMethod)) {
  throw ConfigError.invalidValue("storage.authMethod", authMethod, VALID_AUTH_METHODS);
}
```

And for numeric range validation:

```typescript
const port = Number(api["port"]);
if (isNaN(port) || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw ConfigError.invalidValue("api.port", api["port"], ["integer between 1 and 65535"]);
}
```

### 5.4 Validation Architecture

The validation is split into two functions:

1. **`validateConfig(merged)`** -- validates base config sections (storage, logging, retry, batch). Called for both CLI and API modes.
2. **`validateApiConfig(api)`** -- validates API-specific section (port, host, corsOrigins, swaggerEnabled, uploadMaxSizeMb, requestTimeoutMs). Called only when starting the API server.

The loader (`config.loader.ts`) orchestrates:

```typescript
export function resolveApiConfig(cliOptions?: CliOptions): ApiResolvedConfig {
  const merged = buildMergedConfig(opts);
  const baseConfig = validateConfig(merged);       // throws for missing base config
  const apiConfig = validateApiConfig(apiSection);  // throws for missing API config
  return { ...baseConfig, api: apiConfig };
}
```

### 5.5 Zero-Default Philosophy

The schema enforces a strict no-default-value policy. Every field must be explicitly provided. Even boolean fields like `logging.logRequests` require explicit `true` or `false` -- there is no assumed default. This is a deliberate design principle stated in the project's CLAUDE.md:

> You must never create fallback solutions for configuration settings. In every case a configuration setting is not provided you must raise the appropriate exception.

---

## 6. Feature 5: Controller Separation

**Files analyzed**:
- `src/api/controllers/file.controller.ts` (229 lines)
- `src/api/controllers/folder.controller.ts` (105 lines)
- `src/api/routes/file.routes.ts` (264 lines)
- `src/api/routes/folder.routes.ts` (150 lines)
- `src/api/routes/index.ts` (68 lines)

### 6.1 Three-Layer Architecture

```
Route File (HTTP wiring)
    |
    v
Controller Factory (request/response handling)
    |
    v
Service (business logic)
```

### 6.2 Controller Factory Pattern

Controllers are created via factory functions that receive service dependencies:

**File controller** (`src/api/controllers/file.controller.ts`):

```typescript
export function createFileController(blobService: BlobFileSystemService) {
  return {
    async upload(req: Request, res: Response): Promise<void> { ... },
    async download(req: Request, res: Response): Promise<void> { ... },
    async deleteFile(req: Request, res: Response): Promise<void> { ... },
    async replace(req: Request, res: Response): Promise<void> { ... },
    async info(req: Request, res: Response): Promise<void> { ... },
    async exists(req: Request, res: Response): Promise<void> { ... },
  };
}
```

**Folder controller** (`src/api/controllers/folder.controller.ts`):

```typescript
export function createFolderController(blobService: BlobFileSystemService) {
  return {
    async list(req: Request, res: Response): Promise<void> { ... },
    async create(req: Request, res: Response): Promise<void> { ... },
    async deleteFolder(req: Request, res: Response): Promise<void> { ... },
    async exists(req: Request, res: Response): Promise<void> { ... },
  };
}
```

### 6.3 The `buildResponse()` Helper

Used in controllers to construct the success response envelope:

```typescript
function buildResponse<T>(command: string, data: T, startTime: number) {
  return {
    success: true,
    data,
    metadata: {
      command,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    },
  };
}
```

**Note**: This helper is defined locally in each controller file (not shared). The folder controller inlines the same structure without using the helper. This is a minor inconsistency that could be unified in a generic template.

### 6.4 Success Response Envelope

```json
{
  "success": true,
  "data": { /* operation-specific payload */ },
  "metadata": {
    "command": "api:upload",
    "timestamp": "2026-02-23T12:00:00.000Z",
    "durationMs": 42
  }
}
```

### 6.5 Route Factory Pattern

Route files create an Express `Router`, instantiate the controller, and wire HTTP verbs:

```typescript
export function createFileRoutes(
  blobService: BlobFileSystemService,
  apiConfig: ApiConfig,
): Router {
  const router = Router();
  const controller = createFileController(blobService);
  const upload = createUploadMiddleware(apiConfig);

  router.post("/", upload.single("file"), controller.upload);
  router.get("/info/*path", controller.info);
  router.get("/*path", controller.download);
  router.head("/*path", controller.exists);
  router.delete("/*path", controller.deleteFile);
  router.put("/*path", upload.single("file"), controller.replace);

  return router;
}
```

```typescript
export function createFolderRoutes(blobService: BlobFileSystemService): Router {
  const router = Router();
  const controller = createFolderController(blobService);

  router.get("/*path", controller.list);
  router.post("/*path", controller.create);
  router.delete("/*path", controller.deleteFolder);
  router.head("/*path", controller.exists);

  return router;
}
```

### 6.6 Route Registration Barrel

`src/api/routes/index.ts` defines an `ApiServices` interface and a single `registerApiRoutes()` function:

```typescript
export interface ApiServices {
  blobService: BlobFileSystemService;
  metadataService: MetadataService;
  config: ApiResolvedConfig;
  logger: Logger;
}

export function registerApiRoutes(app: Express, services: ApiServices): void {
  app.use("/api/health", createHealthRoutes(config));
  app.use("/api/v1/files", createFileRoutes(services.blobService, config.api));
  app.use("/api/v1/edit", createEditRoutes(services.blobService, config.api));
  app.use("/api/v1/folders", createFolderRoutes(services.blobService));
  app.use("/api/v1/meta", createMetaRoutes(services.metadataService));
  app.use("/api/v1/tags", createTagRoutes(services.metadataService));

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: { code: "NOT_FOUND", message: `Route not found: ${_req.method} ${_req.originalUrl}` },
      metadata: { timestamp: new Date().toISOString() },
    });
  });
}
```

### 6.7 Controller Design Principles

1. **No try/catch in controllers** -- Express 5 auto-forwards async errors to the error handler middleware.
2. **Controllers are thin adapters** -- extract params from `req`, call service, format response via `buildResponse()` or inline envelope.
3. **Inline validation** for request-level issues (missing file, missing path) -- returns 400 directly without going through the error middleware.
4. **Controllers never import or instantiate services** -- they receive them as factory function arguments.

### 6.8 The `extractPath()` Helper

Both file and folder controllers define a local `extractPath()` function for Express 5 wildcard compatibility:

```typescript
function extractPath(params: Record<string, unknown>): string {
  const pathParam = params["path"];
  if (Array.isArray(pathParam)) {
    return pathParam.join("/");
  }
  return String(pathParam || "");
}
```

---

## 7. Cross-Cutting Patterns

### 7.1 Factory Function Pattern (Dependency Injection)

Every middleware, controller, and route creator uses this pattern:

```typescript
export function create<Component>(dependency1: Type1, dependency2?: Type2) {
  return /* the actual middleware/controller/router */;
}
```

**Examples**:
- `createErrorHandlerMiddleware(logger)` returns Express 4-arg error handler
- `createRequestLoggerMiddleware(logger)` returns Express middleware
- `createTimeoutMiddleware(timeoutMs)` returns Express middleware
- `createUploadMiddleware(apiConfig)` returns Multer instance
- `createFileController(blobService)` returns controller object
- `createFileRoutes(blobService, apiConfig)` returns Express Router

This avoids global singletons and makes testing straightforward.

### 7.2 Consistent Response Envelope

**All responses** (success, error, 404, timeout) follow one of two shapes:

**Success**:
```json
{
  "success": true,
  "data": { ... },
  "metadata": { "command": "...", "timestamp": "...", "durationMs": N }
}
```

**Error**:
```json
{
  "success": false,
  "error": { "code": "...", "message": "...", "details": {} },
  "metadata": { "timestamp": "..." }
}
```

### 7.3 Middleware Ordering in `server.ts`

```typescript
// 1. CORS (handles OPTIONS preflight)
app.use(cors({ ... }));
// 2. JSON body parser
app.use(express.json({ limit: "10mb" }));
// 3. Request logger
app.use(createRequestLoggerMiddleware(logger));
// 4. Timeout
app.use(createTimeoutMiddleware(config.api.requestTimeoutMs));
// 5. Swagger (optional, before routes)
if (config.api.swaggerEnabled) { ... }
// 6. Routes (includes 404 catch-all at end)
registerApiRoutes(app, services);
// 7. Error handler (LAST -- Express 4-arg signature)
app.use(createErrorHandlerMiddleware(logger));
```

### 7.4 App Factory vs Server Startup

```typescript
// Pure factory -- no side effects, testable
export function createApp(config, blobService, metadataService, logger): Express { ... }

// Side-effectful startup -- creates services, starts listening, handles signals
export async function startServer(): Promise<void> { ... }
```

### 7.5 Graceful Shutdown

```typescript
const SHUTDOWN_TIMEOUT_MS = 10_000;
let shutdownInProgress = false;

function gracefulShutdown(signal: string): void {
  if (shutdownInProgress) {
    process.exit(1); // double-signal forces immediate exit
  }
  shutdownInProgress = true;
  server.close(() => { process.exit(0); });
  setTimeout(() => { process.exit(1); }, SHUTDOWN_TIMEOUT_MS).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
```

---

## 8. Generalization Notes

The following changes are needed to port these patterns into a generic skill template:

### 8.1 Error Handling Generalization

| Azure-specific | Generic replacement |
|----------------|---------------------|
| `AzureFsError` base class | `AppError` base class |
| `BlobNotFoundError` | `NotFoundError` or `ResourceNotFoundError` |
| `PathError` | `ValidationError` (for input validation failures) |
| `MetadataError` | `ValidationError` (merge with PathError generalization) |
| `ConcurrentModificationError` | `ConflictError` or `ConcurrentModificationError` (this is generic enough) |
| `ConfigError` | Keep as-is (already generic) |
| `AuthError` | Keep as-is (already generic) |
| `MulterError` handling | Keep (any project using file uploads will need this) |

The **error-to-HTTP-status mapping** should be presented as a configurable table that the user extends per their domain:

```typescript
const ERROR_STATUS_MAP: Map<Function, number | ((err) => number)> = new Map([
  [ConfigError, 500],
  [AuthError, (err) => err.code === "ACCESS_DENIED" ? 403 : 500],
  [NotFoundError, 404],
  [ValidationError, 400],
  [ConflictError, 409],
  [ConcurrentModificationError, 412],
]);
```

### 8.2 Config Error Messages

The `ConfigError.missingRequired()` pattern is already generic. The skill template should:
- Include the `missingRequired(paramName, cliFlagHint, envVarHint, configFileHint)` factory pattern
- Show how to adapt the "Run `<tool> config init`" guidance line to the specific project
- Emphasize the zero-default philosophy as a configurable policy

### 8.3 Middleware

All three middleware (request logger, timeout, error handler) are already generic Express patterns. The skill template should:
- Include them as standard middleware files with the factory pattern
- Show the correct ordering (CORS -> body parser -> logger -> timeout -> routes -> error handler)
- Make the timeout configurable via the same config system

### 8.4 Controller Separation

The three-layer pattern is fully generic. The skill template should:
- Define the `buildResponse()` helper as a **shared utility** (not duplicated per controller)
- Show the route factory -> controller factory -> service pattern
- Include the `ApiServices` interface pattern for dependency aggregation
- Show the 404 catch-all at the end of route registration

### 8.5 Response Envelope

The `{ success, data/error, metadata }` envelope is already generic. The skill template should:
- Define a `buildSuccessResponse<T>(command, data, startTime)` utility
- Define a `buildErrorResponse(code, message, details?)` utility
- Make the `metadata.command` field a convention (e.g., `"api:resource:action"`)

### 8.6 What to Remove (Azure-Specific)

- All references to `BlobFileSystemService`, `MetadataService`
- Azure-specific error codes (`BLOB_NOT_FOUND`, `AUTH_MISSING_CONNECTION_STRING`, etc.)
- Azure-specific config fields (`accountUrl`, `containerName`, `authMethod`, `sasTokenExpiry`)
- Azure-specific env var names (`AZURE_STORAGE_*`, `AZURE_FS_*`)
- The `extractPath()` helper (Express 5 wildcard handling is useful but project-specific)

### 8.7 What to Keep As-Is

- The factory function pattern for all components
- The `createApp()` / `startServer()` separation
- The graceful shutdown logic
- The Logger class with level-based filtering and stderr output
- The NullLogger for pre-configuration scenarios
- The response envelope structure
- The middleware ordering
- The route registration barrel pattern
- The controller factory pattern
- The Swagger/OpenAPI integration pattern
- The upload middleware (Multer) pattern

---

## Appendix: File Index

| File | Lines | Role |
|------|-------|------|
| `src/api/middleware/error-handler.middleware.ts` | 154 | Centralized error handling |
| `src/api/middleware/request-logger.middleware.ts` | 26 | Request logging |
| `src/api/middleware/timeout.middleware.ts` | 44 | Request timeout |
| `src/api/middleware/upload.middleware.ts` | 21 | Multer file upload |
| `src/api/server.ts` | 164 | App factory + server startup |
| `src/api/routes/index.ts` | 68 | Route registration barrel |
| `src/api/routes/file.routes.ts` | 264 | File route wiring + OpenAPI |
| `src/api/routes/folder.routes.ts` | 150 | Folder route wiring + OpenAPI |
| `src/api/controllers/file.controller.ts` | 229 | File controller factory |
| `src/api/controllers/folder.controller.ts` | 105 | Folder controller factory |
| `src/config/config.schema.ts` | 364 | Config validation (no defaults) |
| `src/config/config.loader.ts` | 275 | Config loading + merging |
| `src/errors/base.error.ts` | 29 | Base error class |
| `src/errors/config.error.ts` | 53 | Config error with factories |
| `src/errors/auth.error.ts` | 79 | Auth error with factories |
| `src/errors/blob-not-found.error.ts` | 17 | Not-found error |
| `src/errors/path.error.ts` | 54 | Path validation error |
| `src/errors/metadata.error.ts` | 47 | Metadata validation error |
| `src/errors/concurrent-modification.error.ts` | 20 | Concurrency error |
| `src/utils/logger.utils.ts` | 91 | Logger + NullLogger |
| `src/types/api-config.types.ts` | 25 | API config types |
