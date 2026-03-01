import { ConfigError } from "../errors/config.error";
import { Logger } from "./logger.utils";
import { TokenExpiryStatus } from "../types/repo-replication.types";

/** Number of days before expiry to start warning */
const EXPIRY_WARNING_DAYS = 7;

/**
 * Compute a token expiry status without throwing.
 *
 * @param expiryDateStr - ISO 8601 date string, or undefined
 * @returns TokenExpiryStatus: "valid", "expiring-soon", "expired", or "no-expiry-set"
 */
export function getTokenExpiryStatus(
  expiryDateStr: string | undefined,
): TokenExpiryStatus {
  if (expiryDateStr === undefined) {
    return "no-expiry-set";
  }

  const expiryDate = new Date(expiryDateStr);
  if (isNaN(expiryDate.getTime())) {
    return "no-expiry-set";
  }

  const now = new Date();
  const daysUntilExpiry = Math.floor(
    (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (daysUntilExpiry < 0) {
    return "expired";
  }
  if (daysUntilExpiry <= EXPIRY_WARNING_DAYS) {
    return "expiring-soon";
  }
  return "valid";
}

/**
 * Check a token expiry date and either warn or throw.
 *
 * @param tokenName - Human-readable name (e.g., "GITHUB_TOKEN")
 * @param expiryDateStr - ISO 8601 date string, or undefined (no-op)
 * @param logger - Logger instance for warnings
 * @throws ConfigError if the token is already expired
 */
export function checkTokenExpiry(
  tokenName: string,
  expiryDateStr: string | undefined,
  logger: Logger,
): void {
  if (expiryDateStr === undefined) {
    return;
  }

  const expiryDate = new Date(expiryDateStr);
  if (isNaN(expiryDate.getTime())) {
    throw ConfigError.invalidValue(
      `${tokenName}_EXPIRY`,
      expiryDateStr,
      ["ISO 8601 date string (e.g., 2026-12-31T00:00:00Z)"],
    );
  }

  const now = new Date();
  const daysUntilExpiry = Math.floor(
    (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (daysUntilExpiry < 0) {
    throw new ConfigError(
      "CONFIG_INVALID_VALUE",
      `${tokenName} has expired (expiry: ${expiryDateStr}). ` +
        `Please renew the token and update ${tokenName}_EXPIRY.`,
      { tokenName, expiryDate: expiryDateStr },
    );
  }

  if (daysUntilExpiry <= EXPIRY_WARNING_DAYS) {
    logger.warn(
      `${tokenName} expires in ${daysUntilExpiry} day(s) ` +
        `(expiry: ${expiryDateStr}). Consider renewing it soon.`,
    );
  }
}
