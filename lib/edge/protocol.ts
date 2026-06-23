import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const EDGE_AUTH_HEADERS = {
  deviceId: "x-edge-device-id",
  timestamp: "x-edge-timestamp",
  nonce: "x-edge-nonce",
  signature: "x-edge-signature",
} as const;

export function generateDeviceSecret(): string {
  return `df_edge_${randomBytes(32).toString("base64url")}`;
}

export function deviceSecretHash(secret: string): string {
  return sha256Hex(secret);
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function edgeSignatureBase(input: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  bodyHash: string;
}): string {
  return [
    input.method.toUpperCase(),
    input.path,
    input.timestamp,
    input.nonce,
    input.bodyHash,
  ].join("\n");
}

export function signEdgeRequest(input: {
  secret: string;
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  body: string;
}): string {
  const key = deviceSecretHash(input.secret);
  return signWithDeviceKey({
    key,
    method: input.method,
    path: input.path,
    timestamp: input.timestamp,
    nonce: input.nonce,
    body: input.body,
  });
}

export function signWithDeviceKey(input: {
  key: string;
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  body: string;
}): string {
  const base = edgeSignatureBase({
    method: input.method,
    path: input.path,
    timestamp: input.timestamp,
    nonce: input.nonce,
    bodyHash: sha256Hex(input.body),
  });
  return createHmac("sha256", input.key).update(base).digest("hex");
}

export function verifyEdgeSignature(expected: string, actual: string | null): boolean {
  if (!actual || !/^[a-f0-9]{64}$/i.test(actual)) return false;
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export function randomNonce(): string {
  return randomBytes(16).toString("base64url");
}
