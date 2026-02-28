import { Request, Response, NextFunction } from "express";
import { RepoReplicationService } from "../../services/repo-replication.service";
import { RepoReplicationError } from "../../errors/repo-replication.error";
import { Logger } from "../../utils/logger.utils";
import {
  validateSyncPairConfig,
  checkSyncPairTokenExpiry,
} from "../../config/sync-pair.loader";

/**
 * Build the standard API response envelope.
 */
function buildResponse<T>(command: string, data: T, startTime: number) {
  return {
    success: true,
    data,
    metadata: {
      command,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    },
  };
}

/**
 * Factory function that creates repo replication controller methods.
 * Each method is a thin layer that extracts request params, calls
 * RepoReplicationService, and formats the response.
 *
 * Express 5 auto-forwards async errors to the error handler middleware,
 * so no try/catch is needed in these methods.
 */
export function createRepoController(
  repoService: RepoReplicationService,
  logger: Logger,
) {
  return {
    /**
     * POST /api/v1/repo/github
     * Clone a GitHub repository to Azure Blob Storage.
     * Body fields: repo (required), ref (optional), destPath (required)
     */
    async cloneGitHub(
      req: Request,
      res: Response,
      _next: NextFunction,
    ): Promise<void> {
      const startTime = Date.now();

      const { repo, ref, destPath } = req.body as {
        repo?: string;
        ref?: string;
        destPath?: string;
      };

      // Validate required fields
      const missingFields: string[] = [];
      if (!repo) missingFields.push("repo");
      if (!destPath) missingFields.push("destPath");

      if (missingFields.length > 0) {
        throw RepoReplicationError.missingParams(missingFields);
      }

      logger.info(`API: Replicating GitHub repo ${repo} to ${destPath}`);

      const result = await repoService.replicateGitHub({
        repo: repo!,
        ref,
        destPath: destPath!,
      });

      res.status(200).json(buildResponse("repo-clone-github", result, startTime));
    },

    /**
     * POST /api/v1/repo/devops
     * Clone an Azure DevOps repository to Azure Blob Storage.
     * Body fields: organization (required), project (required), repository (required),
     *              destPath (required), ref (optional), versionType (optional), resolveLfs (optional)
     */
    async cloneDevOps(
      req: Request,
      res: Response,
      _next: NextFunction,
    ): Promise<void> {
      const startTime = Date.now();

      const {
        organization,
        project,
        repository,
        destPath,
        ref,
        versionType,
        resolveLfs,
      } = req.body as {
        organization?: string;
        project?: string;
        repository?: string;
        destPath?: string;
        ref?: string;
        versionType?: "branch" | "tag" | "commit";
        resolveLfs?: boolean;
      };

      // Validate required fields
      const missingFields: string[] = [];
      if (!organization) missingFields.push("organization");
      if (!project) missingFields.push("project");
      if (!repository) missingFields.push("repository");
      if (!destPath) missingFields.push("destPath");

      if (missingFields.length > 0) {
        throw RepoReplicationError.missingParams(missingFields);
      }

      logger.info(
        `API: Replicating DevOps repo ${organization}/${project}/${repository} to ${destPath}`,
      );

      const result = await repoService.replicateDevOps({
        organization: organization!,
        project: project!,
        repository: repository!,
        ref,
        versionType,
        destPath: destPath!,
        resolveLfs,
      });

      res.status(200).json(buildResponse("repo-clone-devops", result, startTime));
    },

    /**
     * POST /api/v1/repo/sync
     * Execute repository replication from a sync pair configuration.
     * Body: sync pair configuration object (same structure as JSON/YAML file content)
     */
    async syncPairs(
      req: Request,
      res: Response,
      _next: NextFunction,
    ): Promise<void> {
      const startTime = Date.now();

      const body = req.body;
      if (!body || !body.syncPairs) {
        throw RepoReplicationError.missingParams(["syncPairs"]);
      }

      // Validate the sync pair configuration
      const syncConfig = validateSyncPairConfig(body);

      // Check token expiry
      checkSyncPairTokenExpiry(syncConfig, logger);

      logger.info(`API: Processing ${syncConfig.syncPairs.length} sync pairs`);

      const result = await repoService.replicateFromSyncConfig(syncConfig);

      // HTTP status: 200 (all ok), 207 (partial), 500 (all failed)
      const statusCode = result.failed > 0 && result.succeeded === 0
        ? 500
        : result.failed > 0
          ? 207
          : 200;

      res.status(statusCode).json(buildResponse("repo-sync", result, startTime));
    },
  };
}
