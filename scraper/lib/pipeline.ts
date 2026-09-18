/**
 * Target pipeline: listing → pagination → profile discovery → extraction → normalisation → ingest.
 *
 *   directory targets:  scrape listing page(s), follow profile links, extract each profile
 *   search targets:     Firecrawl search (with page content), pre-filter pages that carry a direct
 *                       contact channel, extract those
 *   forum/classified:   same as search, but every guide mentioned on the page becomes a record
 *
 * Extraction modes:
 *   llm   → Firecrawl `json` format with our schema (≈5 credits/page) + dictionary verification
 *   regex → markdown only (1 credit/page) + dictionary/regex extraction
 */

import pLimit from "p-limit";
import type { ScrapeEngine } from "./apify";
import type { FirecrawlClient, ScrapeFormat, ScrapeOptions, ScrapeResult } from "./firecrawl";
import { countryByCode, type CountryInfo } from "./countries";
import { discoverNextPage, discoverProfileLinks, normalizeUrl, pageUrlFromTemplate } from "./discover";
import { EXTRACTION_PROMPT, PAGE_EXTRACTION_JSON_SCHEMA } from "./extract-schema";
import type { IngestClient } from "./ingest";
import { log } from "./logger";
import { normalizePage, normalizePageRegex, type RawPageExtraction } from "./normalize";
import { SERVICE_RULES, WHATSAPP_PATTERN } from "./dictionaries";
import type { ScrapeTarget } from "../targets";
import type { GuideRecordInput, SourceType } from "../../src/lib/guide-schema";

export type ExtractionMode = "llm" | "regex";

export interface PipelineLimits {
  maxPagesPerTarget: number;
  maxProfilesPerTarget: number;
  /** stop the whole run once this many Firecrawl credits have been consumed */
  maxCredits: number;
  profileConcurrency: number;
}

export interface PipelineStats {
  targets: number;
  pagesScraped: number;
  guidesFound: number;
  withWhatsapp: number;
  withPhone: number;
  errors: number;
  perTarget: Record<string, { pages: number; guides: number; error?: string }>;
}

export interface PipelineContext {
  engine: ScrapeEngine;
  firecrawl: FirecrawlClient;
  ingest: IngestClient;
  mode: ExtractionMode;
  limits: PipelineLimits;
  /** shared across workers in one process so the same profile URL is never extracted twice */
  visited: Set<string>;
  stats: PipelineStats;
  onRecords?: (records: GuideRecordInput[], target: ScrapeTarget) => void | Promise<void>;
}

export function createStats(): PipelineStats {
  return { targets: 0, pagesScraped: 0, guidesFound: 0, withWhatsapp: 0, withPhone: 0, errors: 0, perTarget: {} };
}

const PHONE_HINT = /(?:\+|00)\d[\d\s().-]{7,}\d|tel:|wa\.me|\d{2,4}[\s.-]\d{3,4}[\s.-]\d{3,4}/;
const EMAIL_HINT = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

/** Cheap pre-filter for search results: does this page look like an operator with a direct contact? */
export function looksLikeGuidePage(markdown: string): boolean {
  if (!markdown || markdown.length < 200) return false;
  const hasService = SERVICE_RULES.some((r) => r.pattern.test(markdown));
  const hasContact = WHATSAPP_PATTERN.test(markdown) || PHONE_HINT.test(markdown) || EMAIL_HINT.test(markdown);
  return hasService && hasContact;
}

function formatsFor(mode: ExtractionMode, includeLinks: boolean): ScrapeFormat[] {
  const formats: ScrapeFormat[] = ["markdown"];
  if (includeLinks) formats.push("links");
  if (mode === "llm") formats.push({ type: "json", schema: PAGE_EXTRACTION_JSON_SCHEMA as unknown as Record<string, unknown>, prompt: EXTRACTION_PROMPT });
  return formats;
}

function budgetExceeded(ctx: PipelineContext): boolean {
  return ctx.firecrawl.creditsUsed >= ctx.limits.maxCredits;
}

function markVisited(ctx: PipelineContext, url: string): boolean {
  const key = normalizeUrl(url);
  if (ctx.visited.has(key)) return false;
  ctx.visited.add(key);
  return true;
}

async function scrapeWithMode(ctx: PipelineContext, url: string, target: ScrapeTarget, includeLinks: boolean): Promise<ScrapeResult> {
  const options: ScrapeOptions = {
    onlyMainContent: true,
    formats: formatsFor(ctx.mode, includeLinks),
    ...target.scrapeOptions,
  };
  const result = await ctx.engine.scrape(url, options);
  ctx.stats.pagesScraped++;
  return result;
}

