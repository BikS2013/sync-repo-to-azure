<objective>
Extend the azure-fs tool with a new "repo" command group that replicates complete Git repositories
(from GitHub and Azure DevOps) into Azure Blob Storage folders. The feature must be available
through both the CLI and REST API interfaces. All project documentation must be updated according
to the project's CLAUDE.md instructions.

This is a complex, multi-phase task. Thoroughly analyze each phase before proceeding.
Consider multiple approaches and deeply evaluate trade-offs at each architectural decision point.
</objective>

<context>
The azure-fs tool is a TypeScript CLI and REST API application that presents Azure Blob Storage
as a virtual file system. It uses Commander.js for the CLI, Express 5 for the API, and the
@azure/storage-blob SDK for Azure operations.

Before starting, read the following project files to understand the existing architecture,
patterns, and conventions:

- Read `CLAUDE.md` for project instructions and tool documentation format
- Read `cli-instructions.md` for CLI command documentation patterns
- Read `api-instructions.md` for API endpoint documentation patterns
- Read `docs/design/project-design.md` for architectural patterns
- Read `docs/design/project-functions.md` for functional requirement patterns
- Read `docs/design/configuration-guide.md` for configuration documentation patterns
- Read `src/commands/index.ts` for command registration pattern
- Read `src/commands/file.commands.ts` for CLI command implementation patterns
- Read `src/api/routes/index.ts` for API route registration pattern
- Read `src/api/routes/file.routes.ts` for API route implementation patterns
- Read `src/api/controllers/file.controller.ts` for controller implementation patterns
- Read `src/services/blob-filesystem.service.ts` for service layer patterns
- Read `src/types/index.ts` for type export patterns
- Read `src/errors/base.error.ts` for error class patterns
- Read `src/config/config.loader.ts` for configuration loading patterns
- Read `src/config/config.schema.ts` for configuration validation patterns
- Read `package.json` for current dependencies
</context>

<workflow>
Execute the following phases sequentially. Each phase builds on the previous one.
Do not skip phases. Complete each phase fully before moving to the next.

<!-- ================================================================== -->
<!-- PHASE 1: RESEARCH AND INVESTIGATION                                -->
<!-- ================================================================== -->

<phase name="1-research" title="Research and Investigation">
<objective>
Research the GitHub and Azure DevOps REST APIs to understand how to programmatically
access and download repository contents. Identify the best approach for each platform.
</objective>

<research_tasks>

<task name="1.1" title="GitHub Repository Content Access">
Research the GitHub REST API for downloading repository contents. Investigate:

1. **GitHub REST API - Repository Contents endpoint**:
   - GET /repos/{owner}/{repo}/contents/{path} - for individual files
   - The "Download a repository archive" endpoint (GET /repos/{owner}/{repo}/tarball/{ref} or zipball/{ref})
   - The Git Trees API (GET /repos/{owner}/{repo}/git/trees/{tree_sha}?recursive=1) for listing all files

2. **Authentication options**:
   - Unauthenticated access (rate-limited to 60 requests/hour)
   - Personal Access Token (PAT) via Authorization header
   - GitHub App tokens
   - Determine which is most practical for a CLI tool

3. **Rate limits and pagination**:
   - API rate limits for authenticated vs unauthenticated requests
   - How to handle repositories with thousands of files
   - Pagination patterns in the GitHub API

4. **Large file handling**:
   - GitHub API file size limits (files > 1MB via Contents API)
   - How to handle Git LFS files
   - Binary file handling

5. **Branch/tag/commit reference support**:
   - How to specify which ref (branch, tag, commit SHA) to download
   - Default branch detection

6. **Approach evaluation** - Compare these strategies:
   - **Strategy A**: Use the tarball/zipball archive endpoint (download entire repo as archive, extract, upload files)
   - **Strategy B**: Use the Git Trees API to list all files, then download each file individually
   - **Strategy C**: Use the Contents API recursively to walk the directory tree

   For each strategy, evaluate: API call count, rate limit impact, memory usage, large repo handling,
   binary file support, and implementation complexity.
</task>

<task name="1.2" title="Azure DevOps Repository Content Access">
Research the Azure DevOps REST API for downloading repository contents. Investigate:

