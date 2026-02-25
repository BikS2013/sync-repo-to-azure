import { Request, Response } from "express";
import { ApiServices } from "../routes/index";

/**
 * Create the hotkeys controller with handlers that invoke ConsoleCommands actions.
 * These endpoints provide HTTP access to the same interactive hotkey actions
 * available via stdin when running locally.
 *
 * SECURITY: These handlers include a defense-in-depth NODE_ENV check.
 * Even though the routes should only be mounted in development mode,
 * the handlers verify this independently and return 403 if not in development.
 *
 * @param services - The shared API services (includes consoleCommands).
 */
export function createHotkeysController(services: ApiServices) {
  const { config } = services;

  /**
   * Defense-in-depth check: return 403 if not in development mode.
   * Returns true if the request was blocked (response already sent).
   */
  function guardDevelopmentMode(res: Response): boolean {
    if (config.api.nodeEnv !== "development") {
      res.status(403).json({
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "This endpoint is only available in development mode.",
        },
        metadata: { timestamp: new Date().toISOString() },
      });
      return true;
    }
    return false;
  }

  /**
   * Check that ConsoleCommands is available. Returns true if unavailable (response already sent).
   */
  function guardConsoleCommands(res: Response): boolean {
    if (!services.consoleCommands) {
      res.status(503).json({
        success: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Console commands are not initialized.",
        },
        metadata: { timestamp: new Date().toISOString() },
      });
      return true;
    }
    return false;
  }

  return {
    /**
     * POST /api/dev/hotkeys/clear
     * Clear the console output.
     */
    clear(_req: Request, res: Response): void {
      if (guardDevelopmentMode(res)) return;
      if (guardConsoleCommands(res)) return;

      const result = services.consoleCommands!.executeClear();
      res.json({
        success: true,
        data: result,
        metadata: { timestamp: new Date().toISOString() },
      });
    },

    /**
     * POST /api/dev/hotkeys/freeze
     * Toggle freeze/unfreeze of log output.
     */
    freeze(_req: Request, res: Response): void {
      if (guardDevelopmentMode(res)) return;
      if (guardConsoleCommands(res)) return;

      const result = services.consoleCommands!.executeFreeze();
      res.json({
        success: true,
        data: result,
        metadata: { timestamp: new Date().toISOString() },
      });
    },

    /**
     * POST /api/dev/hotkeys/verbose
     * Toggle verbose mode (switches AZURE_FS_LOG_LEVEL between debug/info).
     */
    verbose(_req: Request, res: Response): void {
      if (guardDevelopmentMode(res)) return;
      if (guardConsoleCommands(res)) return;

      const result = services.consoleCommands!.executeVerbose();
      res.json({
        success: true,
        data: result,
        metadata: { timestamp: new Date().toISOString() },
      });
    },

    /**
     * GET /api/dev/hotkeys/config
     * Inspect resolved configuration (sensitive values masked).
     */
    inspectConfig(_req: Request, res: Response): void {
      if (guardDevelopmentMode(res)) return;
      if (guardConsoleCommands(res)) return;

      const result = services.consoleCommands!.executeInspect();
      res.json({
        success: true,
        data: result,
        metadata: { timestamp: new Date().toISOString() },
      });
    },

    /**
     * GET /api/dev/hotkeys/status
     * Get current state (frozen, verbose).
     */
    status(_req: Request, res: Response): void {
      if (guardDevelopmentMode(res)) return;
      if (guardConsoleCommands(res)) return;

      const result = services.consoleCommands!.getStatus();
      res.json({
        success: true,
        data: result,
        metadata: { timestamp: new Date().toISOString() },
      });
    },

    /**
     * GET /api/dev/hotkeys/help
     * Get the list of available hotkeys and their descriptions.
     */
    help(_req: Request, res: Response): void {
      if (guardDevelopmentMode(res)) return;
      if (guardConsoleCommands(res)) return;

      const result = services.consoleCommands!.getHelp();
      res.json({
        success: true,
        data: result,
        metadata: { timestamp: new Date().toISOString() },
      });
    },
  };
}
