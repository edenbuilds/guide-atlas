import type { Prisma, TourGuide } from "@prisma/client";
import { decodeList, encodeList, type GuideRecord } from "./guide-schema";

/**
 * Maps a validated scraper `GuideRecord` onto the Prisma `TourGuide` row shape, merging with an
 * existing row when the fingerprint is already known.
 *
 * Merge policy: never overwrite a known value with null, union list fields, keep the higher
 * confidence, let a confirmed WhatsApp number win over an unconfirmed one, and let any concrete
 * vehicle class beat "Unknown".
 */
function union(a: string | null | undefined, b: readonly string[]): string {
  return encodeList([...decodeList(a), ...b]);
}

export function mergeInto(existing: TourGuide | undefined, incoming: GuideRecord): Prisma.TourGuideUncheckedCreateInput {
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

