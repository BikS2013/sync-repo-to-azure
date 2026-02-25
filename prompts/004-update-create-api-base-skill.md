# Prompt: Update `create-api-base` Skill with Azure FS REST API Patterns

## Context

The `create-api-base` skill (located at `/Users/giorgosmarinos/.claude/skills/create-api-base/01-model-api-option.md`) is a reusable blueprint for creating Express.js 5.x TypeScript API projects. The Azure FS REST API implementation (under `src/api/` in the `azure-storage-tool` project) introduced several production-hardened patterns that are missing from the skill. A deviation analysis has already been completed and is available at `docs/design/api-skill-deviation-analysis.md`.

This prompt defines a structured workflow to backport 5 specific features from the Azure FS REST API into the skill's model API guide, making the skill produce more robust APIs by default.

All documentation produced during this work must go under the `api-base-skill-update/` folder at the project root.

---

## Features to Introduce

### Feature 1: Granular Error Handling

A centralized error handler middleware that:
- Is created via a **factory function** accepting a Logger dependency (`createErrorHandlerMiddleware(logger)`)
- Maps different application error types to appropriate HTTP status codes (400, 403, 404, 408, 412, 413, 500, 502)
- Sanitizes sensitive errors (config/auth errors return generic messages; domain errors forward their messages)
- Handles Multer upload errors specifically (413 for `LIMIT_FILE_SIZE`, 400 for other upload errors)
- Returns a standardized error envelope: `{ success: false, error: { code, message }, metadata: { timestamp } }`
- Never includes stack traces in responses (logs them internally instead)
- For unknown/unhandled errors, returns a generic "Internal server error" with code `INTERNAL_ERROR`

**Reference implementation**: `src/api/middleware/error-handler.middleware.ts`

### Feature 2: Request Logging Middleware

A factory-function middleware that:
- Is created via `createRequestLoggerMiddleware(logger)` accepting a Logger dependency
- Logs every HTTP request in the format: `METHOD URL -> STATUS (DURATIONms)`
- Measures timing from request start to the response `finish` event
- Never logs request or response bodies
- Uses the Logger class (writes to stderr) rather than `console.log`

**Reference implementation**: `src/api/middleware/request-logger.middleware.ts`

### Feature 3: Timeout Middleware

A per-request timeout middleware that:
- Is created via `createTimeoutMiddleware(timeoutMs)` factory function
- Sets a `setTimeout` timer per request
- If the timer fires and headers have not been sent, responds with HTTP 408 and the standard error envelope: `{ success: false, error: { code: "REQUEST_TIMEOUT", message }, metadata: { timestamp } }`
- Clears the timer on both `finish` and `close` response events (handles normal completion and client disconnection)
- Accepts `timeoutMs` as a parameter (sourced from configuration)

**Reference implementation**: `src/api/middleware/timeout.middleware.ts`

### Feature 4: Detailed Error Messages for Missing Configuration

When a required configuration variable is missing, the error message must:
- Name the missing parameter explicitly
- Provide remediation guidance showing how to supply the value via each configuration source
- Include concrete examples for each method

The pattern is:
```
Missing required configuration: <paramName>

Provide it via one of the following methods:
  - Environment var:   export <ENV_VAR>=<example_value>
  - Config file:       { "<section>": { "<key>": <example_value> } }
```

For the skill (which uses `.env` files as the primary config source), adapt the pattern to show `.env` file and environment variable examples. The key principle is: **every missing config error must be immediately actionable** by the developer reading it.

**Reference implementation**: `src/errors/config.error.ts` (the `ConfigError.missingRequired()` static factory) and `src/config/config.schema.ts` (where it is called for every required field)

### Feature 5: Controller Separation

Separating route handlers into dedicated controller files using:
- A **factory pattern** where controllers are created with injected service dependencies: `createXxxController(service)`
- The factory returns an object with async handler methods (e.g., `{ upload, download, deleteFile, replace, info, exists }`)
- A `buildResponse()` helper that constructs the standard success envelope: `{ success: true, data, metadata: { command, timestamp, durationMs } }`
- Routes stay thin -- they only wire HTTP verbs/paths to controller methods and apply per-route middleware (like upload)
- Controllers contain all request parsing, service calls, and response formatting
- Express 5 auto-forwards async errors, so controllers do not need try/catch blocks

