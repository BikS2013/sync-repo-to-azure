import { Request, Response, NextFunction } from "express";
import express from "express";
import yaml from "js-yaml";

/**
 * YAML content types that this middleware will handle.
 */
const YAML_CONTENT_TYPES = [
  "application/yaml",
  "application/x-yaml",
  "text/yaml",
];

/**
 * Create an Express middleware that parses YAML request bodies.
 *
 * Uses `express.text()` to read the raw body for YAML content types,
 * then parses with `js-yaml`. On parse failure, responds with 400.
 * Non-YAML requests pass through untouched.
 *
 * @param limit - Maximum body size (default: "10mb", matching the JSON parser).
 */
export function createYamlBodyParserMiddleware(limit: string = "10mb") {
  // Pre-build the text parser for YAML content types
  const textParser = express.text({ type: YAML_CONTENT_TYPES, limit });

  return function yamlBodyParserMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    // Only process if content-type is a YAML variant
    const contentType = req.headers["content-type"] ?? "";
    const isYaml = YAML_CONTENT_TYPES.some((ct) => contentType.includes(ct));
    if (!isYaml) {
      next();
      return;
    }

    // Use express.text() to read the raw body string
    textParser(req, res, (err?: unknown) => {
      if (err) {
        next(err);
        return;
      }

      // req.body is now a raw string -- parse it as YAML
      if (typeof req.body === "string") {
        try {
          const parsed = yaml.load(req.body);
          if (parsed === null || parsed === undefined || typeof parsed !== "object") {
            res.status(400).json({
              success: false,
              error: {
                code: "YAML_PARSE_ERROR",
                message: "YAML body must be an object or array, got: " + typeof parsed,
              },
              metadata: { timestamp: new Date().toISOString() },
            });
            return;
          }
          req.body = parsed;
        } catch (parseErr) {
          const message =
            parseErr instanceof Error ? parseErr.message : String(parseErr);
          res.status(400).json({
            success: false,
            error: {
              code: "YAML_PARSE_ERROR",
              message: `Invalid YAML body: ${message}`,
            },
            metadata: { timestamp: new Date().toISOString() },
          });
          return;
        }
      }

      next();
    });
  };
}
