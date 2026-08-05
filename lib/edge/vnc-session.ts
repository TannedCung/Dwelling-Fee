import { createHash, randomBytes } from "node:crypto";

export interface VncSession {
  id: string;
  deviceId: string;
  jobId: string;
  tokenHash: string;
  rawToken: string;
  status: "pending" | "active" | "completed" | "expired";
  createdAt: Date;
  expiresAt: Date;
}

const DEFAULT_SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

// In-memory registry for active WebSocket session proxies
const activeSessions = new Map<string, VncSession>();

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function generateVncToken(): string {
  return `df_vnc_${randomBytes(24).toString("base64url")}`;
}

export function createVncSession(input: {
  deviceId: string;
  jobId: string;
  ttlMs?: number;
}): VncSession {
  const rawToken = generateVncToken();
  const tokenHash = sha256Hex(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlMs ?? DEFAULT_SESSION_TTL_MS));

  const session: VncSession = {
    id: `vnc_sess_${randomBytes(8).toString("hex")}`,
    deviceId: input.deviceId,
    jobId: input.jobId,
    tokenHash,
    rawToken,
    status: "pending",
    createdAt: now,
    expiresAt,
  };

  activeSessions.set(tokenHash, session);
  return session;
}

export function getVncSessionByToken(rawToken: string): VncSession | null {
  cleanExpiredVncSessions();
  const tokenHash = sha256Hex(rawToken);
  const session = activeSessions.get(tokenHash);
  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    session.status = "expired";
    activeSessions.delete(tokenHash);
    return null;
  }

  return session;
}

export function activateVncSession(rawToken: string): VncSession | null {
  const session = getVncSessionByToken(rawToken);
  if (!session) return null;
  if (session.status !== "pending") return null;

  session.status = "active";
  return session;
}

export function completeVncSession(rawToken: string): boolean {
  const tokenHash = sha256Hex(rawToken);
  const session = activeSessions.get(tokenHash);
  if (!session) return false;

  session.status = "completed";
  activeSessions.delete(tokenHash);
  return true;
}

export function cleanExpiredVncSessions(): void {
  const now = Date.now();
  for (const [hash, session] of activeSessions.entries()) {
    if (session.expiresAt.getTime() <= now) {
      activeSessions.delete(hash);
    }
  }
}

export function clearAllVncSessionsForTest(): void {
  activeSessions.clear();
}
