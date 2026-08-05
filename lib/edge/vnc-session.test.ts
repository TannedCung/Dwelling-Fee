import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activateVncSession,
  cleanExpiredVncSessions,
  clearAllVncSessionsForTest,
  completeVncSession,
  createVncSession,
  getVncSessionByToken,
} from "./vnc-session";

test("vnc session creation produces valid token and pending status", () => {
  clearAllVncSessionsForTest();
  const session = createVncSession({
    deviceId: "dev-123",
    jobId: "job-456",
    ttlMs: 5000,
  });

  assert.equal(session.deviceId, "dev-123");
  assert.equal(session.jobId, "job-456");
  assert.equal(session.status, "pending");
  assert.ok(session.rawToken.startsWith("df_vnc_"));

  const retrieved = getVncSessionByToken(session.rawToken);
  assert.notEqual(retrieved, null);
  assert.equal(retrieved?.id, session.id);
});

test("vnc session activation transitions pending session to active", () => {
  clearAllVncSessionsForTest();
  const session = createVncSession({ deviceId: "dev-1", jobId: "job-1" });

  const activated = activateVncSession(session.rawToken);
  assert.notEqual(activated, null);
  assert.equal(activated?.status, "active");

  // Re-activating active session returns null (single activation)
  const reActivated = activateVncSession(session.rawToken);
  assert.equal(reActivated, null);
});

test("vnc session completion removes session from registry", () => {
  clearAllVncSessionsForTest();
  const session = createVncSession({ deviceId: "dev-1", jobId: "job-1" });

  activateVncSession(session.rawToken);
  const ok = completeVncSession(session.rawToken);
  assert.equal(ok, true);

  const afterComplete = getVncSessionByToken(session.rawToken);
  assert.equal(afterComplete, null);
});

test("vnc session expiration returns null and removes expired session", async () => {
  clearAllVncSessionsForTest();
  const session = createVncSession({
    deviceId: "dev-1",
    jobId: "job-1",
    ttlMs: 10, // 10ms TTL
  });

  // Wait 25ms for session to expire
  await new Promise((r) => setTimeout(r, 25));

  const expired = getVncSessionByToken(session.rawToken);
  assert.equal(expired, null);
});
