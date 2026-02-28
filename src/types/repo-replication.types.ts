/**
 * Type definitions for the repository replication feature.
 * Covers both GitHub and Azure DevOps platforms.
 */

/** Source platform for the repository */
export type RepoPlatform = "github" | "azure-devops";

/** Version type for Azure DevOps (GitHub uses ref directly) */
export type DevOpsVersionType = "branch" | "tag" | "commit";

/** Auth method for Azure DevOps repository access */
export type DevOpsAuthMethod = "pat" | "azure-ad";

// ---------------------------------------------------------------------------
// Input Parameters
// ---------------------------------------------------------------------------

/** Parameters for a GitHub replication request (shared by CLI and API) */
export interface GitHubRepoParams {
  /** Repository in "owner/repo" format */
  repo: string;
  /** Git ref: branch name, tag, or commit SHA. If omitted, default branch is used. */
  ref?: string;
  /** Destination folder path in Azure Blob Storage */
  destPath: string;
}

/** Parameters for an Azure DevOps replication request (shared by CLI and API) */
export interface DevOpsRepoParams {
  /** Azure DevOps organization name */
  organization: string;
  /** Project name */
  project: string;
  /** Repository name or GUID */
  repository: string;
  /** Version identifier (branch name, tag, commit SHA) */
  ref?: string;
  /** How to interpret the ref. Defaults to "branch" if ref is provided. */
  versionType?: DevOpsVersionType;
  /** Destination folder path in Azure Blob Storage */
  destPath: string;
  /** Whether to resolve LFS pointers (Azure DevOps only) */
  resolveLfs?: boolean;
}

// ---------------------------------------------------------------------------
// Result Types
// ---------------------------------------------------------------------------

/** Per-file upload result within a replication operation */
export interface RepoFileUploadResult {
  /** Relative path within the repository */
  repoPath: string;
  /** Full blob path in Azure Storage */
  blobPath: string;
  /** File size in bytes */
  size: number;
  /** Whether this file was uploaded successfully */
  success: boolean;
  /** Error message if upload failed */
  error?: string;
}

/** Aggregate result of a repository replication operation */
export interface RepoReplicationResult {
  /** Source platform */
  platform: RepoPlatform;
  /** Source repository identifier (e.g., "owner/repo" or "org/project/repo") */
  source: string;
  /** Git ref that was replicated */
  ref: string;
  /** Destination folder path in Azure Blob Storage */
  destPath: string;
  /** Total number of files discovered in the archive stream */
  totalFiles: number;
  /** Number of files successfully uploaded */
  successCount: number;
  /** Number of files that failed to upload */
  failedCount: number;
  /** Total bytes uploaded */
  totalBytes: number;
  /** Duration of the streaming operation (stream + upload combined) in milliseconds.
   *  In the streaming design, download/extraction/upload happen concurrently
   *  as data flows through the pipeline, so they cannot be measured separately. */
  streamingDurationMs: number;
  /** Total wall-clock duration in milliseconds (includes metadata fetch, auth, etc.) */
  totalDurationMs: number;
  /** Per-file results (only included if there were failures, to avoid huge payloads) */
  failedFiles?: RepoFileUploadResult[];
}

// ---------------------------------------------------------------------------
// GitHub-Specific Types
// ---------------------------------------------------------------------------

/** Repository metadata returned by the GitHub API */
export interface GitHubRepoInfo {
  /** Default branch name (e.g., "main") */
  defaultBranch: string;
  /** Whether the repository is private */
  isPrivate: boolean;
  /** Full repository name (e.g., "owner/repo") */
  fullName: string;
}

// ---------------------------------------------------------------------------
// Configuration Types (Repo-Specific Sections)
// ---------------------------------------------------------------------------

/** GitHub-specific configuration (from env vars only, never config file) */
export interface GitHubRepoConfig {
  /** GitHub Personal Access Token */
  token?: string;
  /** Token expiry date in ISO 8601 format */
  tokenExpiry?: string;
}

