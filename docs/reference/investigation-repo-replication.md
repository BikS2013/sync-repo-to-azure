# Investigation: Repository Replication to Azure Blob Storage

## Executive Summary

This investigation evaluates how to extend the azure-fs tool to replicate complete GitHub and Azure DevOps repositories into Azure Blob Storage folders. For each platform, two primary approaches exist: **archive download** (download a tarball/zip, extract, upload) and **tree walking** (enumerate files via API, download and upload individually). The recommended approach for both platforms is **archive download with streaming extraction**, which minimizes API calls, handles binary files natively, and avoids rate-limit pressure. The recommended npm packages are `@octokit/rest` for GitHub, native `fetch` with Base64 PAT headers for Azure DevOps, `tar` (node-tar) for tarball extraction, and `yauzl` for zip extraction.

---

## 1. GitHub Repository Content Access

### 1.1 API Options for Downloading Full Repository Content

#### Option A: Archive Download (Tarball / Zipball)

**Endpoints:**
- `GET /repos/{owner}/{repo}/tarball/{ref}` -- returns HTTP 302 redirect to a temporary download URL
- `GET /repos/{owner}/{repo}/zipball/{ref}` -- same pattern, zip format

**Behavior:**
- If `{ref}` is omitted, the default branch is used.
- The response is a 302 redirect. HTTP clients must follow redirects or read the `Location` header.
- For private repositories, download URLs are temporary and expire after 5 minutes.
- Archives are generated on request by `git archive`, cached briefly, then deleted.
- Submodules are **not included** in the archive -- only pointer files are present. This is a fundamental limitation of `git archive`.
- Git LFS files are **not resolved** -- only LFS pointer files are included.

**Archive structure:**
- Tarball: `.tar.gz` format with a single root directory named `{owner}-{repo}-{short-sha}/`
- Zipball: `.zip` format with the same root directory convention

**Curl example (authenticated):**
```bash
curl -L \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/repos/OWNER/REPO/tarball/main \
  -o repo.tar.gz
```

