import { logger } from "./log";

/**
 * Used by server components in their data-load catch blocks: logs the failure
 * (with the page tag and stack) and returns a short message to render in a
 * <DatabaseError /> banner. Centralizes what was a repeated, silently-swallowed
 * `error = e instanceof Error ? e.message : "database unavailable"`.
 */
export function describeError(e: unknown, page: string): string {
  logger.child({ page }).error("page data load failed", e);
  return e instanceof Error ? e.message : "database unavailable";
}
