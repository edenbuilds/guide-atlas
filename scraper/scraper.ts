#!/usr/bin/env tsx
/**
 * Guide Atlas scraper — standalone CLI.
 *
 *   npx tsx scraper/scraper.ts run --region japan --mode llm --max-credits 2000
 *   npx tsx scraper/scraper.ts run --urls https://www.tourhq.com/japan/tour-guides --country JP
 *   npx tsx scraper/scraper.ts run --country IT,ES --kinds search,forum --dry-run --out out/it-es.jsonl
 *   npx tsx scraper/scraper.ts list --region europe-central
 *   npx tsx scraper/scraper.ts replay out/it-es.jsonl
 *   npx tsx scraper/scraper.ts credits
 *
 * The `run` command accepts an array of target regional directory URLs (--urls / --file) and/or
 * generates targets from the built-in catalogue (--region / --country / --kinds).
 */

import "dotenv/config";
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import type { CountryCode } from "libphonenumber-js";
import { createFirecrawlClient } from "./lib/firecrawl";
import { createFallbackEngine } from "./lib/apify";
import { IngestClient } from "./lib/ingest";
import { log } from "./lib/logger";
import { createStats, runTargets, type ExtractionMode, type PipelineContext } from "./lib/pipeline";
import { buildTargets, targetsFromUrls, REGIONS, type RegionKey, type TargetKind, type ScrapeTarget } from "./targets";
import { GuideRecordSchema } from "../src/lib/guide-schema";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    urls: { type: "string" },
    file: { type: "string" },
    region: { type: "string" },
    country: { type: "string" },
    kinds: { type: "string" },
    directories: { type: "string" },
    mode: { type: "string", default: process.env.SCRAPER_MODE ?? "llm" },
    "max-pages": { type: "string", default: "10" },
    "max-profiles": { type: "string", default: "150" },
    "max-credits": { type: "string", default: process.env.SCRAPER_MAX_CREDITS ?? "5000" },
    "max-search": { type: "string" },
    "limit-targets": { type: "string" },
    concurrency: { type: "string", default: "2" },
    "profile-concurrency": { type: "string", default: "4" },
    out: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    "api-url": { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});

const command = positionals[0] ?? "run";