**Source:** [GitHub Docs - Downloading source code archives](https://docs.github.com/en/repositories/working-with-files/using-files/downloading-source-code-archives)

#### Option B: Git Trees API + Blob Download

**Endpoint (tree listing):**
```
GET /repos/{owner}/{repo}/git/trees/{tree_sha}?recursive=1
```

**Endpoint (blob content):**
```
GET /repos/{owner}/{repo}/git/blobs/{sha}
```

**Behavior:**
- Returns the full file tree in a single call (up to 100,000 entries, 7 MB response).
- If `truncated: true`, the tree exceeded limits and must be fetched non-recursively, one sub-tree at a time.
- Each blob must be fetched individually. Content is Base64-encoded in the response.
- To get the `tree_sha`, first call `GET /repos/{owner}/{repo}/git/ref/heads/{branch}` to get the commit SHA, then `GET /repos/{owner}/{repo}/git/commits/{sha}` to get the tree SHA.

**Source:** [GitHub Docs - Git Trees API](https://docs.github.com/en/rest/git/trees)

#### Option C: Contents API

**Endpoint:**
```
GET /repos/{owner}/{repo}/contents/{path}?ref={branch}
```

**Behavior:**
- Returns file content (Base64-encoded) for files up to 1 MB.
- For 1-100 MB files, only `raw` or `object` media types work.
- Files > 100 MB are not supported.
- Directory listings are limited to 1,000 files.
- Each directory must be fetched separately (no recursion).

**Source:** [GitHub Docs - Repository Contents API](https://docs.github.com/en/rest/repos/contents)

### 1.2 Authentication

| Method | Header | Rate Limit | Use Case |
|--------|--------|------------|----------|
| Unauthenticated | None | 60 req/hour | Public repos only, testing |
| Personal Access Token (PAT) | `Authorization: Bearer <token>` | 5,000 req/hour | Human developers, CI/CD |
| GitHub App Installation Token | `Authorization: Bearer <token>` | 5,000+ req/hour (scales) | Automated services |
| OAuth App Token | `Authorization: Bearer <token>` | 5,000 req/hour | Third-party apps |

**Recommended for azure-fs:** Personal Access Token (PAT), provided via `GITHUB_TOKEN` environment variable. This aligns with the project's pattern of reading auth credentials from environment variables (similar to `AZURE_STORAGE_SAS_TOKEN`).

**Source:** [GitHub Docs - Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

### 1.3 Rate Limiting

- **Unauthenticated:** 60 requests/hour per IP (reduced further as of May 2025).
- **Authenticated (PAT):** 5,000 requests/hour per user.
- **Archive download:** Counts as 1 API call (the redirect request). The actual binary download from the CDN does not count.
- **Tree walking a 1,000-file repo:** ~1 (tree) + 1,000 (blobs) = ~1,001 API calls.
- **Rate limit headers:** `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After` (on 403).

**Source:** [GitHub Changelog - Updated rate limits for unauthenticated requests](https://github.blog/changelog/2025-05-08-updated-rate-limits-for-unauthenticated-requests/)

### 1.4 Branch/Tag/Ref Specification

- All endpoints accept a `ref` parameter: branch name, tag name, or commit SHA.
- To discover the default branch: `GET /repos/{owner}/{repo}` returns `default_branch` field.
- If ref is omitted on archive endpoints, the default branch is used.

### 1.5 Handling Edge Cases

| Case | Archive Approach | Tree-Walking Approach |
|------|-----------------|----------------------|
| **Large repos (>1 GB)** | Works (single download) | Impractical (thousands of API calls) |
| **Binary files** | Included natively | Must Base64-decode from blob API |
| **Files > 100 MB** | Included if not LFS | Cannot fetch via Contents API |
| **Git LFS files** | Only pointer files included | Only pointer files available |
| **Submodules** | Only pointer files (`.gitmodules`) | Only pointer files |
| **Empty directories** | Not preserved (git limitation) | Not listed (no tree entry) |

### 1.6 Available npm Libraries

| Library | Purpose | Weekly Downloads | TypeScript | Notes |
|---------|---------|-----------------|------------|-------|
| `@octokit/rest` | Full GitHub REST API client | ~7M | Yes (built-in) | Official GitHub SDK, typed methods for all endpoints |
| `octokit` | All-in-one GitHub SDK | ~2M | Yes | Includes REST, GraphQL, webhooks, auth |
| `@octokit/core` | Minimal GitHub API client | ~15M | Yes | Lightweight, lower-level |
| `simple-git` | Git CLI wrapper | ~2M | Yes | Requires git binary on host |
| `isomorphic-git` | Pure JS git implementation | ~200K | Yes | Can clone without git binary, but heavy |

**Recommendation:** Use `@octokit/rest` -- it provides typed methods (`octokit.rest.repos.downloadTarballArchive()`), handles authentication, follows redirects, and has excellent TypeScript support.

---

## 2. Azure DevOps Repository Content Access

### 2.1 API Options for Downloading Full Repository Content

#### Option A: Items API -- Zip Download

**Endpoint:**
```
GET https://dev.azure.com/{organization}/{project}/_apis/git/repositories/{repositoryId}/items?path=/&$format=zip&recursionLevel=Full&versionDescriptor.version={branch}&versionDescriptor.versionType=branch&api-version=7.1
```

**Key Parameters:**

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `path` | `/` | Root of repository |
| `$format` | `zip` | Return content as zip archive |
| `recursionLevel` | `Full` | Include all descendants |
| `download` | `true` | Return as downloadable file |
| `versionDescriptor.version` | `main` | Branch/tag/commit name |
| `versionDescriptor.versionType` | `branch` | Interpret version as branch name |
| `zipForUnix` | `true` | Preserve Unix file permissions |
| `resolveLfs` | `true` | Resolve LFS pointers to actual content |
| `api-version` | `7.1` | API version |

**Behavior:**
- Returns a zip archive of the entire repository (or scoped path) in a single HTTP response.
- The `resolveLfs` parameter can resolve LFS pointers (unlike GitHub).
- Supports Unix-compatible zip with `zipForUnix=true`.
- Zipped content is always returned as a download.

**Source:** [Microsoft Learn - Items Get](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/items/get?view=azure-devops-rest-7.1)

#### Option B: Items List API -- Tree Walking

**Endpoint (list files):**
```
GET https://dev.azure.com/{organization}/{project}/_apis/git/repositories/{repositoryId}/items?scopePath=/&recursionLevel=Full&includeContentMetadata=true&api-version=7.1
```

**Endpoint (download individual file):**
```
GET https://dev.azure.com/{organization}/{project}/_apis/git/repositories/{repositoryId}/items?path={filePath}&includeContent=true&api-version=7.1
```

**Behavior:**
- Returns metadata for all items in a single call.
- Individual files must then be downloaded one by one.
- Content can be included inline (Base64 for binary, raw for text).

**Source:** [Microsoft Learn - Items List](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/items/list?view=azure-devops-rest-7.1)

#### Option C: Blobs -- Get Blobs Zip

**Endpoint:**
```
POST https://dev.azure.com/{organization}/{project}/_apis/git/repositories/{repositoryId}/blobs?api-version=7.1
```

**Behavior:**
- Accepts an array of blob object IDs in the request body.
- Returns a zip containing those specific blobs.
- Useful for downloading a subset of files by their object IDs.
- Requires knowing object IDs beforehand (from Items List).

**Source:** [Microsoft Learn - Blobs Get Blobs Zip](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/blobs/get-blobs-zip?view=azure-devops-rest-7.1)

### 2.2 Authentication

| Method | Header | Notes |
|--------|--------|-------|
| Personal Access Token (PAT) | `Authorization: Basic base64(:{PAT})` | Most common for automation. Scope: `Code (Read)` |
| Microsoft Entra ID / Bearer Token | `Authorization: Bearer <token>` | Recommended for production. Resource: `499b84ac-1321-427f-aa17-267ca6975798/.default` |
| DefaultAzureCredential | Bearer token via SDK | Uses `@azure/identity` -- already in project dependencies |

**Using DefaultAzureCredential for Azure DevOps (TypeScript):**
```typescript
import { DefaultAzureCredential } from "@azure/identity";

const credential = new DefaultAzureCredential();
const token = await credential.getToken("499b84ac-1321-427f-aa17-267ca6975798/.default");
// Use token.token as Bearer token in Authorization header
```

**Recommended for azure-fs:** Support both PAT (via `AZURE_DEVOPS_PAT` env var) and Azure AD (via `DefaultAzureCredential` with the DevOps resource scope). This aligns with the project's existing dual auth pattern (connection-string/sas-token vs azure-ad).

**Source:** [Microsoft Learn - Use personal access tokens](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate?view=azure-devops)

### 2.3 API Versioning

- All requests require `api-version` query parameter.
- Current stable version: `7.1` (recommended).
- Older versions supported: 4.1, 5.0, 5.1, 6.0, 6.1, 7.0.
- Preview version available: `7.2`.

### 2.4 Organization/Project/Repository URL Formats

```
https://dev.azure.com/{organization}/{project}/_apis/git/repositories/{repositoryId}/...
```

Where:
- `{organization}` -- Azure DevOps organization name
- `{project}` -- Project name or GUID (optional for some endpoints)
- `{repositoryId}` -- Repository name or GUID

**Alternative (legacy) format:**
```
https://{organization}.visualstudio.com/{project}/_apis/git/repositories/{repositoryId}/...
```

### 2.5 Branch/Tag/Ref Specification

Via `versionDescriptor` parameters:
- `versionDescriptor.version` -- Name of the branch, tag, or commit SHA
- `versionDescriptor.versionType` -- `branch`, `tag`, or `commit`
- `versionDescriptor.versionOptions` -- `none`, `previousChange`, `firstParent`

If omitted, the default branch is used.

### 2.6 Rate Limiting

- Azure DevOps uses a **TSTU** (Throughput Unit) system: 200 TSTUs per 5-minute sliding window.
- No fixed request-per-hour limit like GitHub -- consumption is resource-weighted.
- Archive download is a single API call but may consume more TSTUs due to response size.
- Response headers: `Retry-After`, `X-RateLimit-Delay`, `X-RateLimit-Remaining`.
- Best practice: Honor `Retry-After` header, batch operations where possible.

**Source:** [Microsoft Learn - Rate and usage limits](https://learn.microsoft.com/en-us/azure/devops/integrate/concepts/rate-limits?view=azure-devops)

### 2.7 Handling Edge Cases

| Case | Zip Download | Tree-Walking |
|------|-------------|-------------|
| **Large repos** | Single request | Many API calls, TSTU pressure |
| **Binary files** | Included natively | Must download individually |
| **LFS files** | Resolved with `resolveLfs=true` | Must resolve separately |
| **Submodules** | Not included | Not accessible via Items API |
| **Unix permissions** | Preserved with `zipForUnix=true` | Lost |

---

## 3. Archive Extraction in Node.js

### 3.1 Tarball Extraction (GitHub)

#### Recommended: `tar` (node-tar)

**npm package:** [`tar`](https://www.npmjs.com/package/tar) (maintained by npm, Inc.)

- Weekly downloads: ~25M
- Used internally by npm itself
- Auto-detects gzip compression
- Supports streaming extraction
- `strip: 1` option removes the top-level `{owner}-{repo}-{sha}/` directory

**Streaming extraction pattern (memory-efficient):**
```typescript
import * as tar from 'tar';
import { Readable } from 'stream';

// archiveStream is the HTTP response stream from GitHub
await new Promise<void>((resolve, reject) => {
  archiveStream
    .pipe(tar.extract({
      cwd: tempDir,
      strip: 1,  // Remove top-level directory from tarball
      filter: (path) => !path.includes('..'),  // Security: prevent path traversal
    }))
    .on('finish', resolve)
    .on('error', reject);
});
```

**Alternative: `tar-stream`**
- Lower-level, gives entry-by-entry control
- Does not auto-gunzip -- requires pairing with `zlib.createGunzip()`
- Better for cases where you want to pipe each file directly to blob storage without touching disk

```typescript
import * as tarStream from 'tar-stream';
import { createGunzip } from 'zlib';

const extract = tarStream.extract();
extract.on('entry', (header, stream, next) => {
  // header.name is the file path
  // stream is the file content -- pipe directly to Azure Blob upload
  uploadToBlob(header.name, stream).then(next);
});

archiveStream.pipe(createGunzip()).pipe(extract);
```

### 3.2 Zip Extraction (Azure DevOps)

#### Recommended: `yauzl` via `extract-zip`

**npm package:** [`extract-zip`](https://www.npmjs.com/package/extract-zip)

- Weekly downloads: ~17M
- High-level wrapper around `yauzl`
- Simple API: extract to directory

```typescript
import extract from 'extract-zip';

await extract(zipFilePath, { dir: outputDir });
```

**For streaming (without writing zip to disk first):** Use `yauzl` directly or `unzip-stream`:

```typescript
import * as yauzl from 'yauzl';

yauzl.open(zipFilePath, { lazyEntries: true }, (err, zipfile) => {
  zipfile.readEntry();
  zipfile.on('entry', (entry) => {
    if (/\/$/.test(entry.fileName)) {
      // Directory entry
      zipfile.readEntry();
    } else {
      zipfile.openReadStream(entry, (err, readStream) => {
        // Pipe readStream to Azure Blob upload
        uploadToBlob(entry.fileName, readStream).then(() => zipfile.readEntry());
      });
    }
  });
});
```

**Note:** Zip format requires random access to the central directory (at the end of the file), so true streaming extraction without buffering the entire file is unreliable. For Azure DevOps zip downloads, the practical approach is: download to a temp file, then extract.

### 3.3 Memory Optimization Strategy

| Strategy | Tarball (GitHub) | Zip (Azure DevOps) |
|----------|-----------------|---------------------|
| **Streaming to disk** | Extract to temp dir, then upload | Download zip to temp file, extract to temp dir, upload |
| **Streaming to blob** | Pipe each tar entry directly to blob upload (no disk) | Not feasible -- zip requires random access |
| **Hybrid** | Extract to temp dir, upload with concurrency limiter | Download to temp, stream entries to blob via yauzl |

**Recommended:** For both platforms, extract to a temporary directory, then use the existing `parallelLimit` utility and `uploadFile` method to batch-upload to Azure Blob Storage. This is simpler, uses proven code paths, and the temp directory is cleaned up after.

---

## 4. Comparison Matrix

### 4.1 GitHub: Archive Download vs Tree Walking

| Criterion | Archive Download (Tarball) | Tree Walking (Trees + Blobs API) |
|-----------|--------------------------|----------------------------------|
| **API calls for 1K-file repo** | 1 (archive) + 1 (repo metadata for default branch) | 1 (tree) + 1,000 (blobs) = 1,001 |
| **API calls for 10K-file repo** | 1 + 1 | 1 + 10,000 = 10,001 |
| **Rate limit impact** | Minimal (2 calls) | Severe (uses 20% of hourly budget for 1K files) |
| **Binary file support** | Native | Base64-decode overhead |
| **Max file size** | No API limit (full repo archive) | 100 MB via Blobs API |
| **Streaming capability** | Yes (tar-stream) | Per-file only |
| **Network efficiency** | Single compressed download | N+1 HTTPS requests |
| **Complexity** | Medium (archive extraction logic) | High (pagination, error handling per file) |
| **Progress tracking** | Coarse (download %, then extraction %) | Fine-grained (per-file) |
| **Submodule support** | No (pointer files only) | No (pointer files only) |
| **LFS support** | No (pointer files only) | No (pointer files only) |
| **Resume capability** | No (must restart) | Yes (skip already-uploaded files) |

### 4.2 Azure DevOps: Zip Download vs Tree Walking

| Criterion | Zip Download | Tree Walking (Items API) |
|-----------|-------------|--------------------------|
| **API calls for 1K-file repo** | 1 | 1 (list) + 1,000 (downloads) = 1,001 |
| **Rate limit impact (TSTU)** | Low-medium (one large response) | High (many small requests) |
| **Binary file support** | Native | Per-file download |
| **LFS resolution** | Yes (`resolveLfs=true`) | Must resolve separately |
| **Unix permissions** | Yes (`zipForUnix=true`) | Lost |
| **Streaming capability** | No (zip needs random access) | Per-file |
| **Network efficiency** | Single compressed download | N+1 HTTPS requests |
| **Complexity** | Medium (zip extraction) | High |
| **Progress tracking** | Coarse | Fine-grained |
| **Resume capability** | No | Yes |

### 4.3 Cross-Platform Summary

| Feature | GitHub (Tarball) | Azure DevOps (Zip) |
|---------|-----------------|---------------------|
| **Auth method** | PAT via Bearer header | PAT via Basic header or Entra ID Bearer |
| **Archive format** | `.tar.gz` | `.zip` |
| **Extraction library** | `tar` (node-tar) | `yauzl` / `extract-zip` |
| **Streaming extraction** | Yes (pipe tar entries to blob) | No (must buffer to temp file) |
| **LFS resolution** | Not available via API | Available (`resolveLfs=true`) |
| **Default branch discovery** | `GET /repos/{owner}/{repo}` -> `default_branch` | Implicit (omit versionDescriptor) |
| **Rate limit model** | Request count (5,000/hr) | Resource consumption (200 TSTU/5min) |

---

## 5. Recommendation

### 5.1 Recommended Approach: Archive Download for Both Platforms

**For GitHub:** Download tarball via `GET /repos/{owner}/{repo}/tarball/{ref}`, extract with `tar` (node-tar), upload files to Azure Blob Storage using existing `BlobFileSystemService.uploadFile()` and `parallelLimit`.

**For Azure DevOps:** Download zip via Items API with `$format=zip&recursionLevel=Full`, extract with `extract-zip` (yauzl-based), upload files identically.

**Flow (both platforms):**
1. Resolve repository metadata (default branch if ref not specified).
2. Download archive to a temporary directory (`os.tmpdir()`).
3. Extract archive to a temporary directory (strip top-level for GitHub tarball).
4. Walk extracted directory recursively, building upload task list.
5. Upload all files to Azure Blob Storage using `parallelLimit` with configured concurrency (`AZURE_FS_BATCH_CONCURRENCY`).
6. Clean up temporary directories.
7. Return structured `CommandResult<RepoReplicationResult>`.

### 5.2 npm Packages to Add

| Package | Purpose | Justification |
|---------|---------|---------------|
| `@octokit/rest` | GitHub API client | Official SDK, typed, handles auth/redirects/pagination |
| `tar` | Tarball extraction | Used by npm itself, streaming support, `strip` option |
| `extract-zip` | Zip extraction | High-level yauzl wrapper, 17M weekly downloads |

**Not recommended to add:**
- `simple-git` / `isomorphic-git` -- Overkill for downloading; we don't need git clone, just file content.
- `adm-zip` -- Not streaming, loads entire zip into memory.
- `azure-devops-node-api` -- Microsoft's official SDK but very heavy; raw fetch with proper auth headers is simpler for our needs (only 2 endpoints needed).

### 5.3 Authentication Strategy

**GitHub:**
- New env var: `GITHUB_TOKEN` (Personal Access Token)
- Optional env var: `GITHUB_TOKEN_EXPIRY` (ISO 8601, for proactive expiry warning -- aligns with project pattern from `AZURE_STORAGE_SAS_TOKEN_EXPIRY`)
- For public repos, token is optional (but recommended to avoid 60 req/hr limit).
- Auth header: `Authorization: Bearer ${GITHUB_TOKEN}`

**Azure DevOps:**
- New env vars: `AZURE_DEVOPS_PAT`, `AZURE_DEVOPS_PAT_EXPIRY` (ISO 8601)
- Alternative: Use existing `DefaultAzureCredential` from `@azure/identity` (already a project dependency) with scope `499b84ac-1321-427f-aa17-267ca6975798/.default`
- Auth header (PAT): `Authorization: Basic ${base64(':' + PAT)}`
- Auth header (Entra ID): `Authorization: Bearer ${token}`
- New env var for auth method selection: `AZURE_DEVOPS_AUTH_METHOD` (`pat` or `azure-ad`)

**Alignment with existing patterns:**
- The project already uses env vars for auth (connection-string, sas-token, azure-ad).
- The project already validates expiry dates (`sasTokenExpiry` check in `auth.service.ts`).
- The project already has `DefaultAzureCredential` from `@azure/identity` installed.
- The project enforces no-fallback configuration: missing tokens must throw errors.

### 5.4 Proposed CLI Commands

```bash
# GitHub repository replication
azure-fs repo clone-github --repo owner/repo --ref main --dest /target/folder
azure-fs repo clone-github --repo owner/repo --tag v1.0.0 --dest /target/folder

# Azure DevOps repository replication
azure-fs repo clone-devops --org myorg --project myproject --repo myrepo --ref main --dest /target/folder
azure-fs repo clone-devops --org myorg --project myproject --repo myrepo --tag v1.0.0 --dest /target/folder
```

### 5.5 Proposed API Endpoints

```
POST /api/v1/repo/github
  Body: { owner: string, repo: string, ref?: string, destPath: string }

POST /api/v1/repo/devops
  Body: { organization: string, project: string, repository: string, ref?: string, versionType?: "branch"|"tag"|"commit", destPath: string }
```

### 5.6 Proposed New Service

```
src/services/repo-replication.service.ts  -- Orchestration (download, extract, upload)
src/services/github-client.service.ts     -- GitHub API wrapper (using @octokit/rest)
src/services/devops-client.service.ts     -- Azure DevOps API wrapper (raw fetch + auth)
```

### 5.7 Limitations to Document

1. **No submodule support** -- Neither platform's archive includes submodule content.
2. **No Git LFS for GitHub** -- GitHub tarballs contain only LFS pointer files. Azure DevOps supports LFS resolution via `resolveLfs=true`.
3. **No incremental sync** -- Each replication is a full copy. Differential sync would require tracking state (commit SHA, ETags).
4. **Temporary disk space** -- Archives are extracted to `os.tmpdir()` before upload. Large repos require sufficient disk space.
5. **No git history** -- Only the working tree at the specified ref is replicated, not the `.git` directory or commit history.

---

## 6. Direct Streaming Approach (Design Revision)

### 6.1 Problem with the Archive-to-Disk Approach

The original recommendation (Section 5) proposed downloading archives to `os.tmpdir()`, extracting to disk, then uploading each file. This approach has several drawbacks:

1. **Disk space**: Requires approximately 2x the repository size in free disk space (archive + extracted files).
2. **Cleanup burden**: Temporary files must be cleaned up in `finally` blocks, and SIGKILL scenarios leave orphaned files.
3. **Latency**: The three phases (download, extract, upload) are sequential -- no data flows to blob storage until the entire archive is extracted.
4. **Container constraints**: Memory-constrained environments (Docker containers, Azure App Service, Kubernetes pods) often have limited ephemeral storage, making the temp-dir approach impractical for large repos.

### 6.2 Direct Streaming Alternative

Instead of writing archives to disk, the archive can be streamed directly from the source platform through an archive parser, with each file entry piped immediately to Azure Blob Storage.

**GitHub tarball pipeline:**
```
GitHub HTTP response (tar.gz) -> zlib.createGunzip() -> tar-stream extract -> per-entry pipe to BlockBlobClient.uploadStream()
```

**Azure DevOps zip pipeline:**
```
DevOps HTTP response (zip) -> unzipper.Parse() -> per-entry pipe to BlockBlobClient.uploadStream()
```

### 6.3 Streaming Library Evaluation

#### Tar Streaming: `tar-stream` vs `tar` (node-tar)

| Criterion | `tar` (node-tar) | `tar-stream` |
|-----------|-----------------|-------------|
| Weekly downloads | ~25M | ~8M |
| Entry-by-entry control | No (extracts to directory) | Yes (`extract.on('entry', ...)`) |
| Auto-gunzip | Yes | No (requires manual `zlib.createGunzip()`) |
| `strip: 1` support | Yes (built-in option) | No (manual first-component stripping) |
| Pipe entry to upload | Not directly supported | Full support -- entry stream is a standard `Readable` |

**Decision**: Use `tar-stream` because it provides entry-by-entry control needed for piping each file directly to `BlockBlobClient.uploadStream()`. The trade-off is manual gunzip and path stripping, which is trivial to implement.

#### Zip Streaming: Library Comparison

| Criterion | `yauzl` | `extract-zip` | `unzipper` | `unzip-stream` |
|-----------|--------|-------------|-----------|--------------|
| Weekly downloads | ~17M | ~17M | ~3M | ~600K |
| True streaming (no file on disk) | No (requires random access) | No (wrapper around yauzl) | Yes (Parse mode) | Yes |
| Central Directory reading | Yes (correct) | Yes (via yauzl) | Yes (Open mode) + No (Parse mode) | No |
| Pipe from HTTP response | No | No | Yes | Yes |
| TypeScript types | @types/yauzl | Built-in | Built-in | @types/unzip-stream |
| Entry stream piping | Yes (from file) | No (extracts to dir) | Yes | Yes |
| Zip64 support | Limited | Via yauzl | Yes | Yes |

**The Central Directory Problem**: ZIP files store their authoritative file listing (Central Directory) at the end of the file. Libraries like `yauzl` read this directory first, which requires the complete file on disk or in memory. Streaming libraries (`unzipper.Parse()`, `unzip-stream`) process entries using Local File Headers at the beginning of each entry, which is less authoritative but enables true streaming.

**Decision**: Use `unzipper` because:
1. It supports piping an HTTP response stream directly through `unzipper.Parse()`.
2. Each entry provides a standard Node.js `Readable` stream that can be piped to blob storage.
3. It has built-in TypeScript types.
4. The Local File Header correctness concern is mitigated because Azure DevOps generates well-formed zip files.
5. It supports Zip64 for large archives.

#### Alternative Considered: Tree-Walk + Individual File Streaming (Azure DevOps)

For Azure DevOps, an alternative to zip streaming is the Items API tree-walk:
1. Get file tree via `recursionLevel=Full` with `$format=json` (metadata only).
2. For each file in the tree, stream its content via individual Items API GET requests.

**Rejected because**:
- For a 1,000-file repo, this requires 1,001 API calls vs 1 for zip.
- Each API call consumes TSTU (Azure DevOps rate limit budget).
- Network overhead: 1,001 HTTPS round-trips vs 1.
- The streaming zip approach achieves the same result with a single HTTP response.

### 6.4 Why Direct Streaming Was Chosen

| Criterion | Archive-to-Disk | Direct Streaming |
|-----------|----------------|-----------------|
| **Disk space required** | 2x repo size | Zero |
| **Memory usage** | Low (files on disk) | Low-Medium (4 MB buffer per file) |
| **Latency** | Sequential: download -> extract -> upload | Concurrent: all phases overlap |
| **Container-friendly** | No (needs ephemeral storage) | Yes (no disk needed) |
| **Cleanup burden** | Yes (finally blocks, SIGKILL risk) | None |
| **Complexity** | Medium | Medium-High (streaming pipeline) |
| **Concurrent uploads** | Yes (parallelLimit) | No (sequential entry processing) |
| **Resume capability** | No | No |

The direct streaming approach is preferred because it eliminates local disk requirements entirely, making it suitable for containerized deployments and memory-constrained environments. The trade-off of sequential entry processing (vs parallel uploads in the archive-to-disk approach) is acceptable for typical source code repositories where most files are small.

### 6.5 Updated npm Package Recommendations

| Package | Purpose | Justification |
|---------|---------|---------------|
| `@octokit/rest` | GitHub API client | Official SDK, typed, handles auth/redirects. Use `parseSuccessResponseBody: false` for streaming. |
| `tar-stream` | Tarball streaming extraction | Entry-by-entry control for piping to blob storage |
| `unzipper` | Zip streaming extraction | True streaming from HTTP response, TypeScript types, Zip64 support |

**Replaced from original recommendation:**
- `tar` (node-tar) -- replaced by `tar-stream` for entry-level streaming control
- `extract-zip` -- replaced by `unzipper` for true streaming extraction without disk

---

## 7. References

### GitHub API Documentation
- [Downloading source code archives](https://docs.github.com/en/repositories/working-with-files/using-files/downloading-source-code-archives)
- [REST API endpoints for repository contents](https://docs.github.com/en/rest/repos/contents)
- [REST API endpoints for Git trees](https://docs.github.com/en/rest/git/trees)
- [Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [REST API endpoints for repositories](https://docs.github.com/en/rest/reference/repos)
- [About large files on GitHub](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)
- [Repository limits](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits)
- [Updated rate limits for unauthenticated requests (May 2025)](https://github.blog/changelog/2025-05-08-updated-rate-limits-for-unauthenticated-requests/)

### Azure DevOps API Documentation
- [Items - Get](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/items/get?view=azure-devops-rest-7.1)
- [Items - List](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/items/list?view=azure-devops-rest-7.1)
- [Blobs - Get Blobs Zip](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/blobs/get-blobs-zip?view=azure-devops-rest-7.1)
- [Use personal access tokens](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate?view=azure-devops)
- [Rate and usage limits](https://learn.microsoft.com/en-us/azure/devops/integrate/concepts/rate-limits?view=azure-devops)
- [Integration best practices](https://learn.microsoft.com/en-us/azure/devops/integrate/concepts/integration-bestpractices?view=azure-devops)

### npm Packages
- [@octokit/rest](https://www.npmjs.com/package/@octokit/rest) -- GitHub REST API client
- [octokit](https://www.npmjs.com/package/octokit) -- All-in-one GitHub SDK
- [tar (node-tar)](https://www.npmjs.com/package/tar) -- Tarball extraction/creation
- [tar-stream](https://www.npmjs.com/package/tar-stream) -- Low-level streaming tar parser
- [extract-zip](https://www.npmjs.com/package/extract-zip) -- High-level zip extraction (yauzl-based)
- [yauzl](https://www.npmjs.com/package/yauzl) -- Low-level zip parser
- [unzip-stream](https://www.npmjs.com/package/unzip-stream) -- Streaming zip extraction
- [unzipper](https://www.npmjs.com/package/unzipper) -- Streaming zip extraction with Parse and Open modes

### Blog Posts and Community Discussions
- [Download files from Azure DevOps Git repository through REST API](https://oshamrai.wordpress.com/2023/04/06/how-to-download-files-from-azure-devops-git-repository-through-rest-api-and-powershell/)
- [Download files and folders from Azure DevOps](https://prcode.co.uk/2023/11/15/download-files-and-folders-from-azure-devops/)
- [GitHub API: Download Zip/Tarball Links](https://www.tutorialpedia.org/blog/github-api-download-zip-or-tarball-link/)
- [Say goodbye to your Personal Access Tokens (Azure DevOps)](https://jessehouwing.net/azure-devops-say-goodbye-to-personal-access-tokens-pats/)
- [Reducing PAT usage across Azure DevOps](https://devblogs.microsoft.com/devops/reducing-pat-usage-across-azure-devops/)
