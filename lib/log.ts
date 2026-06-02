/**
 * Structured application logger (server-side).
 *
 * One place to emit logs so format and level filtering are consistent across
 * route handlers, library code, and scheduled jobs. Pretty single-line output in
 * development; one JSON object per line in production (parseable by Vercel log
 * drains / observability tools). Level is controlled by `LOG_LEVEL`
 * (debug|info|warn|error), defaulting to `debug` in dev and `info` in prod.
 *
 * Usage:
 *   import { logger } from "../log";
 *   const log = logger.child({ route: "collect.run", sourceId });
 *   log.info("collection complete", { itemsFetched, signalsNew });
 *   log.error("collection failed", err, { sourceId });
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogContext = Record<string, unknown>;

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function thresholdLevel(): number {
  const fallback = process.env.NODE_ENV === "production" ? "info" : "debug";
  const env = (process.env.LOG_LEVEL ?? fallback).toLowerCase();
  return ORDER[env as LogLevel] ?? ORDER.info;
}

function serializeError(err: unknown): LogContext {
  if (err instanceof Error) {
    return { error: err.message, errorName: err.name, ...(err.stack ? { stack: err.stack } : {}) };
  }
  if (err === undefined || err === null) return {};
  return { error: String(err) };
}

function pretty(level: LogLevel, msg: string, fields: LogContext): string {
  const tag = level.toUpperCase().padEnd(5);
  const time = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
  const extras = Object.entries(fields)
    .filter(([k]) => k !== "stack")
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
  let line = `${time} ${tag} ${msg}${extras ? ` ${extras}` : ""}`;
  if (typeof fields.stack === "string") line += `\n${fields.stack}`;
  return line;
}

function sinkFor(level: LogLevel): (line: string) => void {
  // eslint-disable-next-line no-console
  if (level === "error") return console.error;
  // eslint-disable-next-line no-console
  if (level === "warn") return console.warn;
  // eslint-disable-next-line no-console
  return console.log;
}

function emit(bound: LogContext, level: LogLevel, msg: string, fields: LogContext): void {
  if (ORDER[level] < thresholdLevel()) return;
  const merged = { ...bound, ...fields };
  const sink = sinkFor(level);
  if (process.env.NODE_ENV === "production") {
    sink(JSON.stringify({ level, time: new Date().toISOString(), msg, ...merged }));
  } else {
    sink(pretty(level, msg, merged));
  }
}

export interface Logger {
  debug(msg: string, context?: LogContext): void;
  info(msg: string, context?: LogContext): void;
  warn(msg: string, context?: LogContext): void;
  /** Log an error. Pass the caught value as `err` to capture its message + stack. */
  error(msg: string, err?: unknown, context?: LogContext): void;
  /** Derive a logger that includes `context` on every line. */
  child(context: LogContext): Logger;
}

function make(bound: LogContext): Logger {
  return {
    debug: (msg, context) => emit(bound, "debug", msg, context ?? {}),
    info: (msg, context) => emit(bound, "info", msg, context ?? {}),
    warn: (msg, context) => emit(bound, "warn", msg, context ?? {}),
    error: (msg, err, context) => emit(bound, "error", msg, { ...serializeError(err), ...(context ?? {}) }),
    child: (context) => make({ ...bound, ...context }),
  };
}

export const logger: Logger = make({});