/** Azure DevOps-specific configuration (from env vars + optional config file) */
export interface DevOpsRepoConfig {
  /** Personal Access Token */
  pat?: string;
  /** PAT expiry date in ISO 8601 format */
  patExpiry?: string;
  /** Authentication method: "pat" or "azure-ad" */
  authMethod?: DevOpsAuthMethod;
  /** Default organization URL (e.g., "https://dev.azure.com/myorg") */
  orgUrl?: string;
}

/** Sync pair destination: Azure Blob Storage target */
export interface SyncPairDestination {
  /** Azure Storage account URL (e.g., https://myaccount.blob.core.windows.net/) */
  accountUrl: string;
  /** Container name */
  container: string;
  /** Destination folder path (use "/" for root) */
  folder: string;
  /** SAS token for authentication */
  sasToken: string;
  /** SAS token expiry in ISO 8601 format (optional, warns before expiry) */
  sasTokenExpiry?: string;
}

/** GitHub sync pair source */
export interface GitHubSyncPairSource {
  /** Repository in "owner/repo" format */
  repo: string;
  /** Branch, tag, or commit SHA (defaults to repo default branch if omitted) */
  ref?: string;
  /** GitHub Personal Access Token (required for private repos) */
  token?: string;
  /** Token expiry in ISO 8601 format */
  tokenExpiry?: string;
}

/** Azure DevOps sync pair source */
export interface DevOpsSyncPairSource {
  /** Organization name */
  organization: string;
  /** Project name */
  project: string;
  /** Repository name or GUID */
  repository: string;
  /** Version identifier (branch name, tag, or commit SHA) */
  ref?: string;
  /** How to interpret ref */
  versionType?: "branch" | "tag" | "commit";
  /** Whether to resolve LFS pointers */
  resolveLfs?: boolean;
  /** Personal Access Token (required) */
  pat: string;
  /** PAT expiry in ISO 8601 format */
  patExpiry?: string;
  /** Organization URL override (e.g., https://dev.azure.com/myorg) */
  orgUrl?: string;
}

/** GitHub sync pair definition */
export interface GitHubSyncPair {
  /** Unique name for this sync pair */
  name: string;
  /** Platform discriminator */
  platform: "github";
  /** Source repository configuration */
  source: GitHubSyncPairSource;
  /** Destination Azure Storage configuration */
  destination: SyncPairDestination;
}

/** Azure DevOps sync pair definition */
export interface DevOpsSyncPair {
  /** Unique name for this sync pair */
  name: string;
  /** Platform discriminator */
  platform: "azure-devops";
  /** Source repository configuration */
  source: DevOpsSyncPairSource;
  /** Destination Azure Storage configuration */
  destination: SyncPairDestination;
}

/** Union type for all sync pair types */
export type SyncPair = GitHubSyncPair | DevOpsSyncPair;

/** Top-level sync pair configuration file structure */
export interface SyncPairConfig {
  /** Array of sync pair definitions */
  syncPairs: SyncPair[];
}

/** Result of a single sync pair execution */
export interface SyncPairItemResult {
  /** Sync pair name */
  name: string;
  /** Platform that was synced */
  platform: "github" | "azure-devops";
  /** Source identifier (e.g., "owner/repo" or "org/project/repo") */
  source: string;
  /** Destination path in Azure Blob Storage */
  destPath: string;
  /** Whether the sync succeeded */
  success: boolean;
  /** Replication result (only present on success) */
  result?: RepoReplicationResult;
  /** Error message (only present on failure) */
  error?: string;
}

/** Result of batch sync pair execution */
export interface SyncPairBatchResult {
  /** Total number of pairs processed */
  totalPairs: number;
  /** Number of pairs that succeeded */
  succeeded: number;
  /** Number of pairs that failed */
  failed: number;
  /** Per-pair results */
  results: SyncPairItemResult[];
  /** Total wall-clock duration in milliseconds */
  totalDurationMs: number;
}
