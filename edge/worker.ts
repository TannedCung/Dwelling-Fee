import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { canonicalUrl, extractLinks, extractPageItems, visibleText } from "../lib/collection/http-fetcher";
import { EDGE_AUTH_HEADERS, randomNonce, signEdgeRequest } from "../lib/edge/protocol";

const VERSION = "edge-worker/0.1.0";

interface WorkerConfig {
  serverUrl: string;
  deviceId: string;
  secret: string;
  profileDir: string;
  pollMs: number;
  headless: boolean;
  once: boolean;
  // How long to keep a challenged page open so a human can solve it via VNC
  // before giving up with needs_user_action. 0 disables the wait (headless).
  interactiveSolveMs: number;
}

export interface InteractiveSolve {
  timeoutMs: number;
  heartbeat?: () => Promise<void>;
}

interface JobResponse {
  job: null | {
    id: string;
    sourceId: string;
    leaseExpiresAt: string;
    payload: {
      mode: "playwright_edge";
      source: {
        id: string;
        label: string;
        url: string;
        config: Record<string, unknown> | null;
      };
    };
  };
}

export interface CrawlConfig {
  allowedDomains: string[];
  maxPages: number;
  maxDepth: number;
  followLinks: boolean;
  includeUrlPatterns: RegExp[];
  excludeUrlPatterns: RegExp[];
  requestDelayMs: number;
  timeoutMs: number;
  itemSelector?: string;
  contentSelector?: string;
  linkSelector?: string;
  maxTextChars: number;
}

export class NeedsUserAction extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NeedsUserAction";
  }
}

// Human-readable interstitial copy that means a person must act (solve a CAPTCHA,
// sign in, pass a Cloudflare/anti-bot challenge). Matched against VISIBLE text.
const USER_ACTION_TEXT_PATTERNS = [
  "captcha",
  "verify you are human",
  "verify you are not a robot",
  "are you a human",
  "unusual traffic",
  "access denied",
  "sign in to continue",
  "login to continue",
  "just a moment",
  "performing security verification",
  "checking your browser before accessing",
  "needs to review the security of your connection",
  "enable javascript and cookies to continue",
  "ddos protection by",
  "đăng nhập để tiếp tục",
  "xác minh bạn không phải",
  "vui lòng xác minh",
];

// Cloudflare / Akamai anti-bot machinery left in the HTML even when the visible
// copy is sparse. Matched against raw HTML so we still catch silent challenges.
const USER_ACTION_HTML_PATTERNS = [
  "cf-browser-verification",
  "cf_chl_opt",
  "/cdn-cgi/challenge-platform",
  "challenge-platform",
  "__cf_chl",
  "_incapsula_resource",
];

export type CrawlVerdict =
  | { kind: "ok" }
  | { kind: "blocked"; reason: string }
  | { kind: "error"; reason: string };

/**
 * Decide whether a fetched page is real content, a bot/auth wall that needs a
 * human (NeedsUserAction), or a transport error. A blocked or errored page must
 * never be ingested — the challenge/error text is not a listing and only creates
 * junk raw signals with zero observations.
 */
export function classifyCrawlPage(html: string, text: string, httpStatus?: number): CrawlVerdict {
  const haystackText = text.toLowerCase();
  const textWall = USER_ACTION_TEXT_PATTERNS.find((pattern) => haystackText.includes(pattern));
  if (textWall) return { kind: "blocked", reason: `bot/auth wall: ${textWall}` };

  const haystackHtml = html.toLowerCase();
  const htmlWall = USER_ACTION_HTML_PATTERNS.find((pattern) => haystackHtml.includes(pattern));
  if (htmlWall) return { kind: "blocked", reason: `anti-bot challenge: ${htmlWall}` };

  if (httpStatus !== undefined) {
    // 401/403/429 from a bot-protected site without recognizable challenge copy
    // still means "a human needs to open this in a real session".
    if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429) {
      return { kind: "blocked", reason: `HTTP ${httpStatus}` };
    }
    if (httpStatus >= 400) return { kind: "error", reason: `HTTP ${httpStatus}` };
  }
  return { kind: "ok" };
}

