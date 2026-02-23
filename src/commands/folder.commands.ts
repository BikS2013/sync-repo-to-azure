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
 * Register folder operation commands: ls, mkdir, rmdir.
 */
export function registerFolderCommands(program: Command): void {
  // --- ls ---
  program
    .command("ls")
    .description("List files and folders at the given path")
    .argument("<path>", "Remote folder path (use / for root)")
    .option("-r, --recursive", "List all nested items recursively")
    .action(async (folderPath: string, options: Record<string, unknown>, cmd: Command) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent!.opts();
      const jsonMode = globalOpts.json === true;

      try {
        const config = resolveConfig(globalOpts);
        const logger = new Logger(config.logging.level, globalOpts.verbose === true);
        const service = new BlobFileSystemService(config, logger);

        const result = await service.listFolder(folderPath, {
          recursive: options["recursive"] === true,
        });

        const output = formatSuccess(result, "ls", startTime);
        outputResult(output, jsonMode);
      } catch (err) {
        const output = formatErrorFromException(err, "ls", startTime);
        outputResult(output, jsonMode);
        process.exitCode = exitCodeForError(err);
      }
    });

  // --- mkdir ---
  program
    .command("mkdir")
    .description("Create a virtual folder (zero-byte marker blob)")
    .argument("<path>", "Remote folder path to create")
    .action(async (folderPath: string, _options: Record<string, unknown>, cmd: Command) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent!.opts();
      const jsonMode = globalOpts.json === true;

      try {
        const config = resolveConfig(globalOpts);
        const logger = new Logger(config.logging.level, globalOpts.verbose === true);
        const service = new BlobFileSystemService(config, logger);

        const result = await service.createFolder(folderPath);

        const output = formatSuccess(result, "mkdir", startTime);
        outputResult(output, jsonMode);
      } catch (err) {
        const output = formatErrorFromException(err, "mkdir", startTime);
        outputResult(output, jsonMode);
        process.exitCode = exitCodeForError(err);
      }
    });

  // --- rmdir ---
  program
    .command("rmdir")
    .description("Delete a folder and all its contents recursively")
    .argument("<path>", "Remote folder path to delete")
    .action(async (folderPath: string, _options: Record<string, unknown>, cmd: Command) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent!.opts();
      const jsonMode = globalOpts.json === true;

      try {
        const config = resolveConfig(globalOpts);
        const logger = new Logger(config.logging.level, globalOpts.verbose === true);
        const service = new BlobFileSystemService(config, logger);

        const result = await service.deleteFolder(folderPath);

        const output = formatSuccess(result, "rmdir", startTime);
        outputResult(output, jsonMode);
      } catch (err) {
        const output = formatErrorFromException(err, "rmdir", startTime);
        outputResult(output, jsonMode);
        process.exitCode = exitCodeForError(err);
      }
    });
}
