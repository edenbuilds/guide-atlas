import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { IngestPayloadSchema, type GuideRecord } from "@/lib/guide-schema";
import { mergeInto } from "@/lib/guide-merge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/guides/ingest
 *
 * Accepts `{ guides: GuideRecord[], run?: {...} }` from the scraper and upserts by `fingerprint`.
 * Merge policy for existing rows: never overwrite a known value with null, union list fields,
 * keep the higher confidence, and let a confirmed WhatsApp number win over an unconfirmed one.
 */

function authorized(req: NextRequest): boolean {
  const required = process.env.INGEST_API_KEY;
  if (!required) return true;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${required}`;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return await handleIngest(req);
  } catch (error) {
    console.error("[ingest] unhandled error", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "internal error" }, { status: 500 });
  }
}

async function handleIngest(req: NextRequest) {

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = IngestPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation failed", issues: parsed.error.issues.slice(0, 50).map((i) => ({ path: i.path.join("."), message: i.message })) },
      { status: 422 },
    );
  }

  const { guides, run } = parsed.data;

  // De-duplicate inside the batch (same fingerprint twice → keep the higher-confidence one).
  const byFingerprint = new Map<string, GuideRecord>();
  for (const g of guides) {
    const prev = byFingerprint.get(g.fingerprint);
    if (!prev || g.confidence >= prev.confidence) byFingerprint.set(g.fingerprint, g);
  }
  const unique = Array.from(byFingerprint.values());

  const existingRows = await prisma.tourGuide.findMany({ where: { fingerprint: { in: unique.map((g) => g.fingerprint) } } });
  const existing = new Map(existingRows.map((r) => [r.fingerprint, r]));

  let created = 0;
  let updated = 0;
  const errors: Array<{ index: number; error: string }> = [];

  // Chunked transactions keep SQLite lock time short while staying atomic per chunk.
  const CHUNK = 50;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    try {
      await prisma.$transaction(
        chunk.map((g) => {
          const data = mergeInto(existing.get(g.fingerprint), g);
          return prisma.tourGuide.upsert({ where: { fingerprint: g.fingerprint }, create: data, update: data });
        }),
      );
      for (const g of chunk) {
        if (existing.has(g.fingerprint)) updated++;
        else created++;
      }
    } catch (error) {
      // Fall back to row-by-row so one bad record cannot sink the chunk.
      for (const [j, g] of chunk.entries()) {
        try {
          const data = mergeInto(existing.get(g.fingerprint), g);
          await prisma.tourGuide.upsert({ where: { fingerprint: g.fingerprint }, create: data, update: data });
          if (existing.has(g.fingerprint)) updated++;
          else created++;
        } catch (rowError) {
          errors.push({ index: i + j, error: rowError instanceof Error ? rowError.message : String(rowError ?? error) });
        }
      }
    }
  }

  let runId: string | undefined = run?.id;
  if (run) {
    const increments = { guidesFound: { increment: guides.length }, guidesUpserted: { increment: created + updated } };
    if (runId) {
      await prisma.scrapeRun
        .update({ where: { id: runId }, data: { ...increments, pagesScraped: run.pagesScraped || undefined, creditsUsed: run.creditsUsed || undefined } })
        .catch(() => undefined);
    } else {
      const createdRun = await prisma.scrapeRun.create({
        data: {
          region: run.region ?? null,
          mode: run.mode,
          targetUrls: JSON.stringify(run.targetUrls),
          pagesScraped: run.pagesScraped,
          creditsUsed: run.creditsUsed,
          guidesFound: guides.length,
          guidesUpserted: created + updated,
        },
      });
      runId = createdRun.id;
    }
  }

  return NextResponse.json({
    received: guides.length,
    created,
    updated,
    skipped: guides.length - unique.length + errors.length,
    runId,
    errors,
  });
}
