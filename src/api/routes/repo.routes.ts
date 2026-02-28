import { Router } from "express";
import { ApiServices } from "./index";
import { createRepoController } from "../controllers/repo.controller";
import { createTimeoutMiddleware } from "../middleware/timeout.middleware";

/**
 * Create the repository replication router.
 *
 * Mounted at /api/v1/repo by the route registration barrel.
 *
 * Applies a 5-minute timeout override because repo replication
 * is a long-running operation that can exceed the default timeout.
 */
export function createRepoRoutes(services: ApiServices): Router {
  const router = Router();
  const controller = createRepoController(
    services.repoReplicationService!,
    services.logger,
  );

  // Override timeout for repo routes (5 minutes instead of default)
  router.use(createTimeoutMiddleware(300000));

  /**
   * @openapi
   * /api/v1/repo/github:
   *   post:
   *     operationId: cloneGitHubRepo
   *     summary: Clone a GitHub repository to Azure Blob Storage
   *     description: |
   *       Streams a GitHub repository archive (tarball) directly into Azure Blob Storage
   *       with zero local disk usage. Supports public and private repositories.
   *       If no ref is specified, the default branch is used.
   *       This is a long-running operation; a 5-minute timeout is applied.
   *     tags: [Repository Replication]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [repo, destPath]
   *             properties:
   *               repo:
   *                 type: string
   *                 description: GitHub repository in "owner/repo" format
   *                 example: "microsoft/typescript"
   *               ref:
   *                 type: string
   *                 description: Branch name, tag, or commit SHA. Omit for default branch.
   *                 example: "main"
   *               destPath:
   *                 type: string
   *                 description: Destination folder path in Azure Blob Storage
   *                 example: "repos/typescript"
   *     responses:
   *       200:
   *         description: Repository replicated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   type: object
   *                   properties:
   *                     platform:
   *                       type: string
   *                       example: "github"
   *                     source:
   *                       type: string
   *                       example: "microsoft/typescript"
   *                     ref:
   *                       type: string
   *                       example: "main"
   *                     destPath:
   *                       type: string
   *                       example: "repos/typescript"
   *                     totalFiles:
   *                       type: integer
   *                       example: 142
   *                     successCount:
   *                       type: integer
   *                       example: 142
   *                     failedCount:
   *                       type: integer
   *                       example: 0
   *                     totalBytes:
   *                       type: integer
   *                       example: 5242880
   *                     streamingDurationMs:
   *                       type: integer
   *                       example: 9500
   *                     totalDurationMs:
   *                       type: integer
   *                       example: 11750
   *                     failedFiles:
   *                       type: array
   *                       nullable: true
   *                       items:
   *                         type: object
   *                         properties:
   *                           repoPath:
   *                             type: string
   *                           blobPath:
   *                             type: string
   *                           size:
   *                             type: integer
   *                           success:
   *                             type: boolean
   *                           error:
   *                             type: string
   *                 metadata:
   *                   type: object
   *                   properties:
   *                     command:
   *                       type: string
   *                       example: "repo-clone-github"
   *                     timestamp:
   *                       type: string
   *                       format: date-time
   *                     durationMs:
   *                       type: integer
   *       400:
   *         description: Missing required fields (repo or destPath)
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: false
   *                 error:
   *                   type: object
   *                   properties:
   *                     code:
   *                       type: string
   *                       example: "REPO_MISSING_PARAMS"
   *                     message:
   *                       type: string
   *                       example: "Missing required fields: repo, destPath"
   *                 metadata:
   *                   type: object
   *                   properties:
   *                     timestamp:
   *                       type: string
   *                       format: date-time
   *       401:
   *         description: Authentication token missing for private repository
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: false
   *                 error:
   *                   type: object
   *                   properties:
   *                     code:
   *                       type: string
   *                       example: "REPO_AUTH_MISSING"
   *                     message:
   *                       type: string
   *                 metadata:
   *                   type: object
   *                   properties:
   *                     timestamp:
   *                       type: string
   *                       format: date-time
   *       404:
   *         description: Repository not found or not accessible
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: false
   *                 error:
   *                   type: object
   *                   properties:
   *                     code:
   *                       type: string
   *                       example: "REPO_NOT_FOUND"
   *                     message:
   *                       type: string
   *                 metadata:
   *                   type: object
   *                   properties:
   *                     timestamp:
   *                       type: string
   *                       format: date-time
   *       500:
   *         description: Internal server error (extraction or upload failure)
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: false
   *                 error:
   *                   type: object
   *                   properties:
   *                     code:
   *                       type: string
   *                       example: "REPO_EXTRACTION_FAILED"
   *                     message:
   *                       type: string
   *                 metadata:
   *                   type: object
   *                   properties:
   *                     timestamp:
   *                       type: string
   *                       format: date-time
   */
  router.post("/github", controller.cloneGitHub);

  /**
   * @openapi
   * /api/v1/repo/devops:
   *   post:
   *     operationId: cloneDevOpsRepo
   *     summary: Clone an Azure DevOps repository to Azure Blob Storage
   *     description: |
   *       Streams an Azure DevOps repository archive (zip) directly into Azure Blob Storage
   *       with zero local disk usage. Requires either a PAT token or Azure AD authentication.
   *       If no ref is specified, the default branch is used.
   *       This is a long-running operation; a 5-minute timeout is applied.
   *     tags: [Repository Replication]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [organization, project, repository, destPath]
   *             properties:
   *               organization:
   *                 type: string
   *                 description: Azure DevOps organization name
   *                 example: "myorg"
   *               project:
   *                 type: string
   *                 description: Project name
   *                 example: "myproject"
   *               repository:
   *                 type: string
   *                 description: Repository name or GUID
   *                 example: "myrepo"
   *               ref:
   *                 type: string
   *                 description: Version identifier (branch name, tag, commit SHA). Omit for default branch.
   *                 example: "main"
   *               versionType:
   *                 type: string
   *                 enum: [branch, tag, commit]
   *                 description: How to interpret the ref field. Defaults to "branch".
   *                 example: "branch"
   *               destPath:
   *                 type: string
   *                 description: Destination folder path in Azure Blob Storage
   *                 example: "repos/my-devops-project"
   *               resolveLfs:
   *                 type: boolean
   *                 description: Whether to resolve LFS pointers. Defaults to false.
   *                 example: false
   *     responses:
   *       200:
   *         description: Repository replicated successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   type: object
   *                   properties:
   *                     platform:
   *                       type: string
   *                       example: "azure-devops"
   *                     source:
   *                       type: string
   *                       example: "myorg/myproject/myrepo"
   *                     ref:
   *                       type: string
   *                       example: "main"
   *                     destPath:
   *                       type: string
   *                       example: "repos/my-devops-project"
   *                     totalFiles:
   *                       type: integer
   *                       example: 85
   *                     successCount:
   *                       type: integer
   *                       example: 85
   *                     failedCount:
   *                       type: integer
   *                       example: 0
   *                     totalBytes:
   *                       type: integer
   *                       example: 3145728
   *                     streamingDurationMs:
   *                       type: integer
   *                       example: 7200
   *                     totalDurationMs:
   *                       type: integer
   *                       example: 8500
   *                     failedFiles:
   *                       type: array
   *                       nullable: true
   *                       items:
   *                         type: object
   *                         properties:
   *                           repoPath:
   *                             type: string
   *                           blobPath:
   *                             type: string
   *                           size:
   *                             type: integer
   *                           success:
   *                             type: boolean
   *                           error:
   *                             type: string
   *                 metadata:
   *                   type: object
   *                   properties:
   *                     command:
   *                       type: string
   *                       example: "repo-clone-devops"
   *                     timestamp:
   *                       type: string
   *                       format: date-time
   *                     durationMs:
   *                       type: integer
   *       400:
   *         description: Missing required fields
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: false
   *                 error:
   *                   type: object
   *                   properties:
   *                     code:
   *                       type: string
   *                       example: "REPO_MISSING_PARAMS"
   *                     message:
   *                       type: string
   *                       example: "Missing required fields: organization, project, repository, destPath"
   *                 metadata:
   *                   type: object
   *                   properties:
   *                     timestamp:
   *                       type: string
   *                       format: date-time
   *       401:
   *         description: Authentication token missing for DevOps repository
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: false
   *                 error:
   *                   type: object
   *                   properties:
   *                     code:
   *                       type: string
   *                       example: "REPO_AUTH_MISSING"
   *                     message:
   *                       type: string
   *                 metadata:
   *                   type: object
   *                   properties:
   *                     timestamp:
   *                       type: string
   *                       format: date-time
   *       404:
   *         description: Repository not found or not accessible
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: false
   *                 error:
   *                   type: object
   *                   properties:
   *                     code:
   *                       type: string
   *                       example: "REPO_NOT_FOUND"
   *                     message:
   *                       type: string
   *                 metadata:
   *                   type: object
   *                   properties:
   *                     timestamp:
   *                       type: string
   *                       format: date-time
   *       500:
   *         description: Internal server error (extraction or upload failure)
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: false
   *                 error:
   *                   type: object
   *                   properties:
   *                     code:
   *                       type: string
   *                       example: "REPO_EXTRACTION_FAILED"
   *                     message:
   *                       type: string
   *                 metadata:
   *                   type: object
   *                   properties:
   *                     timestamp:
   *                       type: string
   *                       format: date-time
   */
  router.post("/devops", controller.cloneDevOps);

  /**
   * @openapi
   * /api/v1/repo/sync:
   *   post:
   *     operationId: syncRepositories
   *     summary: Replicate repositories from sync pair configuration
   *     description: |
   *       Executes a batch of repository replication operations from a sync pair
   *       configuration. Each pair specifies its own source repository credentials
   *       and Azure Storage destination (SAS token auth). Pairs are processed sequentially.
   *       This is a long-running operation; a 30-minute timeout is applied.
   *       DevOps sync pairs use PAT authentication only.
   *     tags: [Repository Replication]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [syncPairs]
   *             properties:
   *               syncPairs:
   *                 type: array
   *                 minItems: 1
   *                 items:
   *                   type: object
   *                   required: [name, platform, source, destination]
   *                   properties:
   *                     name:
   *                       type: string
   *                       description: Unique name for this sync pair
   *                       example: "my-github-repo"
   *                     platform:
   *                       type: string
   *                       enum: [github, azure-devops]
   *                       description: Source platform
   *                     source:
   *                       type: object
   *                       description: Source repository configuration (platform-specific)
   *                     destination:
   *                       type: object
   *                       required: [accountUrl, container, folder, sasToken]
   *                       properties:
   *                         accountUrl:
   *                           type: string
   *                           description: Azure Storage account URL
   *                           example: "https://myaccount.blob.core.windows.net"
   *                         container:
   *                           type: string
   *                           description: Container name
   *                           example: "my-container"
   *                         folder:
   *                           type: string
   *                           description: Destination folder path (required)
   *                           example: "repos/my-repo"
   *                         sasToken:
   *                           type: string
   *                           description: SAS token for Azure Storage auth
   *                         sasTokenExpiry:
   *                           type: string
   *                           description: SAS token expiry (ISO 8601)
   *     responses:
   *       200:
   *         description: All sync pairs completed successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 data:
   *                   type: object
   *                   properties:
   *                     totalPairs:
   *                       type: integer
   *                       example: 3
   *                     succeeded:
   *                       type: integer
   *                       example: 3
   *                     failed:
   *                       type: integer
   *                       example: 0
   *                     results:
   *                       type: array
   *                       items:
   *                         type: object
   *                         properties:
   *                           name:
   *                             type: string
   *                           platform:
   *                             type: string
   *                           source:
   *                             type: string
   *                           destPath:
   *                             type: string
   *                           success:
   *                             type: boolean
   *                           result:
   *                             type: object
   *                           error:
   *                             type: string
   *                           errorCode:
   *                             type: string
   *                     totalDurationMs:
   *                       type: integer
   *                       example: 45000
   *                 metadata:
   *                   type: object
   *                   properties:
   *                     command:
   *                       type: string
   *                       example: "repo-sync"
   *                     timestamp:
   *                       type: string
   *                       format: date-time
   *                     durationMs:
   *                       type: integer
   *       207:
   *         description: Some sync pairs failed (partial success)
   *       400:
   *         description: Invalid sync pair configuration
   *       500:
   *         description: All sync pairs failed
   */
  router.post("/sync", createTimeoutMiddleware(1800000), controller.syncPairs);

  return router;
}
