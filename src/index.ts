#!/usr/bin/env node

import { Command } from "commander";
import * as dotenv from "dotenv";
import {
  registerConfigCommands,
  registerFileCommands,
  registerFolderCommands,
  registerEditCommands,
  registerMetaCommands,
  registerTagsCommands,
} from "./commands";
import { exitCodeForError } from "./utils/exit-codes.utils";

// Load .env file if present (for local development)
dotenv.config();

const program = new Command();

program
  .name("azure-fs")
  .description("Azure Blob Storage virtual file system CLI tool")
  .version("1.0.0")
  .option("--json", "Output structured JSON instead of human-readable text")
  .option("-v, --verbose", "Enable verbose logging of requests and operations")
  .option("--config <path>", "Path to .azure-fs.json config file")
  .option("-a, --account-url <url>", "Storage account URL (overrides config file and env var)")
  .option("-c, --container <name>", "Container name (overrides config file and env var)")
  .option("--auth-method <method>", "Authentication method: connection-string | sas-token | azure-ad");

// Register command modules
registerConfigCommands(program);
registerFileCommands(program);
registerFolderCommands(program);
registerEditCommands(program);
registerMetaCommands(program);
registerTagsCommands(program);

// Run the CLI
async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    // Only handle errors that were NOT already handled by command actions.
    // Command actions set process.exitCode and output their own errors.
    if (process.exitCode) {
      // Already handled by a command action
      return;
    }

    if (program.opts().json) {
      const result = {
        success: false,
        error: {
          code: "UNKNOWN_ERROR",
          message: err instanceof Error ? err.message : String(err),
        },
        metadata: {
          command: "unknown",
          timestamp: new Date().toISOString(),
          durationMs: 0,
        },
      };
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    }
    process.exitCode = exitCodeForError(err);
  }
}

main();
