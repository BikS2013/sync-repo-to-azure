import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { loadConfig, loadConfigRaw } from "../config/config.loader";
import { validateConnection } from "../services/auth.service";
import {
  formatSuccess,
  formatErrorFromException,
  outputResult,
} from "../utils/output.utils";
import { CliOptions, AuthMethod, AzureFsConfigFile } from "../types/config.types";
import { exitCodeForError } from "../utils/exit-codes.utils";

/**
 * Register config sub-commands: init, show, validate.
 */
export function registerConfigCommands(program: Command): void {
  const configCmd = program
    .command("config")
    .description("Configuration management commands");

  // --- config init ---
  configCmd
    .command("init")
    .description("Create a .azure-fs.json configuration file interactively")
    .option("--path <path>", "Output path for the config file")
    .action(async (options, cmd) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent!.parent!.opts();
      const jsonMode = globalOpts.json === true;

      try {
        const config = await interactiveConfigInit(options.path);
        const result = formatSuccess(config, "config init", startTime);
        outputResult(result, jsonMode);
      } catch (err) {
        const result = formatErrorFromException(err, "config init", startTime);
        outputResult(result, jsonMode);
        process.exitCode = exitCodeForError(err);
      }
    });

  // --- config show ---
  configCmd
    .command("show")
    .description("Display the resolved configuration (sensitive values masked)")
    .action((_options, cmd) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent!.parent!.opts();
      const jsonMode = globalOpts.json === true;

      try {
        const cliOptions: CliOptions = {
          accountUrl: globalOpts.accountUrl,
          container: globalOpts.container,
          authMethod: globalOpts.authMethod,
          config: globalOpts.config,
          json: globalOpts.json,
          verbose: globalOpts.verbose,
        };

        const raw = loadConfigRaw(cliOptions);
        const masked = maskSensitiveValues(raw);
        const result = formatSuccess(masked, "config show", startTime);
        outputResult(result, jsonMode);
      } catch (err) {
        const result = formatErrorFromException(err, "config show", startTime);
        outputResult(result, jsonMode);
        process.exitCode = exitCodeForError(err);
      }
    });

  // --- config validate ---
  configCmd
    .command("validate")
    .description("Validate configuration and test the connection to Azure Storage")
    .action(async (_options, cmd) => {
      const startTime = Date.now();
      const globalOpts = cmd.parent!.parent!.opts();
      const jsonMode = globalOpts.json === true;

      try {
        const cliOptions: CliOptions = {
          accountUrl: globalOpts.accountUrl,
          container: globalOpts.container,
          authMethod: globalOpts.authMethod,
          config: globalOpts.config,
          json: globalOpts.json,
          verbose: globalOpts.verbose,
        };

        const config = loadConfig(cliOptions);
        const testResult = await validateConnection(config);

        if (testResult.success) {
          const result = formatSuccess(testResult, "config validate", startTime);
          outputResult(result, jsonMode);
        } else {
          const result = formatSuccess(testResult, "config validate", startTime);
          outputResult(result, jsonMode);
          process.exitCode = 1;
        }
      } catch (err) {
        const result = formatErrorFromException(err, "config validate", startTime);
        outputResult(result, jsonMode);
        process.exitCode = exitCodeForError(err);
      }
    });
}

// --- Helper Functions ---

/**
 * Interactive configuration file creation.
 * Prompts the user for each required value and writes the config file.
 */
async function interactiveConfigInit(
  outputPath?: string,
): Promise<{ path: string; config: AzureFsConfigFile }> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr, // Prompts to stderr, keep stdout for JSON output
  });

  const ask = (question: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        resolve(answer.trim());
      });
    });
  };

  try {
    process.stderr.write("\nAzure Blob Storage File System CLI - Configuration Setup\n");
    process.stderr.write("=".repeat(58) + "\n\n");

    // Storage settings
    const accountUrl = await ask(
      "Storage account URL (e.g., https://myaccount.blob.core.windows.net): ",
    );
    const containerName = await ask("Container name: ");
    const authMethodInput = await ask(
      "Authentication method (connection-string / sas-token / azure-ad): ",
    );
    const authMethod = authMethodInput as AuthMethod;

    // SAS token expiry (only for sas-token auth)
    let sasTokenExpiry: string | undefined;
    if (authMethod === "sas-token") {
      sasTokenExpiry = await ask(
        "SAS token expiry (ISO 8601 date, e.g., 2026-12-31T00:00:00Z): ",
      );
    }

    // Logging settings
    const logLevel = await ask("Log level (debug / info / warn / error): ");
    const logRequestsInput = await ask("Log Azure SDK requests? (true / false): ");
    const logRequests = logRequestsInput === "true";

    // Retry settings
    const retryStrategy = await ask("Retry strategy (none / exponential / fixed): ");
    const maxRetriesInput = await ask("Max retries: ");
    const maxRetries = Number(maxRetriesInput);

    let initialDelayMs = 0;
    let maxDelayMs = 0;
    if (retryStrategy !== "none") {
      const initialDelayInput = await ask("Initial delay (ms): ");
      initialDelayMs = Number(initialDelayInput);
      const maxDelayInput = await ask("Max delay (ms): ");
      maxDelayMs = Number(maxDelayInput);
    }

    const storageConfig: AzureFsConfigFile["storage"] = {
      accountUrl,
      containerName,
      authMethod,
    };

    if (sasTokenExpiry) {
      storageConfig!.sasTokenExpiry = sasTokenExpiry;
    }

    const config: AzureFsConfigFile = {
      storage: storageConfig,
      logging: {
        level: logLevel as AzureFsConfigFile["logging"] extends { level: infer L } ? L : never,
        logRequests,
      },
      retry: {
        strategy: retryStrategy as AzureFsConfigFile["retry"] extends { strategy: infer S } ? S : never,
        maxRetries,
        initialDelayMs,
        maxDelayMs,
      },
    };

    const filePath = outputPath
      ? path.resolve(outputPath)
      : path.join(process.cwd(), ".azure-fs.json");

    fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n", "utf-8");

    process.stderr.write(`\nConfiguration written to: ${filePath}\n`);

    if (authMethod === "connection-string") {
      process.stderr.write(
        "\nRemember to set: export AZURE_STORAGE_CONNECTION_STRING=<your-connection-string>\n",
      );
    } else if (authMethod === "sas-token") {
      process.stderr.write(
        "\nRemember to set: export AZURE_STORAGE_SAS_TOKEN=<your-sas-token>\n",
      );
    } else if (authMethod === "azure-ad") {
      process.stderr.write(
        "\nEnsure you are logged in: az login\n",
      );
    }

    return { path: filePath, config };
  } finally {
    rl.close();
  }
}

/**
 * Mask sensitive values in the config for display.
 * Masks environment variables that may contain secrets.
 */
function maskSensitiveValues(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const result = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;

  // Add env var status for informational purposes
  const envStatus: Record<string, string> = {};

  if (process.env.AZURE_STORAGE_CONNECTION_STRING) {
    envStatus["AZURE_STORAGE_CONNECTION_STRING"] = "***SET***";
  } else {
    envStatus["AZURE_STORAGE_CONNECTION_STRING"] = "(not set)";
  }

  if (process.env.AZURE_STORAGE_SAS_TOKEN) {
    envStatus["AZURE_STORAGE_SAS_TOKEN"] = "***SET***";
  } else {
    envStatus["AZURE_STORAGE_SAS_TOKEN"] = "(not set)";
  }

  result["environmentSecrets"] = envStatus;

  return result;
}
