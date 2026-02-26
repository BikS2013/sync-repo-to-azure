import { Router } from "express";
import { MetadataService } from "../../services/metadata.service";
import { createTagsController } from "../controllers/tags.controller";

/**
 * Create the tag routes router.
 *
 * Mounted at /api/v1/tags by the route registration barrel.
 */
export function createTagRoutes(metadataService: MetadataService): Router {
  const router = Router();
  const controller = createTagsController(metadataService);

  /**
   * @openapi
   * /api/v1/tags:
   *   get:
   *     operationId: queryByTags
   *     summary: Query blobs by tag filter expression
   *     tags: [Tags]
   *     parameters:
   *       - in: query
   *         name: filter
   *         required: true
   *         schema:
   *           type: string
   *         description: OData tag filter expression (e.g. "env = 'prod' AND status = 'active'")
   *     responses:
   *       200:
   *         description: Matching blobs
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
   *                     filter:
   *                       type: string
   *                     results:
   *                       type: array
   *                       items:
   *                         type: object
   *                         properties:
   *                           name:
   *                             type: string
   *                           tags:
   *                             type: object
   *       400:
   *         description: Missing filter parameter
   */
  router.get("/", controller.query);

  /**
   * @openapi
   * /api/v1/tags/{path}:
   *   get:
   *     operationId: getTags
   *     summary: Get all tags for a blob
   *     tags: [Tags]
   *     parameters:
   *       - in: path
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Remote blob path
   *     responses:
   *       200:
   *         description: Blob tags
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
   *                     tags:
   *                       type: object
   *       404:
   *         description: Blob not found
   *   put:
   *     operationId: setTags
   *     summary: Set (replace all) tags on a blob
   *     tags: [Tags]
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
   *             required: [tags]
   *             properties:
   *               tags:
   *                 type: object
   *                 additionalProperties:
   *                   type: string
   *                 description: Key-value tag pairs (max 10 tags)
   *     responses:
   *       200:
   *         description: Tags set
   *       400:
   *         description: Validation error (max 10 tags, key/value length)
   *       404:
   *         description: Blob not found
   */
  router.get("/*path", controller.get);
  router.put("/*path", controller.set);

  return router;
}
