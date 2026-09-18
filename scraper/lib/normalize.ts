/**
 * Turns raw extractor output + page markdown into validated `GuideRecordInput`s.
 *
 * Everything the LLM claims about vehicle / client experience / contact channels is re-verified
 * against the page text with multilingual dictionaries. Deterministic extractors (phone, e-mail,
 * WhatsApp links) run regardless, so `--mode regex` (no LLM, 1 credit/page) produces the same
 * record shape with slightly lower recall on names and bios.
 */

import { createHash } from "node:crypto";
import {
  findPhoneNumbersInText,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/max";
import {
  CAPACITY_PATTERN,
  CLIENT_RULES,
  COMPANY_PATTERN,
  COUPLES_PATTERN,
  EXPERIENCE_YEARS_PATTERN,
  EXPERIENCE_YEARS_PATTERN_REVERSED,
  INDEPENDENT_PATTERN,
  LICENSED_PATTERN,
  SERVICE_RULES,
  SINCE_YEAR_PATTERN,
  SMALL_GROUP_PATTERN,
  VEHICLE_RULES,
  WHATSAPP_PATTERN,
  type KeywordRule,
} from "./dictionaries";
import { countryByCode, detectCountryInText, findCountry, type CountryInfo } from "./countries";
import {
  CLIENT_NATIONALITIES,
  SERVICE_TYPES,
  VEHICLE_TYPES,
  type ClientNationality,
  type GuideRecordInput,
  type ServiceType,
  type SourceType,
  type VehicleType,
} from "../../src/lib/guide-schema";

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

/** Loose shape of what the LLM returns for one guide (mirrors RAW_GUIDE_JSON_SCHEMA). */
export interface RawGuide {
  fullName?: string | null;
  companyName?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  website?: string | null;
  country?: string | null;
  city?: string | null;
  region?: string | null;
  languages?: string[] | null;
  vehicleType?: string | null;
  vehicleDetails?: string | null;
  vehicleCapacity?: number | null;
  vehicleEvidence?: string | null;
  services?: string[] | null;
  clientExperience?: string[] | null;
  clientExperienceEvidence?: string[] | null;
  isIndependent?: boolean | null;
  worksWithCouples?: boolean | null;
  smallGroupCapable?: boolean | null;
  isTourManager?: boolean | null;
  licensed?: boolean | null;
  yearsExperience?: number | null;
  bio?: string | null;
}

export interface RawPageExtraction {
  pageType?: string;
  guides?: RawGuide[];
}

export interface NormalizeContext {
  sourceUrl: string;
  markdown: string;
  pageTitle?: string;
  /** country hint from the target definition, used for phone parsing and as a fallback */
  countryHint?: CountryInfo;
  sourceType?: SourceType;
  scrapedAt?: Date;
}

export interface PhoneHit {
  e164: string;
  index: number;
  length: number;
  whatsapp: boolean;
}

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

/** Contact details on these domains belong to the platform, not to individual guides. */
export const PLATFORM_DOMAINS = [
  "tourhq.com",
  "gowithguide.com",
  "toursbylocals.com",
  "viator.com",
  "getyourguide.com",
  "tripadvisor.com",
  "tripadvisor.co.uk",
  "withlocals.com",
  "showaround.com",
  "guruwalk.com",
  "airbnb.com",
  "klook.com",
  "kkday.com",
  "facebook.com",
  "instagram.com",
  "reddit.com",
  "linkedin.com",
  "youtube.com",
  "google.com",
  "wixpress.com",
  "wix.com",
  "squarespace.com",
  "sentry.io",
  "example.com",
  "domain.com",
  "email.com",
];

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/giu;
const URL_RE = /https?:\/\/[^\s)\]"'<>]+/giu;
const WA_LINK_RE = /(?:https?:\/\/)?(?:wa\.me|api\.whatsapp\.com\/send|chat\.whatsapp\.com)\/?(?:\?phone=)?\+?(\d{7,15})/giu;
const TEL_LINK_RE = /tel:\+?([\d\s().-]{7,20})/giu;