**Reference implementation**: `src/api/controllers/file.controller.ts` (controller) and `src/api/routes/file.routes.ts` (thin routes)

---

## Workflow Phases

### Phase 1: Investigation

**Objective**: Deeply understand each of the 5 features as they exist in the Azure FS implementation.

**Tasks**:
1. Read and document each reference implementation file listed above
2. For each feature, capture:
   - The exact function signature and parameters
   - The dependency injection pattern used
   - The response/error format produced
   - How the middleware/component fits into the Express middleware chain (ordering)
   - Any edge cases handled
3. Read the deviation analysis at `docs/design/api-skill-deviation-analysis.md` to understand the full context of differences
4. Read the current skill file at `/Users/giorgosmarinos/.claude/skills/create-api-base/01-model-api-option.md` to understand the existing structure and conventions
5. Identify the exact sections in the skill that need modification or where new sections must be added

**Output**: Create `api-base-skill-update/01-investigation-notes.md` documenting findings for all 5 features with code extracts and section-mapping to the skill.

### Phase 2: Planning

**Objective**: Create a detailed plan for how each feature will be integrated into the skill.

**Tasks**:
1. For each of the 5 features, define:
   - Which existing skill sections need modification
   - Which new sections need to be added
   - The insertion point relative to existing content
   - Dependencies between features (e.g., the error handler references the error envelope which is used by the timeout middleware)
2. Define the order of implementation (respect dependencies)
3. Identify any existing skill content that must be replaced vs. augmented
4. Decide how the 5 features interact with existing skill patterns:
   - The `errorHandler.ts` in the skill is a simple function -- it must be replaced with the granular version
   - The `AppConfigurationManager.validateRequiredConfigs()` has simple error messages -- they must be enhanced
   - Routes in the skill have inline handlers -- they must be refactored to use controllers
   - New middleware files must be added to the skill's project structure and Module Architecture Diagram
5. Update the Module Responsibilities table and Mermaid diagrams in the plan

**Output**: Create `api-base-skill-update/02-implementation-plan.md` with the ordered plan.

### Phase 3: Design

**Objective**: Draft the exact code and documentation content that will go into the skill.

**Tasks**:
1. Draft the new `errorHandler.ts` middleware section for the skill, generalized (not Azure-specific):
   - Define a generic `AppError` base class pattern with `code`, `message`, `statusCode`
   - Show the error-type-to-HTTP-status mapping as an extensible pattern
   - Include the sanitization concept
   - Include Multer error handling
   - Use the standardized error envelope
2. Draft the `requestLogger.ts` middleware section (portable as-is)
3. Draft the `timeoutMiddleware.ts` section (portable as-is)
4. Draft the updated `EnvironmentManager.validateConfiguration()` or a new `ConfigValidator` section with detailed error messages per missing variable, showing `.env` file and env var examples
5. Draft a sample controller (e.g., `healthController.ts`) and update the existing `healthRoutes.ts` to use it, demonstrating the controller separation pattern
6. Update the project structure listing to include new files:
   - `src/middleware/requestLogger.ts`
   - `src/middleware/timeoutMiddleware.ts`
   - `src/controllers/` directory
7. Update the Module Architecture Diagram (Mermaid) to include:
   - Request Logger middleware
   - Timeout middleware
   - Controllers layer
8. Update the Module Invocation Sequence (Mermaid) to show the new middleware in the request flow
9. Update the Module Responsibilities table

**Output**: Create `api-base-skill-update/03-design-draft.md` with all drafted sections, clearly marked by insertion point in the skill.

### Phase 4: Implementation

**Objective**: Apply the designed changes to the actual skill file.

