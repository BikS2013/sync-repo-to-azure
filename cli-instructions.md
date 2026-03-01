# CLI Tool Instructions

## Tool Documentation

### Configuration Commands

<repo-sync-config-init>
    <objective>
        Interactively create a .repo-sync.json configuration file
    </objective>
    <command>
        repo-sync config init [--path <output-path>] [--json]
    </command>
    <info>
        Prompts the user for all required configuration values (storage account URL,
        container name, authentication method, logging settings, retry settings)
        and writes a .repo-sync.json configuration file.

        Parameters:
          --path <output-path>  Custom output path for the config file (default: ./.repo-sync.json)
          --json                Output result as structured JSON

        Examples:
          repo-sync config init
          repo-sync config init --path ~/.repo-sync.json
          repo-sync config init --json
    </info>
</repo-sync-config-init>

<repo-sync-config-show>
    <objective>
        Display the resolved configuration with sensitive values masked
    </objective>
    <command>
        repo-sync config show [--json] [--config <path>] [-a <url>] [-c <name>] [--auth-method <method>]
    </command>
    <info>
        Loads configuration from all three sources (config file, environment variables,
        CLI flags) and displays the merged result. Sensitive values (connection strings,
        SAS tokens) are masked. Shows whether environment secrets are set or not.

        This command does NOT validate that all required fields are present.
        Use 'config validate' for full validation.

        Parameters:
          --json                  Output result as structured JSON
          --config <path>         Path to .repo-sync.json config file
          -a, --account-url <url> Override storage account URL
          -c, --container <name>  Override container name
          --auth-method <method>  Override authentication method

        Examples:
          repo-sync config show
          repo-sync config show --json
          repo-sync config show --config /path/to/.repo-sync.json
    </info>
</repo-sync-config-show>

<repo-sync-config-validate>
    <objective>
        Validate configuration and test the connection to Azure Storage
    </objective>
    <command>
        repo-sync config validate [--json] [--config <path>] [-a <url>] [-c <name>] [--auth-method <method>]
    </command>
    <info>
        Loads and validates all configuration (all required fields must be present),
        creates an authenticated Azure Storage client using the configured auth method,
        and tests the connection by checking if the configured container exists.

        Exit codes:
          0  Configuration valid and connection successful
          1  Configuration valid but connection failed
          2  Configuration error (missing or invalid values)

        Parameters:
          --json                  Output result as structured JSON
          --config <path>         Path to .repo-sync.json config file
          -a, --account-url <url> Override storage account URL
          -c, --container <name>  Override container name
          --auth-method <method>  Override authentication method

        Examples:
          repo-sync config validate
          repo-sync config validate --json
          repo-sync config validate -a https://myaccount.blob.core.windows.net -c my-container --auth-method azure-ad --json
    </info>
</repo-sync-config-validate>

### Repository Replication Commands

<repo-sync-clone-github>
    <objective>
        Replicate a GitHub repository to Azure Blob Storage
    </objective>
    <command>
        repo-sync repo clone-github --repo <owner/repo> --dest <path> [--ref <branch|tag|sha>] [--json] [--verbose]
    </command>
    <info>
        Streams a GitHub repository archive (tarball) directly into Azure Blob Storage
        with zero local disk usage. Downloads the repository as a tar.gz archive from
        the GitHub API and extracts files on-the-fly, uploading each file as a blob
        under the specified destination path. Supports both public and private repositories.

        For private repositories, set the GITHUB_TOKEN environment variable with a
        Personal Access Token that has the "repo" scope.

        If no --ref is specified, the repository's default branch is used.

        Options:
          --repo <owner/repo>   GitHub repository in owner/repo format (required)
          --dest <path>         Destination folder path in Azure Blob Storage (required)
          --ref <ref>           Branch name, tag, or commit SHA (optional, defaults to default branch)
          --json                Output result as structured JSON
          -v, --verbose         Enable verbose logging

        Output fields (JSON mode):
          platform              "github"
          source                Repository identifier (e.g., "microsoft/typescript")
          ref                   Git ref that was replicated
          destPath              Destination folder in blob storage
          totalFiles            Number of files discovered in the archive
          successCount          Number of files uploaded successfully
          failedCount           Number of files that failed to upload
          totalBytes            Total bytes uploaded
          streamingDurationMs   Duration of the streaming pipeline (download + extract + upload)
          totalDurationMs       Total wall-clock duration including metadata fetch and auth
          failedFiles           Array of per-file error details (only present if failures occurred)

        Examples:
          # Clone a public repo to blob storage
          repo-sync repo clone-github --repo microsoft/typescript --dest repos/typescript

          # Clone a specific branch
          repo-sync repo clone-github --repo facebook/react --dest repos/react --ref v18.2.0

          # Clone with JSON output
          repo-sync repo clone-github --repo owner/private-repo --dest backups/private-repo --json

          # Clone a specific commit SHA
          repo-sync repo clone-github --repo microsoft/vscode --dest snapshots/vscode --ref abc1234 --json --verbose
    </info>
