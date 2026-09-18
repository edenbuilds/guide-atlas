import { z } from "zod";

/**
 * Shared contract between the scraper (producer) and the ingest API (consumer).
 * Anything the scraper emits MUST validate against `GuideRecordSchema`, and every
 * field here maps 1:1 onto a column of the Prisma `TourGuide` model
 * (array fields are JSON-encoded at the persistence boundary).
 */

export const VEHICLE_TYPES = [
  "Sedan",
  "SUV",
  "Minivan",
  "Minibus",
  "Coach",
  "Motorcycle",
  "None",
  "Unknown",
] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const SERVICE_TYPES = [
  "Driver",
  "Guide",
  "Driver-Guide",
  "Tour Manager",
  "Transfer",
  "Interpreter",
] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const CLIENT_NATIONALITIES = [
  "Indian",
  "American",
  "Chinese",
  "British",
  "Australian",
  "Canadian",
  "Singaporean",
  "Malaysian",
  "Middle Eastern",
  "Japanese",
  "Korean",
  "European",
  "International",
] as const;
export type ClientNationality = (typeof CLIENT_NATIONALITIES)[number];

export const SOURCE_TYPES = [
  "directory",
  "marketplace",
  "forum",
  "classified",
  "personal-site",
  "search",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

const nullableString = z
  .string()
  .trim()
  .max(2000)
  .nullable()
  .optional()
  .transform((v) => (v === undefined || v === "" ? null : v));

export const GuideRecordSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  companyName: nullableString,

  email: z
    .email()
    .trim()
    .toLowerCase()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  phone: nullableString, // E.164 expected
  whatsapp: nullableString, // E.164 expected
  whatsappConfirmed: z.boolean().default(false),
  website: nullableString,
  contactPageUrl: nullableString,

  country: z.string().trim().min(2).max(100),
  countryCode: z
    .string()
    .trim()
    .length(2)
    .toUpperCase()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  city: nullableString,
  region: nullableString,

  vehicleType: z.enum(VEHICLE_TYPES).nullable().optional().transform((v) => v ?? null),
  vehicleDetails: nullableString,
  vehicleCapacity: z.number().int().min(1).max(100).nullable().optional().transform((v) => v ?? null),

  services: z.array(z.enum(SERVICE_TYPES)).default([]),
  languages: z.array(z.string().trim().min(1).max(50)).default([]),
  clientExperience: z.array(z.enum(CLIENT_NATIONALITIES)).default([]),
  isIndependent: z.boolean().default(true),
  worksWithCouples: z.boolean().nullable().optional().transform((v) => v ?? null),
  smallGroupCapable: z.boolean().nullable().optional().transform((v) => v ?? null),
  isTourManager: z.boolean().nullable().optional().transform((v) => v ?? null),
  licensed: z.boolean().nullable().optional().transform((v) => v ?? null),
  yearsExperience: z.number().int().min(0).max(80).nullable().optional().transform((v) => v ?? null),
  bio: z
    .string()
    .trim()
    .max(4000)
    .nullable()
    .optional()
    .transform((v) => v ?? null),

  sourceUrl: z.url().trim(),
  sourceDomain: z.string().trim().min(1),
  sourceType: z.enum(SOURCE_TYPES).nullable().optional().transform((v) => v ?? null),
  confidence: z.number().min(0).max(1).default(0.5),
  evidence: z.record(z.string(), z.array(z.string())).optional(),
  rawJson: z.unknown().optional(),

  fingerprint: z.string().trim().min(8).max(64),
  scrapedAt: z.coerce.date().optional(),
});

export type GuideRecord = z.infer<typeof GuideRecordSchema>;
export type GuideRecordInput = z.input<typeof GuideRecordSchema>;

export const IngestPayloadSchema = z.object({
  guides: z.array(GuideRecordSchema).min(1).max(500),
  run: z
    .object({
      id: z.string().optional(),
      region: z.string().nullable().optional(),
      mode: z.enum(["llm", "regex"]).default("llm"),
      targetUrls: z.array(z.string()).default([]),
      pagesScraped: z.number().int().min(0).default(0),
      creditsUsed: z.number().int().min(0).default(0),
    })
    .optional(),
});
export type IngestPayload = z.infer<typeof IngestPayloadSchema>;

/** Convert an array field to its JSON-encoded DB representation. */
export function encodeList(values: readonly string[]): string {
  return JSON.stringify(Array.from(new Set(values.map((v) => v.trim()).filter(Boolean))));
}

/** Parse a JSON-encoded list column, tolerating legacy comma-separated values. */
export function decodeList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    /* fall through */
  }
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}
