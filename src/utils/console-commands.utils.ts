import * as readline from "readline";
import chalk from "chalk";
import { ApiResolvedConfig } from "../types/api-config.types";
import { getAzureVenvIntrospection, getWatchStatus } from "./azure-venv-holder.utils";

/**
 * Callback that returns a snapshot of configuration for the "inspect" hotkey.
 */
export type ConfigInspectorFn = () => Record<string, unknown>;

/**
 * Interactive console hotkeys for development and debugging.
 *
 * Hotkeys (type letter + Enter):
 *   c  Clear console (including scrollback buffer)
 *   f  Freeze / unfreeze log output
 *   v  Toggle verbose mode (sets AZURE_FS_LOG_LEVEL between debug/info)
 *   i  Inspect resolved configuration
 *   h  Show help
 *   Ctrl+C  Graceful exit
 *
 * Only enabled when NODE_ENV !== "production".
 */
export class ConsoleCommands {
  private rl: readline.Interface | null = null;
  private outputFrozen = false;
  private verboseMode = false;
  private readonly originalConsoleLog: typeof console.log;
  private readonly originalConsoleError: typeof console.error;
  private readonly originalConsoleWarn: typeof console.warn;
  private readonly configInspector: ConfigInspectorFn | undefined;

  constructor(configInspector?: ConfigInspectorFn) {
    this.configInspector = configInspector;
    this.originalConsoleLog = console.log.bind(console);
    this.originalConsoleError = console.error.bind(console);
    this.originalConsoleWarn = console.warn.bind(console);
  }

  /**
   * Build a ConfigInspectorFn from the resolved API config.
   * Sensitive values (connection strings, SAS tokens) are masked.
   */
  static createInspector(config: ApiResolvedConfig): ConfigInspectorFn {
    return () => {
      const mask = (v: string | undefined): string =>
        v ? `${v.slice(0, 8)}...${v.slice(-4)}` : "(not set)";

      return {
        "storage.accountUrl": config.storage?.accountUrl ?? "(not configured)",
        "storage.containerName": config.storage?.containerName ?? "(not configured)",
        "storage.authMethod": config.storage?.authMethod ?? "(not configured)",
        "logging.level": config.logging.level,
        "logging.logRequests": config.logging.logRequests,
        "retry.strategy": config.retry.strategy,
        "retry.maxRetries": config.retry.maxRetries,
        "api.port": config.api.port,
        "api.host": config.api.host,
        "api.nodeEnv": config.api.nodeEnv,
        "api.swaggerEnabled": config.api.swaggerEnabled,
        "api.corsOrigins": config.api.corsOrigins.join(", "),
        "api.requestTimeoutMs": config.api.requestTimeoutMs,
        "api.autoSelectPort": config.api.autoSelectPort,
        "AZURE_STORAGE_CONNECTION_STRING": mask(process.env.AZURE_STORAGE_CONNECTION_STRING),
        "AZURE_STORAGE_SAS_TOKEN": mask(process.env.AZURE_STORAGE_SAS_TOKEN),
        "verbose (runtime)": process.env.AZURE_FS_LOG_LEVEL === "debug",
      };
    };
  }

  public setup(): void {
    try {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
      });

      setTimeout(() => {
        this.showHelp();
      }, 100);

      this.rl.on("line", (input) => {
        this.handleCommand(input.trim().toLowerCase());
      });

      this.rl.on("SIGINT", () => {
        this.originalConsoleLog(chalk.yellow("\n\u{1F44B} Exiting..."));
        this.cleanup();
        process.exit(0);
      });

      this.rl.on("error", (err) => {
        this.originalConsoleError(chalk.red("\u26A0\uFE0F  Console hotkeys error:"), err.message);
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.originalConsoleLog(chalk.yellow("\u26A0\uFE0F  Console hotkeys not available:"), msg);
    }
  }

  private handleCommand(cmd: string): void {
    switch (cmd) {
      case "c":
        this.executeClear();
        break;
      case "f":
        this.executeFreeze();
        break;
      case "v":
        this.executeVerbose();
        break;
      case "i":
        this.executeInspect();
        break;
      case "b":
        this.executeAzureVenvInspect();
        break;
      case "h":
        this.showHelp();
        break;
      default:
        break;
    }
  }

  /**
   * Clear the console. Returns structured result for API consumption.
   */
  public executeClear(): { action: string; success: boolean } {
    process.stdout.write("\x1B[2J\x1B[3J\x1B[H");
    if (process.platform !== "win32") {
      process.stdout.write("\u001b[0;0H\u001b[2J");
    }
    this.originalConsoleLog(chalk.green("\u2728 Console cleared"));
    this.showHelp();
    return { action: "clear", success: true };
  }

  /**
   * Toggle freeze/unfreeze of log output. Returns structured result for API consumption.
   */
  public executeFreeze(): { action: string; frozen: boolean } {
    this.outputFrozen = !this.outputFrozen;

    if (this.outputFrozen) {
      console.log = () => {};
      console.error = () => {};
      console.warn = () => {};
      this.originalConsoleLog(chalk.blue("\u2744\uFE0F  Output frozen"));
    } else {
      console.log = this.originalConsoleLog;
      console.error = this.originalConsoleError;
      console.warn = this.originalConsoleWarn;
      console.log(chalk.green("\uD83D\uDD25 Output unfrozen"));
    }

    return { action: "freeze", frozen: this.outputFrozen };
  }

