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
 * Register edit operation commands: edit, patch, append.
 */
export function registerEditCommands(program: Command): void {
  // --- edit (download to temp) ---
  program
    .command("edit")
    .description("Download a blob to a temp file for editing, or re-upload an edited file")
    .argument("<remote>", "Remote blob path")
    .option("--upload", "Re-upload mode: re-upload an edited file (requires --local and --etag)")
    .option("--local <path>", "Local file path to re-upload (used with --upload)")
    .option("--etag <etag>", "ETag from original download for concurrency check (used with --upload)")
    .action(async (remote: string, options: Record<string, unknown>, cmd: Command) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent!.opts();
      const jsonMode = globalOpts.json === true;

      try {
        const config = resolveConfig(globalOpts);
        const logger = new Logger(config.logging.level, globalOpts.verbose === true);
        const service = new BlobFileSystemService(config, logger);

        if (options["upload"]) {
          // Re-upload mode
          const localPath = options["local"] as string | undefined;
          const etag = options["etag"] as string | undefined;

          if (!localPath) {
            throw new Error("--local <path> is required when using --upload");
          }
          if (!etag) {
            throw new Error("--etag <etag> is required when using --upload");
          }

          const result = await service.editFileUpload(remote, localPath, etag);

          const output = formatSuccess(result, "edit-upload", startTime);
          outputResult(output, jsonMode);
        } else {
          // Download to temp mode
          const result = await service.editFile(remote);

          const output = formatSuccess(result, "edit", startTime);
          outputResult(output, jsonMode);
        }
      } catch (err) {
        const commandName = options["upload"] ? "edit-upload" : "edit";
        const output = formatErrorFromException(err, commandName, startTime);
        outputResult(output, jsonMode);
        process.exitCode = exitCodeForError(err);
      }
    });

  // --- patch ---
  program
    .command("patch")
    .description("Apply text patches (find-replace) to a blob")
    .argument("<remote>", "Remote blob path")
    .requiredOption("--find <text>", "Text or regex pattern to find")
    .requiredOption("--replace <text>", "Replacement text")
    .option("--regex", "Treat --find as a regular expression")
    .option("--flags <flags>", "Regex flags (e.g., 'g', 'gi'); implies --regex")
    .action(async (remote: string, options: Record<string, unknown>, cmd: Command) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent!.opts();
      const jsonMode = globalOpts.json === true;

      try {
        const config = resolveConfig(globalOpts);
        const logger = new Logger(config.logging.level, globalOpts.verbose === true);
        const service = new BlobFileSystemService(config, logger);

        const find = options["find"] as string;
        const replace = options["replace"] as string;
        const isRegex = (options["regex"] === true) || (typeof options["flags"] === "string");
        const flags = options["flags"] as string | undefined;

        const result = await service.patchFile(remote, [
          {
            find,
            replace,
            isRegex,
            flags: flags ?? (isRegex ? "g" : undefined),
          },
        ]);

        const output = formatSuccess(result, "patch", startTime);
        outputResult(output, jsonMode);
      } catch (err) {
        const output = formatErrorFromException(err, "patch", startTime);
        outputResult(output, jsonMode);
        process.exitCode = exitCodeForError(err);
      }
    });

  // --- append ---
  program
    .command("append")
    .description("Append or prepend content to a blob")
    .argument("<remote>", "Remote blob path")
    .requiredOption("--content <text>", "Content to add")
    .option("--position <position>", "Where to add: 'start' or 'end' (default: end)", "end")
    .action(async (remote: string, options: Record<string, unknown>, cmd: Command) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent!.opts();
      const jsonMode = globalOpts.json === true;

      try {
        const config = resolveConfig(globalOpts);
        const logger = new Logger(config.logging.level, globalOpts.verbose === true);
        const service = new BlobFileSystemService(config, logger);

        const content = options["content"] as string;
        const position = options["position"] as "start" | "end";

        if (position !== "start" && position !== "end") {
          throw new Error(`Invalid position "${position}". Must be "start" or "end".`);
        }

        const result = await service.appendToFile(remote, content, position);

        const output = formatSuccess(result, "append", startTime);
        outputResult(output, jsonMode);
      } catch (err) {
        const output = formatErrorFromException(err, "append", startTime);
        outputResult(output, jsonMode);
        process.exitCode = exitCodeForError(err);
      }
    });
}
