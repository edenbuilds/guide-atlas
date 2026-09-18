import type { Prisma, TourGuide } from "@prisma/client";
import { z } from "zod";
import { CLIENT_NATIONALITIES, SERVICE_TYPES, VEHICLE_TYPES, decodeList } from "./guide-schema";

/**
 * Shared filter parsing for the dashboard page, the JSON API and the CSV export so every surface
 * applies identical semantics to the same URL parameters.
 */

export const SORT_FIELDS = ["scrapedAt", "confidence", "fullName", "country", "yearsExperience"] as const;

export const GuideFiltersSchema = z.object({
  q: z.string().trim().max(200).optional(),
  country: z.array(z.string().trim().min(1)).default([]),
  vehicle: z.array(z.enum(VEHICLE_TYPES)).default([]),
  client: z.array(z.enum(CLIENT_NATIONALITIES)).default([]),
  service: z.array(z.enum(SERVICE_TYPES)).default([]),
  whatsapp: z.enum(["any", "confirmed", "has"]).default("any"),
  contact: z.enum(["any", "direct"]).default("any"),
  independent: z.enum(["any", "yes", "no"]).default("any"),
  minConfidence: z.coerce.number().min(0).max(1).default(0),
  sort: z.enum(SORT_FIELDS).default("scrapedAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
});
export type GuideFilters = z.infer<typeof GuideFiltersSchema>;

type SearchParamsLike = Record<string, string | string[] | undefined> | URLSearchParams;

function getAll(sp: SearchParamsLike, key: string): string[] {
  if (sp instanceof URLSearchParams) return sp.getAll(key).flatMap((v) => v.split(",")).filter(Boolean);
  const v = sp[key];
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).flatMap((x) => x.split(",")).filter(Boolean);
}