</repo-sync-clone-github>

<repo-sync-clone-devops>
    <objective>
        Replicate an Azure DevOps repository to Azure Blob Storage
    </objective>
    <command>
        repo-sync repo clone-devops --org <org> --project <project> --repo <repo> --dest <path> [--ref <ref>] [--version-type <branch|tag|commit>] [--resolve-lfs] [--json] [--verbose]
    </command>
    <info>
        Streams an Azure DevOps repository archive (zip) directly into Azure Blob Storage
        with zero local disk usage. Downloads the repository as a zip archive from the
        Azure DevOps REST API and extracts files on-the-fly, uploading each file as a blob
        under the specified destination path.

        Requires authentication via either:
          - AZURE_DEVOPS_PAT environment variable (Personal Access Token with Code Read scope)
          - Azure AD (when AZURE_DEVOPS_AUTH_METHOD=azure-ad)

        If no --ref is specified, the repository's default branch is used.

        Options:
          --org <org>                 Azure DevOps organization name (required)
          --project <project>         Project name (required)
          --repo <repo>               Repository name or GUID (required)
          --dest <path>               Destination folder path in Azure Blob Storage (required)
          --ref <ref>                 Version identifier: branch name, tag, or commit SHA (optional)
          --version-type <type>       How to interpret --ref: branch, tag, or commit (optional, defaults to "branch")
          --resolve-lfs               Resolve LFS pointers (optional, default false)
          --json                      Output result as structured JSON
          -v, --verbose               Enable verbose logging

        Output fields (JSON mode):
          platform              "azure-devops"
          source                Repository identifier (e.g., "myorg/myproject/myrepo")
          ref                   Git ref that was replicated
          destPath              Destination folder in blob storage
          totalFiles            Number of files discovered in the archive
          successCount          Number of files uploaded successfully
          failedCount           Number of files that failed to upload
          totalBytes            Total bytes uploaded
          streamingDurationMs   Duration of the streaming pipeline (download + extract + upload)
          totalDurationMs       Total wall-clock duration including metadata fetch and auth
          failedFiles           Array of per-file error details (only present if failures occurred)

        Examples:
          # Clone from Azure DevOps (default branch)
          repo-sync repo clone-devops --org myorg --project myproject --repo myrepo --dest repos/myrepo

          # Clone a specific branch
          repo-sync repo clone-devops --org myorg --project myproject --repo myrepo --dest repos/myrepo --ref develop --version-type branch

          # Clone a specific tag with JSON output
          repo-sync repo clone-devops --org myorg --project myproject --repo myrepo --dest releases/v1.0 --ref v1.0.0 --version-type tag --json

          # Clone with LFS resolution
          repo-sync repo clone-devops --org myorg --project myproject --repo myrepo --dest repos/myrepo --resolve-lfs --json

          # Clone a specific commit
          repo-sync repo clone-devops --org myorg --project myproject --repo myrepo --dest snapshots/commit-abc --ref abc1234def5678 --version-type commit --json --verbose
    </info>
</repo-sync-clone-devops>

