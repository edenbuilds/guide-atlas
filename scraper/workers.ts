#!/usr/bin/env tsx
/**
 * Parallel dispatcher: runs one scraper worker process per region (or per country) so distinct
 * regional directories are crawled simultaneously. Each worker is an ordinary `scraper.ts run`
 * invocation, so the same units can be handed to separate subagents / machines by copying the
 * printed command lines.
 *
 *   npx tsx scraper/workers.ts --regions europe-west,europe-central,japan,korea --max-credits 20000
 *   npx tsx scraper/workers.ts --per-country --country JP,KR,IT --mode regex
 *   npx tsx scraper/workers.ts --print   # only print the per-worker commands
 *
 * Firecrawl's concurrency cap is team-wide, so the dispatcher reads /v2/concurrency-check and gives
 * every worker an equal share via FIRECRAWL_MAX_CONCURRENCY. The credit budget is split the same way.
 */

import "dotenv/config";
import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import path from "node:path";
import { createFirecrawlClient } from "./lib/firecrawl";
import { log } from "./lib/logger";
import { COUNTRIES, REGIONS, type RegionKey } from "./targets";

const { values } = parseArgs({
  options: {
    regions: { type: "string" },
    country: { type: "string" },
    "per-country": { type: "boolean", default: false },
    kinds: { type: "string" },
    mode: { type: "string", default: process.env.SCRAPER_MODE ?? "llm" },
    "max-credits": { type: "string", default: process.env.SCRAPER_MAX_CREDITS ?? "20000" },
    "max-pages": { type: "string" },
    "max-profiles": { type: "string" },
    "max-search": { type: "string" },
    "max-workers": { type: "string", default: "6" },
    "out-dir": { type: "string", default: "out" },
    "dry-run": { type: "boolean", default: false },
    print: { type: "boolean", default: false },
  },
});

interface WorkUnit {
  id: string;
  args: string[];
}

function csv(v: string | undefined): string[] {
  return (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

function buildUnits(): WorkUnit[] {
  const regions = (csv(values.regions) as RegionKey[]).filter((r) => r in REGIONS);
  const countries = csv(values.country).map((c) => c.toUpperCase());

  if (values["per-country"]) {
    const codes = countries.length ? countries : COUNTRIES.filter((c) => !regions.length || regions.includes(c.region)).map((c) => c.code);
    return codes.map((code) => ({ id: `country-${code}`, args: ["--country", code] }));
  }
  const keys = regions.length ? regions : (Object.keys(REGIONS) as RegionKey[]);
  return keys.map((key) => ({ id: `region-${key}`, args: ["--region", key, ...(countries.length ? ["--country", countries.join(",")] : [])] }));
}

async function main() {
  const units = buildUnits();
  if (units.length === 0) throw new Error("no work units");

  const maxWorkers = Math.max(1, Math.min(Number(values["max-workers"]), units.length));
  const totalCredits = Number(values["max-credits"]);
  const creditsPerWorker = Math.max(50, Math.floor(totalCredits / units.length));

  let perWorkerConcurrency = 1;
  try {
    const fc = createFirecrawlClient({ maxConcurrency: 1 });
    const res = await fetch("https://api.firecrawl.dev/v2/concurrency-check", { headers: { Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}` } });
    const json = (await res.json()) as { maxConcurrency?: number };
    perWorkerConcurrency = Math.max(1, Math.floor((json.maxConcurrency ?? 2) / maxWorkers));
    void fc;
  } catch {
    /* default 1 */
  }

  const common = [
    "--mode", values.mode!,
    "--max-credits", String(creditsPerWorker),
    ...(values.kinds ? ["--kinds", values.kinds] : []),
    ...(values["max-pages"] ? ["--max-pages", values["max-pages"]] : []),
    ...(values["max-profiles"] ? ["--max-profiles", values["max-profiles"]] : []),
    ...(values["max-search"] ? ["--max-search", values["max-search"]] : []),
    ...(values["dry-run"] ? ["--dry-run"] : []),
  ];

  const script = path.join(path.dirname(new URL(import.meta.url).pathname), "scraper.ts");
  const commands = units.map((u) => ({
    unit: u,
    argv: [script, "run", ...u.args, ...common, "--out", path.join(values["out-dir"]!, `${u.id}.jsonl`)],
  }));

  log.info(`dispatching ${units.length} work units with up to ${maxWorkers} concurrent workers (${perWorkerConcurrency} Firecrawl slots each, ${creditsPerWorker} credits each)`);
  for (const c of commands) process.stdout.write(`  FIRECRAWL_MAX_CONCURRENCY=${perWorkerConcurrency} SCRAPER_WORKER_ID=${c.unit.id} npx tsx ${c.argv.join(" ")}\n`);
  if (values.print) return;

  const queue = [...commands];
  const results: Array<{ id: string; code: number | null }> = [];

  await new Promise<void>((resolve) => {
    let running = 0;
    const next = () => {
      if (queue.length === 0 && running === 0) return resolve();
      while (running < maxWorkers && queue.length > 0) {
        const cmd = queue.shift()!;
        running++;
        const child = spawn(process.execPath, ["--import", "tsx", ...cmd.argv], {
          stdio: "inherit",
          env: {
            ...process.env,
            SCRAPER_WORKER_ID: cmd.unit.id,
            FIRECRAWL_MAX_CONCURRENCY: String(perWorkerConcurrency),
          },
        });
        child.on("exit", (code) => {
          running--;
          results.push({ id: cmd.unit.id, code });
          log.info(`worker ${cmd.unit.id} exited with ${code}`);
          next();
        });
      }
    };
    next();
  });

  const failed = results.filter((r) => r.code !== 0);
  process.stdout.write(`\n${JSON.stringify({ workers: results.length, failed: failed.map((f) => f.id) }, null, 2)}\n`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  log.error(String(error));
  process.exit(1);
});
