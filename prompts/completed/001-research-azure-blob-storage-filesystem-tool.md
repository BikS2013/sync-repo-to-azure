<research_objective>
Research how to build a TypeScript CLI tool that uses Azure Blob Storage as a virtual file system.

The tool will allow an AI agent (Claude Code) to read, write, and manage files stored in Azure Blob Storage
as if it were a local file system. The research should gather comprehensive information on the Azure Blob
Storage SDK, authentication methods, file system emulation patterns, and metadata capabilities.

Thoroughly explore multiple sources including official Azure documentation, SDK references, npm packages,
and community best practices. Consider various approaches and their trade-offs.
</research_objective>

<scope>
<focus_areas>
1. **Azure Blob Storage SDK for JavaScript/TypeScript** (@azure/storage-blob):
   - Latest stable version and API surface
   - BlobServiceClient, ContainerClient, BlobClient usage patterns
   - How to list blobs with hierarchical delimiter (folder emulation)
   - How to upload, download, replace, and delete blobs
   - How to read and edit blob content (text-based files)
   - How to set, get, update, and delete custom metadata on blobs
   - How to handle blob properties vs metadata

2. **Authentication methods** (research all, compare trade-offs):
   - Connection strings (simplest setup)
   - Azure AD / DefaultAzureCredential / Managed Identity
   - SAS tokens (scoped, time-limited)
   - Account keys
   - Which is best for a CLI tool used by a developer/agent locally

3. **File system emulation on Blob Storage**:
   - How Azure Blob Storage handles "folders" (virtual directories via prefixes)
   - Creating folder-like structures (zero-byte blobs vs prefix convention)
   - Listing files within a "folder" (prefix + delimiter)
   - Path normalization (forward slashes, leading/trailing slash handling)
   - Hierarchical namespace (Azure Data Lake Storage Gen2) vs flat namespace trade-offs

4. **Configuration patterns**:
   - How to configure the storage account name/URL
   - How to configure the target container
   - Environment variables vs config files vs CLI flags
   - Best practices for storing connection credentials securely

5. **Metadata enrichment**:
   - Azure Blob metadata limits (key-value pairs, size constraints)
   - System properties vs custom metadata
   - Content-Type, Content-Encoding, and other standard properties
   - Indexing and querying by metadata (blob index tags)
   - Patterns for storing structured metadata (JSON in metadata values)

6. **CLI tool design for agent integration**:
   - How to structure a CLI with subcommands (e.g., commander.js, yargs)
   - Output format best practices for agent consumption (JSON output mode)
   - Error handling patterns that agents can parse
   - How to handle large file uploads/downloads (streams vs buffers)
   - How to handle binary vs text files
</focus_areas>

<sources_to_prioritize>
- Official Azure SDK for JavaScript documentation (learn.microsoft.com)
- @azure/storage-blob npm package documentation and changelog
- Azure Blob Storage REST API reference
- TypeScript CLI tool best practices (commander.js, yargs documentation)
- GitHub repositories implementing similar file-system-over-blob-storage patterns
</sources_to_prioritize>

<version_constraints>
- Target Node.js 18+ and TypeScript 5+
- Use the latest stable @azure/storage-blob package
- Use @azure/identity for Azure AD authentication
- Research as of 2026
</version_constraints>
</scope>

<deliverables>
Save all findings to: `./docs/reference/azure-blob-storage-filesystem-research.md`

The research document must be structured as follows:

<output_structure>
# Azure Blob Storage File System Tool - Research

## 1. Azure Blob Storage SDK Overview
- Package details, version, installation
- Core classes and their responsibilities
- TypeScript type definitions available

## 2. Authentication Methods
For each method, document:
- How to set it up
- Code example (TypeScript)
- Pros and cons
- When to use it
- Security considerations

### 2.1 Connection String
### 2.2 Azure AD / DefaultAzureCredential
### 2.3 SAS Tokens
### 2.4 Account Key

## 3. File System Operations
For each operation, provide:
- SDK method(s) to use
- TypeScript code snippet
- Important parameters and options
- Error handling considerations

### 3.1 List Files and Folders (with prefix/delimiter)
### 3.2 Create Folder (virtual directory)
### 3.3 Upload File
### 3.4 Download File
### 3.5 Replace File (overwrite)
### 3.6 Delete File
### 3.7 Edit File (read-modify-write pattern)
### 3.8 Check if File/Folder Exists

## 4. Metadata Management
### 4.1 System Properties vs Custom Metadata
### 4.2 Setting Metadata on Upload
### 4.3 Reading Metadata
### 4.4 Updating Metadata
### 4.5 Blob Index Tags (for querying)
### 4.6 Metadata Limits and Constraints

## 5. Configuration Design
### 5.1 Required Configuration Parameters
### 5.2 Environment Variables Approach
### 5.3 Config File Approach
### 5.4 CLI Flags Approach
### 5.5 Recommended Configuration Strategy

## 6. CLI Tool Architecture
### 6.1 Recommended CLI Framework
### 6.2 Subcommand Structure
### 6.3 Output Format (JSON for agent consumption)
### 6.4 Error Handling Patterns
### 6.5 Stream Handling for Large Files

## 7. Key Findings and Recommendations
- Recommended authentication method for this use case
- Recommended folder emulation strategy
- Key npm packages to use
- Potential pitfalls and how to avoid them
- Suggested CLI command structure

## 8. Reference Links
- All URLs and sources consulted
</output_structure>
</deliverables>

<evaluation_criteria>
- All 6 focus areas must be covered with specific, actionable information
- Code examples must be in TypeScript (not JavaScript)
- Each authentication method must have a working code snippet
- Each file operation must have a clear SDK method mapping
- Metadata section must cover limits and constraints explicitly
- Configuration section must NOT include any fallback/default values for settings — per project conventions, missing config must raise an exception
- Research must be current (2026-compatible SDK versions)
- All source URLs must be included in the Reference Links section
</evaluation_criteria>

<verification>
Before completing, verify:
- All sections in the output structure are populated with substantive content
- Code examples compile conceptually (correct TypeScript syntax, correct SDK method names)
- Authentication comparison table is complete
- Metadata limits are documented with specific numbers
- At least 5 reference links are included
- The document is saved to ./docs/reference/azure-blob-storage-filesystem-research.md
</verification>
