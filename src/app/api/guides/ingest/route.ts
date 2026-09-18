import { NextResponse, type NextRequest } from "next/server";
import type { Prisma, TourGuide } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { IngestPayloadSchema, encodeList, decodeList, type GuideRecord } from "@/lib/guide-schema";

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

function union(a: string | null | undefined, b: readonly string[]): string {
  return encodeList([...decodeList(a), ...b]);
}

function mergeInto(existing: TourGuide | undefined, incoming: GuideRecord): Prisma.TourGuideUncheckedCreateInput {
  const pick = <T>(next: T | null | undefined, prev: T | null | undefined): T | null => (next ?? prev ?? null);
  const whatsappConfirmed = Boolean(incoming.whatsappConfirmed || existing?.whatsappConfirmed);
  const whatsapp =
    incoming.whatsappConfirmed && incoming.whatsapp ? incoming.whatsapp : existing?.whatsappConfirmed && existing.whatsapp ? existing.whatsapp : pick(incoming.whatsapp, existing?.whatsapp);

  const evidence = {
    ...(existing?.evidence ? safeJson<Record<string, string[]>>(existing.evidence) : {}),
    ...(incoming.evidence ?? {}),
  };

  return {
    fingerprint: incoming.fingerprint,
    fullName: incoming.fullName || existing?.fullName || "Unknown",
    companyName: pick(incoming.companyName, existing?.companyName),
    email: pick(incoming.email, existing?.email),
    phone: pick(incoming.phone, existing?.phone),
    whatsapp,
    whatsappConfirmed,
    website: pick(incoming.website, existing?.website),
    contactPageUrl: pick(incoming.contactPageUrl, existing?.contactPageUrl),
    country: incoming.country || existing?.country || "Unknown",
    countryCode: pick(incoming.countryCode, existing?.countryCode),
    city: pick(incoming.city, existing?.city),
    region: pick(incoming.region, existing?.region),
    vehicleType: preferSpecific(incoming.vehicleType, existing?.vehicleType),
    vehicleDetails: pick(incoming.vehicleDetails, existing?.vehicleDetails),
    vehicleCapacity: pick(incoming.vehicleCapacity, existing?.vehicleCapacity),
    services: union(existing?.services, incoming.services),
    languages: union(existing?.languages, incoming.languages),
    clientExperience: union(existing?.clientExperience, incoming.clientExperience),
    isIndependent: existing ? existing.isIndependent && incoming.isIndependent : incoming.isIndependent,
    worksWithCouples: pick(incoming.worksWithCouples, existing?.worksWithCouples),
    smallGroupCapable: pick(incoming.smallGroupCapable, existing?.smallGroupCapable),
    isTourManager: pick(incoming.isTourManager, existing?.isTourManager),
    licensed: pick(incoming.licensed, existing?.licensed),
    yearsExperience: Math.max(incoming.yearsExperience ?? 0, existing?.yearsExperience ?? 0) || null,
    bio: incoming.bio && (!existing?.bio || incoming.bio.length > existing.bio.length) ? incoming.bio : (existing?.bio ?? null),
    sourceUrl: incoming.sourceUrl,
    sourceDomain: incoming.sourceDomain,
    sourceType: pick(incoming.sourceType, existing?.sourceType),
    confidence: Math.max(incoming.confidence, existing?.confidence ?? 0),
    evidence: Object.keys(evidence).length ? JSON.stringify(evidence) : null,
    rawJson: incoming.rawJson !== undefined ? JSON.stringify(incoming.rawJson) : (existing?.rawJson ?? null),
    scrapedAt: incoming.scrapedAt ?? new Date(),
  };
}

/** "Unknown" is the weakest vehicle class; any concrete class beats it. */
function preferSpecific(next: string | null | undefined, prev: string | null | undefined): string | null {
  if (next && next !== "Unknown") return next;
  if (prev && prev !== "Unknown") return prev;
  return next ?? prev ?? null;
}

function safeJson<T>(s: string): T | Record<string, never> {
  try {
    return JSON.parse(s) as T;
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

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
      for (const g of chunk) existing.has(g.fingerprint) ? updated++ : created++;
    } catch (error) {
      // Fall back to row-by-row so one bad record cannot sink the chunk.
      for (const [j, g] of chunk.entries()) {
        try {
          const data = mergeInto(existing.get(g.fingerprint), g);
          await prisma.tourGuide.upsert({ where: { fingerprint: g.fingerprint }, create: data, update: data });
          existing.has(g.fingerprint) ? updated++ : created++;
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
