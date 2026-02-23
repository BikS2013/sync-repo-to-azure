import { Command } from "commander";
import { resolveConfig } from "../config/config.loader";
import { BlobFileSystemService } from "../services/blob-filesystem.service";
import {
  formatSuccess,
  formatErrorFromException,
  outputResult,
} from "../utils/output.utils";
import { Logger } from "../utils/logger.utils";
import { exitCodeForError } from "../utils/exit-codes.utils";
/**
 * Parse repeatable --metadata key=value options into a Record.
 * Accepts an array of "key=value" strings.
 */
function parseKeyValuePairs(pairs?: string[]): Record<string, string> | undefined {
  if (!pairs || pairs.length === 0) {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const pair of pairs) {
    const eqIndex = pair.indexOf("=");
    if (eqIndex === -1) {
      throw new Error(`Invalid metadata format: "${pair}". Expected key=value.`);
    }
    const key = pair.substring(0, eqIndex);
    const value = pair.substring(eqIndex + 1);
    result[key] = value;
  }
  return result;
}

/**
 * Register file operation commands: upload, download, delete, replace, info, exists.
 */
export function registerFileCommands(program: Command): void {
  // --- upload ---
  program
    .command("upload")
    .description("Upload a local file to blob storage")
    .argument("<local>", "Local file path")
    .argument("<remote>", "Remote blob path")
    .option("--metadata <pairs...>", "Metadata key=value pairs")
    .action(async (local: string, remote: string, options: Record<string, unknown>, cmd: Command) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent!.opts();
      const jsonMode = globalOpts.json === true;

      try {
        const config = resolveConfig(globalOpts);
        const logger = new Logger(config.logging.level, globalOpts.verbose === true);
        const service = new BlobFileSystemService(config, logger);

        const metadata = parseKeyValuePairs(options["metadata"] as string[] | undefined);
        const result = await service.uploadFile(remote, local, metadata);

        const output = formatSuccess(result, "upload", startTime);
        outputResult(output, jsonMode);
      } catch (err) {
        const output = formatErrorFromException(err, "upload", startTime);
        outputResult(output, jsonMode);
        process.exitCode = exitCodeForError(err);
      }
    });

  // --- download ---
  program
    .command("download")
    .description("Download a blob from storage")
    .argument("<remote>", "Remote blob path")
    .argument("[local]", "Optional local file path to save to")
    .action(async (remote: string, local: string | undefined, _options: Record<string, unknown>, cmd: Command) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent!.opts();
      const jsonMode = globalOpts.json === true;

      try {
        const config = resolveConfig(globalOpts);
        const logger = new Logger(config.logging.level, globalOpts.verbose === true);
        const service = new BlobFileSystemService(config, logger);

        const result = await service.downloadFile(remote, local);

        const output = formatSuccess(result, "download", startTime);
        outputResult(output, jsonMode);
      } catch (err) {
        const output = formatErrorFromException(err, "download", startTime);
        outputResult(output, jsonMode);
        process.exitCode = exitCodeForError(err);
      }
    });

  // --- delete ---
  program
    .command("delete")
    .description("Delete a single blob from storage")
    .argument("<remote>", "Remote blob path")
    .action(async (remote: string, _options: Record<string, unknown>, cmd: Command) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent!.opts();
      const jsonMode = globalOpts.json === true;

      try {
        const config = resolveConfig(globalOpts);
        const logger = new Logger(config.logging.level, globalOpts.verbose === true);
        const service = new BlobFileSystemService(config, logger);

        const result = await service.deleteFile(remote);

        const output = formatSuccess(result, "delete", startTime);
        outputResult(output, jsonMode);
      } catch (err) {
        const output = formatErrorFromException(err, "delete", startTime);
        outputResult(output, jsonMode);
        process.exitCode = exitCodeForError(err);
      }
    });

  // --- replace ---
  program
    .command("replace")
    .description("Replace an existing blob with new content")
    .argument("<local>", "Local file path")
    .argument("<remote>", "Remote blob path")
    .option("--metadata <pairs...>", "Metadata key=value pairs")
    .action(async (local: string, remote: string, options: Record<string, unknown>, cmd: Command) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent!.opts();
      const jsonMode = globalOpts.json === true;

      try {
        const config = resolveConfig(globalOpts);
        const logger = new Logger(config.logging.level, globalOpts.verbose === true);
        const service = new BlobFileSystemService(config, logger);

        const metadata = parseKeyValuePairs(options["metadata"] as string[] | undefined);
        const result = await service.replaceFile(remote, local, metadata);

        const output = formatSuccess(result, "replace", startTime);
        outputResult(output, jsonMode);
      } catch (err) {
        const output = formatErrorFromException(err, "replace", startTime);
        outputResult(output, jsonMode);
        process.exitCode = exitCodeForError(err);
      }
    });

  // --- info ---
  program
    .command("info")
    .description("Show blob properties, metadata, and tags")
    .argument("<remote>", "Remote blob path")
    .action(async (remote: string, _options: Record<string, unknown>, cmd: Command) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent!.opts();
      const jsonMode = globalOpts.json === true;

      try {
        const config = resolveConfig(globalOpts);
        const logger = new Logger(config.logging.level, globalOpts.verbose === true);
        const service = new BlobFileSystemService(config, logger);

        const result = await service.getFileInfo(remote);

        const output = formatSuccess(result, "info", startTime);
        outputResult(output, jsonMode);
      } catch (err) {
        const output = formatErrorFromException(err, "info", startTime);
        outputResult(output, jsonMode);
        process.exitCode = exitCodeForError(err);
      }
    });

  // --- upload-dir ---
  program
    .command("upload-dir")
    .description("Upload a local directory to blob storage with parallel uploads")
    .argument("<local-dir>", "Local directory path")
    .argument("<remote-prefix>", "Remote blob prefix (e.g., 'data/uploads/')")
    .option("--concurrency <n>", "Max parallel uploads (overrides batch.concurrency config)")
    .option("--exclude <patterns>", "Comma-separated exclusion patterns (e.g., node_modules,.git,dist)")
    .option("--metadata <pairs...>", "Metadata key=value pairs to apply to all files")
    .action(async (localDir: string, remotePrefix: string, options: Record<string, unknown>, cmd: Command) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent!.opts();
      const jsonMode = globalOpts.json === true;

      try {
        const config = resolveConfig(globalOpts);
        const logger = new Logger(config.logging.level, globalOpts.verbose === true);
        const service = new BlobFileSystemService(config, logger);

        const metadata = parseKeyValuePairs(options["metadata"] as string[] | undefined);

        // Concurrency: CLI --concurrency flag overrides config
        const concurrency = options["concurrency"]
          ? Number(options["concurrency"])
          : config.batch.concurrency;

        // Parse exclude patterns from comma-separated string
        const excludeStr = options["exclude"] as string | undefined;
        const exclude = excludeStr ? excludeStr.split(",").map((s) => s.trim()) : undefined;

        const result = await service.uploadDirectory(localDir, remotePrefix, {
          concurrency,
          exclude,
          metadata,
        });

        const output = formatSuccess(result, "upload-dir", startTime);
        outputResult(output, jsonMode);
      } catch (err) {
        const output = formatErrorFromException(err, "upload-dir", startTime);
        outputResult(output, jsonMode);
        process.exitCode = exitCodeForError(err);
      }
    });

  // --- exists ---
  program
    .command("exists")
    .description("Check if a file or folder exists at the given path")
    .argument("<path>", "Remote path to check")
    .option("--type <type>", "Narrow check to 'file' or 'folder' (default: checks both)")
    .action(async (remotePath: string, options: Record<string, unknown>, cmd: Command) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent!.opts();
      const jsonMode = globalOpts.json === true;

      try {
        const config = resolveConfig(globalOpts);
        const logger = new Logger(config.logging.level, globalOpts.verbose === true);
        const service = new BlobFileSystemService(config, logger);

        const typeOption = options["type"] as string | undefined;

        if (typeOption === "folder") {
          // Check folder existence only
          const result = await service.folderExists(remotePath);
          const output = formatSuccess(result, "exists", startTime);
          outputResult(output, jsonMode);
        } else if (typeOption === "file" || !typeOption) {
          // Check file existence (default behavior when no --type or --type file)
          const result = await service.fileExists(remotePath);

          // If --type is not specified and the file doesn't exist, also check as folder
          if (!typeOption && !result.exists) {
            const folderResult = await service.folderExists(remotePath);
            if (folderResult.exists) {
              const output = formatSuccess(folderResult, "exists", startTime);
              outputResult(output, jsonMode);
              return;
            }
          }

          const output = formatSuccess(result, "exists", startTime);
          outputResult(output, jsonMode);
        } else {
          throw new Error(`Invalid --type value: "${typeOption}". Must be "file" or "folder".`);
        }
      } catch (err) {
        const output = formatErrorFromException(err, "exists", startTime);
        outputResult(output, jsonMode);
        process.exitCode = exitCodeForError(err);
      }
    });
}
