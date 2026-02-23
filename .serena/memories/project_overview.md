# Azure Storage Tool - Project Overview

## Purpose
`azure-fs` is a TypeScript CLI tool that presents Azure Blob Storage as a virtual file system. It is designed to be consumed by AI agents (specifically Claude Code) and human developers. The tool supports full CRUD operations on files and folders, three file-editing strategies, metadata management, and blob index tag querying — all with structured JSON output.

## Tech Stack
- **Language**: TypeScript 5+ (strict mode)
- **Runtime**: Node.js 18+
- **CLI framework**: Commander.js
- **Azure SDK**: @azure/storage-blob (v12.31.0), @azure/identity
- **Build**: tsc (CommonJS output to dist/)
- **Test runner**: ts-node (direct execution, no test framework)

## Authentication
Three methods supported (configurable):
1. Connection String (`AZURE_STORAGE_CONNECTION_STRING`)
2. SAS Token (`AZURE_STORAGE_SAS_TOKEN`)
3. Azure AD / DefaultAzureCredential (`@azure/identity`)

## Configuration
- Layered: CLI flags > environment variables > config file (`.azure-fs.json`)
- **CRITICAL**: No fallback/default values. Missing config raises `ConfigError` with instructions.

## Key Design Decisions
- Flat blob namespace with virtual folders via prefix/delimiter
- Zero-byte `.folder` marker blobs for folder creation
- ETag-based conditional writes for concurrency safety in edit operations
- Structured JSON output (`CommandResult<T>`) for agent consumption
- Custom error hierarchy with machine-readable error codes
- Exit codes: 0=success, 1=operation error, 2=config error, 3=validation error