function getOne(sp: SearchParamsLike, key: string): string | undefined {
  if (sp instanceof URLSearchParams) return sp.get(key) ?? undefined;
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

export function parseGuideFilters(sp: SearchParamsLike): GuideFilters {
  const raw = {
    q: getOne(sp, "q"),
    country: getAll(sp, "country"),
    vehicle: getAll(sp, "vehicle"),
    client: getAll(sp, "client"),
    service: getAll(sp, "service"),
    whatsapp: getOne(sp, "whatsapp"),
    contact: getOne(sp, "contact"),
    independent: getOne(sp, "independent"),
    minConfidence: getOne(sp, "minConfidence"),
    sort: getOne(sp, "sort"),
    dir: getOne(sp, "dir"),
    page: getOne(sp, "page"),
    pageSize: getOne(sp, "pageSize"),
  };
  const parsed = GuideFiltersSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  // Drop invalid enum values instead of failing the whole page.
  return GuideFiltersSchema.parse({
    ...raw,
    vehicle: raw.vehicle.filter((v) => (VEHICLE_TYPES as readonly string[]).includes(v)),
    client: raw.client.filter((v) => (CLIENT_NATIONALITIES as readonly string[]).includes(v)),
    service: raw.service.filter((v) => (SERVICE_TYPES as readonly string[]).includes(v)),
    whatsapp: ["any", "confirmed", "has"].includes(raw.whatsapp ?? "") ? raw.whatsapp : undefined,
    contact: ["any", "direct"].includes(raw.contact ?? "") ? raw.contact : undefined,
    independent: ["any", "yes", "no"].includes(raw.independent ?? "") ? raw.independent : undefined,
    sort: (SORT_FIELDS as readonly string[]).includes(raw.sort ?? "") ? raw.sort : undefined,
    dir: ["asc", "desc"].includes(raw.dir ?? "") ? raw.dir : undefined,
    minConfidence: undefined,
    page: undefined,
    pageSize: undefined,
  });
}

/** JSON-encoded list columns are matched with a `contains` on the quoted value. */
function listContains(field: "clientExperience" | "services", values: string[]): Prisma.TourGuideWhereInput {
  return { OR: values.map((v) => ({ [field]: { contains: `"${v}"` } })) };
}

export function buildWhere(f: GuideFilters): Prisma.TourGuideWhereInput {
  const and: Prisma.TourGuideWhereInput[] = [];

  if (f.q) {
    const q = f.q;
    and.push({
      OR: [
        { fullName: { contains: q } },
        { companyName: { contains: q } },
        { city: { contains: q } },
        { region: { contains: q } },
        { email: { contains: q } },
        { phone: { contains: q } },
        { whatsapp: { contains: q } },
        { languages: { contains: q } },
        { bio: { contains: q } },
        { sourceDomain: { contains: q } },
      ],
    });
  }
  if (f.country.length) and.push({ OR: [{ country: { in: f.country } }, { countryCode: { in: f.country.map((c) => c.toUpperCase()) } }] });
  if (f.vehicle.length) and.push({ vehicleType: { in: f.vehicle } });
  if (f.client.length) and.push(listContains("clientExperience", f.client));
  if (f.service.length) and.push(listContains("services", f.service));
  if (f.whatsapp === "confirmed") and.push({ whatsappConfirmed: true });
  if (f.whatsapp === "has") and.push({ whatsapp: { not: null } });
  if (f.contact === "direct") and.push({ OR: [{ whatsapp: { not: null } }, { phone: { not: null } }, { email: { not: null } }] });
  if (f.independent === "yes") and.push({ isIndependent: true });
  if (f.independent === "no") and.push({ isIndependent: false });
  if (f.minConfidence > 0) and.push({ confidence: { gte: f.minConfidence } });

  return and.length ? { AND: and } : {};
}

export function buildOrderBy(f: GuideFilters): Prisma.TourGuideOrderByWithRelationInput[] {
  const primary = { [f.sort]: f.dir } as Prisma.TourGuideOrderByWithRelationInput;
  return f.sort === "scrapedAt" ? [primary, { id: "asc" }] : [primary, { scrapedAt: "desc" }];
}

/** Serialisable view model with list columns decoded. */
export type GuideView = Omit<TourGuide, "services" | "languages" | "clientExperience" | "evidence" | "rawJson" | "scrapedAt" | "createdAt" | "updatedAt"> & {
  services: string[];
  languages: string[];
  clientExperience: string[];
  evidence: Record<string, string[]> | null;
  scrapedAt: string;
  createdAt: string;
  updatedAt: string;
};

export function toGuideView(g: TourGuide): GuideView {
  let evidence: Record<string, string[]> | null = null;
  if (g.evidence) {
    try {
      evidence = JSON.parse(g.evidence);
    } catch {
      evidence = null;
    }
  }
  const { rawJson: _rawJson, ...rest } = g;
  void _rawJson;
  return {
    ...rest,
    services: decodeList(g.services),
    languages: decodeList(g.languages),
    clientExperience: decodeList(g.clientExperience),
    evidence,
    scrapedAt: g.scrapedAt.toISOString(),
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
  };
}

export function filtersToSearchParams(f: Partial<GuideFilters>): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.q) sp.set("q", f.q);
  for (const c of f.country ?? []) sp.append("country", c);
  for (const v of f.vehicle ?? []) sp.append("vehicle", v);
  for (const c of f.client ?? []) sp.append("client", c);
  for (const s of f.service ?? []) sp.append("service", s);
  if (f.whatsapp && f.whatsapp !== "any") sp.set("whatsapp", f.whatsapp);
  if (f.contact && f.contact !== "any") sp.set("contact", f.contact);
  if (f.independent && f.independent !== "any") sp.set("independent", f.independent);
  if (f.minConfidence) sp.set("minConfidence", String(f.minConfidence));
  if (f.sort && f.sort !== "scrapedAt") sp.set("sort", f.sort);
  if (f.dir && f.dir !== "desc") sp.set("dir", f.dir);
  if (f.page && f.page > 1) sp.set("page", String(f.page));
  if (f.pageSize && f.pageSize !== 50) sp.set("pageSize", String(f.pageSize));
  return sp;
}
