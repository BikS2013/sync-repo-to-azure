import * as fs from "fs";

const LARGE_FILE_THRESHOLD = 100 * 1024 * 1024; // 100 MB

/**
 * Convert a readable stream to a Buffer.
 */
async function streamToBuffer(readable: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Convert a readable stream to a string.
 */
export async function streamToString(readable: NodeJS.ReadableStream): Promise<string> {
  const buffer = await streamToBuffer(readable);
  return buffer.toString("utf-8");
}

/**
 * Check if a local file exceeds the large-file threshold (100 MB).
 * Returns false if the file does not exist.
 */
export function isLargeFile(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath);
    return stats.size > LARGE_FILE_THRESHOLD;
  } catch {
    return false;
  }
}
