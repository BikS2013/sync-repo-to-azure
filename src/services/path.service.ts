import { PathError } from "../errors/path.error";

/**
 * Normalize a blob path:
 *   1. Convert backslashes to forward slashes
 *   2. Collapse multiple slashes
 *   3. Remove leading slashes
 *   4. Remove trailing slashes
 *   5. Remove "." segments
 *   6. Resolve ".." segments
 *
 * Returns an empty string for root paths ("" or "/").
 */
export function normalizePath(rawPath: string): string {
  let p = rawPath;

  // 1. Backslash to forward slash
  p = p.replace(/\\/g, "/");

  // 2. Collapse multiple slashes
  p = p.replace(/\/+/g, "/");

  // 3. Remove leading slash
  p = p.replace(/^\//, "");

  // 4. Remove trailing slash
  p = p.replace(/\/$/, "");

  // 5 & 6. Resolve "." and ".." segments
  const segments = p.split("/").filter((seg) => seg !== "");
  const resolved: string[] = [];

  for (const seg of segments) {
    if (seg === ".") {
      continue;
    }
    if (seg === "..") {
      if (resolved.length === 0) {
        // ".." escapes root; this will be caught by validatePath
        continue;
      }
      resolved.pop();
    } else {
      resolved.push(seg);
    }
  }

  return resolved.join("/");
}

/**
 * Get the parent path of a blob path.
 * Returns an empty string for root-level paths.
 */
export function getParentPath(rawPath: string): string {
  const normalized = normalizePath(rawPath);
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) {
    return "";
  }
  return normalized.substring(0, lastSlash);
}

/**
 * Get the file name (last segment) from a blob path.
 */
export function getFileName(rawPath: string): string {
  const normalized = normalizePath(rawPath);
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) {
    return normalized;
  }
  return normalized.substring(lastSlash + 1);
}

/**
 * Join multiple path segments into a single normalized path.
 */
export function joinPath(...segments: string[]): string {
  return normalizePath(segments.join("/"));
}

/**
 * Check if a path represents the container root (empty string or "/").
 */
export function isRootPath(rawPath: string): boolean {
  return normalizePath(rawPath) === "";
}

/**
 * Normalize a path as a folder path.
 * Applies the same normalization as normalizePath, then ensures a trailing slash
 * (unless the result is the root, represented as empty string).
 */
export function normalizeFolderPath(rawPath: string): string {
  const p = normalizePath(rawPath);
  if (p === "") {
    return "";
  }
  return p.endsWith("/") ? p : p + "/";
}

/**
 * Validate a folder path. Returns the normalized folder path with a trailing slash.
 * Allows root paths (empty string or "/") -- returns "" for root.
 *
 * Rules:
 *   - Must not contain ".." segments that would escape the root
 *   - Must not exceed 1024 characters
 */
export function validateFolderPath(rawPath: string): string {
  // Check for ".." that escapes root before normalization
  const tentative = rawPath.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\//, "").replace(/\/$/, "");
  const segments = tentative.split("/").filter((s) => s !== "" && s !== ".");
  let depth = 0;
  for (const seg of segments) {
    if (seg === "..") {
      depth--;
      if (depth < 0) {
        throw PathError.invalidPath(rawPath, 'Path contains ".." segments that escape the container root.');
      }
    } else {
      depth++;
    }
  }

  const normalized = normalizeFolderPath(rawPath);

  if (normalized.length > 1024) {
    throw PathError.tooLong(normalized);
  }

  return normalized;
}

/**
 * Validate a blob path. Throws PathError if the path is invalid.
 *
 * Rules:
 *   - Must not be empty after normalization (use isRootPath to check for root)
 *   - Must not contain ".." segments that would escape the root
 *   - Must not exceed 1024 characters
 */
export function validatePath(rawPath: string): string {
  // Check for ".." that escapes root before normalization
  const tentative = rawPath.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\//, "").replace(/\/$/, "");
  const segments = tentative.split("/").filter((s) => s !== "" && s !== ".");
  let depth = 0;
  for (const seg of segments) {
    if (seg === "..") {
      depth--;
      if (depth < 0) {
        throw PathError.invalidPath(rawPath, 'Path contains ".." segments that escape the container root.');
      }
    } else {
      depth++;
    }
  }

  const normalized = normalizePath(rawPath);

  if (normalized === "") {
    throw PathError.emptyPath();
  }

  if (normalized.length > 1024) {
    throw PathError.tooLong(normalized);
  }

  return normalized;
}
