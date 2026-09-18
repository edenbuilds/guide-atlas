/**
 * Apify fallback engine.
 *
 * Firecrawl is the primary engine. When a domain repeatedly blocks it (403/429/999, CAPTCHA pages,
 * empty bodies on JS-heavy/social sites), `FallbackEngine` routes that domain to Apify actors,
 * which run on Apify's residential-proxy compute:
 *   - apify/website-content-crawler   → page markdown (scrape)
 *   - apify/google-search-scraper     → organic results (search)
 *   - apify/facebook-posts-scraper etc. can be wired in via ACTOR_OVERRIDES for social URLs.
 *
 * Both engines expose the same `ScrapeEngine` interface so the pipeline is engine-agnostic.
 * Requires APIFY_TOKEN; without it the fallback is disabled and failures are surfaced normally.
 */

import { HttpError, withRetry } from "./rate-limit";
import type { FirecrawlClient, ScrapeOptions, ScrapeResult, SearchOptions, SearchResultItem } from "./firecrawl";
import { log } from "./logger";

export interface ScrapeEngine {
  readonly name: string;
  scrape(url: string, options?: ScrapeOptions): Promise<ScrapeResult>;
  search(query: string, options?: SearchOptions): Promise<SearchResultItem[]>;
}

interface ApifyRunOptions {
  token: string;
  baseUrl?: string;
  /** actor id or "user~name" for web pages */
  contentActor?: string;
  /** actor id for search */
  searchActor?: string;
  timeoutSecs?: number;
  proxyGroups?: string[];
}

const ACTOR_OVERRIDES: Array<{ match: RegExp; actor: string; buildInput: (url: string) => Record<string, unknown> }> = [
  {
    match: /facebook\.com/i,
    actor: "apify~facebook-posts-scraper",
    buildInput: (url) => ({ startUrls: [{ url }], resultsLimit: 20 }),
  },
  {
    match: /instagram\.com/i,
    actor: "apify~instagram-scraper",
    buildInput: (url) => ({ directUrls: [url], resultsType: "details", resultsLimit: 1 }),
  },
  {
    match: /reddit\.com/i,
    actor: "trudax~reddit-scraper-lite",
    buildInput: (url) => ({ startUrls: [{ url }], maxItems: 50, maxComments: 50 }),
  },
];

export class ApifyEngine implements ScrapeEngine {
  readonly name = "apify";
  private readonly base: string;

  constructor(private readonly opts: ApifyRunOptions) {
    if (!opts.token) throw new Error("APIFY_TOKEN is required for the Apify engine");
    this.base = (opts.baseUrl ?? "https://api.apify.com").replace(/\/$/, "");
  }

  async scrape(url: string, options: ScrapeOptions = {}): Promise<ScrapeResult> {
    const override = ACTOR_OVERRIDES.find((o) => o.match.test(url));
    const actor = override?.actor ?? this.opts.contentActor ?? "apify~website-content-crawler";
    const input = override
      ? override.buildInput(url)
      : {
          startUrls: [{ url }],
          maxCrawlPages: 1,
          maxCrawlDepth: 0,
          crawlerType: "playwright:adaptive",
          saveMarkdown: true,
          saveHtml: false,
          removeElementsCssSelector: options.onlyMainContent === false ? "" : "nav, footer, header, script, style, noscript, [role=banner], [role=navigation], .cookie, #cookie",
          proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: this.opts.proxyGroups ?? ["RESIDENTIAL"] },
          dynamicContentWaitSecs: Math.max(1, Math.round((options.waitFor ?? 2000) / 1000)),
        };

    const items = await this.runSync(actor, input);
    const first = items[0] ?? {};
    const markdown =
      (first.markdown as string | undefined) ??
      (first.text as string | undefined) ??
      // social actors return posts/comments: flatten to text so the normaliser can work on it
      items
        .map((it) => [it.text, it.caption, it.body, it.title, it.message].filter(Boolean).join("\n"))
        .filter(Boolean)
        .join("\n\n---\n\n");

