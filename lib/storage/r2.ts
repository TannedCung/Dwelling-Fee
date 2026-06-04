import { createHash, createHmac, randomUUID } from "node:crypto";
import { badRequest } from "../api/respond";

export interface Attachment {
  key: string;
  url: string;
  filename: string;
  contentType: string;
  size: number;
  sha256?: string;
  data?: Uint8Array;
}

const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
const MAX_IMAGES = 8;

export function parseAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Attachment => {
      const v = item as Partial<Attachment>;
      return Boolean(v.key && v.url && v.filename && v.contentType && typeof v.size === "number");
    })
    .slice(0, MAX_IMAGES);
}

export function persistableAttachments(attachments: Attachment[]): Attachment[] {
  return attachments.map((a) => ({
    key: a.key,
    url: a.url,
    filename: a.filename,
    contentType: a.contentType,
    size: a.size,
    ...(a.sha256 ? { sha256: a.sha256 } : {}),
  }));
}

export async function uploadImageFiles(files: File[]): Promise<Attachment[]> {
  const images = files.filter((file) => file.size > 0);
  if (images.length > MAX_IMAGES) throw badRequest(`At most ${MAX_IMAGES} images are allowed.`);

  const out: Attachment[] = [];
  for (const file of images) {
    if (!file.type.startsWith("image/")) throw badRequest(`${file.name || "attachment"} is not an image.`);
    if (file.size > MAX_IMAGE_SIZE) throw badRequest(`${file.name || "image"} exceeds 8 MB.`);
    out.push(await uploadToR2(file));
  }
  return out;
}

async function uploadToR2(file: File): Promise<Attachment> {
  const endpoint = process.env.R2_S3_ENDPOINT ?? process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? process.env.R2_API_TOKEN;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 storage is not configured. Set R2_S3_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.");
  }

  const base = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
  const body = Buffer.from(await file.arrayBuffer());
  const sha256 = sha256Hex(body);
  const ext = extensionFor(file);
  const key = `ingest/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${ext}`;
  const uploadUrl = new URL(`${base}/${encodeURIComponentPath(key)}`);
  const headers = signedRequestHeaders(
    uploadUrl,
    "PUT",
    sha256,
    accessKeyId,
    secretAccessKey,
    file.type || "application/octet-stream",
  );

  const res = await fetch(uploadUrl, { method: "PUT", headers, body });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`R2 upload failed (${res.status})${detail ? `: ${detail.slice(0, 160)}` : ""}`);
  }

  return {
    key,
    url: publicUrlFor(base, key),
    filename: file.name || "image",
    contentType: file.type || "application/octet-stream",
    size: file.size,
    sha256,
    data: body,
  };
}

export async function attachmentImageData(attachment: Attachment): Promise<Uint8Array | null> {
  if (attachment.data) return attachment.data;

  const endpoint = process.env.R2_S3_ENDPOINT ?? process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? process.env.R2_API_TOKEN;
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;

  const base = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
  const url = new URL(`${base}/${encodeURIComponentPath(attachment.key)}`);
  const payloadHash = sha256Hex("");
  const headers = signedRequestHeaders(url, "GET", payloadHash, accessKeyId, secretAccessKey);
  const res = await fetch(url, { method: "GET", headers });
  if (!res.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}

function signedRequestHeaders(
  url: URL,
  method: "GET" | "PUT",
  payloadHash: string,
  accessKeyId: string,
  secretAccessKey: string,
  contentType?: string,
): Headers {
  const now = new Date();
  const amzDate = isoDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const headerEntries: Array<[string, string]> = [
    ["host", url.host],
    ["x-amz-content-sha256", payloadHash],
    ["x-amz-date", amzDate],
  ];
  if (contentType) headerEntries.unshift(["content-type", contentType]);

  const headers = new Headers({
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  });
  if (contentType) headers.set("content-type", contentType);

  const canonicalHeaders = headerEntries.map(([key, value]) => `${key}:${value}\n`).join("");
  const signedHeaders = headerEntries.map(([key]) => key).join(";");
  const canonicalRequest = [
    method,
    url.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = hmacHex(signingKey(secretAccessKey, dateStamp), stringToSign);
  headers.set("authorization", `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`);
  return headers;
}

function signingKey(secret: string, dateStamp: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, "auto");
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

function publicUrlFor(base: string, key: string): string {
  const publicBase = process.env.R2_PUBLIC_BASE_URL;
  if (publicBase) return `${publicBase.replace(/\/$/, "")}/${encodeURIComponentPath(key)}`;
  return `${base}/${encodeURIComponentPath(key)}`;
}

function extensionFor(file: File): string {
  const fromName = file.name.match(/\.[a-z0-9]{2,8}$/i)?.[0];
  if (fromName) return fromName.toLowerCase();
  const subtype = file.type.split("/")[1];
  return subtype ? `.${subtype.replace(/[^a-z0-9]/gi, "")}` : "";
}

function encodeURIComponentPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function isoDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key: string | Buffer, value: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}
