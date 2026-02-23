# Style and Conventions

## TypeScript
- **Strict mode** enabled in tsconfig.json
- **Target**: ES2022, **Module**: CommonJS
- All code strongly typed — no `any` except in catch blocks (`catch (err: any)`)
- Interfaces for all data transfer objects (types/ directory)
- Type barrel exports via `index.ts`

## Naming Conventions
- **Files**: kebab-case with suffix: `blob-filesystem.service.ts`, `config.types.ts`, `base.error.ts`
- **Classes**: PascalCase: `BlobFileSystemService`, `MetadataService`, `AzureFsError`
- **Interfaces**: PascalCase, no prefix: `FileInfo`, `ResolvedConfig`, `PatchInstruction`
- **Functions**: camelCase: `resolveConfig`, `validatePath`, `formatSuccess`
- **Constants**: PascalCase for enum-like: `ExitCode`, camelCase for regular: `program`
- **Error classes**: PascalCase with Error suffix: `ConfigError`, `BlobNotFoundError`

## Architecture Patterns
- **Service layer**: Classes with constructor injection (config, logger, retryConfig)
- **Factory pattern**: Auth service uses factory functions per auth method
- **Error hierarchy**: All errors extend `AzureFsError` base class with `code`, `statusCode`, `details`
- **Error factories**: Static factory methods on error classes (e.g., `ConfigError.missingRequired()`)
- **Command pattern**: Each command group in separate file with `registerXxxCommands(program)` function
- **Retry wrapper**: `withRetry<T>(fn, config)` wraps all Azure SDK calls

## Command Handler Pattern
Every CLI command follows this structure:
```typescript
.action(async (arg: string, options: Record<string, unknown>, cmd: Command) => {
  const startTime = Date.now();
  const globalOpts = cmd.parent!.opts();
  const jsonMode = globalOpts.json === true;
  try {
    const config = resolveConfig(globalOpts);
    const logger = new Logger(config.logging.level, globalOpts.verbose === true);
    const service = new BlobFileSystemService(config, logger);
    // ... operation ...
    const output = formatSuccess(result, "commandName", startTime);
    outputResult(output, jsonMode);
  } catch (err) {
    const output = formatErrorFromException(err, "commandName", startTime);
    outputResult(output, jsonMode);
    process.exitCode = exitCodeForError(err);
  }
});
```

## Configuration Rules (CRITICAL)
- **NEVER** use fallback/default values for configuration settings
- Every missing required config value throws `ConfigError` with instructions
- Exception must explain all 3 ways to provide the value (CLI flag, env var, config file)

## Documentation Rules
- All CLI tools documented in CLAUDE.md using `<toolName>` XML format
- Plans in `docs/design/plan-xxx-<description>.md`
- Test scripts in `test_scripts/` folder
- Issues tracked in `Issues - Pending Items.md`

## Testing
- No test framework — plain TypeScript scripts run via ts-node
- Tests use `execSync` to invoke CLI commands with `--json` flag
- Each test creates isolated data under unique prefix `test-{timestamp}-{random}/`
- Cleanup in `finally` blocks
- Tests require live Azure Storage account (no emulator)