1. **Azure DevOps REST API - Git Items endpoint**:
   - GET /{organization}/{project}/_apis/git/repositories/{repositoryId}/items
   - The Items endpoint with recursionLevel parameter
   - The Blobs endpoint for downloading file content

2. **Authentication options**:
   - Personal Access Token (PAT) via Basic auth header
   - Azure AD / OAuth tokens
   - How the azure-fs tool's existing Azure AD auth could be reused

3. **API version and pagination**:
   - Required api-version query parameter
   - How to handle large repositories (pagination, batch endpoints)

4. **Branch/tag/commit reference support**:
   - versionDescriptor parameter (branch, tag, commit)
   - Default branch detection

5. **Large file and binary handling**:
   - File content retrieval options (json with base64, raw stream)
   - Maximum file sizes

6. **Approach evaluation** - Compare these strategies:
   - **Strategy A**: Use zip download endpoint (GET items?path=/&$format=zip)
   - **Strategy B**: Use Items API with recursionLevel=Full to list all items, then download each
   - **Strategy C**: Recursive tree walking using the Items API

   For each strategy, evaluate the same criteria as GitHub.
</task>

<task name="1.3" title="Determine NPM Package Dependencies">
Based on the research findings, determine:

1. Whether to use the `@octokit/rest` package for GitHub API access, or plain HTTP requests
2. Whether to use the `azure-devops-node-api` package for Azure DevOps, or plain HTTP requests
3. Whether an archive extraction library is needed (e.g., `tar`, `adm-zip`, `unzipper`)
4. Evaluate the trade-off: additional dependencies vs implementation simplicity
5. For each potential dependency, check: bundle size, maintenance status, TypeScript support, license compatibility

Recommendation: Prefer minimal dependencies. If plain `fetch` (Node.js 18+ built-in) with
well-typed interfaces provides sufficient capability, prefer that over heavy SDK packages.
</task>

</research_tasks>

<deliverable>
Save research findings to: `docs/design/research-repo-replication.md`

The document must include:
- Summary of each API investigated
- Chosen strategy for each platform with justification
- Dependency decisions with rationale
- Identified risks, limitations, and edge cases
- Rate limit mitigation strategy
</deliverable>
</phase>

<!-- ================================================================== -->
<!-- PHASE 2: PLANNING                                                  -->
<!-- ================================================================== -->

<phase name="2-planning" title="Create Implementation Plan">
<objective>
Based on the research findings, create a detailed implementation plan that covers
all components needed for the repo replication feature.
</objective>

<planning_tasks>

<task name="2.1" title="Define Feature Scope">
Define exactly what the repo replication feature will and will not do:

**Must include**:
- Clone/replicate a GitHub repository's file contents to an Azure Blob Storage folder
- Clone/replicate an Azure DevOps repository's file contents to an Azure Blob Storage folder
- Support specifying a target branch, tag, or commit SHA
- Support specifying the target Azure Storage folder path
- Preserve directory structure in blob paths
- Report progress during replication (file count, bytes transferred)
- Handle errors gracefully (partial failures, network issues, auth failures)
- Both CLI and API interfaces

**Must NOT include**:
- Git history (commits, branches) - only the file tree at a specific ref
- Git LFS file resolution (document as a known limitation)
- Incremental sync / delta updates (full replication only)
- Webhooks or automatic triggers
- Two-way sync
</task>

<task name="2.2" title="Plan New Configuration Parameters">
Plan new environment variables and config file parameters needed:

For GitHub:
- `AZURE_FS_GITHUB_PAT` - GitHub Personal Access Token (optional, for private repos / higher rate limits)
- `AZURE_FS_GITHUB_PAT_EXPIRY` - GitHub PAT expiry date in ISO 8601 (required if PAT is set)

