/**
 * Minimal, typed Firecrawl v2 REST client with built-in rate limiting.
 *
 * We call the REST API directly (instead of the SDK) so the surface area we depend on is explicit,
 * the retry / concurrency behaviour is under our control, and the same interface can be backed by
 * an alternate engine (see ./apify.ts) without touching the pipeline.
 */

import { HttpError, Semaphore, TokenBucket, sleep, withRetry } from "./rate-limit";
import { log } from "./logger";

export interface JsonFormat {
  type: "json";
  schema?: Record<string, unknown>;
  prompt?: string;
}
export type ScrapeFormat = "markdown" | "html" | "rawHtml" | "links" | "screenshot" | JsonFormat;

export interface ScrapeOptions {
  formats?: ScrapeFormat[];
  onlyMainContent?: boolean;
  waitFor?: number;
  timeout?: number;
  /** cache tolerance in ms; 0 forces a fresh fetch */
  maxAge?: number;
  location?: { country?: string; languages?: string[] };
  includeTags?: string[];
  excludeTags?: string[];
  headers?: Record<string, string>;
  mobile?: boolean;
  proxy?: "basic" | "stealth" | "auto";
}

export interface ScrapeMetadata {
  title?: string;
  description?: string;
  language?: string;
  sourceURL?: string;
  url?: string;
  statusCode?: number;
  error?: string;
  creditsUsed?: number;
  proxyUsed?: string;
  [key: string]: unknown;
}

export interface ScrapeResult {
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: string[];
  json?: unknown;
  metadata: ScrapeMetadata;
}

export interface SearchResultItem {
  url: string;
  title?: string;
  description?: string;
  markdown?: string;
  links?: string[];
  json?: unknown;
  metadata?: ScrapeMetadata;
}

export interface SearchOptions {
  limit?: number;
  /** ISO country name or code understood by Firecrawl, e.g. "Japan" */
  location?: string;
  /** time filter, e.g. "qdr:y" for past year */
  tbs?: string;
  sources?: Array<"web" | "news" | "images">;
  scrapeOptions?: ScrapeOptions;
}

export interface MapOptions {
  search?: string;
  limit?: number;
  includeSubdomains?: boolean;
  sitemap?: "include" | "skip" | "only";
}

export interface CrawlOptions {
  limit?: number;
  maxDiscoveryDepth?: number;
  includePaths?: string[];
  excludePaths?: string[];
  allowSubdomains?: boolean;
  crawlEntireDomain?: boolean;
  scrapeOptions?: ScrapeOptions;
}

export interface CrawlStatus {
  status: "scraping" | "completed" | "failed" | "cancelled";
  total: number;
  completed: number;
  creditsUsed: number;
  next?: string;
  data: ScrapeResult[];
}

export interface FirecrawlClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** hard cap on concurrent in-flight requests; auto-tuned from /concurrency-check when omitted */
  maxConcurrency?: number;
  /** requests per minute budget for the token bucket */
  requestsPerMinute?: number;
  retries?: number;
}

