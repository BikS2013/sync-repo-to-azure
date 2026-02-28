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
        // ".." escapes root; skip
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
 * Join multiple path segments into a single normalized path.
 */
export function joinPath(...segments: string[]): string {
  return normalizePath(segments.join("/"));
}
