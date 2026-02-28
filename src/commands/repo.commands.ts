import { Command } from "commander";
import { resolveConfig } from "../config/config.loader";
import { createContainerClient } from "../services/auth.service";
import { RepoReplicationService } from "../services/repo-replication.service";
import {
  formatSuccess,
  formatErrorFromException,
  outputResult,
} from "../utils/output.utils";
import { Logger } from "../utils/logger.utils";
import { exitCodeForError } from "../utils/exit-codes.utils";
import { DevOpsVersionType } from "../types/repo-replication.types";
import { loadSyncPairConfig } from "../config/sync-pair.loader";
import { ConfigError } from "../errors/config.error";

/**
 * Register repository replication commands: repo clone-github, repo clone-devops.
 */
export function registerRepoCommands(program: Command): void {
  const repo = program
    .command("repo")
    .description("Repository replication commands");

  // --- clone-github ---
  repo
    .command("clone-github")
    .description("Replicate a GitHub repository to Azure Blob Storage")
    .requiredOption("--repo <owner/repo>", "GitHub repository in owner/repo format")
    .requiredOption("--dest <path>", "Destination folder in Azure Blob Storage")
    .option("--ref <ref>", "Branch, tag, or commit SHA (defaults to repo default branch)")
    .action(async (options: Record<string, unknown>, cmd: Command) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent!.parent!.opts();
      const jsonMode = globalOpts.json === true;

      try {
        const config = resolveConfig(globalOpts);
        const logger = new Logger(config.logging.level, globalOpts.verbose === true);
        const containerClient = createContainerClient(config);
        const service = new RepoReplicationService(config, containerClient, logger);

        const result = await service.replicateGitHub({
          repo: options["repo"] as string,
          destPath: options["dest"] as string,
          ref: options["ref"] as string | undefined,
        });

        const output = formatSuccess(result, "repo clone-github", startTime);
        outputResult(output, jsonMode);
      } catch (err) {
        const output = formatErrorFromException(err, "repo clone-github", startTime);
        outputResult(output, jsonMode);
        process.exitCode = exitCodeForError(err);
      }
    });

  // --- clone-devops ---
  repo
    .command("clone-devops")
    .description("Replicate an Azure DevOps repository to Azure Blob Storage")
    .requiredOption("--org <org>", "Azure DevOps organization name")
    .requiredOption("--project <project>", "Project name")
    .requiredOption("--repo <repo>", "Repository name")
    .requiredOption("--dest <path>", "Destination folder in Azure Blob Storage")
    .option("--ref <ref>", "Version identifier (branch name, tag, or commit SHA)")
    .option("--version-type <type>", "How to interpret ref: branch, tag, or commit")
    .option("--resolve-lfs", "Resolve LFS pointers")
    .action(async (options: Record<string, unknown>, cmd: Command) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent!.parent!.opts();
      const jsonMode = globalOpts.json === true;

      try {
        const config = resolveConfig(globalOpts);
        const logger = new Logger(config.logging.level, globalOpts.verbose === true);
        const containerClient = createContainerClient(config);
        const service = new RepoReplicationService(config, containerClient, logger);

        const result = await service.replicateDevOps({
          organization: options["org"] as string,
          project: options["project"] as string,
          repository: options["repo"] as string,
          destPath: options["dest"] as string,
          ref: options["ref"] as string | undefined,
          versionType: options["versionType"] as DevOpsVersionType | undefined,
          resolveLfs: options["resolveLfs"] === true ? true : undefined,
        });

        const output = formatSuccess(result, "repo clone-devops", startTime);
        outputResult(output, jsonMode);
      } catch (err) {
        const output = formatErrorFromException(err, "repo clone-devops", startTime);
        outputResult(output, jsonMode);
        process.exitCode = exitCodeForError(err);
      }
    });

  // --- sync ---
  repo
    .command("sync")
    .description("Replicate repositories from a sync pair configuration file (JSON or YAML)")
    .option("--sync-config <path>", "Path to sync pair configuration file (.json, .yaml, .yml) — overrides AZURE_FS_SYNC_CONFIG_PATH env var")
    .action(async (options: Record<string, unknown>, cmd: Command) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent!.parent!.opts();
      const jsonMode = globalOpts.json === true;

      try {
        const config = resolveConfig(globalOpts);
        const logger = new Logger(config.logging.level, globalOpts.verbose === true);

        // Resolve sync config path: CLI flag > env var (no fallback)
        const configPath = (options["syncConfig"] as string | undefined)
          || process.env.AZURE_FS_SYNC_CONFIG_PATH;

        if (!configPath) {
          throw new ConfigError(
            "CONFIG_MISSING",
            "Sync pair configuration path not provided. Use --sync-config <path> or set the AZURE_FS_SYNC_CONFIG_PATH environment variable.",
          );
        }
        const syncConfig = loadSyncPairConfig(configPath, logger);

        // Create RepoReplicationService (global containerClient used as fallback for constructor)
        const containerClient = createContainerClient(config);
        const service = new RepoReplicationService(config, containerClient, logger);

        const result = await service.replicateFromSyncConfig(syncConfig);

        const output = formatSuccess(result, "repo sync", startTime);
        outputResult(output, jsonMode);

        // Set exit code based on failures
        if (result.failed > 0) {
          process.exitCode = 1;
        }
      } catch (err) {
        const output = formatErrorFromException(err, "repo sync", startTime);
        outputResult(output, jsonMode);
        process.exitCode = exitCodeForError(err);
      }
    });
}
