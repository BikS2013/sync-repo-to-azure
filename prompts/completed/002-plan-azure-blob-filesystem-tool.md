<objective>
Create a detailed implementation plan for building a TypeScript CLI tool that uses Azure Blob Storage as a virtual file system.

This plan will serve as the blueprint for building the tool. It must be thorough, covering architecture,
module structure, CLI commands, configuration, authentication, file operations, metadata management,
editing strategies, error handling, and testing. The plan must be actionable — each phase should have
clear deliverables that can be implemented independently.

Thoroughly analyze the research document, consider multiple architectural approaches, and produce a plan
that balances extensibility with simplicity. Deeply consider the interactions between components and
how an AI agent will consume the tool's output.
</objective>

<context>
This is a greenfield TypeScript CLI tool project. The tool will be used by AI agents (specifically Claude Code)
to read and write content in Azure Blob Storage as if it were a file system. The tool must:

- Support multiple authentication methods (configurable)
- Emulate a file system with folder structure on flat blob storage
- Support full CRUD operations on files and folders
- Support metadata enrichment on stored files
- Support 3 editing strategies: read-modify-write, in-place patch, and append/prepend
- Output JSON for agent consumption
- Be tested against a live Azure Storage account

**Technology Stack**: TypeScript 5+, Node.js 18+, Commander.js, @azure/storage-blob, @azure/identity

Read the CLAUDE.md file at the project root for project conventions (tool documentation format,
config rules, folder structure, testing conventions).
</context>

<research_input>
Read the research document at `./docs/reference/azure-blob-storage-filesystem-research.md` thoroughly.
Extract all relevant architectural decisions, SDK patterns, and recommendations from it.
The plan must be grounded in the findings of this research — do not contradict or ignore research recommendations.
</research_input>

<plan_requirements>

The plan must cover ALL of the following areas in detail:

### 1. Project Structure
- Directory layout (src/, commands/, services/, config/, types/, utils/)
- Entry point and CLI bootstrap
- TypeScript configuration (tsconfig.json)
- Package.json with all dependencies
- Build and run scripts

### 2. Configuration System
- Configuration file format and location (e.g., `.azure-fs.json` or similar)
- Environment variable mappings
- CLI flag overrides
- Required parameters: storage account URL, container name, authentication method
- CRITICAL: No fallback/default values for any configuration setting. If a setting is missing, throw a clear exception explaining what is needed and how to provide it.
- Configuration loading priority: CLI flags > environment variables > config file
- Configuration validation on startup

### 3. Authentication Module
Design a pluggable authentication system supporting THREE methods:
- **Connection String**: From config/env var `AZURE_STORAGE_CONNECTION_STRING`
- **SAS Token**: From config/env var, scoped to container
- **Azure AD (DefaultAzureCredential)**: From `@azure/identity`, works with `az login`
- Auth method selection via config parameter `authMethod: "connection-string" | "sas-token" | "azure-ad"`
- Each method must have its own factory function returning the appropriate client
- Clear error messages when credentials are missing for the selected method

### 4. File System Service Layer
Core service class (`BlobFileSystemService`) encapsulating all operations:

**Folder Operations:**
- `createFolder(path)` — Create virtual directory (zero-byte marker blob)
- `listFolder(path)` — List files and subfolders using prefix + delimiter
- `deleteFolder(path)` — Recursively delete all blobs under prefix
- `folderExists(path)` — Check if any blobs exist with the prefix

**File Operations:**
- `uploadFile(remotePath, localPath | content, metadata?)` — Upload with optional metadata
- `downloadFile(remotePath, localPath?)` — Download to local path or return content as string
- `deleteFile(remotePath)` — Delete a single blob
- `fileExists(remotePath)` — Check blob existence
- `replaceFile(remotePath, localPath | content, metadata?)` — Overwrite existing blob
- `getFileInfo(remotePath)` — Return blob properties and metadata

**Edit Operations (all three strategies):**
- `editFile(remotePath, localPath)` — Read-modify-write: download, caller edits, re-upload
- `patchFile(remotePath, patches: PatchInstruction[])` — In-place patch: download, apply text patches (find/replace, regex), re-upload
- `appendToFile(remotePath, content, position: "start" | "end")` — Append or prepend text to existing blob

**Metadata Operations:**
- `setMetadata(remotePath, metadata: Record<string, string>)` — Set/overwrite all custom metadata
- `getMetadata(remotePath)` — Get all custom metadata
- `updateMetadata(remotePath, partial: Record<string, string>)` — Merge partial metadata update
- `deleteMetadata(remotePath, keys: string[])` — Remove specific metadata keys
- `setTags(remotePath, tags: Record<string, string>)` — Set blob index tags
- `getTags(remotePath)` — Get blob index tags
- `queryByTags(tagFilter: string)` — Find blobs by tag filter expression

