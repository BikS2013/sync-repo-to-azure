import { Command } from "commander";
import { resolveConfig } from "../config/config.loader";
import { MetadataService } from "../services/metadata.service";
import {
  formatSuccess,
  formatErrorFromException,
  outputResult,
} from "../utils/output.utils";
import { Logger } from "../utils/logger.utils";
import { exitCodeForError } from "../utils/exit-codes.utils";

/**
 * Parse an array of "key=value" strings into a Record<string, string>.
 */
function parseKeyValuePairs(pairs: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of pairs) {
    const eqIndex = pair.indexOf("=");
    if (eqIndex === -1) {
      throw new Error(`Invalid format: "${pair}". Expected key=value.`);
    }
    const key = pair.substring(0, eqIndex);
    const value = pair.substring(eqIndex + 1);
    result[key] = value;
  }
  return result;
}

/**
 * Register metadata commands: meta set | get | update | delete.
 */
export function registerMetaCommands(program: Command): void {
  const meta = program
    .command("meta")
    .description("Manage blob user-defined metadata");

  // --- meta set ---
  meta
    .command("set")
    .description("Set (replace all) metadata on a blob")
    .argument("<remote>", "Remote blob path")
    .argument("<pairs...>", "Metadata key=value pairs")
    .action(async (remote: string, pairs: string[], _options: Record<string, unknown>, cmd: Command) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent!.parent!.opts();
      const jsonMode = globalOpts.json === true;

      try {
        const config = resolveConfig(globalOpts);
        const logger = new Logger(config.logging.level, globalOpts.verbose === true);
        const service = new MetadataService(config, logger);

        const metadata = parseKeyValuePairs(pairs);
        const result = await service.setMetadata(remote, metadata);

        const output = formatSuccess(result, "meta set", startTime);
        outputResult(output, jsonMode);
      } catch (err) {
        const output = formatErrorFromException(err, "meta set", startTime);
        outputResult(output, jsonMode);
        process.exitCode = exitCodeForError(err);
      }
    });

  // --- meta get ---
  meta
    .command("get")
    .description("Get all metadata from a blob")
    .argument("<remote>", "Remote blob path")
    .action(async (remote: string, _options: Record<string, unknown>, cmd: Command) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent!.parent!.opts();
      const jsonMode = globalOpts.json === true;

      try {
        const config = resolveConfig(globalOpts);
        const logger = new Logger(config.logging.level, globalOpts.verbose === true);
        const service = new MetadataService(config, logger);

        const result = await service.getMetadata(remote);

        const output = formatSuccess(result, "meta get", startTime);
        outputResult(output, jsonMode);
      } catch (err) {
        const output = formatErrorFromException(err, "meta get", startTime);
        outputResult(output, jsonMode);
        process.exitCode = exitCodeForError(err);
      }
    });

  // --- meta update ---
  meta
    .command("update")
    .description("Merge metadata into existing blob metadata")
    .argument("<remote>", "Remote blob path")
    .argument("<pairs...>", "Metadata key=value pairs to merge")
    .action(async (remote: string, pairs: string[], _options: Record<string, unknown>, cmd: Command) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent!.parent!.opts();
      const jsonMode = globalOpts.json === true;

      try {
        const config = resolveConfig(globalOpts);
        const logger = new Logger(config.logging.level, globalOpts.verbose === true);
        const service = new MetadataService(config, logger);

        const partial = parseKeyValuePairs(pairs);
        const result = await service.updateMetadata(remote, partial);

        const output = formatSuccess(result, "meta update", startTime);
        outputResult(output, jsonMode);
      } catch (err) {
        const output = formatErrorFromException(err, "meta update", startTime);
        outputResult(output, jsonMode);
        process.exitCode = exitCodeForError(err);
      }
    });

  // --- meta delete ---
  meta
    .command("delete")
    .description("Delete specific metadata keys from a blob")
    .argument("<remote>", "Remote blob path")
    .argument("<keys...>", "Metadata keys to remove")
    .action(async (remote: string, keys: string[], _options: Record<string, unknown>, cmd: Command) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent!.parent!.opts();
      const jsonMode = globalOpts.json === true;

      try {
        const config = resolveConfig(globalOpts);
        const logger = new Logger(config.logging.level, globalOpts.verbose === true);
        const service = new MetadataService(config, logger);

        const result = await service.deleteMetadata(remote, keys);

        const output = formatSuccess(result, "meta delete", startTime);
        outputResult(output, jsonMode);
      } catch (err) {
        const output = formatErrorFromException(err, "meta delete", startTime);
        outputResult(output, jsonMode);
        process.exitCode = exitCodeForError(err);
      }
    });
}
