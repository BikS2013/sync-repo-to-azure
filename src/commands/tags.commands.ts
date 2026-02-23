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
 * Register tag commands: tags set | get | query.
 */
export function registerTagsCommands(program: Command): void {
  const tags = program
    .command("tags")
    .description("Manage blob index tags");

  // --- tags set ---
  tags
    .command("set")
    .description("Set (replace all) blob index tags on a blob")
    .argument("<remote>", "Remote blob path")
    .argument("<pairs...>", "Tag key=value pairs")
    .action(async (remote: string, pairs: string[], _options: Record<string, unknown>, cmd: Command) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent!.parent!.opts();
      const jsonMode = globalOpts.json === true;

      try {
        const config = resolveConfig(globalOpts);
        const logger = new Logger(config.logging.level, globalOpts.verbose === true);
        const service = new MetadataService(config, logger);

        const tagMap = parseKeyValuePairs(pairs);
        const result = await service.setTags(remote, tagMap);

        const output = formatSuccess(result, "tags set", startTime);
        outputResult(output, jsonMode);
      } catch (err) {
        const output = formatErrorFromException(err, "tags set", startTime);
        outputResult(output, jsonMode);
        process.exitCode = exitCodeForError(err);
      }
    });

  // --- tags get ---
  tags
    .command("get")
    .description("Get all blob index tags from a blob")
    .argument("<remote>", "Remote blob path")
    .action(async (remote: string, _options: Record<string, unknown>, cmd: Command) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent!.parent!.opts();
      const jsonMode = globalOpts.json === true;

      try {
        const config = resolveConfig(globalOpts);
        const logger = new Logger(config.logging.level, globalOpts.verbose === true);
        const service = new MetadataService(config, logger);

        const result = await service.getTags(remote);

        const output = formatSuccess(result, "tags get", startTime);
        outputResult(output, jsonMode);
      } catch (err) {
        const output = formatErrorFromException(err, "tags get", startTime);
        outputResult(output, jsonMode);
        process.exitCode = exitCodeForError(err);
      }
    });

  // --- tags query ---
  tags
    .command("query")
    .description("Query blobs by an OData tag filter expression")
    .argument("<filter>", "OData tag filter (e.g. \"env = 'prod'\")")
    .action(async (filter: string, _options: Record<string, unknown>, cmd: Command) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent!.parent!.opts();
      const jsonMode = globalOpts.json === true;

      try {
        const config = resolveConfig(globalOpts);
        const logger = new Logger(config.logging.level, globalOpts.verbose === true);
        const service = new MetadataService(config, logger);

        const result = await service.queryByTags(filter);

        const output = formatSuccess(result, "tags query", startTime);
        outputResult(output, jsonMode);
      } catch (err) {
        const output = formatErrorFromException(err, "tags query", startTime);
        outputResult(output, jsonMode);
        process.exitCode = exitCodeForError(err);
      }
    });
}
