import { Router } from "express";
import { MetadataService } from "../../services/metadata.service";
import { createMetaController } from "../controllers/meta.controller";

/**
 * Create the metadata routes router.
 *
 * Mounted at /api/v1/meta by the route registration barrel.
 */
export function createMetaRoutes(metadataService: MetadataService): Router {
  const router = Router();
  const controller = createMetaController(metadataService);

  /**
   * @openapi
   * /api/v1/meta/{path}:
   *   get:
   *     summary: Get all metadata for a blob
   *     tags: [Metadata]
   *     parameters:
   *       - in: path
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Remote blob path
   *     responses:
   *       200:
   *         description: Blob metadata
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
   *                     metadata:
   *                       type: object
   *       404:
   *         description: Blob not found
   *   put:
   *     summary: Set (replace all) metadata on a blob
   *     tags: [Metadata]
   *     parameters:
   *       - in: path
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Remote blob path
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [metadata]
   *             properties:
   *               metadata:
   *                 type: object
   *                 additionalProperties:
   *                   type: string
   *                 description: Key-value pairs to set as metadata
   *     responses:
   *       200:
   *         description: Metadata set
   *       400:
   *         description: Validation error (invalid key, size exceeded)
   *       404:
   *         description: Blob not found
   *   patch:
   *     summary: Merge metadata into existing blob metadata
   *     tags: [Metadata]
   *     parameters:
   *       - in: path
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Remote blob path
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [metadata]
   *             properties:
   *               metadata:
   *                 type: object
   *                 additionalProperties:
   *                   type: string
   *                 description: Key-value pairs to merge
   *     responses:
   *       200:
   *         description: Metadata merged
   *       400:
   *         description: Validation error
   *       404:
   *         description: Blob not found
   *   delete:
   *     summary: Delete specific metadata keys from a blob
   *     tags: [Metadata]
   *     parameters:
   *       - in: path
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Remote blob path
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [keys]
   *             properties:
   *               keys:
   *                 type: array
   *                 items:
   *                   type: string
   *                 description: Metadata key names to remove
   *     responses:
   *       200:
   *         description: Metadata keys deleted
   *       404:
   *         description: Blob not found
   */
  router.get("/*path", controller.get);
  router.put("/*path", controller.set);
  router.patch("/*path", controller.update);
  router.delete("/*path", controller.deleteKeys);

  return router;
}
