import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { logger, type Logger } from "../log";

/**
 * Shared HTTP plumbing for route handlers: one error response shape, one place
 * that logs failures, and a `route()` wrapper so handlers stop repeating the same
 * try/catch. Handlers signal expected failures by throwing {@link HttpError}
 * (or the helpers below); anything else thrown is treated as a 500 and logged
 * with its stack.
 *
 * Response shape (stable for clients):
 *   { "error": string, "details"?: unknown }
 */

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const unauthorized = (message = "unauthorized") => new HttpError(401, message);
export const notFound = (message = "not found") => new HttpError(404, message);

/** Parse + validate a JSON body, throwing a 400 HttpError on malformed input. */
export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const json = await req.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new HttpError(400, "invalid request body", parsed.error.flatten());
  return parsed.data;
}

/** Convert any thrown value into a logged, consistently-shaped JSON response. */
export function toErrorResponse(err: unknown, log: Logger): NextResponse {
  if (err instanceof HttpError) {
    // 4xx are client/operational; 5xx are bugs/outages worth an error-level log.
    if (err.status >= 500) log.error(err.message, err, { status: err.status });
    else log.warn(err.message, { status: err.status, ...(err.details != null ? { details: err.details } : {}) });
    return NextResponse.json(
      { error: err.message, ...(err.details != null ? { details: err.details } : {}) },
      { status: err.status },
    );
  }
  log.error("unhandled route error", err);
  const message = err instanceof Error ? err.message : "internal server error";
  return NextResponse.json({ error: message }, { status: 500 });
}

type RouteHandler<C> = (req: Request, ctx: C, log: Logger) => Response | Promise<Response>;

/**
 * Wrap a route handler so thrown errors are logged and returned in the standard
 * shape. `name` tags every log line for this route. The handler receives a
 * child logger as its third argument for success/info logging.
 */
export function route<C = unknown>(name: string, handler: RouteHandler<C>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    const log = logger.child({ route: name });
    try {
      return await handler(req, ctx, log);
    } catch (e) {
      return toErrorResponse(e, log);
    }
  };
}
