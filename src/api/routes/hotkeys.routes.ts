import { Router } from "express";
import { ApiServices } from "./index";
import { createHotkeysController } from "../controllers/hotkeys.controller";

/**
 * Create hotkey routes for remote access to console commands.
 *
 * These routes are only mounted when NODE_ENV=development (checked in routes/index.ts).
 * Each handler also performs a defense-in-depth check and returns 403 if not in development.
 *
 * Endpoints:
 *   POST /api/dev/hotkeys/clear    - Clear console
 *   POST /api/dev/hotkeys/freeze   - Toggle freeze/unfreeze
 *   POST /api/dev/hotkeys/verbose  - Toggle verbose mode
 *   GET  /api/dev/hotkeys/config   - Inspect configuration
 *   GET  /api/dev/hotkeys/status   - Get current state
 */
export function createHotkeyRoutes(services: ApiServices): Router {
  const router = Router();
  const controller = createHotkeysController(services);

  /**
   * @openapi
   * /api/dev/hotkeys/clear:
   *   post:
   *     operationId: clearConsole
   *     summary: Clear console output
   *     description: |
   *       Clears the server console output (equivalent to the 'c' hotkey).
   *       Only available in development mode.
   *     tags: [Hotkeys]
   *     responses:
   *       200:
   *         description: Console cleared successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   properties:
   *                     action:
   *                       type: string
   *                       example: clear
   *                     success:
   *                       type: boolean
   *       403:
   *         description: Not available outside development mode
   *       503:
   *         description: Console commands not initialized
   */
  router.post("/clear", controller.clear);

  /**
   * @openapi
   * /api/dev/hotkeys/freeze:
   *   post:
   *     operationId: toggleFreeze
   *     summary: Toggle freeze/unfreeze log output
   *     description: |
   *       Toggles freezing of console log output (equivalent to the 'f' hotkey).
   *       When frozen, console.log/error/warn calls are suppressed.
   *       Only available in development mode.
   *     tags: [Hotkeys]
   *     responses:
   *       200:
   *         description: Freeze state toggled
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   properties:
   *                     action:
   *                       type: string
   *                       example: freeze
   *                     frozen:
   *                       type: boolean
   *       403:
   *         description: Not available outside development mode
   *       503:
   *         description: Console commands not initialized
   */
  router.post("/freeze", controller.freeze);

  /**
   * @openapi
   * /api/dev/hotkeys/verbose:
   *   post:
   *     operationId: toggleVerbose
   *     summary: Toggle verbose mode
   *     description: |
   *       Toggles verbose mode by switching AZURE_FS_LOG_LEVEL between
   *       'debug' and 'info' at runtime (equivalent to the 'v' hotkey).
   *       Only available in development mode.
   *     tags: [Hotkeys]
   *     responses:
   *       200:
   *         description: Verbose mode toggled
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   properties:
   *                     action:
   *                       type: string
   *                       example: verbose
   *                     verbose:
   *                       type: boolean
   *       403:
   *         description: Not available outside development mode
   *       503:
   *         description: Console commands not initialized
   */
  router.post("/verbose", controller.verbose);

  /**
   * @openapi
   * /api/dev/hotkeys/config:
   *   get:
   *     operationId: inspectConfig
   *     summary: Inspect resolved configuration
   *     description: |
   *       Returns the resolved configuration with sensitive values masked
   *       (equivalent to the 'i' hotkey). Only available in development mode.
   *     tags: [Hotkeys]
   *     responses:
   *       200:
   *         description: Configuration snapshot
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   properties:
   *                     action:
   *                       type: string
   *                       example: inspect
   *                     config:
   *                       type: object
   *                       description: Resolved configuration key-value pairs (sensitive values masked)
   *       403:
   *         description: Not available outside development mode
   *       503:
   *         description: Console commands not initialized
   */
  router.get("/config", controller.inspectConfig);

  /**
   * @openapi
   * /api/dev/hotkeys/status:
   *   get:
   *     operationId: getHotkeyStatus
   *     summary: Get current hotkey state
   *     description: |
   *       Returns the current state of freeze and verbose modes.
   *       Only available in development mode.
   *     tags: [Hotkeys]
   *     responses:
   *       200:
   *         description: Current hotkey state
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   properties:
   *                     frozen:
   *                       type: boolean
   *                     verbose:
   *                       type: boolean
   *       403:
   *         description: Not available outside development mode
   *       503:
   *         description: Console commands not initialized
   */
  router.get("/status", controller.status);

  /**
   * @openapi
   * /api/dev/hotkeys/help:
   *   get:
   *     operationId: getHotkeyHelp
   *     summary: Get available hotkeys and descriptions
   *     description: |
   *       Returns the list of all available console hotkeys with their
   *       key bindings, command names, and descriptions.
   *       Only available in development mode.
   *     tags: [Hotkeys]
   *     responses:
   *       200:
   *         description: List of available hotkeys
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 data:
   *                   type: object
   *                   properties:
   *                     action:
   *                       type: string
   *                       example: help
   *                     hotkeys:
   *                       type: array
   *                       items:
   *                         type: object
   *                         properties:
   *                           key:
   *                             type: string
   *                           command:
   *                             type: string
   *                           description:
   *                             type: string
   *       403:
   *         description: Not available outside development mode
   *       503:
   *         description: Console commands not initialized
   */
  router.get("/help", controller.help);

  return router;
}
