import multer from "multer";
import { ApiConfig } from "../../types/api-config.types";

/**
 * Create a configured multer instance for file uploads.
 *
 * - Storage: memory storage (file available as req.file.buffer)
 * - Size limit: derived from api.uploadMaxSizeMb config
 * - Single file field name: "file"
 *
 * Multer is applied per-route, NOT as global middleware.
 */
export function createUploadMiddleware(apiConfig: ApiConfig): multer.Multer {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: apiConfig.uploadMaxSizeMb * 1024 * 1024,
    },
  });
}
