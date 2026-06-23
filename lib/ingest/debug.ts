export type IngestDebugStatus = "started" | "ok" | "warning" | "error";

export interface IngestDebugEvent {
  id: string;
  at: string;
  phase: string;
  status: IngestDebugStatus;
  message: string;
  data?: unknown;
}

export function debugEvent(
  phase: string,
  status: IngestDebugStatus,
  message: string,
  data?: unknown,
): IngestDebugEvent {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    phase,
    status,
    message,
    ...(data === undefined ? {} : { data }),
  };
}
