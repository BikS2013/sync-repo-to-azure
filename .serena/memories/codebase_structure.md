# Codebase Structure

```
azure-storage-tool/
├── src/
│   ├── index.ts                          # CLI entry point (Commander.js bootstrap)
│   ├── commands/
│   │   ├── index.ts                      # Barrel re-export of all register functions
│   │   ├── config.commands.ts            # config init | show | validate
│   │   ├── file.commands.ts              # upload | download | delete | replace | info | exists
│   │   ├── folder.commands.ts            # ls | mkdir | rmdir
│   │   ├── edit.commands.ts              # edit | patch | append
│   │   ├── meta.commands.ts              # meta set | get | update | delete
│   │   └── tags.commands.ts              # tags set | get | query
│   ├── services/
│   │   ├── blob-filesystem.service.ts    # Core BlobFileSystemService class (15 methods)
│   │   ├── auth.service.ts               # Authentication factory (3 methods)
│   │   ├── metadata.service.ts           # MetadataService class (9 methods)
│   │   └── path.service.ts               # Path normalization functions (8 functions)
│   ├── config/
│   │   ├── config.schema.ts              # Config validation
│   │   └── config.loader.ts              # Layered config loading
│   ├── types/
│   │   ├── index.ts                      # Barrel export
│   │   ├── config.types.ts               # AzureFsConfigFile, ResolvedConfig, AuthMethod
│   │   ├── command-result.types.ts       # CommandResult<T>, CommandError
│   │   ├── errors.types.ts               # Error code enums
│   │   ├── filesystem.types.ts           # FileInfo, UploadResult, ListItem, etc.
│   │   ├── metadata.types.ts             # MetadataResult, TagResult, TagQueryResult
│   │   └── patch.types.ts               # PatchInstruction, EditResult, AppendResult
│   ├── errors/
│   │   ├── base.error.ts                 # AzureFsError (base class)
│   │   ├── config.error.ts               # ConfigError
│   │   ├── auth.error.ts                 # AuthError
│   │   ├── blob-not-found.error.ts       # BlobNotFoundError
│   │   ├── path.error.ts                 # PathError
│   │   ├── metadata.error.ts             # MetadataError
│   │   └── concurrent-modification.error.ts # ConcurrentModificationError
│   └── utils/
│       ├── output.utils.ts               # formatSuccess, formatError, outputResult
│       ├── logger.utils.ts               # Logger class with verbose mode
│       ├── exit-codes.utils.ts           # ExitCode enum, exitCodeForError
│       ├── retry.utils.ts               # withRetry (none/exponential/fixed)
│       ├── stream.utils.ts              # streamToString, streamToBuffer, isLargeFile
│       ├── content-type.utils.ts        # detectContentType from extension
│       └── validation.utils.ts          # validateMetadataKey, validateMetadataSize, validateTagCount
├── test_scripts/                         # 9 test scripts + runner (ts-node, live Azure)
├── docs/
│   ├── design/
│   │   ├── plan-002-azure-blob-filesystem-tool.md
│   │   ├── project-design.md
│   │   └── project-functions.md
│   └── reference/
│       └── azure-blob-storage-filesystem-research.md
├── prompts/completed/                    # Archived prompts
├── CLAUDE.md                             # Tool documentation
├── Issues - Pending Items.md             # Issue tracking
├── package.json
└── tsconfig.json
```

## Key Classes and Services

### BlobFileSystemService (blob-filesystem.service.ts)
Central service with 15 public methods:
- File: uploadFile, downloadFile, deleteFile, fileExists, replaceFile, getFileInfo
- Folder: createFolder, listFolder, deleteFolder, folderExists
- Edit: editFile, editFileUpload, patchFile, appendToFile
- Private: _uploadContent

### MetadataService (metadata.service.ts)
Constructor: `MetadataService(config: ResolvedConfig, logger: Logger)` — creates its own ContainerClient and RetryConfig internally (same pattern as BlobFileSystemService).
9 methods: setMetadata, getMetadata, updateMetadata, deleteMetadata, setTags, getTags, queryByTags, ensureBlobExists, is404