For Azure DevOps:
- `AZURE_FS_AZDO_PAT` - Azure DevOps Personal Access Token
- `AZURE_FS_AZDO_PAT_EXPIRY` - Azure DevOps PAT expiry date in ISO 8601 (required if PAT is set)
- `AZURE_FS_AZDO_ORG_URL` - Azure DevOps organization URL (e.g., https://dev.azure.com/myorg)

Common:
- `AZURE_FS_REPO_CONCURRENCY` - Max parallel file uploads during replication (default should NOT exist per project rules - must be explicitly set)

Note: Per project conventions, NO default/fallback values. All parameters that are needed
for an operation must be explicitly provided or the tool must raise a ConfigError.
Exception: GitHub PAT is optional because GitHub allows unauthenticated public repo access.
Register this exception in the project memory file before implementing.
</task>

<task name="2.3" title="Plan Component Structure">
Plan the new files and modifications needed:

New files:
- `src/services/repo-replication.service.ts` - Core replication orchestration
- `src/services/github-client.service.ts` - GitHub API client
- `src/services/azdo-client.service.ts` - Azure DevOps API client
- `src/commands/repo.commands.ts` - CLI command definitions
- `src/api/routes/repo.routes.ts` - API route definitions
- `src/api/controllers/repo.controller.ts` - API controller
- `src/types/repo.types.ts` - Type definitions for repo operations
- `src/errors/repo.error.ts` - Repo-specific error classes

Modified files:
- `src/commands/index.ts` - Register new repo commands
- `src/api/routes/index.ts` - Register new repo routes
- `src/types/index.ts` - Export new types
- `src/config/config.schema.ts` - Add repo config validation
- `src/config/config.loader.ts` - Load repo config from env/file
- `src/types/config.types.ts` - Add repo config types
- `package.json` - Add new dependencies (if any)
</task>

<task name="2.4" title="Plan CLI Commands">
Define the CLI command syntax:

```
azure-fs repo clone-github <repo-url> <target-folder> [options]
azure-fs repo clone-azdo <repo-url> <target-folder> [options]
```

Common options:
- `--ref <branch|tag|sha>` - Git reference to clone (default: repository default branch)
- `--concurrency <n>` - Max parallel uploads
- `--dry-run` - List files that would be replicated without uploading
- `--exclude <pattern>` - Glob pattern(s) to exclude (repeatable)
- `--include <pattern>` - Glob pattern(s) to include (repeatable)
- `--json` - Structured JSON output
- `--verbose` - Detailed progress output

GitHub-specific options:
- `--github-pat <token>` - GitHub PAT (overrides env var)

Azure DevOps-specific options:
- `--azdo-pat <token>` - Azure DevOps PAT (overrides env var)
- `--azdo-org <url>` - Azure DevOps org URL (overrides env var)
</task>

<task name="2.5" title="Plan API Endpoints">
Define the REST API endpoints:

```
POST /api/v1/repo/clone/github    - Clone a GitHub repository
POST /api/v1/repo/clone/azdo      - Clone an Azure DevOps repository
```

Request body schema for both:
```json
{
  "repoUrl": "string (required)",
  "targetFolder": "string (required)",
  "ref": "string (optional)",
  "concurrency": "number (optional)",
  "dryRun": "boolean (optional, default false)",
  "exclude": ["string"] (optional),
  "include": ["string"] (optional)
}
```

Response schema:
```json
{
  "success": true,
  "data": {
    "source": { "platform": "github|azdo", "repo": "...", "ref": "...", "commitSha": "..." },
    "target": { "container": "...", "folder": "..." },
    "stats": {
      "totalFiles": 0,
      "uploadedFiles": 0,
      "skippedFiles": 0,
      "failedFiles": 0,
      "totalBytes": 0,
      "durationMs": 0
    },
    "files": [ { "path": "...", "size": 0, "status": "uploaded|skipped|failed" } ]
  },
  "metadata": { "timestamp": "...", "durationMs": 0 }
}
```
</task>

</planning_tasks>

<deliverable>
Save the implementation plan to: `docs/design/plan-006-repo-replication-to-azure-storage.md`

The plan must follow the project's plan file naming convention and include:
- Feature scope (in/out)
- Configuration parameters
- Component structure
- CLI command definitions
- API endpoint definitions
- Implementation order and dependencies between components
- Estimated complexity per component
</deliverable>
</phase>

<!-- ================================================================== -->
<!-- PHASE 3: DESIGN AND ARCHITECTURE                                   -->
<!-- ================================================================== -->

<phase name="3-design" title="Design and Architecture">
<objective>
Create the detailed technical design for the repo replication feature,
making all architectural decisions explicit.
</objective>

<design_tasks>

<task name="3.1" title="Design the Service Layer">
Design the service layer classes and interfaces:

1. **RepoReplicationService** - The orchestrator:
   - Accepts a `RepoCloneRequest` (platform-agnostic)
   - Uses the appropriate platform client (GitHub or AzDO) to list repository files
   - Downloads files and uploads them to Azure Blob Storage using the existing `BlobFileSystemService`
   - Manages concurrency using the existing `concurrency.utils.ts` (`parallelLimit`)
   - Reports progress via a callback or event pattern
   - Returns a `RepoCloneResult` with complete statistics

2. **GitHubClientService** - GitHub API wrapper:
   - Uses Node.js built-in `fetch` (or chosen HTTP client from research)
   - Implements the chosen strategy from Phase 1 research
   - Handles authentication (PAT or unauthenticated)
   - Handles pagination and rate limiting
   - Provides: `listFiles(repo, ref)` -> `RepoFile[]` and `downloadFile(repo, path, ref)` -> `Buffer`

3. **AzDoClientService** - Azure DevOps API wrapper:
   - Similar interface to GitHubClientService
   - Handles Azure DevOps authentication
   - Implements the chosen strategy from Phase 1 research
   - Provides: `listFiles(repo, ref)` -> `RepoFile[]` and `downloadFile(repo, path, ref)` -> `Buffer`

4. **Common interface**:
   Both clients should implement a common `RepoClient` interface so the
   `RepoReplicationService` is platform-agnostic.

Design the data flow:
```
CLI/API -> RepoReplicationService -> RepoClient (GitHub|AzDO) -> Remote API
                                  -> BlobFileSystemService -> Azure Storage
```
</task>

<task name="3.2" title="Design Error Handling">
Design the error types for repo operations:

- `RepoError` (extends `AzureFsError`) - Base class for repo errors
- `RepoAuthError` - Authentication failures (invalid PAT, expired token)
- `RepoNotFoundError` - Repository not found or inaccessible
- `RepoRefNotFoundError` - Branch/tag/commit not found
- `RepoRateLimitError` - API rate limit exceeded
- `RepoPartialFailureError` - Some files failed to upload (includes list of failures)

Define HTTP status code mappings for each error type in the API error handler middleware.
</task>

<task name="3.3" title="Design Configuration Extension">
Design how the new configuration parameters integrate with the existing config system:

1. Extend `AzureFsConfig` type with a `repo` section:
```typescript
interface RepoConfig {
  github?: {
    pat?: string;
    patExpiry?: string;
  };
  azdo?: {
    pat?: string;
    patExpiry?: string;
    orgUrl?: string;
  };
  concurrency?: number;
}
```

2. Define environment variable mappings
3. Define config file schema extension
4. Define validation rules:
   - If `github.pat` is set, `github.patExpiry` must also be set
   - If `azdo.pat` is set, `azdo.patExpiry` and `azdo.orgUrl` must also be set
   - Expiry dates must be valid ISO 8601 and in the future (warn if expiring within 7 days)
   - Concurrency must be a positive integer

IMPORTANT: Per project conventions, the repo config parameters are only required when
executing repo commands. They must NOT be validated when running other commands.
</task>

<task name="3.4" title="Design Progress Reporting">
Design how progress is reported during long-running replication operations:

For CLI:
- Use streaming output: print each file as it is uploaded (in verbose mode)
- At completion, print summary statistics
- In JSON mode, output the complete result object

For API:
- The response is returned after the operation completes (synchronous for now)
- The response includes complete file-by-file results
- Consider: should we add a `maxFiles` or `timeout` parameter for safety?
- Document as a future enhancement: Server-Sent Events (SSE) for real-time progress
</task>

<task name="3.5" title="Design URL Parsing">
Design how repository URLs are parsed to extract owner, repo name, and platform:

GitHub URL formats to support:
- `https://github.com/owner/repo`
- `https://github.com/owner/repo.git`
- `github.com/owner/repo`
- `owner/repo` (shorthand, assumes GitHub)

Azure DevOps URL formats to support:
- `https://dev.azure.com/org/project/_git/repo`
- `https://org.visualstudio.com/project/_git/repo` (legacy format)
- `org/project/repo` (shorthand, requires --azdo-org)

Create a `RepoUrlParser` utility that extracts structured data from any supported URL format.
</task>

</design_tasks>

<deliverable>
Update `docs/design/project-design.md` with a new section (Section 11 or appropriate number)
documenting the repo replication architecture, service layer design, data flow, and key decisions.

The design section must include:
- Architecture diagram showing the new components
- Service interface definitions
- Data flow for a replication operation
- Error handling strategy
- Configuration integration approach
</deliverable>
</phase>

<!-- ================================================================== -->
<!-- PHASE 4: IMPLEMENTATION                                            -->
<!-- ================================================================== -->

<phase name="4-implementation" title="Implementation">
<objective>
Implement the repo replication feature following the design from Phase 3.
Follow existing code patterns exactly. All code must be in TypeScript.
</objective>

<implementation_order>
Implement in this exact order to ensure each component can be tested incrementally:

<step number="1" title="Types and Interfaces">
Create `src/types/repo.types.ts`:
- `RepoPlatform` enum (github, azdo)
- `RepoReference` interface (owner, repo, platform, ref)
- `RepoFile` interface (path, size, sha, downloadUrl)
- `RepoCloneRequest` interface
- `RepoCloneResult` interface with statistics
- `RepoCloneFileResult` interface (per-file result)
- `RepoConfig` interface for configuration
- `RepoClientOptions` interface

Update `src/types/index.ts` to export the new types.
Update `src/types/config.types.ts` to include the repo configuration section.
</step>

<step number="2" title="Error Classes">
Create `src/errors/repo.error.ts`:
- `RepoError` extending `AzureFsError`
- `RepoAuthError`
- `RepoNotFoundError`
- `RepoRefNotFoundError`
- `RepoRateLimitError`
- `RepoPartialFailureError`

Follow the exact pattern used in existing error files (e.g., `src/errors/blob-not-found.error.ts`).
Each error must have an error code compatible with the exit code system.
</step>

<step number="3" title="Configuration Extension">
Modify `src/types/config.types.ts` to add the repo config section.
Modify `src/config/config.schema.ts` to add repo config validation.
Modify `src/config/config.loader.ts` to load repo config from environment variables and config file.

CRITICAL: Repo configuration must only be validated when repo commands are executed.
Do NOT add repo parameters to the global required validation.

Implement PAT expiry warning: if a PAT's expiry date is within 7 days, log a warning.
If the PAT has expired, throw a `RepoAuthError`.
</step>

<step number="4" title="URL Parser Utility">
Create the URL parsing logic (either in a new utility file or within the repo service).
It must handle all URL formats defined in the design phase.
Write clear error messages for unparseable URLs.
</step>

<step number="5" title="GitHub Client Service">
Create `src/services/github-client.service.ts`:
- Implement the `RepoClient` interface
- Use the strategy chosen in Phase 1 research
- Use Node.js built-in `fetch` for HTTP requests
- Handle authentication (PAT header or unauthenticated)
- Handle rate limiting (check X-RateLimit-* headers, pause or fail gracefully)
- Handle pagination if using the Trees or Contents API
- Implement `listFiles()` and `downloadFile()` methods
- Use the existing retry utility (`src/utils/retry.utils.ts`) for transient failures

Important: Log API requests using the existing logger (parameters only, never token values).
</step>

<step number="6" title="Azure DevOps Client Service">
Create `src/services/azdo-client.service.ts`:
- Implement the same `RepoClient` interface as GitHub client
- Use the strategy chosen in Phase 1 research
- Handle Azure DevOps authentication (PAT via Basic auth header)
- Handle the api-version query parameter
- Implement `listFiles()` and `downloadFile()` methods
- Use the existing retry utility for transient failures
</step>

<step number="7" title="Repo Replication Service">
Create `src/services/repo-replication.service.ts`:
- Accept `BlobFileSystemService` as a dependency (constructor injection)
- Accept a `Logger` as a dependency
- Create the appropriate `RepoClient` based on platform
- Implement the replication orchestration:
  1. Parse the repository URL
  2. Initialize the appropriate platform client
  3. List all files in the repository at the specified ref
  4. Apply include/exclude glob filters
  5. Upload files to Azure Storage in parallel (using `parallelLimit` from `concurrency.utils.ts`)
  6. Collect results and statistics
  7. Return `RepoCloneResult`
- Handle partial failures (continue uploading remaining files, report failures)
- Detect content type for each file using existing `content-type.utils.ts`
</step>

<step number="8" title="CLI Commands">
Create `src/commands/repo.commands.ts`:
- Register `repo clone-github` and `repo clone-azdo` commands
- Follow the exact pattern used in `src/commands/file.commands.ts`
- Parse all options and call `RepoReplicationService`
- Format output using `output.utils.ts`
- Handle `--dry-run` mode (list files without uploading)
- Handle `--verbose` mode (stream progress)

Update `src/commands/index.ts` to register the new commands.
</step>

<step number="9" title="API Controller and Routes">
Create `src/api/controllers/repo.controller.ts`:
- Follow the exact pattern used in `src/api/controllers/file.controller.ts`
- Implement `cloneGithubRepo` and `cloneAzdoRepo` handler functions
- Extract parameters from request body
- Call `RepoReplicationService`
- Return `CommandResult` JSON response

Create `src/api/routes/repo.routes.ts`:
- Define POST /api/v1/repo/clone/github
- Define POST /api/v1/repo/clone/azdo
- Add Swagger JSDoc annotations for both endpoints

Update `src/api/routes/index.ts` to register the new routes.

Update the error handler middleware to map new repo error types to HTTP status codes.
</step>

<step number="10" title="Swagger Documentation">
Update `src/api/swagger/config.ts` to include:
- New tag: "Repository Replication"
- Component schemas for request/response types
- Both endpoint specifications with examples

Verify the Swagger UI renders correctly by running the API server.
</step>

</implementation_order>

<coding_standards>
Follow these standards strictly (derived from existing codebase):

1. **No default/fallback config values**: Every required parameter must be explicitly provided
2. **Structured JSON output**: All results wrapped in CommandResult<T>
3. **Error codes**: All errors must have codes compatible with the exit code system
4. **Logging**: Log request parameters, never secrets or file content
5. **ETag handling**: Not applicable for repo replication (one-way write)
6. **Service injection**: Services receive dependencies via constructor, never import singletons
7. **Path normalization**: Use existing PathService for all Azure blob paths
8. **Content type detection**: Use existing content-type.utils.ts
9. **Concurrency control**: Use existing parallelLimit from concurrency.utils.ts
10. **Retry logic**: Use existing withRetry from retry.utils.ts for transient failures
</coding_standards>
</phase>

<!-- ================================================================== -->
<!-- PHASE 5: TESTING                                                   -->
<!-- ================================================================== -->

<phase name="5-testing" title="Testing">
<objective>
Create a comprehensive test suite for the repo replication feature.
All test scripts must be placed in the `test_scripts/` folder.
</objective>

<test_tasks>

<task name="5.1" title="Unit Tests for URL Parser">
Create `test_scripts/test-repo-url-parser.ts`:
- Test all supported GitHub URL formats
- Test all supported Azure DevOps URL formats
- Test invalid URL handling
- Test edge cases (trailing slashes, .git suffix, etc.)
</task>

<task name="5.2" title="Integration Test for GitHub Replication (CLI)">
Create `test_scripts/test-repo-clone-github-cli.ts`:
- Test cloning a small public GitHub repo via CLI
- Test with --dry-run flag
- Test with --ref flag (specific branch)
- Test with --exclude flag
- Test with invalid repo URL (expect error)
- Test with non-existent repo (expect error)
- Test JSON output format

Use a well-known small public repo for testing (e.g., a repo with < 20 files).
</task>

<task name="5.3" title="Integration Test for Azure DevOps Replication (CLI)">
Create `test_scripts/test-repo-clone-azdo-cli.ts`:
- Similar test structure to GitHub tests
- Skip tests if AZURE_FS_AZDO_PAT is not set (with informative message)
- Test authentication error handling
</task>

<task name="5.4" title="Integration Test for API Endpoints">
Create `test_scripts/test-repo-clone-api.ts`:
- Test POST /api/v1/repo/clone/github with curl-like HTTP requests
- Test POST /api/v1/repo/clone/azdo with curl-like HTTP requests
- Test request validation (missing required fields)
- Test error responses (invalid repo, auth failure)
- Verify response schema matches the design

Note: These tests require the API server to be running. Include setup instructions
in comments at the top of the file.
</task>

<task name="5.5" title="Test Configuration Validation">
Create `test_scripts/test-repo-config-validation.ts`:
- Test that repo config is NOT required for non-repo commands
- Test PAT expiry validation (expired PAT throws error)
- Test PAT expiry warning (PAT expiring within 7 days logs warning)
- Test that missing required params throw ConfigError
</task>

</test_tasks>
</phase>

</workflow>

<!-- ================================================================== -->
<!-- DOCUMENTATION UPDATES                                              -->
<!-- ================================================================== -->

<documentation>
After implementation, update ALL of the following documents. This is mandatory per project
instructions in CLAUDE.md.

<doc name="project-design.md">
Update `docs/design/project-design.md`:
- Add new section for Repository Replication architecture
- Update the high-level architecture diagram to show the new components
- Update the dependency graph
- Update the module responsibilities table
- Add data flow diagram for repo replication
</doc>

<doc name="project-functions.md">
Update `docs/design/project-functions.md`:
- Add functional requirements for repo clone-github (with inputs, outputs, behavior, edge cases)
- Add functional requirements for repo clone-azdo (with inputs, outputs, behavior, edge cases)
- Add functional requirements for the API endpoints
</doc>

<doc name="configuration-guide.md">
Update `docs/design/configuration-guide.md`:
- Document all new environment variables (purpose, how to obtain, recommended management)
- Document PAT expiry parameters and proactive warning behavior
- Document the config file extension for repo settings
</doc>

<doc name="cli-instructions.md">
Update `cli-instructions.md`:
- Add documentation for `repo clone-github` command in the project's tool documentation XML format
- Add documentation for `repo clone-azdo` command in the project's tool documentation XML format
</doc>

<doc name="api-instructions.md">
Update `api-instructions.md`:
- Add documentation for POST /api/v1/repo/clone/github endpoint
- Add documentation for POST /api/v1/repo/clone/azdo endpoint
- Add curl examples for both endpoints
</doc>

<doc name="CLAUDE.md">
Update `CLAUDE.md`:
- Add new environment variables to the table
- Update the project structure section with new files
- Update any other sections affected by the new feature
</doc>

<doc name="Issues - Pending Items.md">
Review `Issues - Pending Items.md`:
- Add any gaps, inconsistencies, or known limitations discovered during implementation
- Document Git LFS as a known limitation
- Document that replication is full (not incremental) as a known limitation
- If any documentation is incomplete, register it as a pending item
</doc>

</documentation>

<success_criteria>
The implementation is complete when ALL of the following are true:

1. `azure-fs repo clone-github <url> <folder>` successfully replicates a public GitHub repo to Azure Storage
2. `azure-fs repo clone-azdo <url> <folder>` successfully replicates an Azure DevOps repo to Azure Storage
3. Both CLI commands support --ref, --dry-run, --exclude, --include, --json, --verbose options
4. POST /api/v1/repo/clone/github endpoint works and returns correct response schema
5. POST /api/v1/repo/clone/azdo endpoint works and returns correct response schema
6. Swagger UI shows both new endpoints with complete documentation
7. All test scripts in test_scripts/ pass
8. All documentation listed in the documentation section has been updated
9. No new entries needed in "Issues - Pending Items.md" (or all issues are documented)
10. The project builds successfully with `npm run build`
11. Configuration validation does not break existing commands (repo config only validated for repo commands)
</success_criteria>

<verification>
Before declaring complete, run:

1. `npm run build` - Must compile without errors
2. `azure-fs repo clone-github https://github.com/octocat/Hello-World repos/hello-world --json --dry-run` - Must list files
3. `azure-fs repo clone-github https://github.com/octocat/Hello-World repos/hello-world --json` - Must upload files
4. Start API server and test: `curl -X POST http://localhost:3000/api/v1/repo/clone/github -H "Content-Type: application/json" -d '{"repoUrl":"https://github.com/octocat/Hello-World","targetFolder":"repos/hello-world","dryRun":true}'`
5. Verify Swagger UI at http://localhost:3000/api/docs shows the new endpoints
6. Run existing commands to ensure nothing is broken: `azure-fs config show --json`
7. Run all test scripts in test_scripts/
</verification>