/** Extract guide records from one page (already scraped or not). */
export async function extractPage(
  ctx: PipelineContext,
  url: string,
  target: ScrapeTarget,
  country: CountryInfo | undefined,
  sourceType: SourceType,
  prefetched?: ScrapeResult,
): Promise<GuideRecordInput[]> {
  let page = prefetched;
  const needsJson = ctx.mode === "llm" && (!page || page.json === undefined);
  if (!page || needsJson) {
    const fresh = await scrapeWithMode(ctx, url, target, false);
    page = { ...fresh, markdown: fresh.markdown || page?.markdown, links: fresh.links ?? page?.links };
  }
  const markdown = page.markdown ?? "";
  if (!markdown.trim()) return [];

  const normCtx = {
    sourceUrl: page.metadata?.sourceURL ?? url,
    markdown,
    pageTitle: page.metadata?.title,
    countryHint: country,
    sourceType,
    scrapedAt: new Date(),
  };

  let records: GuideRecordInput[];
  if (ctx.mode === "llm") {
    const extraction = (page.json ?? undefined) as RawPageExtraction | undefined;
    if (extraction?.pageType === "article" && (extraction.guides?.length ?? 0) === 0) return [];
    records = normalizePage(extraction, normCtx);
  } else {
    records = normalizePageRegex(normCtx);
  }
  return records;
}

async function emit(ctx: PipelineContext, target: ScrapeTarget, records: GuideRecordInput[]) {
  if (records.length === 0) return;
  ctx.stats.guidesFound += records.length;
  ctx.stats.withWhatsapp += records.filter((r) => r.whatsappConfirmed).length;
  ctx.stats.withPhone += records.filter((r) => r.phone || r.whatsapp).length;
  ctx.stats.perTarget[target.id].guides += records.length;
  await ctx.ingest.add(records);
  await ctx.onRecords?.(records, target);
}

// ---------------------------------------------------------------------------------------------
// Directory targets
// ---------------------------------------------------------------------------------------------