### 5. CLI Command Structure
Using Commander.js, design the following subcommands:

```
azure-fs config init          # Initialize configuration interactively
azure-fs config show          # Show current configuration
azure-fs config validate      # Validate configuration and test connection

azure-fs ls <path>            # List files and folders
azure-fs mkdir <path>         # Create a folder
azure-fs rmdir <path>         # Remove a folder (recursive)
azure-fs exists <path>        # Check if file/folder exists

azure-fs upload <local> <remote> [--metadata key=value...]
azure-fs download <remote> [local]
azure-fs delete <remote>
azure-fs replace <local> <remote> [--metadata key=value...]
azure-fs info <remote>        # Show file properties and metadata

azure-fs edit <remote>        # Download to temp, open for editing, re-upload on save
azure-fs patch <remote> --find <text> --replace <text> [--regex]
azure-fs append <remote> --content <text> [--position start|end]

azure-fs meta set <remote> key=value [key=value...]
azure-fs meta get <remote>
azure-fs meta update <remote> key=value [key=value...]
azure-fs meta delete <remote> key [key...]

azure-fs tags set <remote> key=value [key=value...]
azure-fs tags get <remote>
azure-fs tags query <filter-expression>
```

Each command must:
- Support `--json` flag for JSON output (default for agent use)
- Support `--verbose` flag for detailed logging
- Return structured JSON with `{ success: boolean, data?: any, error?: { code: string, message: string } }`
- Handle errors gracefully with meaningful error codes

### 6. Path Normalization
- All paths use forward slashes
- Strip leading/trailing slashes
- Handle edge cases: empty paths, double slashes, dot segments
- Root path is represented as empty string or "/"

### 7. Error Handling Strategy
- Custom error classes (ConfigError, AuthError, BlobNotFoundError, PathError, etc.)
- Structured error responses with error codes
- Retry logic for transient Azure errors (429, 503)
- Clear user-facing error messages

### 8. Testing Strategy
- Test against a live Azure Storage account
- Test configuration via environment variables
- Test each file operation (upload, download, delete, replace, list)
- Test each editing strategy
- Test metadata and tag operations
- Test error scenarios (missing file, invalid path, auth failure)
- Test scripts placed in `./test_scripts/` folder per project conventions
- All tests in TypeScript

### 9. Implementation Phases
Break the implementation into sequential phases, where each phase produces a working, testable increment:
- Phase 1: Project setup, config, auth
- Phase 2: Core file operations (upload, download, delete, list, exists)
- Phase 3: Folder operations
- Phase 4: Edit operations (all 3 strategies)
- Phase 5: Metadata and tags
- Phase 6: CLI commands wiring
- Phase 7: Testing and polish

For each phase, specify:
- Files to create/modify
- Dependencies on previous phases
- Acceptance criteria
- Estimated complexity (simple/moderate/complex)

</plan_requirements>

<constraints>
- Follow all conventions in the project's CLAUDE.md file
- No fallback/default values for configuration — raise exceptions for missing config
- All code in TypeScript
- All tools must be documented in CLAUDE.md using the specified format
- Test scripts go in `./test_scripts/` folder
- Plans go in `./docs/design/` folder
- The plan must be saved to `./docs/design/plan-002-azure-blob-filesystem-tool.md`
- The project design document must be created/updated at `./docs/design/project-design.md`
- The functional requirements must be registered in `./docs/design/project-functions.md`
</constraints>

<output>
Produce THREE documents:

1. **Implementation Plan**: `./docs/design/plan-002-azure-blob-filesystem-tool.md`
   - Full implementation plan covering all 9 areas above
   - Each phase with files, deliverables, acceptance criteria
   - Architecture diagrams in text/ASCII where helpful

2. **Project Design**: `./docs/design/project-design.md`
   - High-level architecture overview
   - Module relationships
   - Data flow diagrams (text-based)
   - Technology decisions with rationale

3. **Functional Requirements**: `./docs/design/project-functions.md`
   - All features organized by category
   - Each feature with description, inputs, outputs, and edge cases
   - Priority classification (P0 = must-have, P1 = important, P2 = nice-to-have)
</output>

<verification>
Before declaring complete, verify:
- All 9 plan areas are covered with actionable detail
- Each implementation phase has clear acceptance criteria
- The 3 editing strategies are fully specified with interfaces
- Authentication module supports all 3 methods with clear switching
- CLI command structure covers all operations
- No configuration setting has a fallback/default value
- All 3 output documents are created at the correct paths
- The plan references the research document where appropriate
- Error handling strategy is comprehensive
- Testing strategy covers all major operations
</verification>

<success_criteria>
- Plan is detailed enough for a developer/agent to implement each phase without ambiguity
- Architecture is clean, modular, and extensible
- All file paths, interfaces, and command signatures are specified
- The plan can be broken into individual implementation prompts (one per phase)
</success_criteria>