export class FirecrawlClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly semaphore: Semaphore;
  private readonly bucket: TokenBucket;
  private readonly retries: number;
  private tuned = false;

  /** running total of credits consumed via this client instance */
  creditsUsed = 0;
  requestCount = 0;

  constructor(opts: FirecrawlClientOptions) {
    if (!opts.apiKey) throw new Error("FIRECRAWL_API_KEY is required");
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://api.firecrawl.dev").replace(/\/$/, "");
    this.semaphore = new Semaphore(opts.maxConcurrency ?? 2);
    const rpm = opts.requestsPerMinute ?? 60;
    this.bucket = new TokenBucket(Math.max(2, Math.ceil(rpm / 6)), rpm / 60_000);
    this.retries = opts.retries ?? 4;
    if (opts.maxConcurrency) this.tuned = true;
  }

  /** Read the team's concurrency cap once and size the semaphore to it. */
  async autoTune(): Promise<void> {
    if (this.tuned) return;
    this.tuned = true;
    try {
      const res = await this.request<{ concurrency: number; maxConcurrency: number }>(
        "GET",
        "/v2/concurrency-check",
        undefined,
        { skipLimiter: true },
      );
      const max = Math.max(1, Math.min(res.maxConcurrency ?? 2, 50));
      this.semaphore.setMax(max);
      log.info(`firecrawl concurrency tuned to ${max} (in use: ${res.concurrency})`);
    } catch (error) {
      log.warn(`concurrency-check failed, keeping default semaphore: ${String(error)}`);
    }
  }

  async creditUsage(): Promise<{ remainingCredits: number; planCredits: number }> {
    const res = await this.request<{ data: { remainingCredits: number; planCredits: number } }>(
      "GET",
      "/v2/team/credit-usage",
      undefined,
      { skipLimiter: true },
    );
    return res.data;
  }

  async scrape(url: string, options: ScrapeOptions = {}): Promise<ScrapeResult> {
    const body = { url, formats: ["markdown"], onlyMainContent: true, ...options };
    const res = await this.request<{ success: boolean; data: ScrapeResult; error?: string }>(
      "POST",
      "/v2/scrape",
      body,
    );
    if (!res.success) throw new Error(`scrape failed for ${url}: ${res.error ?? "unknown"}`);
    this.trackCredits(res.data?.metadata?.creditsUsed);
    return res.data;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResultItem[]> {
    const body: Record<string, unknown> = { query, limit: options.limit ?? 10 };
    if (options.location) body.location = options.location;
    if (options.tbs) body.tbs = options.tbs;
    if (options.sources) body.sources = options.sources.map((type) => ({ type }));
    if (options.scrapeOptions) body.scrapeOptions = options.scrapeOptions;

    const res = await this.request<{
      success: boolean;
      data: { web?: SearchResultItem[] } | SearchResultItem[];
      creditsUsed?: number;
      error?: string;
    }>("POST", "/v2/search", body);
    if (!res.success) throw new Error(`search failed for "${query}": ${res.error ?? "unknown"}`);
    const items = Array.isArray(res.data) ? res.data : (res.data?.web ?? []);
    // search costs 2 credits per result when scraping; fall back to result count if unreported
    this.trackCredits(res.creditsUsed ?? items.length * (options.scrapeOptions ? 2 : 1));
    return items;
  }

  async map(url: string, options: MapOptions = {}): Promise<Array<{ url: string; title?: string }>> {
    const res = await this.request<{
      success: boolean;
      links: Array<{ url: string; title?: string; description?: string }> | string[];
      error?: string;
    }>("POST", "/v2/map", { url, limit: 500, ...options });
    if (!res.success) throw new Error(`map failed for ${url}: ${res.error ?? "unknown"}`);
    this.trackCredits(1);
    return (res.links ?? []).map((l) => (typeof l === "string" ? { url: l } : l));
  }

  /** Start a crawl and poll until finished. Returns every page scraped. */
  async crawl(
    url: string,
    options: CrawlOptions = {},
    poll: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<CrawlStatus> {
    const start = await this.request<{ success: boolean; id: string; error?: string }>(
      "POST",
      "/v2/crawl",
      { url, limit: 100, ...options },
    );
    if (!start.success) throw new Error(`crawl failed to start for ${url}: ${start.error}`);
    return this.pollJob(`/v2/crawl/${start.id}`, poll);
  }

  /** Batch-scrape many URLs server-side (cheaper on our request budget than N scrapes). */
  async batchScrape(
    urls: string[],
    options: ScrapeOptions = {},
    poll: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<CrawlStatus> {
    const start = await this.request<{ success: boolean; id: string; error?: string }>(
      "POST",
      "/v2/batch/scrape",
      { urls, formats: ["markdown"], onlyMainContent: true, ...options },
    );
    if (!start.success) throw new Error(`batch scrape failed to start: ${start.error}`);
    return this.pollJob(`/v2/batch/scrape/${start.id}`, poll);
  }

  private async pollJob(
    path: string,
    { intervalMs = 4_000, timeoutMs = 15 * 60_000 }: { intervalMs?: number; timeoutMs?: number },
  ): Promise<CrawlStatus> {
    const deadline = Date.now() + timeoutMs;
    const aggregated: ScrapeResult[] = [];
    let status: CrawlStatus | undefined;

    while (Date.now() < deadline) {
      status = await this.request<CrawlStatus>("GET", path, undefined, { skipLimiter: true });
      if (status.status === "completed" || status.status === "failed" || status.status === "cancelled") {
        aggregated.push(...(status.data ?? []));
        // Large jobs paginate their result set through `next`.
        let next = status.next;
        while (next) {
          const page = await this.request<CrawlStatus>("GET", next.replace(this.baseUrl, ""), undefined, {
            skipLimiter: true,
            absolute: next.startsWith("http") ? next : undefined,
          });
          aggregated.push(...(page.data ?? []));
          next = page.next;
        }
        this.trackCredits(status.creditsUsed);
        return { ...status, data: aggregated };
      }
      await sleep(intervalMs);
    }
    throw new Error(`job ${path} timed out after ${timeoutMs}ms (last status: ${status?.status})`);
  }

  private trackCredits(n?: number) {
    if (typeof n === "number" && Number.isFinite(n)) this.creditsUsed += n;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    opts: { skipLimiter?: boolean; absolute?: string } = {},
  ): Promise<T> {
    const url = opts.absolute ?? `${this.baseUrl}${path}`;
    const release = opts.skipLimiter ? undefined : await this.semaphore.acquire();
    try {
      if (!opts.skipLimiter) await this.bucket.take();
      return await withRetry(
        async () => {
          this.requestCount++;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 120_000);
          try {
            const res = await fetch(url, {
              method,
              headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
              },
              body: body === undefined ? undefined : JSON.stringify(body),
              signal: controller.signal,
            });
            const text = await res.text();
            let parsed: unknown = undefined;
            try {
              parsed = text ? JSON.parse(text) : undefined;
            } catch {
              parsed = { raw: text };
            }
            if (!res.ok) {
              const retryAfterHeader = res.headers.get("retry-after");
              const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined;
              const message =
                (parsed as { error?: string } | undefined)?.error ?? `HTTP ${res.status} from ${path}`;
              throw new HttpError(res.status, message, retryAfterMs, parsed);
            }
            return parsed as T;
          } finally {
            clearTimeout(timer);
          }
        },
        {
          retries: this.retries,
          onRetry: ({ attempt, delayMs, error }) =>
            log.warn(
              `firecrawl ${method} ${path} retry ${attempt} in ${Math.round(delayMs)}ms: ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
        },
      );
    } finally {
      release?.();
    }
  }
}

export function createFirecrawlClient(overrides: Partial<FirecrawlClientOptions> = {}): FirecrawlClient {
  return new FirecrawlClient({
    apiKey: process.env.FIRECRAWL_API_KEY ?? "",
    maxConcurrency: process.env.FIRECRAWL_MAX_CONCURRENCY
      ? Number(process.env.FIRECRAWL_MAX_CONCURRENCY)
      : undefined,
    requestsPerMinute: process.env.FIRECRAWL_RPM ? Number(process.env.FIRECRAWL_RPM) : undefined,
    ...overrides,
  });
}