function csv(v: string | undefined): string[] {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function usage() {
  process.stdout.write(`Guide Atlas scraper

Commands:
  run       scrape targets and POST to the ingest API (default)
  list      print the targets that would run
  replay    re-ingest a JSONL file produced by --out
  credits   show Firecrawl credit balance

Options for run/list:
  --urls <a,b>            explicit listing URLs (comma separated)
  --file <path>           newline-separated listing URLs
  --region <keys>         ${Object.keys(REGIONS).join(", ")}
  --country <codes>       ISO alpha-2 codes, e.g. JP,KR,IT
  --kinds <kinds>         directory,search,forum,classified (default: all)
  --directories <ids>     restrict directory templates, e.g. tourhq,gowithguide-cars
  --mode llm|regex        extraction mode (default llm)
  --max-pages <n>         listing pages per target (default 10)
  --max-profiles <n>      profile pages per target (default 150)
  --max-credits <n>       stop after this many Firecrawl credits (default 5000)
  --max-search <n>        cap search queries per country
  --limit-targets <n>     only run the first n targets
  --concurrency <n>       targets in parallel (default 2)
  --profile-concurrency   profile pages in parallel per target (default 4)
  --out <file.jsonl>      also write validated records to JSONL
  --dry-run               do not call the ingest API
  --api-url <url>         ingest endpoint (default $INGEST_API_URL or http://localhost:3000/api/guides/ingest)
`);
}

async function loadUrlTargets(): Promise<ScrapeTarget[]> {
  const urls = csv(values.urls);
  if (values.file) {
    const text = await readFile(values.file, "utf8");
    urls.push(...text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")));
  }
  if (urls.length === 0) return [];
  const country = csv(values.country)[0]?.toUpperCase() as CountryCode | undefined;
  return targetsFromUrls(urls, country, { paging: { maxPages: Number(values["max-pages"]) } });
}

async function resolveTargets(): Promise<ScrapeTarget[]> {
  const urlTargets = await loadUrlTargets();
  const hasCatalogueFilter = values.region || values.country || values.kinds || values.directories;
  let catalogue: ScrapeTarget[] = [];
  if (urlTargets.length === 0 || hasCatalogueFilter) {
    catalogue = buildTargets({
      regions: csv(values.region) as RegionKey[],
      countries: csv(values.country).map((c) => c.toUpperCase()) as CountryCode[],
      kinds: csv(values.kinds) as TargetKind[],
      directories: csv(values.directories),
      maxSearchPerCountry: values["max-search"] ? Number(values["max-search"]) : undefined,
    });
  }
  // Explicit URLs always run first.
  let targets = [...urlTargets, ...(urlTargets.length && !hasCatalogueFilter ? [] : catalogue)];
  if (values["limit-targets"]) targets = targets.slice(0, Number(values["limit-targets"]));
  return targets;
}

async function cmdList() {
  const targets = await resolveTargets();
  for (const t of targets) process.stdout.write(`${t.id.padEnd(34)} ${t.kind.padEnd(10)} ${t.countryCode}  ${t.url ?? t.query}\n`);
  process.stdout.write(`\n${targets.length} targets\n`);
}

async function cmdCredits() {
  const fc = createFirecrawlClient();
  const usage = await fc.creditUsage();
  process.stdout.write(`${JSON.stringify(usage, null, 2)}\n`);
}

async function cmdReplay() {
  const file = positionals[1];
  if (!file) throw new Error("replay requires a JSONL file path");
  const ingest = new IngestClient({ apiUrl: values["api-url"], batchSize: 200 });
  const lines = (await readFile(file, "utf8")).split(/\r?\n/).filter(Boolean);
  let ok = 0;
  for (const line of lines) {
    const parsed = GuideRecordSchema.safeParse(JSON.parse(line));
    if (parsed.success) {
      ok++;
      await ingest.add([parsed.data]);
    }
  }
  await ingest.flush();
  log.info(`replayed ${ok}/${lines.length} records`, ingest.totals);
}

async function cmdRun() {
  const mode = values.mode as ExtractionMode;
  if (mode !== "llm" && mode !== "regex") throw new Error(`invalid --mode ${values.mode}`);
  const targets = await resolveTargets();
  if (targets.length === 0) {
    usage();
    throw new Error("no targets: pass --urls/--file or --region/--country");
  }

  const firecrawl = createFirecrawlClient();
  await firecrawl.autoTune();
  try {
    const usageInfo = await firecrawl.creditUsage();
    log.info(`firecrawl credits remaining: ${usageInfo.remainingCredits}`);
  } catch {
    /* non-fatal */
  }

  const engine = createFallbackEngine(firecrawl);
  const ingest = new IngestClient({ apiUrl: values["api-url"], outFile: values.out, dryRun: values["dry-run"] });
  ingest.setRun({
    region: csv(values.region).join(",") || csv(values.country).join(",") || null,
    mode,
    targetUrls: targets.map((t) => t.url ?? t.query ?? "").filter(Boolean).slice(0, 200),
    pagesScraped: 0,
    creditsUsed: 0,
  });

  const ctx: PipelineContext = {
    engine,
    firecrawl,
    ingest,
    mode,
    limits: {
      maxPagesPerTarget: Number(values["max-pages"]),
      maxProfilesPerTarget: Number(values["max-profiles"]),
      maxCredits: Number(values["max-credits"]),
      profileConcurrency: Number(values["profile-concurrency"]),
    },
    visited: new Set(),
    stats: createStats(),
  };

  log.info(`running ${targets.length} targets in ${mode} mode (credit cap ${ctx.limits.maxCredits})`);
  const started = Date.now();
  let status: "completed" | "failed" = "completed";
  let error: string | undefined;
  try {
    await runTargets(ctx, targets, Number(values.concurrency));
  } catch (e) {
    status = "failed";
    error = String(e);
    log.error(`run failed: ${error}`);
  } finally {
    await ingest.finish({ pagesScraped: ctx.stats.pagesScraped, creditsUsed: firecrawl.creditsUsed, status, error });
  }

  const summary = {
    durationSec: Math.round((Date.now() - started) / 1000),
    creditsUsed: firecrawl.creditsUsed,
    requests: firecrawl.requestCount,
    trippedDomains: engine.trippedDomains,
    ...ctx.stats,
    invalidRecords: ingest.invalid,
    ingest: ingest.totals,
  };
  process.stdout.write(`\n${JSON.stringify(summary, null, 2)}\n`);
  if (status === "failed") process.exitCode = 1;
}

(async () => {
  if (values.help) return usage();
  switch (command) {
    case "run":
      return cmdRun();
    case "list":
      return cmdList();
    case "replay":
      return cmdReplay();
    case "credits":
      return cmdCredits();
    default:
      usage();
      throw new Error(`unknown command ${command}`);
  }
})().catch((error) => {
  log.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
