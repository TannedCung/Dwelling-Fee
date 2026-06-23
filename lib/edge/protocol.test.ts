import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deviceSecretHash,
  edgeSignatureBase,
  signEdgeRequest,
  signWithDeviceKey,
  verifyEdgeSignature,
} from "./protocol";

test("edge request signatures are deterministic for the same request", () => {
  const input = {
    secret: "df_edge_test_secret",
    method: "POST",
    path: "/api/edge/worker/jobs/lease",
    timestamp: "1782219670000",
    nonce: "nonce-123",
    body: JSON.stringify({ version: "edge-worker/0.1.0" }),
  };

  const signature = signEdgeRequest(input);
  const sameSignature = signWithDeviceKey({
    key: deviceSecretHash(input.secret),
    method: input.method,
    path: input.path,
    timestamp: input.timestamp,
    nonce: input.nonce,
    body: input.body,
  });

  assert.equal(signature, sameSignature);
  assert.equal(verifyEdgeSignature(signature, sameSignature), true);
});

test("edge request signatures change when the body changes", () => {
  const base = {
    secret: "df_edge_test_secret",
    method: "POST",
    path: "/api/edge/worker/jobs/lease",
    timestamp: "1782219670000",
    nonce: "nonce-123",
  };

  const a = signEdgeRequest({ ...base, body: JSON.stringify({ leaseSeconds: 120 }) });
  const b = signEdgeRequest({ ...base, body: JSON.stringify({ leaseSeconds: 180 }) });

  assert.notEqual(a, b);
  assert.equal(verifyEdgeSignature(a, b), false);
});

test("edge signature base includes method, path, timestamp, nonce, and body hash", () => {
  const base = edgeSignatureBase({
    method: "post",
    path: "/api/edge/worker/heartbeat",
    timestamp: "1782219670000",
    nonce: "nonce-123",
    bodyHash: "abc",
  });

  assert.equal(base, "POST\n/api/edge/worker/heartbeat\n1782219670000\nnonce-123\nabc");
});
