import swaggerJsdoc from "swagger-jsdoc";
import { ApiConfig } from "../../types/api-config.types";

/**
 * Create the OpenAPI 3.0 specification from JSDoc annotations.
 *
 * @param apiConfig - The resolved API configuration (used for dynamic server URL).
 * @returns The generated OpenAPI specification object.
 */
export function createSwaggerSpec(apiConfig: ApiConfig): object {
  const serverUrl = `http://${apiConfig.host}:${apiConfig.port}`;

  const options: swaggerJsdoc.Options = {
    definition: {
      openapi: "3.0.0",
      info: {
        title: "Azure FS REST API",
        version: "1.0.0",
        description: "REST API for Azure Blob Storage virtual file system",
      },
      servers: [
        {
          url: serverUrl,
          description: "Azure FS API Server",
        },
      ],
      tags: [
        { name: "Health", description: "Health check endpoints" },
        { name: "Files", description: "File upload, download, delete, replace, info, and existence checks" },
        { name: "Folders", description: "Folder listing, creation, deletion, and existence checks" },
        { name: "Edit", description: "In-place edit, patch (find-replace), and append operations" },
        { name: "Metadata", description: "Blob user-defined metadata operations" },
        { name: "Tags", description: "Blob index tag operations and queries" },
      ],
    },
    apis: ["./src/api/routes/*.ts", "./dist/api/routes/*.js"],
  };

  return swaggerJsdoc(options);
}
