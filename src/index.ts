#!/usr/bin/env node

import { initAzureVenv } from "azure-venv";
import { Command } from "commander";
import {
  registerConfigCommands,
  registerRepoCommands,
} from "./commands";
import { exitCodeForError } from "./utils/exit-codes.utils";
import { setAzureVenvResult } from "./utils/azure-venv-holder.utils";

// Run the CLI
async function main(): Promise<void> {
  // Load remote blobs + env vars from Azure Blob Storage, then local .env
  // Must run before any code that reads process.env
  const syncResult = await initAzureVenv();
  setAzureVenvResult(syncResult);
  if (syncResult.attempted) {
    process.stderr.write(
      `azure-venv: ${syncResult.downloaded} blobs read in ${syncResult.duration}ms\n`,
    );
  }

  const program = new Command();

  program
    .name("repo-sync")
    .description("Repository synchronization tool for GitHub and Azure DevOps to Azure Blob Storage")
    .version("1.0.0")
    .option("--json", "Output structured JSON instead of human-readable text")
    .option("-v, --verbose", "Enable verbose logging of requests and operations")
    .option("--config <path>", "Path to .repo-sync.json config file")
    .option("-a, --account-url <url>", "Storage account URL (overrides config file and env var)")
    .option("-c, --container <name>", "Container name (overrides config file and env var)")
    .option("--auth-method <method>", "Authentication method: connection-string | sas-token | azure-ad");

  // Register command modules
  registerConfigCommands(program);
  registerRepoCommands(program);

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