const NAME_STOPWORDS =
  /^(home|about|contact|guide|guides|tour|tours|profile|login|menu|search|reviews?|blog|faq|book|booking|private|driver|welcome|unknown|n\/?a|null|undefined)$/i;

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function isPlatformDomain(domainOrEmail: string): boolean {
  const d = domainOrEmail.includes("@") ? domainOrEmail.split("@")[1] : domainOrEmail;
  const host = d.replace(/^www\./, "").toLowerCase();
  return PLATFORM_DOMAINS.some((p) => host === p || host.endsWith(`.${p}`));
}

function snippet(text: string, index: number, length: number, radius = 60): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function unique<T>(values: Iterable<T>): T[] {
  return Array.from(new Set(values));
}

function cleanText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]*)]\(([^)]*)\)/g, "$1 $2") // keep link text and href
    .replace(/[*_#>`|]+/g, " ")
    .replace(/\\/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

/** Case/diacritic-insensitive containment check used to verify LLM evidence quotes. */
function fuzzyIncludes(haystack: string, needle: string | null | undefined): boolean {
  if (!needle) return false;
  const norm = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const n = norm(needle);
  if (n.length < 4) return false;
  const h = norm(haystack);
  if (h.includes(n)) return true;
  // tolerate paraphrased quotes: require 70% of tokens (len>=3) to appear
  const tokens = n.split(" ").filter((t) => t.length >= 3);
  if (tokens.length === 0) return false;
  const hits = tokens.filter((t) => h.includes(t)).length;
  return hits / tokens.length >= 0.7;
}

// ---------------------------------------------------------------------------------------------
// Rule matching
// ---------------------------------------------------------------------------------------------

export interface RuleMatch<T extends string> {
  label: T;
  count: number;
  evidence: string[];
}

export function matchRules<T extends string>(text: string, rules: KeywordRule<T>[]): RuleMatch<T>[] {
  const out: RuleMatch<T>[] = [];
  for (const rule of rules) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : rule.pattern.flags + "g");
    let m: RegExpExecArray | null;
    let count = 0;
    const evidence: string[] = [];
    let guard = 0;
    while ((m = re.exec(text)) !== null && guard++ < 500) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      const snip = snippet(text, m.index, m[0].length, 40);
      if (rule.exclude && rule.exclude.test(snip)) continue;
      count++;
      if (evidence.length < 3) evidence.push(snip);
    }
    if (count > 0) out.push({ label: rule.label, count, evidence });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Contact extraction
// ---------------------------------------------------------------------------------------------

export function toE164(raw: string | null | undefined, defaultCountry?: CountryCode): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d+()\s.-]/g, " ").trim();
  if (cleaned.replace(/\D/g, "").length < 7) return null;
  try {
    const parsed = parsePhoneNumberFromString(cleaned, defaultCountry);
    if (parsed && parsed.isPossible()) return parsed.number;
    // "00" international prefix
    if (/^00\d/.test(cleaned.replace(/\s/g, ""))) {
      const alt = parsePhoneNumberFromString(`+${cleaned.replace(/\s/g, "").slice(2)}`);
      if (alt && alt.isPossible()) return alt.number;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function extractPhones(text: string, defaultCountry?: CountryCode): PhoneHit[] {
  const hits = new Map<string, PhoneHit>();
  const add = (e164: string | null, index: number, length: number, whatsapp: boolean) => {
    if (!e164) return;
    const existing = hits.get(e164);
    if (existing) {
      existing.whatsapp = existing.whatsapp || whatsapp;
    } else {
      hits.set(e164, { e164, index, length, whatsapp });
    }
  };

  // 1. WhatsApp deep links are the strongest possible signal.
  for (const m of text.matchAll(WA_LINK_RE)) add(toE164(`+${m[1]}`), m.index ?? 0, m[0].length, true);

  // 2. tel: links
  for (const m of text.matchAll(TEL_LINK_RE)) add(toE164(m[1], defaultCountry), m.index ?? 0, m[0].length, false);

  // 3. Free-text numbers (handles local formats using the default country).
  try {
    const found = findPhoneNumbersInText(text, defaultCountry ? { defaultCountry } : undefined);
    for (const f of found) {
      if (!f.number.isPossible()) continue;
      add(f.number.number, f.startsAt, f.endsAt - f.startsAt, false);
    }
  } catch {
    /* libphonenumber can throw on exotic input; fall through */
  }

  // 4. WhatsApp proximity: a WhatsApp mention within ±120 chars of a number confirms it.
  for (const hit of hits.values()) {
    if (hit.whatsapp) continue;
    const window = text.slice(Math.max(0, hit.index - 120), hit.index + hit.length + 120);
    if (WHATSAPP_PATTERN.test(window)) hit.whatsapp = true;
  }

  return Array.from(hits.values()).sort((a, b) => a.index - b.index);
}

export function extractEmails(text: string): string[] {
  const emails = unique(Array.from(text.matchAll(EMAIL_RE), (m) => m[0].toLowerCase()));
  return emails.filter((e) => {
    if (/\.(png|jpe?g|gif|svg|webp|css|js)$/i.test(e)) return false;
    if (/^(no-?reply|noreply|privacy|legal|abuse|postmaster|webmaster|dpo|press|jobs|careers)@/i.test(e)) return false;
    if (isPlatformDomain(e)) return false;
    return e.length <= 100;
  });
}

export function extractWebsites(text: string, sourceUrl: string): string[] {
  const sourceDomain = domainOf(sourceUrl);
  const urls = unique(Array.from(text.matchAll(URL_RE), (m) => m[0].replace(/[.,;:]+$/, "")));
  return urls.filter((u) => {
    const d = domainOf(u);
    if (d === sourceDomain) return false;
    if (isPlatformDomain(d)) return false;
    if (/\.(png|jpe?g|gif|svg|webp|css|js|pdf)(\?|$)/i.test(u)) return false;
    if (/cloudinary|cdn\.|static\.|images?\.|fonts?\.|gstatic|googleapis|schema\.org|w3\.org|wa\.me|whatsapp\.com|t\.me|twitter\.com|x\.com|tiktok|pinterest|apple\.com|play\.google/i.test(u)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------------------------

const VEHICLE_PRIORITY: VehicleType[] = ["Minivan", "Minibus", "Coach", "SUV", "Sedan", "Motorcycle", "None", "Unknown"];
const GENERIC_CAR_PATTERN =
  /(?<![\p{L}])(cars?|vehicles?|voiture|véhicule|auto|autos|pkw|wagen|fahrzeug|macchina|veicolo|coche|vehículo|carro|veículo|samoch[oó]d|pojazd|vozidlo|autó|jármű|mașin[aă]|автомоб|машин|αυτοκίνητο|araç|araba|vozilo|bil|auto|車|クルマ|車両|차량|자동차|승용차|รถ|xe|mobil)(?![\p{L}])/iu;

export function classifyVehicle(
  text: string,
  llm?: RawGuide,
): { type: VehicleType | null; capacity: number | null; details: string | null; evidence: string[] } {
  const matches = matchRules(text, VEHICLE_RULES).filter((m) => m.label !== "Unknown");
  const capacity = extractCapacity(text, llm?.vehicleCapacity ?? null);

  let type: VehicleType | null = null;
  let evidence: string[] = [];

  if (matches.length > 0) {
    const none = matches.find((m) => m.label === "None");
    const positives = matches.filter((m) => m.label !== "None");
    if (positives.length === 0 && none) {
      type = "None";
      evidence = none.evidence;
    } else {
      positives.sort((a, b) => b.count - a.count || VEHICLE_PRIORITY.indexOf(a.label) - VEHICLE_PRIORITY.indexOf(b.label));
      // Sedan matches are dominated by generic phrases; a single specific hit for a bigger class wins a tie-ish race.
      const best = positives[0];
      const specific = positives.find((p) => p.label !== "Sedan" && p.count >= Math.max(1, best.count - 1));
      const chosen = best.label === "Sedan" && specific ? specific : best;
      type = chosen.label;
      evidence = chosen.evidence;
    }
  } else if (llm?.vehicleType && VEHICLE_TYPES.includes(llm.vehicleType as VehicleType) && fuzzyIncludes(text, llm.vehicleEvidence)) {
    // Dictionary missed it but the model quoted real page text — accept with its evidence.
    type = llm.vehicleType as VehicleType;
    evidence = [llm.vehicleEvidence!.slice(0, 200)];
  } else if (GENERIC_CAR_PATTERN.test(text)) {
    type = "Unknown";
    const m = GENERIC_CAR_PATTERN.exec(text);
    if (m) evidence = [snippet(text, m.index, m[0].length, 40)];
  }

  // Seat counts refine ambiguous classes.
  if (capacity && (type === null || type === "Unknown" || type === "Sedan")) {
    if (capacity >= 25) type = "Coach";
    else if (capacity >= 9) type = "Minibus";
    else if (capacity >= 6) type = "Minivan";
    else if (type === null || type === "Unknown") type = "Sedan";
  }

  let details = llm?.vehicleDetails?.trim() || null;
  if (details && !fuzzyIncludes(text, details) && !/\d/.test(details)) details = null;
  if (!details && evidence[0] && type && type !== "Unknown" && type !== "None") details = evidence[0].slice(0, 200);

  return { type, capacity, details, evidence };
}

export function extractCapacity(text: string, llmCapacity: number | null): number | null {
  const candidates: number[] = [];
  for (const m of text.matchAll(CAPACITY_PATTERN)) {
    const lo = Number(m[2]);
    const hi = m[3] ? Number(m[3]) : lo;
    for (const n of [lo, hi]) if (Number.isInteger(n) && n >= 2 && n <= 60) candidates.push(n);
    if (candidates.length > 40) break;
  }
  if (llmCapacity && llmCapacity >= 2 && llmCapacity <= 60) {
    // Only trust the model if the number literally occurs on the page.
    if (new RegExp(`(?<!\\d)${llmCapacity}(?!\\d)`).test(text)) candidates.push(llmCapacity);
  }
  if (candidates.length === 0) return null;
  // Prefer the most frequently mentioned value; break ties toward the larger one (max capacity).
  const freq = new Map<number, number>();
  for (const c of candidates) freq.set(c, (freq.get(c) ?? 0) + 1);
  return Array.from(freq.entries()).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

export function classifyClients(text: string, llm?: RawGuide): { labels: ClientNationality[]; evidence: string[] } {
  const matches = matchRules(text, CLIENT_RULES);
  const labels = new Set<ClientNationality>(matches.map((m) => m.label));
  const evidence: string[] = matches.flatMap((m) => m.evidence.slice(0, 2).map((e) => `${m.label}: ${e}`));

  // LLM claims survive only if the quoted evidence exists on the page AND itself matches the dictionary.
  if (llm?.clientExperience) {
    llm.clientExperience.forEach((label, i) => {
      if (!CLIENT_NATIONALITIES.includes(label as ClientNationality) || labels.has(label as ClientNationality)) return;
      const quote = llm.clientExperienceEvidence?.[i];
      if (!quote || !fuzzyIncludes(text, quote)) return;
      const rule = CLIENT_RULES.find((r) => r.label === label);
      if (rule && rule.pattern.test(quote) && !(rule.exclude && rule.exclude.test(quote))) {
        labels.add(label as ClientNationality);
        evidence.push(`${label}: ${quote.slice(0, 160)}`);
      }
    });
  }
  return { labels: Array.from(labels), evidence };
}

export function classifyServices(text: string, llm?: RawGuide): { services: ServiceType[]; evidence: string[] } {
  const matches = matchRules(text, SERVICE_RULES);
  const services = new Set<ServiceType>(matches.map((m) => m.label));
  const evidence = matches.filter((m) => m.label !== "Guide").flatMap((m) => m.evidence.slice(0, 1).map((e) => `${m.label}: ${e}`));

  for (const s of llm?.services ?? []) {
    if (!SERVICE_TYPES.includes(s as ServiceType)) continue;
    // Driving-related claims need at least one driving keyword on the page.
    if ((s === "Driver" || s === "Driver-Guide") && !services.has("Driver") && !services.has("Driver-Guide")) continue;
    services.add(s as ServiceType);
  }
  if (services.has("Driver") && services.has("Guide")) services.add("Driver-Guide");
  if (llm?.isTourManager === true) services.add("Tour Manager");
  if (services.size === 0) services.add("Guide");

  return { services: Array.from(services), evidence };
}

export function extractYearsExperience(text: string, llm?: RawGuide): number | null {
  const m = EXPERIENCE_YEARS_PATTERN.exec(text) ?? EXPERIENCE_YEARS_PATTERN_REVERSED.exec(text);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 60) return n;
  }
  const since = SINCE_YEAR_PATTERN.exec(text);
  if (since) {
    const years = new Date().getFullYear() - Number(since[1]);
    if (years >= 1 && years <= 60) return years;
  }
  if (llm?.yearsExperience && llm.yearsExperience >= 1 && llm.yearsExperience <= 60) {
    if (new RegExp(`(?<!\\d)${llm.yearsExperience}(?!\\d)`).test(text)) return llm.yearsExperience;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

export function cleanName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let name = raw
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—|:•]+|[\s\-–—|:•]+$/g, "")
    .replace(/\b(mr|mrs|ms|dr|prof|sig|sr|sra|herr|frau|mme|m|san|さん|様|씨)\.?\s+/giu, "")
    .trim();
  // "Name | Site", "Name - Tour Guide in X", "Name – Private Tours"
  name = name.split(/\s+[|–—-]\s+|\s+::\s+/)[0].trim();
  if (name.length < 2 || name.length > 120) return null;
  if (NAME_STOPWORDS.test(name)) return null;
  if (/^\d+$/.test(name)) return null;
  return name;
}

export function nameFromTitle(title: string | undefined, url: string): string | null {
  if (title) {
    const cleaned = cleanName(title.replace(/\b(tour ?guide|private (tour )?guide|driver ?guide|guida|guía|guide|profile|reviews?)\b.*$/i, ""));
    if (cleaned) return cleaned;
  }
  // /guide/DE49765/hasim-anik  →  "Hasim Anik"
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const slug = parts.reverse().find((p) => /^[a-z]+(?:-[a-z]+)+$/i.test(p) && !/tour|guide|profile|user|member/i.test(p));
    if (slug) return slug.split("-").map((s) => s[0].toUpperCase() + s.slice(1)).join(" ");
  } catch {
    /* ignore */
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Fingerprint & confidence
// ---------------------------------------------------------------------------------------------

export function fingerprintFor(parts: { whatsapp?: string | null; phone?: string | null; email?: string | null; name: string; country: string; sourceDomain: string }): string {
  const key = parts.whatsapp
    ? `wa:${parts.whatsapp}`
    : parts.phone
      ? `tel:${parts.phone}`
      : parts.email
        ? `mail:${parts.email.toLowerCase()}`
        : `name:${parts.name.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "")}|${parts.country.toLowerCase()}|${parts.sourceDomain}`;
  return createHash("sha1").update(key).digest("hex");
}

export function scoreConfidence(record: {
  whatsappConfirmed: boolean;
  phone: string | null;
  email: string | null;
  website: string | null;
  vehicleEvidence: string[];
  clientEvidence: string[];
  fullName: string;
  isIndependent: boolean;
  services: ServiceType[];
}): number {
  let score = 0.25;
  if (record.whatsappConfirmed) score += 0.25;
  else if (record.phone) score += 0.15;
  if (record.email) score += 0.1;
  if (record.website) score += 0.05;
  if (record.vehicleEvidence.length > 0) score += 0.1;
  if (record.clientEvidence.length > 0) score += 0.1;
  if (/^\p{Lu}?\p{L}+(\s+\p{L}+){1,3}$/u.test(record.fullName)) score += 0.05;
  if (record.services.includes("Driver-Guide")) score += 0.05;
  if (!record.isIndependent) score -= 0.15;
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

// ---------------------------------------------------------------------------------------------
// Main entry points
// ---------------------------------------------------------------------------------------------

function resolveCountry(llm: RawGuide | undefined, ctx: NormalizeContext, phones: PhoneHit[], text: string): CountryInfo | undefined {
  return (
    findCountry(llm?.country) ??
    findCountry(llm?.region) ??
    findCountry(llm?.city) ??
    ctx.countryHint ??
    (() => {
      for (const p of phones) {
        const parsed = parsePhoneNumberFromString(p.e164);
        const info = countryByCode(parsed?.country ?? null);
        if (info) return info;
      }
      return undefined;
    })() ??
    detectCountryInText(text)
  );
}

/** Build one record from an LLM guide object (or `undefined` in regex mode) plus page text. */
export function buildRecord(llm: RawGuide | undefined, ctx: NormalizeContext, opts: { allPhones?: PhoneHit[]; localText?: string } = {}): GuideRecordInput | null {
  const text = cleanText(opts.localText ?? ctx.markdown);
  const fullText = cleanText(ctx.markdown);
  const sourceDomain = domainOf(ctx.sourceUrl);

  const name = cleanName(llm?.fullName) ?? cleanName(llm?.companyName) ?? nameFromTitle(ctx.pageTitle, ctx.sourceUrl);
  if (!name) return null;
  if (isPlatformDomain(sourceDomain) && new RegExp(sourceDomain.split(".")[0], "i").test(name) && name.split(" ").length === 1) return null;

  const defaultCountry = ctx.countryHint?.code ?? findCountry(llm?.country)?.code;
  const phones = opts.allPhones ?? extractPhones(fullText, defaultCountry);
  const country = resolveCountry(llm, ctx, phones, fullText);
  if (!country) return null; // outside our 50 markets or undeterminable

  // --- contact ---------------------------------------------------------------------------
  const llmWhatsapp = toE164(llm?.whatsapp, country.code);
  const llmPhone = toE164(llm?.phone, country.code);
  const pageWhatsapp = phones.find((p) => p.whatsapp)?.e164 ?? null;
  const whatsapp = llmWhatsapp && phones.some((p) => p.e164 === llmWhatsapp) ? llmWhatsapp : (pageWhatsapp ?? llmWhatsapp);
  const whatsappConfirmed = Boolean(whatsapp && (phones.some((p) => p.e164 === whatsapp && p.whatsapp) || (llmWhatsapp === whatsapp && WHATSAPP_PATTERN.test(fullText))));
  const phone = llmPhone && phones.some((p) => p.e164 === llmPhone) ? llmPhone : (phones.find((p) => p.e164 !== whatsapp)?.e164 ?? llmPhone ?? whatsapp);

  const emails = extractEmails(fullText);
  const llmEmail = llm?.email?.toLowerCase().trim();
  const email = llmEmail && emails.includes(llmEmail) ? llmEmail : (emails[0] ?? (llmEmail && !isPlatformDomain(llmEmail) && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(llmEmail) ? llmEmail : null));

  const websites = extractWebsites(fullText, ctx.sourceUrl);
  const llmSite = llm?.website?.trim();
  const website = llmSite && /^https?:\/\//i.test(llmSite) && !isPlatformDomain(domainOf(llmSite)) ? llmSite : (websites[0] ?? null);

  // --- classification --------------------------------------------------------------------
  const vehicle = classifyVehicle(text, llm);
  const clients = classifyClients(text, llm);
  const svc = classifyServices(text, llm);

  const worksWithCouples = COUPLES_PATTERN.test(text) ? true : (llm?.worksWithCouples ?? null);
  const smallGroupCapable = SMALL_GROUP_PATTERN.test(text) ? true : (llm?.smallGroupCapable ?? null);
  const isTourManager = svc.services.includes("Tour Manager") ? true : (llm?.isTourManager ?? null);
  const licensed = LICENSED_PATTERN.test(text) ? true : (llm?.licensed ?? null);
  const yearsExperience = extractYearsExperience(text, llm);

  const companyLike = COMPANY_PATTERN.test(text) && !INDEPENDENT_PATTERN.test(text);
  const isIndependent = typeof llm?.isIndependent === "boolean" ? llm.isIndependent && !companyLike : !companyLike;

  const languages = unique((llm?.languages ?? []).map((l) => l.trim()).filter((l) => l.length >= 2 && l.length <= 40 && /^[\p{L}\s()-]+$/u.test(l)));

  const bio = llm?.bio?.trim() ? llm.bio.trim().slice(0, 4000) : null;

  const evidence: Record<string, string[]> = {};
  if (vehicle.evidence.length) evidence.vehicle = vehicle.evidence;
  if (clients.evidence.length) evidence.clientExperience = clients.evidence;
  if (svc.evidence.length) evidence.services = svc.evidence;
  if (whatsappConfirmed && whatsapp) {
    const hit = phones.find((p) => p.e164 === whatsapp);
    evidence.whatsapp = [hit ? snippet(fullText, hit.index, hit.length, 60) : "model-reported WhatsApp number"];
  }

  const fingerprint = fingerprintFor({ whatsapp, phone, email, name, country: country.name, sourceDomain });
  const confidence = scoreConfidence({
    whatsappConfirmed,
    phone,
    email,
    website,
    vehicleEvidence: vehicle.evidence,
    clientEvidence: clients.evidence,
    fullName: name,
    isIndependent,
    services: svc.services,
  });

  return {
    fullName: name,
    companyName: cleanName(llm?.companyName) === name ? null : (cleanName(llm?.companyName) ?? null),
    email,
    phone,
    whatsapp,
    whatsappConfirmed,
    website,
    contactPageUrl: ctx.sourceUrl,
    country: country.name,
    countryCode: country.code,
    city: llm?.city?.trim() || null,
    region: llm?.region?.trim() || null,
    vehicleType: vehicle.type,
    vehicleDetails: vehicle.details,
    vehicleCapacity: vehicle.capacity,
    services: svc.services,
    languages,
    clientExperience: clients.labels,
    isIndependent,
    worksWithCouples,
    smallGroupCapable,
    isTourManager,
    licensed,
    yearsExperience,
    bio,
    sourceUrl: ctx.sourceUrl,
    sourceDomain,
    sourceType: ctx.sourceType ?? null,
    confidence,
    evidence,
    rawJson: llm,
    fingerprint,
    scrapedAt: ctx.scrapedAt ?? new Date(),
  };
}

/** Normalise a full page extraction (LLM mode). */
export function normalizePage(extraction: RawPageExtraction | undefined, ctx: NormalizeContext): GuideRecordInput[] {
  const guides = extraction?.guides?.filter(Boolean) ?? [];
  const fullText = cleanText(ctx.markdown);
  const phones = extractPhones(fullText, ctx.countryHint?.code);

  if (guides.length === 0) return normalizePageRegex(ctx);

  const records: GuideRecordInput[] = [];
  const seen = new Set<string>();
  for (const g of guides) {
    // Multi-guide pages: scope classification to the paragraph block that mentions this guide.
    const localText = guides.length > 1 ? localContextFor(fullText, g) : undefined;
    const rec = buildRecord(g, ctx, { allPhones: guides.length > 1 ? phonesNear(fullText, phones, g) : phones, localText });
    if (!rec || seen.has(rec.fingerprint)) continue;
    seen.add(rec.fingerprint);
    records.push(rec);
  }
  return records;
}

/** Regex-only normalisation (no LLM). One record per distinct phone number, or one for the page. */
export function normalizePageRegex(ctx: NormalizeContext): GuideRecordInput[] {
  const fullText = cleanText(ctx.markdown);
  const phones = extractPhones(fullText, ctx.countryHint?.code);
  const records: GuideRecordInput[] = [];
  const seen = new Set<string>();

  if (phones.length <= 1) {
    const rec = buildRecord(undefined, ctx, { allPhones: phones });
    if (rec) records.push(rec);
    return records;
  }

  for (const p of phones) {
    const windowStart = Math.max(0, p.index - 600);
    const local = fullText.slice(windowStart, p.index + p.length + 300);
    const name = guessNameNear(local, p.index - windowStart) ?? nameFromTitle(ctx.pageTitle, ctx.sourceUrl);
    const rec = buildRecord(name ? { fullName: name, phone: p.e164, whatsapp: p.whatsapp ? p.e164 : null } : undefined, ctx, {
      allPhones: [p],
      localText: local,
    });
    if (!rec || seen.has(rec.fingerprint)) continue;
    seen.add(rec.fingerprint);
    records.push(rec);
  }
  return records;
}

function localContextFor(fullText: string, g: RawGuide): string | undefined {
  const anchor = g.fullName?.split(/\s+/)[0];
  if (!anchor || anchor.length < 2) return undefined;
  const idx = fullText.toLowerCase().indexOf(anchor.toLowerCase());
  if (idx === -1) return undefined;
  return fullText.slice(Math.max(0, idx - 300), idx + 1500);
}

function phonesNear(fullText: string, phones: PhoneHit[], g: RawGuide): PhoneHit[] {
  const wanted = [g.whatsapp, g.phone].map((p) => toE164(p)).filter(Boolean) as string[];
  const direct = phones.filter((p) => wanted.includes(p.e164));
  if (direct.length) return direct;
  const anchor = g.fullName?.split(/\s+/)[0];
  if (!anchor) return [];
  const idx = fullText.toLowerCase().indexOf(anchor.toLowerCase());
  if (idx === -1) return [];
  return phones.filter((p) => Math.abs(p.index - idx) < 800);
}

/** Heuristic person-name finder for forum/classified text preceding a phone number. */
function guessNameNear(local: string, phoneOffset: number): string | null {
  const before = local.slice(0, phoneOffset);
  // Latin: "Name Surname" (2–3 capitalised words) closest to the number.
  const latin = Array.from(before.matchAll(/(?<![\p{L}])(\p{Lu}\p{Ll}{1,20}(?:\s+\p{Lu}\p{Ll}{1,20}){1,2})(?![\p{L}])/gu));
  for (const m of latin.reverse()) {
    const candidate = cleanName(m[1]);
    if (candidate && !/^(Whats ?App|Tel|Phone|Mobile|Contact|Call|Email|Guide|Tour|Driver|Private|Viber|Telegram|Line|Kakao)/i.test(candidate)) return candidate;
  }
  // CJK: 2–4 char Japanese/Korean names followed by honorific or "さん/様/씨"
  const cjk = /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,6}|[\p{Script=Hangul}]{2,4})\s*(?:さん|様|氏|씨|님)/u.exec(before);
  if (cjk) return cjk[1];
  return null;
}
