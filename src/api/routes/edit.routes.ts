import { Router } from "express";
import { BlobFileSystemService } from "../../services/blob-filesystem.service";
import { ApiConfig } from "../../types/api-config.types";
import { createEditController } from "../controllers/edit.controller";
import { createUploadMiddleware } from "../middleware/upload.middleware";

/**
 * Create the edit operation routes.
 *
 * Mounted at /api/v1/edit by the route registration barrel.
 */
export function createEditRoutes(
  blobService: BlobFileSystemService,
  apiConfig: ApiConfig,
): Router {
  const router = Router();
  const controller = createEditController(blobService);
  const upload = createUploadMiddleware(apiConfig);

  /**
   * @openapi
   * /api/v1/edit/patch/{path}:
   *   patch:
   *     summary: Apply find-replace patches to blob content
   *     tags: [Edit]
   *     parameters:
   *       - in: path
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Remote blob path
   *       - in: header
   *         name: If-Match
   *         required: true
   *         schema:
   *           type: string
   *         description: ETag for concurrency control (required)
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [patches]
   *             properties:
   *               patches:
   *                 type: array
   *                 items:
   *                   type: object
   *                   required: [find, replace]
   *                   properties:
   *                     find:
   *                       type: string
   *                       description: Text or regex pattern to find
   *                     replace:
   *                       type: string
   *                       description: Replacement text
   *                     isRegex:
   *                       type: boolean
   *                       description: Treat find as regex
   *                     flags:
   *                       type: string
   *                       description: Regex flags (e.g. "g", "gi")
   *     responses:
   *       200:
   *         description: Patches applied
   *         headers:
   *           ETag:
   *             schema:
   *               type: string
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
   *                     matchCount:
   *                       type: integer
   *                     appliedCount:
   *                       type: integer
   *                     originalSize:
   *                       type: integer
   *                     newSize:
   *                       type: integer
   *                     etag:
   *                       type: string
   *       412:
   *         description: Precondition Failed (ETag mismatch)
   *       428:
   *         description: Precondition Required (missing If-Match header)
   */
  router.patch("/patch/*path", controller.patch);

  /**
   * @openapi
   * /api/v1/edit/append/{path}:
   *   patch:
   *     summary: Append or prepend content to a blob
   *     tags: [Edit]
   *     parameters:
   *       - in: path
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Remote blob path
   *       - in: header
   *         name: If-Match
   *         required: true
   *         schema:
   *           type: string
   *         description: ETag for concurrency control (required)
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [content]
   *             properties:
   *               content:
   *                 type: string
   *                 description: Content to add
   *               position:
   *                 type: string
   *                 enum: [start, end]
   *                 description: Where to add content (default "end")
   *     responses:
   *       200:
   *         description: Content appended/prepended
   *         headers:
   *           ETag:
   *             schema:
   *               type: string
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
   *                     position:
   *                       type: string
   *                     addedLength:
   *                       type: integer
   *                     newSize:
   *                       type: integer
   *                     originalSize:
   *                       type: integer
   *                     etag:
   *                       type: string
   *       412:
   *         description: Precondition Failed (ETag mismatch)
   *       428:
   *         description: Precondition Required (missing If-Match header)
   */
  router.patch("/append/*path", controller.append);

  /**
   * @openapi
   * /api/v1/edit/download/{path}:
   *   post:
   *     summary: Download blob for editing (Phase 1 of edit workflow)
   *     tags: [Edit]
   *     description: Downloads the blob to a temp file and returns the path and ETag. Use the ETag with the upload endpoint to complete the edit.
   *     parameters:
   *       - in: path
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Remote blob path
   *     responses:
   *       200:
   *         description: Edit session started
   *         headers:
   *           ETag:
   *             schema:
   *               type: string
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
   *                     tempPath:
   *                       type: string
   *                     size:
   *                       type: integer
   *                     contentType:
   *                       type: string
   *                     etag:
   *                       type: string
   *       404:
   *         description: Blob not found
   */
  router.post("/download/*path", controller.editDownload);

  /**
   * @openapi
   * /api/v1/edit/upload/{path}:
   *   put:
   *     summary: Re-upload edited file (Phase 2 of edit workflow)
   *     tags: [Edit]
   *     description: Re-uploads the edited file with ETag concurrency check. Use the ETag from the download response as the If-Match header.
   *     parameters:
   *       - in: path
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Remote blob path
   *       - in: header
   *         name: If-Match
   *         required: true
   *         schema:
   *           type: string
   *         description: ETag from the download phase
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             required: [file]
   *             properties:
   *               file:
   *                 type: string
   *                 format: binary
   *     responses:
   *       200:
   *         description: File re-uploaded
   *         headers:
   *           ETag:
   *             schema:
   *               type: string
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
   *                     size:
   *                       type: integer
   *                     etag:
   *                       type: string
   *                     previousEtag:
   *                       type: string
   *       412:
   *         description: Precondition Failed (blob modified since download)
   *       428:
   *         description: Precondition Required (missing If-Match header)
   */
  router.put("/upload/*path", upload.single("file"), controller.editUpload);

  return router;
}