  /**
   * Toggle verbose mode. Returns structured result for API consumption.
   */
  public executeVerbose(): { action: string; verbose: boolean } {
    this.verboseMode = !this.verboseMode;
    process.env.AZURE_FS_LOG_LEVEL = this.verboseMode ? "debug" : "info";

    this.originalConsoleLog(
      this.verboseMode
        ? chalk.yellow("\uD83D\uDD0A Verbose mode ON (log level: debug)")
        : chalk.gray("\uD83D\uDD07 Verbose mode OFF (log level: info)"),
    );

    return { action: "verbose", verbose: this.verboseMode };
  }

  /**
   * Inspect the resolved configuration. Returns structured result for API consumption.
   */
  public executeInspect(): { action: string; config: Record<string, unknown> | null } {
    if (!this.configInspector) {
      this.originalConsoleLog(chalk.red("\u26A0\uFE0F  No configuration inspector available"));
      return { action: "inspect", config: null };
    }

    const config = this.configInspector();

    this.originalConsoleLog(chalk.cyan("\n\uD83D\uDCCB Configuration Inspection:"));
    this.originalConsoleLog(chalk.cyan("\u2500".repeat(60)));
    for (const [key, value] of Object.entries(config)) {
      this.originalConsoleLog(`   ${chalk.bold(key)}: ${value}`);
    }
    this.originalConsoleLog(chalk.cyan("\u2500".repeat(60)));

    return { action: "inspect", config };
  }

  /**
   * Inspect azure-venv sync result: blobs, file tree, env sources.
   * Returns structured result for API consumption.
   */
  public executeAzureVenvInspect(): { action: string; data: Record<string, unknown> | null } {
    const data = getAzureVenvIntrospection();

    if (!data) {
      this.originalConsoleLog(chalk.yellow("azure-venv: not initialized"));
      return { action: "azure-venv", data: null };
    }

    if (!data.attempted) {
      this.originalConsoleLog(chalk.yellow("azure-venv: AZURE_VENV not configured (no-op)"));
      return { action: "azure-venv", data };
    }

    const watchStatus = getWatchStatus();

    this.originalConsoleLog(chalk.cyan("\nazure-venv Introspection:"));
    this.originalConsoleLog(chalk.cyan("\u2500".repeat(60)));
    this.originalConsoleLog(`   ${chalk.bold("Watch")}: ${watchStatus.watching ? "active" : "inactive"}`);
    this.originalConsoleLog(`   ${chalk.bold("Blobs downloaded")}: ${data.downloaded} / ${data.totalBlobs}`);
    this.originalConsoleLog(`   ${chalk.bold("Failed")}: ${data.failed}`);
    this.originalConsoleLog(`   ${chalk.bold("Duration")}: ${data.durationMs}ms`);
    this.originalConsoleLog(`   ${chalk.bold("Remote .env loaded")}: ${data.remoteEnvLoaded}`);

    const tierCounts = data.envTierCounts as Record<string, number>;
    this.originalConsoleLog(`   ${chalk.bold("Env vars")}: OS=${tierCounts.os}, Remote=${tierCounts.remote}, Local=${tierCounts.local}`);

    const blobs = data.blobs as Array<{ relativePath: string; size: number }>;
    if (blobs.length > 0) {
      this.originalConsoleLog(chalk.cyan("\n   Blobs in memory:"));
      for (const blob of blobs) {
        this.originalConsoleLog(`     ${blob.relativePath} (${blob.size} bytes)`);
      }
    }
    this.originalConsoleLog(chalk.cyan("\u2500".repeat(60)));

    return { action: "azure-venv", data };
  }

  /**
   * Get current status of freeze and verbose modes.
   */
  public getStatus(): { frozen: boolean; verbose: boolean } {
    return { frozen: this.outputFrozen, verbose: this.verboseMode };
  }

  /**
   * Get the list of available hotkeys and their descriptions.
   */
  public getHelp(): { action: string; hotkeys: Array<{ key: string; command: string; description: string }> } {
    return {
      action: "help",
      hotkeys: [
        { key: "c", command: "clear", description: "Clear console (including scrollback buffer)" },
        { key: "f", command: "freeze", description: "Freeze / unfreeze log output" },
        { key: "v", command: "verbose", description: "Toggle verbose mode (switches log level between debug/info)" },
        { key: "i", command: "config", description: "Inspect resolved configuration (sensitive values masked)" },
        { key: "b", command: "azure-venv", description: "Inspect azure-venv sync result (blobs, env sources)" },
        { key: "h", command: "help", description: "Show available hotkeys" },
        { key: "Ctrl+C", command: "exit", description: "Graceful exit" },
      ],
    };
  }

  private showHelp(): void {
    this.originalConsoleLog("\n" + chalk.gray("\u2501".repeat(50)));
    this.originalConsoleLog(chalk.cyan("   Type a letter and press Enter:"));
    this.originalConsoleLog(chalk.white("   \u2022 c \u21B5  : Clear console"));
    this.originalConsoleLog(chalk.white("   \u2022 f \u21B5  : Freeze/Unfreeze output"));
    this.originalConsoleLog(chalk.white("   \u2022 v \u21B5  : Toggle verbose mode"));
    this.originalConsoleLog(chalk.white("   \u2022 i \u21B5  : Inspect configuration"));
    this.originalConsoleLog(chalk.white("   \u2022 b \u21B5  : Inspect azure-venv (blobs, env sources)"));
    this.originalConsoleLog(chalk.white("   \u2022 h \u21B5  : Show this help"));
    this.originalConsoleLog(chalk.white("   \u2022 Ctrl+C : Exit application"));
    this.originalConsoleLog(chalk.gray("\u2501".repeat(50)) + "\n");
  }

  public cleanup(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    console.log = this.originalConsoleLog;
    console.error = this.originalConsoleError;
    console.warn = this.originalConsoleWarn;
  }
}
