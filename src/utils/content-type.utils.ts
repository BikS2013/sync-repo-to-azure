/**
 * Map of file extensions to MIME types.
 * Covers common text, data, web, and code file formats.
 */
const EXTENSION_MAP: Record<string, string> = {
  // Text
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".log": "text/plain",

  // Web
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",

  // Data formats
  ".json": "application/json",
  ".xml": "application/xml",
  ".yaml": "application/x-yaml",
  ".yml": "application/x-yaml",
  ".toml": "application/toml",

  // Code
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".jsx": "text/javascript",
  ".py": "text/x-python",
  ".rb": "text/x-ruby",
  ".java": "text/x-java-source",
  ".go": "text/x-go",
  ".rs": "text/x-rust",
  ".c": "text/x-c",
  ".cpp": "text/x-c++",
  ".h": "text/x-c",
  ".cs": "text/x-csharp",
  ".sh": "application/x-sh",
  ".bash": "application/x-sh",
  ".ps1": "application/x-powershell",
  ".sql": "application/sql",

  // Documents
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",

  // Images
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",

  // Archives
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".tar": "application/x-tar",
  ".7z": "application/x-7z-compressed",

  // Misc
  ".env": "text/plain",
  ".ini": "text/plain",
  ".cfg": "text/plain",
  ".conf": "text/plain",
};

/**
 * Detect the MIME content type from a filename or path based on its extension.
 * Returns "application/octet-stream" for unknown extensions.
 */
export function detectContentType(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) {
    return "application/octet-stream";
  }

  const extension = filename.substring(lastDot).toLowerCase();
  return EXTENSION_MAP[extension] ?? "application/octet-stream";
}
