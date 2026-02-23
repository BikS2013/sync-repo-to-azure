import { Router } from "express";
import { BlobFileSystemService } from "../../services/blob-filesystem.service";
import { ApiConfig } from "../../types/api-config.types";
import { createFileController } from "../controllers/file.controller";
import { createUploadMiddleware } from "../middleware/upload.middleware";

/**
 * Create the file operations router.
 *
 * Mounted at /api/v1/files by the route registration barrel.
 */
export function createFileRoutes(
  blobService: BlobFileSystemService,
  apiConfig: ApiConfig,
): Router {
  const router = Router();
  const controller = createFileController(blobService);
  const upload = createUploadMiddleware(apiConfig);

  /**
   * @openapi
   * /api/v1/files:
   *   post:
   *     summary: Upload a new file
   *     tags: [Files]
   *     requestBody:
   *       required: true
   *       content:
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             required: [file, remotePath]
   *             properties:
   *               file:
   *                 type: string
   *                 format: binary
   *                 description: The file to upload
   *               remotePath:
   *                 type: string
   *                 description: Destination blob path
   *               metadata:
   *                 type: string
   *                 description: Optional JSON string of key-value metadata pairs
   *     responses:
   *       201:
   *         description: File uploaded successfully
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
   *                     contentType:
   *                       type: string
   *                     etag:
   *                       type: string
   *       400:
   *         description: Missing required fields (file or remotePath)
   *       413:
   *         description: File exceeds maximum upload size
   */
  router.post("/", upload.single("file"), controller.upload);

  /**
   * @openapi
   * /api/v1/files/info/{path}:
   *   get:
   *     summary: Get file properties, metadata, and tags
   *     tags: [Files]
   *     parameters:
   *       - in: path
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Remote blob path
   *     responses:
   *       200:
   *         description: File information
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
   *                     name:
   *                       type: string
   *                     size:
   *                       type: integer
   *                     contentType:
   *                       type: string
   *                     lastModified:
   *                       type: string
   *                     etag:
   *                       type: string
   *                     metadata:
   *                       type: object
   *                     tags:
   *                       type: object
   *       404:
   *         description: Blob not found
   */
  router.get("/info/*path", controller.info);

  /**
   * @openapi
   * /api/v1/files/{path}:
   *   get:
   *     summary: Download a file
   *     tags: [Files]
   *     parameters:
   *       - in: path
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Remote blob path
   *       - in: header
   *         name: If-None-Match
   *         required: false
   *         schema:
   *           type: string
   *         description: ETag for conditional GET (returns 304 if match)
   *     responses:
   *       200:
   *         description: File content with appropriate Content-Type
   *         headers:
   *           ETag:
   *             schema:
   *               type: string
   *           Content-Type:
   *             schema:
   *               type: string
   *       304:
   *         description: Not Modified (ETag matches If-None-Match)
   *       404:
   *         description: Blob not found
   *   head:
   *     summary: Check if a file exists
   *     tags: [Files]
   *     parameters:
   *       - in: path
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Remote blob path
   *     responses:
   *       200:
   *         description: File exists
   *         headers:
   *           ETag:
   *             schema:
   *               type: string
   *       404:
   *         description: File does not exist
   *   delete:
   *     summary: Delete a file
   *     tags: [Files]
   *     parameters:
   *       - in: path
   *         name: path
   *         required: true
   *         schema:
   *           type: string
   *         description: Remote blob path
   *       - in: header
   *         name: If-Match
   *         required: false
   *         schema:
   *           type: string
   *         description: Optional ETag for conditional delete
   *     responses:
   *       200:
   *         description: File deleted
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
   *                     deleted:
   *                       type: boolean
   *       404:
   *         description: Blob not found
   *   put:
   *     summary: Replace an existing file
   *     tags: [Files]
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
   *         multipart/form-data:
   *           schema:
   *             type: object
   *             required: [file]
   *             properties:
   *               file:
   *                 type: string
   *                 format: binary
   *               metadata:
   *                 type: string
   *                 description: Optional JSON string of key-value metadata pairs
   *     responses:
   *       200:
   *         description: File replaced
   *         headers:
   *           ETag:
   *             schema:
   *               type: string
   *       404:
   *         description: Blob not found
   *       412:
   *         description: Precondition Failed (ETag mismatch)
   *       428:
   *         description: Precondition Required (missing If-Match header)
   */
  router.get("/*path", controller.download);
  router.head("/*path", controller.exists);
  router.delete("/*path", controller.deleteFile);
  router.put("/*path", upload.single("file"), controller.replace);

  return router;
}