    const links = Array.from(new Set((markdown ?? "").match(/https?:\/\/[^\s)\]"'<>]+/g) ?? []));

    return {
      markdown: markdown ?? "",
      links,
      metadata: {
        sourceURL: url,
        url: (first.url as string | undefined) ?? url,
        title: (first.metadata as { title?: string } | undefined)?.title ?? (first.title as string | undefined),
        statusCode: markdown ? 200 : 204,
        engine: "apify",
        actor,
      },
    };
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResultItem[]> {
    const actor = this.opts.searchActor ?? "apify~google-search-scraper";
    const items = await this.runSync(actor, {
      queries: query,
      maxPagesPerQuery: 1,
      resultsPerPage: options.limit ?? 10,
      countryCode: options.location ? undefined : "us",
      languageCode: "en",
    });
    const organic = (items[0]?.organicResults as Array<{ url: string; title?: string; description?: string }> | undefined) ?? [];
    const results: SearchResultItem[] = organic.slice(0, options.limit ?? 10).map((r) => ({ url: r.url, title: r.title, description: r.description }));
    if (options.scrapeOptions) {
      for (const r of results) {
        try {
          const page = await this.scrape(r.url, options.scrapeOptions);
          r.markdown = page.markdown;
          r.links = page.links;
          r.metadata = page.metadata;
        } catch (error) {
          log.warn(`apify search-scrape failed for ${r.url}: ${String(error)}`);
        }
      }
    }
    return results;
  }

  private async runSync(actor: string, input: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
    const timeout = this.opts.timeoutSecs ?? 180;
    const url = `${this.base}/v2/acts/${actor}/run-sync-get-dataset-items?token=${encodeURIComponent(this.opts.token)}&timeout=${timeout}&memory=2048&format=json&clean=true`;
    return withRetry(
      async () => {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout((timeout + 30) * 1000),
        });
        const text = await res.text();
        if (!res.ok) throw new HttpError(res.status, `apify ${actor} failed: ${text.slice(0, 300)}`);
        try {
          const parsed = JSON.parse(text);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      },
      { retries: 2, baseDelayMs: 5_000 },
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Firecrawl-first engine with per-domain circuit breaker
// ---------------------------------------------------------------------------------------------

export interface FallbackPolicy {
  /** consecutive blocked responses for a domain before it is routed to the fallback */
  failureThreshold?: number;
  /** domains that always go straight to the fallback engine (social networks, known blockers) */
  alwaysFallback?: RegExp;
}

export class FallbackEngine implements ScrapeEngine {
  readonly name = "firecrawl+apify";
  private failures = new Map<string, number>();
  private tripped = new Set<string>();

  constructor(
    private readonly primary: FirecrawlClient,
    private readonly fallback: ScrapeEngine | null,
    private readonly policy: FallbackPolicy = {},
  ) {}

  get trippedDomains(): string[] {
    return Array.from(this.tripped);
  }

  private domain(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  }

  private shouldFallback(url: string): boolean {
    if (!this.fallback) return false;
    const d = this.domain(url);
    if (this.tripped.has(d)) return true;
    const always = this.policy.alwaysFallback ?? /(^|\.)(facebook|instagram|reddit|linkedin|tiktok|x|twitter)\.com$/i;
    return always.test(d);
  }

  private recordBlock(url: string, reason: string) {
    const d = this.domain(url);
    const n = (this.failures.get(d) ?? 0) + 1;
    this.failures.set(d, n);
    const threshold = this.policy.failureThreshold ?? 3;
    if (n >= threshold && this.fallback && !this.tripped.has(d)) {
      this.tripped.add(d);
      log.warn(`domain ${d} tripped circuit breaker after ${n} blocks (${reason}); routing to ${this.fallback.name}`);
    }
  }

  private recordSuccess(url: string) {
    this.failures.delete(this.domain(url));
  }

  /** Detects soft blocks: bot walls, CAPTCHA pages, empty bodies on 200s. */
  static looksBlocked(result: ScrapeResult): string | null {
    const status = result.metadata?.statusCode ?? 200;
    if ([401, 403, 407, 429, 451, 503, 999].includes(status)) return `status ${status}`;
    const md = (result.markdown ?? "").trim();
    if (md.length < 80) return "empty body";
    if (/(access denied|are you a robot|verify you are human|captcha|cloudflare|attention required|unusual traffic|enable javascript and cookies|请完成安全验证|アクセスが拒否|접근이 거부)/i.test(md.slice(0, 1500)))
      return "bot wall";
    return null;
  }

  async scrape(url: string, options?: ScrapeOptions): Promise<ScrapeResult> {
    if (this.shouldFallback(url)) return this.fallback!.scrape(url, options);
    try {
      const result = await this.primary.scrape(url, options);
      const blocked = FallbackEngine.looksBlocked(result);
      if (blocked) {
        this.recordBlock(url, blocked);
        if (this.tripped.has(this.domain(url)) && this.fallback) return this.fallback.scrape(url, options);
      } else {
        this.recordSuccess(url);
      }
      return result;
    } catch (error) {
      if (error instanceof HttpError && [403, 429, 500, 502, 503].includes(error.status)) {
        this.recordBlock(url, `http ${error.status}`);
        if (this.tripped.has(this.domain(url)) && this.fallback) return this.fallback.scrape(url, options);
      }
      throw error;
    }
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResultItem[]> {
    try {
      return await this.primary.search(query, options);
    } catch (error) {
      if (this.fallback && error instanceof HttpError && [402, 403, 429, 500, 502, 503].includes(error.status)) {
        log.warn(`firecrawl search failed (${error.status}); falling back to ${this.fallback.name}`);
        return this.fallback.search(query, options);
      }
      throw error;
    }
  }
}

export function createFallbackEngine(primary: FirecrawlClient, policy?: FallbackPolicy): FallbackEngine {
  const token = process.env.APIFY_TOKEN;
  const fallback = token
    ? new ApifyEngine({
        token,
        contentActor: process.env.APIFY_CONTENT_ACTOR,
        searchActor: process.env.APIFY_SEARCH_ACTOR,
      })
    : null;
  if (!fallback) log.info("APIFY_TOKEN not set — Apify fallback disabled (blocked domains will be skipped)");
  return new FallbackEngine(primary, fallback, policy);
}