<repo-sync-sync>
    <objective>
        Replicate multiple repositories to Azure Blob Storage from a sync pair configuration file
    </objective>
    <command>
        repo-sync repo sync --sync-config <path> [--json] [--verbose]
    </command>
    <info>
        Reads a sync pair configuration file (JSON or YAML) and executes each sync pair
        sequentially. Each sync pair specifies its own source repository (GitHub or Azure
        DevOps), its own credentials (token/PAT), and its own Azure Storage destination
        (account URL, container, folder, SAS token). This enables batch replication of
        multiple repositories to potentially different storage targets in a single command.

        File format is detected by extension:
          .json   -> JSON format
          .yaml   -> YAML format
          .yml    -> YAML format

        Behavior:
          - Pairs are processed sequentially (one at a time).
          - Fail-open: if one pair fails, the remaining pairs are still processed.
          - Token expiry is checked for all pairs before processing begins. Expired tokens
            cause an error; tokens expiring within 7 days produce a warning.
          - Each pair creates its own Azure Storage ContainerClient with per-pair SAS token.
          - DevOps sync pairs use PAT authentication only (no azure-ad).

        Exit codes:
          0  All sync pairs succeeded
          1  One or more sync pairs failed (partial failure)
          2  Configuration/authentication error (invalid config file, missing required fields)
          3  Validation error (invalid file format, malformed config)

        Options:
          --sync-config <path>  Path to sync pair configuration file (required)
          --json                Output result as structured JSON
          -v, --verbose         Enable verbose logging

        Output fields (JSON mode):
          totalPairs            Total number of sync pairs processed
          succeeded             Number of pairs that completed successfully
          failed                Number of pairs that failed
          results               Array of per-pair results (name, platform, source, destPath, success, result/error)
          totalDurationMs       Total wall-clock duration in milliseconds

        Example JSON config file (sync-pairs.json):
          {
            "syncPairs": [
              {
                "name": "my-github-repo",
                "platform": "github",
                "source": {
                  "repo": "owner/repo-name",
                  "ref": "main",
                  "token": "ghp_xxxx",
                  "tokenExpiry": "2026-12-31T00:00:00Z"
                },
                "destination": {
                  "accountUrl": "https://myaccount.blob.core.windows.net",
                  "container": "my-container",
                  "folder": "repos/github-repo",
                  "sasToken": "sv=2022-11-02&ss=b&srt=co&sp=rwdlacyx...",
                  "sasTokenExpiry": "2026-12-31T00:00:00Z"
                }
              }
            ]
          }

        Examples:
          # Sync repositories from a JSON config
          repo-sync repo sync --sync-config ./sync-pairs.json

          # Sync repositories from a YAML config with JSON output
          repo-sync repo sync --sync-config ./sync-pairs.yaml --json

          # Sync with verbose logging
          repo-sync repo sync --sync-config ~/configs/sync-pairs.yml --json --verbose
    </info>
</repo-sync-sync>

<repo-sync-list-sync-pairs>
    <objective>
        List configured sync pairs from a sync pair configuration file with token expiry status
    </objective>
    <command>
        repo-sync repo list-sync-pairs [--sync-config <path>] [--json] [--verbose]
    </command>
    <info>
        Reads a sync pair configuration file (JSON or YAML) and displays a summary of all
        configured sync pairs. Credentials (tokens, PATs, SAS tokens) are never shown in the
        output. Instead, token expiry status is reported for each credential: "valid",
        "expiring-soon" (within 7 days), "expired", or "no-expiry-set".

        This command is useful for inspecting what sync pairs are configured without
        executing any replication operations.

        Config path resolution (same as repo sync):
          --sync-config flag > AZURE_FS_SYNC_CONFIG_PATH env var

        Options:
          --sync-config <path>  Path to sync pair configuration file (optional if env var is set)
          --json                Output result as structured JSON
          -v, --verbose         Enable verbose logging

        Output fields (JSON mode):
          totalPairs            Total number of configured sync pairs
          configPath            Resolved path to the configuration file
          syncPairs             Array of sync pair summaries:
            name                Sync pair name
            platform            "github" or "azure-devops"
            source              Source repository identifier (e.g., "owner/repo" or "org/project/repo")
            ref                 Git ref if specified
            destination         Object with accountUrl, container, folder
            tokenStatus         Object with sourceToken and destinationSasToken status

        Examples:
          # List sync pairs from a JSON config
          repo-sync repo list-sync-pairs --sync-config ./sync-settings.json

          # List sync pairs using env var for config path
          export AZURE_FS_SYNC_CONFIG_PATH=./sync-settings.json
          repo-sync repo list-sync-pairs

          # List sync pairs with JSON output
          repo-sync repo list-sync-pairs --sync-config ./sync-settings.json --json
    </info>
</repo-sync-list-sync-pairs>

## Global CLI Options

| Flag | Short | Description |
|------|-------|-------------|
| `--json` | | Output structured JSON to stdout |
| `--verbose` | `-v` | Enable verbose/debug logging |
| `--config <path>` | | Path to .repo-sync.json config file |
| `--account-url <url>` | `-a` | Override storage account URL |
| `--container <name>` | `-c` | Override container name |
| `--auth-method <method>` | | Override auth method |

## Configuration Priority

CLI Flags > Environment Variables > Config File (.repo-sync.json)
