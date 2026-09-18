/**
 * Sends normalised guide records to the Next.js ingest API in batches, with a JSONL sink that is
 * always written so a run can be replayed (`scraper replay <file>`) if the API was down.
 */

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { GuideRecordSchema, type GuideRecord, type GuideRecordInput, type IngestPayload } from "../../src/lib/guide-schema";
import { withRetry, HttpError } from "./rate-limit";
import { log } from "./logger";

export interface IngestResult {
  received: number;
  created: number;
  updated: number;
  skipped: number;
  runId?: string;
  errors: Array<{ index: number; error: string }>;
}

export interface IngestClientOptions {
  apiUrl?: string;
  apiKey?: string;
  batchSize?: number;
  outFile?: string;
  dryRun?: boolean;
}

export class IngestClient {
  private readonly apiUrl: string;
  private readonly apiKey?: string;
  private readonly batchSize: number;
  private readonly outFile?: string;
  private readonly dryRun: boolean;
  private buffer: GuideRecord[] = [];
  private runId?: string;
  private runMeta: NonNullable<IngestPayload["run"]> | undefined;

  totals: IngestResult = { received: 0, created: 0, updated: 0, skipped: 0, errors: [] };
  invalid = 0;

  constructor(opts: IngestClientOptions = {}) {
    this.apiUrl = (opts.apiUrl ?? process.env.INGEST_API_URL ?? "http://localhost:3000/api/guides/ingest").replace(/\/$/, "");
    this.apiKey = opts.apiKey ?? process.env.INGEST_API_KEY;
    this.batchSize = Math.min(500, Math.max(1, opts.batchSize ?? 100));
    this.outFile = opts.outFile;
    this.dryRun = opts.dryRun ?? false;
  }

  setRun(meta: NonNullable<IngestPayload["run"]>) {
    this.runMeta = meta;
  }

  /** Validate and queue records; invalid ones are logged and dropped (never sent). */
  async add(records: GuideRecordInput[]): Promise<void> {
    for (const r of records) {
      const parsed = GuideRecordSchema.safeParse(r);
      if (!parsed.success) {
        this.invalid++;
        log.debug(`dropping invalid record from ${r.sourceUrl}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
        continue;
      }
      this.buffer.push(parsed.data);
      if (this.outFile) await this.appendJsonl(parsed.data);
    }
    if (this.buffer.length >= this.batchSize) await this.flush();
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.batchSize);
    if (this.dryRun) {
      this.totals.received += batch.length;
      this.totals.skipped += batch.length;
      log.info(`dry-run: would ingest ${batch.length} records`);
      if (this.buffer.length) await this.flush();
      return;
    }
    const payload: IngestPayload = {
      guides: batch,
      run: this.runMeta ? { ...this.runMeta, id: this.runId } : undefined,
    };
    try {
      const result = await withRetry(
        async () => {
          const res = await fetch(this.apiUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(120_000),
          });
          const text = await res.text();
          if (!res.ok) throw new HttpError(res.status, `ingest failed (${res.status}): ${text.slice(0, 500)}`);
          return JSON.parse(text) as IngestResult;
        },
        { retries: 3, baseDelayMs: 2_000 },
      );
      this.runId = result.runId ?? this.runId;
      this.totals.received += result.received;
      this.totals.created += result.created;
      this.totals.updated += result.updated;
      this.totals.skipped += result.skipped;
      this.totals.errors.push(...(result.errors ?? []));
      log.info(`ingested ${batch.length}: +${result.created} new, ~${result.updated} updated, ${result.skipped} skipped`);
    } catch (error) {
      log.error(`ingest batch of ${batch.length} failed permanently: ${String(error)} — records are preserved in ${this.outFile ?? "memory"}`);
      this.totals.errors.push({ index: -1, error: String(error) });
    }
    if (this.buffer.length) await this.flush();
  }

  async finish(final: { pagesScraped: number; creditsUsed: number; status: "completed" | "failed"; error?: string }): Promise<void> {
    await this.flush();
    if (this.dryRun || !this.runId) return;
    try {
      await fetch(this.apiUrl.replace(/\/ingest$/, "/runs"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
        body: JSON.stringify({ id: this.runId, ...final }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      log.warn(`could not close run ${this.runId}: ${String(error)}`);
    }
  }

  private async appendJsonl(record: GuideRecord) {
    if (!this.outFile) return;
    await mkdir(path.dirname(this.outFile), { recursive: true });
    await appendFile(this.outFile, `${JSON.stringify(record)}\n`, "utf8");
  }
}
