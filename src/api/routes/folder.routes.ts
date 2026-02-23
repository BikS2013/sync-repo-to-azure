import { Router } from "express";
import { BlobFileSystemService } from "../../services/blob-filesystem.service";
import { createFolderController } from "../controllers/folder.controller";

/**
 * Create the folder operations router.
 *
 * Mounted at /api/v1/folders by the route registration barrel.
 */
export function createFolderRoutes(blobService: BlobFileSystemService): Router {
  const router = Router();
  const controller = createFolderController(blobService);

  /**
   * @openapi
   * /api/v1/folders/{path}:
   *   get:
   *     summary: List folder contents
   *     tags: [Folders]
   *     parameters:
   *       - in: path
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Remote folder path (use "/" for root)
   *       - in: query
   *         name: recursive
   *         required: false
   *         schema:
   *           type: string
   *           enum: ["true", "false"]
   *         description: List all nested items recursively
   *     responses:
   *       200:
   *         description: Folder listing
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
   *                     path:
   *                       type: string
   *                     files:
   *                       type: array
   *                       items:
   *                         type: object
   *                         properties:
   *                           name:
   *                             type: string
   *                           path:
   *                             type: string
   *                           size:
   *                             type: integer
   *                           contentType:
   *                             type: string
   *                           lastModified:
   *                             type: string
   *                     folders:
   *                       type: array
   *                       items:
   *                         type: object
   *                         properties:
   *                           name:
   *                             type: string
   *                           path:
   *                             type: string
   *   post:
   *     summary: Create a virtual folder
   *     tags: [Folders]
   *     parameters:
   *       - in: path
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Folder path to create
   *     responses:
   *       201:
   *         description: Folder created
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
   *                     path:
   *                       type: string
   *                     created:
   *                       type: boolean
   *   delete:
   *     summary: Delete a folder and all its contents
   *     tags: [Folders]
   *     parameters:
   *       - in: path
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Folder path to delete
   *     responses:
   *       200:
   *         description: Folder deleted
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
   *                     path:
   *                       type: string
   *                     deletedCount:
   *                       type: integer
   *   head:
   *     summary: Check if a folder exists
   *     tags: [Folders]
   *     parameters:
   *       - in: path
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Folder path to check
   *     responses:
   *       200:
   *         description: Folder exists
   *       404:
   *         description: Folder does not exist
   */
  router.get("/*path", controller.list);
  router.post("/*path", controller.create);
  router.delete("/*path", controller.deleteFolder);
  router.head("/*path", controller.exists);

  return router;
}