**Tasks**:
1. Make a backup of the current skill file (copy to `api-base-skill-update/01-model-api-option.md.backup`)
2. Apply changes to `/Users/giorgosmarinos/.claude/skills/create-api-base/01-model-api-option.md` in this order:
   a. **Feature 4** - Update error messages in `EnvironmentManager.validateConfiguration()` and `AppConfigurationManager` with detailed remediation guidance
   b. **Feature 1** - Replace the existing `errorHandler.ts` section (Section 9) with the granular version
   c. **Feature 2** - Add the request logger middleware as a new section after the error handler
   d. **Feature 3** - Add the timeout middleware as a new section after the request logger
   e. **Feature 5** - Refactor the health routes to use a controller pattern, add a controllers section
   f. Update the `app.ts` section (Section 4) to register the new middleware in the correct order:
      - CORS
      - JSON body parser
      - Request Logger
      - Timeout middleware
      - Swagger UI
      - Routes
      - Error handler (last)
   g. Update the project structure listing
   h. Update the Module Architecture Diagram
   i. Update the Module Invocation Sequence
   j. Update the Module Responsibilities table
   k. Update the Best Practices section to reference the new patterns
3. Ensure all code blocks compile conceptually (correct TypeScript types, imports, exports)
4. Ensure consistency: the error envelope format must be the same in the error handler, timeout middleware, and controllers

**Output**: The updated skill file at `/Users/giorgosmarinos/.claude/skills/create-api-base/01-model-api-option.md`

### Phase 5: Validation

**Objective**: Verify the updated skill is complete, consistent, and correct.

**Tasks**:
1. Review the updated skill end-to-end for:
   - Internal consistency (all sections reference the same patterns, types, and formats)
   - No orphaned references (if a section references a file/class, that file/class is defined)
   - Correct middleware ordering in `app.ts`
   - All new files appear in the project structure listing
   - All new modules appear in the Mermaid diagrams and Module Responsibilities table
   - The error envelope `{ success, error: { code, message }, metadata: { timestamp } }` is consistent everywhere
   - The factory function pattern is consistent (all middleware and controllers use it)
2. Cross-reference with the deviation analysis to confirm the 5 features are addressed
3. Check that no Azure-specific content leaked into the generic skill (no references to blobs, Azure SDK, etc.)
4. Verify the skill still contains all its original features (port checking, Swagger, health checks, etc.) -- nothing was accidentally removed
5. Create a checklist audit document

**Output**: Create `api-base-skill-update/04-validation-audit.md` with the audit results and any remaining issues.

---

## Key Principles to Follow

1. **Generalize, do not copy**: The Azure FS implementation is domain-specific (Azure Blob Storage). The skill must present these patterns in a generic, reusable form that applies to any Express.js API project.

2. **Maintain the no-fallback rule**: The skill's strict "no default values for configuration" philosophy must be preserved. The detailed error messages reinforce this -- they tell the developer exactly what to set, not silently use a default.

3. **Factory function pattern**: All middleware and controllers must use the factory function pattern with dependency injection (accepting Logger, config values, or services as parameters). This is consistent with the skill's existing patterns.

4. **Standardized response envelope**: Both success and error responses must use a consistent envelope format throughout the skill.

5. **No emojis in code or output**: The Azure FS implementation does not use emojis. The skill currently uses emojis in console output (via chalk). This is an existing pattern in the skill and can remain, but the new middleware code must not add emojis.

6. **Preserve existing skill structure**: The skill is organized with numbered sections (1-12). New sections should follow the existing numbering scheme or be inserted logically.

---

## Reference Files

| File | Location | Purpose |
|------|----------|---------|
| Deviation analysis | `docs/design/api-skill-deviation-analysis.md` | Full gap analysis between skill and implementation |
| Current skill | `/Users/giorgosmarinos/.claude/skills/create-api-base/01-model-api-option.md` | The file to be updated |
| Error handler middleware | `src/api/middleware/error-handler.middleware.ts` | Feature 1 reference |
| Request logger middleware | `src/api/middleware/request-logger.middleware.ts` | Feature 2 reference |
| Timeout middleware | `src/api/middleware/timeout.middleware.ts` | Feature 3 reference |
| ConfigError class | `src/errors/config.error.ts` | Feature 4 reference (error factory) |
| Config schema validation | `src/config/config.schema.ts` | Feature 4 reference (usage of detailed errors) |
| File controller | `src/api/controllers/file.controller.ts` | Feature 5 reference (controller pattern) |
| File routes | `src/api/routes/file.routes.ts` | Feature 5 reference (thin routes) |
| Route barrel | `src/api/routes/index.ts` | Feature 5 reference (centralized registration) |
| Server / app factory | `src/api/server.ts` | Middleware ordering and app composition |