async function main() {
  const config = readConfig();
  await mkdir(config.profileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(config.profileDir, {
    headless: config.headless,
    viewport: { width: 1440, height: 1000 },
  });

  process.on("SIGINT", async () => {
    console.log("Stopping edge worker...");
    await context.close();
    process.exit(0);
  });

  console.log(`Edge worker ${VERSION} polling ${config.serverUrl}`);
  while (true) {
    try {
      await heartbeat(config, null);
      const leased = await leaseJob(config);
      if (leased.job) await runJob(config, context, leased.job);
      else if (config.once) break;
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
    }
    if (config.once) break;
    await sleep(config.pollMs);
  }
  await context.close();
}

async function runJob(config: WorkerConfig, context: BrowserContext, job: NonNullable<JobResponse["job"]>) {
  const source = job.payload.source;
  const crawlConfig = parseCrawlConfig(source.url, source.config);
  console.log(`Leased ${job.id} for ${source.label}: ${source.url}`);

  try {
    await heartbeat(config, job.id);
    const metrics = await crawlSource(config, context, job.id, source.url, crawlConfig);
    await complete(config, job.id, { status: "succeeded", metrics });
    console.log(`Completed ${job.id}`);
  } catch (e) {
    const status = e instanceof NeedsUserAction ? "needs_user_action" : "failed";
    const error = e instanceof Error ? e.message : "crawl failed";
    await complete(config, job.id, { status, error });
    console.error(`Stopped ${job.id}: ${error}`);
  } finally {
    await heartbeat(config, null);
  }
}

async function crawlSource(
  worker: WorkerConfig,
  context: BrowserContext,
  jobId: string,
  startUrl: string,
  config: CrawlConfig,
) {
  const queue: Array<{ url: URL; depth: number }> = [{ url: new URL(canonicalUrl(new URL(startUrl))), depth: 0 }];
  const queued = new Set(queue.map((target) => canonicalUrl(target.url)));
  const visited = new Set<string>();
  let pages = 0;
  let items = 0;

  while (queue.length > 0 && pages < config.maxPages) {
    const target = queue.shift()!;
    const targetCanonical = canonicalUrl(target.url);
    queued.delete(targetCanonical);
    if (visited.has(targetCanonical)) continue;
    visited.add(targetCanonical);

    await heartbeat(worker, jobId);
    await sleep(config.requestDelayMs);
    const solve: InteractiveSolve | undefined =
      worker.interactiveSolveMs > 0
        ? { timeoutMs: worker.interactiveSolveMs, heartbeat: () => heartbeat(worker, jobId) }
        : undefined;
    const result = await crawlPage(context, target.url, config, solve);
    pages++;
    items += result.items.length;

    await submitResults(worker, jobId, {
      pages: [result.page],
      items: result.items.map((item) => ({
        sourceRef: item.sourceRef,
        pageUrl: item.pageUrl,
        sourceType: item.sourceType ?? "web",
        text: item.text,
        capturedAt: item.capturedAt?.toISOString(),
      })),
    });

    if (config.followLinks && target.depth < config.maxDepth) {
      for (const link of result.links) {
        const canonical = canonicalUrl(link);
        if (visited.has(canonical) || queued.has(canonical)) continue;
        if (!urlAllowed(link, config)) continue;
        queue.push({ url: link, depth: target.depth + 1 });
        queued.add(canonical);
      }
    }
  }

  return { pages, items };
}

export async function crawlPage(context: BrowserContext, url: URL, config: CrawlConfig, solve?: InteractiveSolve) {
  if (!urlAllowed(url, config)) throw new Error(`URL outside allowlist: ${url.href}`);
  const page = await context.newPage();
  const started = Date.now();
  try {
    const response = await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
    await page.waitForLoadState("networkidle", { timeout: Math.min(config.timeoutMs, 15_000) }).catch(() => undefined);
    await autoScroll(page);
    let html = await page.content();
    let text = visibleText(html, config.maxTextChars);
    const verdict = classifyCrawlPage(html, text, response?.status());
    if (verdict.kind === "blocked") {
      const cleared = solve ? await waitForChallengeToClear(page, url, config, solve) : null;
      if (!cleared) throw new NeedsUserAction(`Page requires user action (${verdict.reason})`);
      html = cleared.html;
      text = cleared.text;
    } else if (verdict.kind === "error") {
      throw new Error(`Page fetch failed (${verdict.reason})`);
    }
    const extracted = extractPageItems(html, url, {
      itemSelector: config.itemSelector,
      contentSelector: config.contentSelector,
      linkSelector: config.linkSelector,
      maxTextChars: config.maxTextChars,
    }, new Date());
    const canonical = canonicalUrl(url);
    return {
      page: {
        canonicalUrl: canonical,
        status: "fetched" as const,
        httpStatus: response?.status(),
        contentHash: sha256(html),
        textHash: sha256(text),
        fetchDurationMs: Date.now() - started,
        bytesFetched: Buffer.byteLength(html),
        textLength: text.length,
        itemCount: extracted.items.length,
        fetchedAt: new Date().toISOString(),
      },
      items: extracted.items,
      links: extractLinks(html, url).filter((link) => urlAllowed(link, config)),
    };
  } catch (e) {
    if (e instanceof NeedsUserAction) throw e;
    return {
      page: {
        canonicalUrl: canonicalUrl(url),
        status: "failed" as const,
        fetchDurationMs: Date.now() - started,
        error: e instanceof Error ? e.message : "page crawl failed",
        fetchedAt: new Date().toISOString(),
      },
      items: [],
      links: [],
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Hold a challenged page open so a human can solve the wall (e.g. a Cloudflare
 * "Just a moment" check) over VNC. Polls the live page until it stops looking
 * like a wall, heartbeating to keep the server-side lease alive. Returns the
 * cleared page content, or null on timeout. Cloudflare's clearance cookie lands
 * in the persistent profile, so later crawls reuse it until it expires.
 */
async function waitForChallengeToClear(
  page: Page,
  url: URL,
  config: CrawlConfig,
  solve: InteractiveSolve,
): Promise<{ html: string; text: string } | null> {
  const seconds = Math.round(solve.timeoutMs / 1000);
  console.log(
    `Challenge wall on ${url.href}. Connect a VNC viewer to localhost:5900 and solve it — ` +
      `waiting up to ${seconds}s (auto-continues once it clears)...`,
  );
  const deadline = Date.now() + solve.timeoutMs;
  while (Date.now() < deadline) {
    await sleep(3000);
    await solve.heartbeat?.().catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
    const html = await page.content();
    const text = visibleText(html, config.maxTextChars);
    // Status is irrelevant after the challenge redirects to real content; judge by markup/text only.
    if (classifyCrawlPage(html, text).kind === "ok") {
      console.log(`Challenge cleared for ${url.href}; continuing crawl.`);
      await autoScroll(page);
      const settledHtml = await page.content();
      return { html: settledHtml, text: visibleText(settledHtml, config.maxTextChars) };
    }
  }
  return null;
}

async function autoScroll(page: Page) {
  await page.evaluate(async () => {
    for (let i = 0; i < 6; i++) {
      window.scrollBy(0, Math.max(600, window.innerHeight));
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  });
}

async function heartbeat(config: WorkerConfig, currentJobId: string | null) {
  await signedFetch(config, "/api/edge/worker/heartbeat", { version: VERSION, currentJobId });
}

async function leaseJob(config: WorkerConfig): Promise<JobResponse> {
  return signedFetch(config, "/api/edge/worker/jobs/lease", { version: VERSION, leaseSeconds: 180 });
}

async function submitResults(config: WorkerConfig, jobId: string, body: unknown) {
  return signedFetch(config, `/api/edge/worker/jobs/${jobId}/results`, body);
}

async function complete(
  config: WorkerConfig,
  jobId: string,
  body: { status: "succeeded" | "failed" | "needs_user_action"; error?: string; metrics?: unknown },
) {
  return signedFetch(config, `/api/edge/worker/jobs/${jobId}/complete`, body);
}

async function signedFetch(config: WorkerConfig, pathName: string, bodyValue: unknown) {
  const body = JSON.stringify(bodyValue ?? {});
  const timestamp = String(Date.now());
  const nonce = randomNonce();
  const signature = signEdgeRequest({
    secret: config.secret,
    method: "POST",
    path: pathName,
    timestamp,
    nonce,
    body,
  });
  const res = await fetch(new URL(pathName, config.serverUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [EDGE_AUTH_HEADERS.deviceId]: config.deviceId,
      [EDGE_AUTH_HEADERS.timestamp]: timestamp,
      [EDGE_AUTH_HEADERS.nonce]: nonce,
      [EDGE_AUTH_HEADERS.signature]: signature,
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `edge request failed: ${res.status}`);
  return data;
}

export function parseCrawlConfig(startUrl: string, raw: Record<string, unknown> | null): CrawlConfig {
  const input = raw ?? {};
  const seed = new URL(startUrl);
  const allowedDomains = new Set<string>([seed.hostname.toLowerCase()]);
  if (Array.isArray(input.allowedDomains)) {
    for (const domain of input.allowedDomains) {
      if (typeof domain === "string" && domain.trim()) allowedDomains.add(normalizeHost(domain));
    }
  }
  return {
    allowedDomains: [...allowedDomains],
    maxPages: clamp(input.maxPages, 10, 1, 50),
    maxDepth: clamp(input.maxDepth, 1, 0, 5),
    followLinks: input.followLinks === true,
    includeUrlPatterns: regexArray(input.includeUrlPatterns),
    excludeUrlPatterns: regexArray(input.excludeUrlPatterns),
    requestDelayMs: clamp(input.requestDelayMs, 1000, 0, 60_000),
    timeoutMs: clamp(input.timeoutMs, 30_000, 1000, 120_000),
    itemSelector: stringValue(input.itemSelector),
    contentSelector: stringValue(input.contentSelector),
    linkSelector: stringValue(input.linkSelector),
    maxTextChars: clamp(input.maxTextChars, 24_000, 1000, 120_000),
  };
}

function urlAllowed(url: URL, config: CrawlConfig): boolean {
  const host = url.hostname.toLowerCase();
  if (!config.allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`))) return false;
  const href = canonicalUrl(url);
  if (config.includeUrlPatterns.length > 0 && !config.includeUrlPatterns.some((pattern) => pattern.test(href))) return false;
  if (config.excludeUrlPatterns.some((pattern) => pattern.test(href))) return false;
  return true;
}

function readConfig(): WorkerConfig {
  const serverUrl = process.env.EDGE_SERVER_URL ?? "http://localhost:3000";
  const deviceId = requiredEnv("EDGE_DEVICE_ID");
  const secret = requiredEnv("EDGE_DEVICE_SECRET");
  const headless = process.env.EDGE_HEADLESS === "1" || process.env.EDGE_HEADLESS === "true";
  return {
    serverUrl,
    deviceId,
    secret,
    profileDir: process.env.EDGE_PROFILE_DIR ?? path.join(process.cwd(), ".edge-profile", deviceId),
    pollMs: clamp(process.env.EDGE_POLL_MS, 10_000, 1000, 300_000),
    headless,
    once: process.env.EDGE_ONCE === "1" || process.env.EDGE_ONCE === "true",
    // Headful runs default to a 5-min solve window; headless runs never wait.
    interactiveSolveMs: clamp(process.env.EDGE_SOLVE_TIMEOUT_MS, headless ? 0 : 300_000, 0, 900_000),
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function regexArray(value: unknown): RegExp[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "string" || !entry.trim()) return [];
    try {
      return [new RegExp(entry)];
    } catch {
      return [];
    }
  });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : fallback;
  return Math.max(min, Math.min(max, Number.isFinite(n) ? Math.trunc(n) : fallback));
}

function normalizeHost(value: string): string {
  return value.replace(/^https?:\/\//i, "").split("/")[0]!.trim().toLowerCase();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