async function runDirectoryTarget(ctx: PipelineContext, target: ScrapeTarget, country: CountryInfo | undefined) {
  if (!target.url) return;
  const maxPages = Math.min(target.paging?.maxPages ?? 10, ctx.limits.maxPagesPerTarget);
  const limit = pLimit(ctx.limits.profileConcurrency);
  const visitedListing = new Set<string>();
  let profilesScheduled = 0;
  let pageUrl: string | null = target.url;

  for (let n = 1; n <= maxPages && pageUrl; n++) {
    if (budgetExceeded(ctx)) {
      log.warn(`credit budget reached, stopping ${target.id}`);
      break;
    }
    const currentUrl: string = target.paging?.template && n > 1 ? pageUrlFromTemplate(target.paging.template, target.url, n) : pageUrl;
    visitedListing.add(normalizeUrl(currentUrl));

    let listing: ScrapeResult;
    try {
      listing = await ctx.engine.scrape(currentUrl, {
        formats: target.extractListing ? formatsFor(ctx.mode, true) : ["markdown", "links"],
        onlyMainContent: true,
        ...target.scrapeOptions,
      });
      ctx.stats.pagesScraped++;
      ctx.stats.perTarget[target.id].pages++;
    } catch (error) {
      log.warn(`${target.id}: listing page ${n} failed: ${String(error)}`);
      ctx.stats.errors++;
      break;
    }

    const status = listing.metadata?.statusCode ?? 200;
    if (status >= 400) {
      log.warn(`${target.id}: listing page ${n} returned ${status}, stopping`);
      break;
    }
    const markdown = listing.markdown ?? "";
    const links = listing.links ?? [];

    if (target.extractListing) {
      try {
        const records = await extractPage(ctx, currentUrl, target, country, target.sourceType, listing);
        await emit(ctx, target, records);
      } catch (error) {
        log.warn(`${target.id}: listing extraction failed: ${String(error)}`);
        ctx.stats.errors++;
      }
    }

    let newProfiles: string[] = [];
    if (target.followProfiles) {
      const found = discoverProfileLinks(currentUrl, links, markdown, target.discovery);
      newProfiles = found.filter((u) => markVisited(ctx, u));
      log.info(`${target.id}: page ${n} → ${found.length} profile links (${newProfiles.length} new)`);

      const remaining = ctx.limits.maxProfilesPerTarget - profilesScheduled;
      const batch = newProfiles.slice(0, Math.max(0, remaining));
      profilesScheduled += batch.length;

      await Promise.all(
        batch.map((profileUrl) =>
          limit(async () => {
            if (budgetExceeded(ctx)) return;
            try {
              const records = await extractPage(ctx, profileUrl, target, country, target.sourceType);
              ctx.stats.perTarget[target.id].pages++;
              await emit(ctx, target, records);
            } catch (error) {
              ctx.stats.errors++;
              log.warn(`${target.id}: profile ${profileUrl} failed: ${String(error)}`);
            }
          }),
        ),
      );
      if (profilesScheduled >= ctx.limits.maxProfilesPerTarget) {
        log.info(`${target.id}: profile cap reached (${profilesScheduled})`);
        break;
      }
    }

    // ---- pagination -------------------------------------------------------------------
    if (target.paging?.template) {
      // Templated paging: stop when a page yields nothing new (past the last page most sites
      // either repeat page 1 or render an empty list).
      if (target.followProfiles && newProfiles.length === 0 && n > 1) break;
      if (target.followProfiles && newProfiles.length === 0 && n === 1 && !target.extractListing) break;
      pageUrl = pageUrlFromTemplate(target.paging.template, target.url, n + 1);
    } else {
      pageUrl = discoverNextPage(currentUrl, links, markdown, visitedListing);
      if (pageUrl) log.debug(`${target.id}: next page → ${pageUrl}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Search / forum / classified targets
// ---------------------------------------------------------------------------------------------

async function runSearchTarget(ctx: PipelineContext, target: ScrapeTarget, country: CountryInfo | undefined) {
  if (!target.query) return;
  if (budgetExceeded(ctx)) return;

  let results;
  try {
    results = await ctx.engine.search(target.query, {
      limit: target.searchLimit ?? 8,
      location: target.searchLocation,
      scrapeOptions: { formats: ["markdown", "links"], onlyMainContent: true },
    });
  } catch (error) {
    ctx.stats.errors++;
    log.warn(`${target.id}: search failed: ${String(error)}`);
    return;
  }
  ctx.stats.pagesScraped += results.length;
  ctx.stats.perTarget[target.id].pages += results.length;
  log.info(`${target.id}: "${target.query}" → ${results.length} results`);

  const limit = pLimit(ctx.limits.profileConcurrency);
  await Promise.all(
    results.map((r) =>
      limit(async () => {
        if (!r.url || !markVisited(ctx, r.url)) return;
        if (budgetExceeded(ctx)) return;
        let markdown = r.markdown ?? "";
        let prefetched: ScrapeResult | undefined = markdown ? { markdown, links: r.links, metadata: { ...(r.metadata ?? {}), sourceURL: r.url, title: r.title } } : undefined;

        // Blocked/social pages come back empty from search; give the (fallback-aware) engine a go.
        if (!markdown) {
          try {
            prefetched = await ctx.engine.scrape(r.url, { formats: ["markdown", "links"], onlyMainContent: true });
            ctx.stats.pagesScraped++;
            markdown = prefetched.markdown ?? "";
          } catch (error) {
            log.debug(`${target.id}: ${r.url} unreachable: ${String(error)}`);
            return;
          }
        }
        if (!looksLikeGuidePage(markdown)) {
          log.debug(`${target.id}: skipping ${r.url} (no operator+contact signal)`);
          return;
        }
        try {
          const records = await extractPage(ctx, r.url, target, country, target.sourceType, prefetched);
          await emit(ctx, target, records);
        } catch (error) {
          ctx.stats.errors++;
          log.warn(`${target.id}: extraction failed for ${r.url}: ${String(error)}`);
        }
      }),
    ),
  );
}

// ---------------------------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------------------------

export async function runTarget(ctx: PipelineContext, target: ScrapeTarget): Promise<void> {
  ctx.stats.targets++;
  ctx.stats.perTarget[target.id] = { pages: 0, guides: 0 };
  const country = countryByCode(target.countryCode);
  const started = Date.now();
  try {
    if (target.kind === "directory") await runDirectoryTarget(ctx, target, country);
    else await runSearchTarget(ctx, target, country);
  } catch (error) {
    ctx.stats.errors++;
    ctx.stats.perTarget[target.id].error = String(error);
    log.error(`${target.id} failed: ${String(error)}`);
  }
  const t = ctx.stats.perTarget[target.id];
  log.info(`${target.id} done in ${Math.round((Date.now() - started) / 1000)}s: ${t.pages} pages, ${t.guides} guides, credits so far ${ctx.firecrawl.creditsUsed}`);
}

export async function runTargets(ctx: PipelineContext, targets: ScrapeTarget[], targetConcurrency = 2): Promise<void> {
  const limit = pLimit(targetConcurrency);
  await Promise.all(targets.map((t) => limit(() => runTarget(ctx, t))));
  await ctx.ingest.flush();
}
