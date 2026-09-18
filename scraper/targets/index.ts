/**
 * Regional directory targets for the 50 markets.
 *
 * A target is either a concrete URL to a listing page (directory / forum / classified) or a
 * discovery query for Firecrawl `/v2/search`. Targets are generated from templates per country so
 * that a worker can be dispatched with `--region europe-central` or `--country JP` and receive a
 * self-contained list of work.
 */

import type { CountryCode } from "libphonenumber-js";
import { COUNTRIES, REGIONS, type CountryInfo, type RegionKey } from "../lib/countries";
import type { DiscoveryConfig } from "../lib/discover";
import type { ScrapeOptions } from "../lib/firecrawl";
import type { SourceType } from "../../src/lib/guide-schema";

export type TargetKind = "directory" | "search" | "forum" | "classified";

export interface ScrapeTarget {
  id: string;
  kind: TargetKind;
  sourceType: SourceType;
  countryCode: CountryCode;
  /** listing URL (directory/forum/classified) */
  url?: string;
  /** search query (kind = search) */
  query?: string;
  /** Firecrawl search `location` hint */
  searchLocation?: string;
  searchLimit?: number;
  discovery?: DiscoveryConfig;
  paging?: {
    /** e.g. "{url}?page={n}" — when omitted, pagination is discovered from links */
    template?: string;
    maxPages?: number;
  };
  /** extract guides from the listing page itself (forums, classifieds) instead of following profile links */
  extractListing?: boolean;
  /** follow profile links found on the listing page */
  followProfiles?: boolean;
  scrapeOptions?: Partial<ScrapeOptions>;
  priority?: number;
}

// ---------------------------------------------------------------------------------------------
// Directory templates (verified live during development; see README for how to add more)
// ---------------------------------------------------------------------------------------------

interface DirectoryTemplate {
  id: string;
  build: (c: CountryInfo) => string | null;
  discovery: DiscoveryConfig;
  paging?: ScrapeTarget["paging"];
  sourceType: SourceType;
  scrapeOptions?: Partial<ScrapeOptions>;
}

const DIRECTORY_TEMPLATES: DirectoryTemplate[] = [
  {
    id: "tourhq",
    // https://www.tourhq.com/germany/tour-guides → profiles at /guide/DE49765/hasim-anik
    build: (c) => `https://www.tourhq.com/${c.slug}/tour-guides`,
    discovery: { profilePattern: /^\/guide\/[a-z]{2}\d+\//i, maxProfilesPerPage: 60 },
    paging: { template: "{url}?page={n}", maxPages: 40 },
    sourceType: "marketplace",
  },
  {
    id: "gowithguide-cars",
    // Private car tours — the closest thing to a driver-guide directory on this marketplace.
    build: (c) => `https://gowithguide.com/s?country=${c.slug}&t=cars`,
    discovery: { profilePattern: /^\/[a-z-]+\/(guide|tour)\/[\w-]+/i, maxProfilesPerPage: 60 },
    paging: { template: "{url}&page={n}", maxPages: 30 },
    sourceType: "marketplace",
    scrapeOptions: { waitFor: 1500 },
  },
  {
    id: "gowithguide-guides",
    build: (c) => `https://gowithguide.com/s?country=${c.slug}&t=guides`,
    discovery: { profilePattern: /^\/[a-z-]+\/guide\/[\w-]+/i, maxProfilesPerPage: 60 },
    paging: { template: "{url}&page={n}", maxPages: 30 },
    sourceType: "marketplace",
    scrapeOptions: { waitFor: 1500 },
  },
  {
    id: "toursbylocals",
    build: (c) => `https://www.toursbylocals.com/tours/${c.slug}`,
    discovery: { profilePattern: /^\/(guides?|tour)\/[\w-]+/i, maxProfilesPerPage: 60 },
    paging: { maxPages: 20 },
    sourceType: "marketplace",
    scrapeOptions: { waitFor: 2000 },
  },
  {
    id: "privateguideworld",
    build: (c) => `https://pg.world/en/guides?country=${encodeURIComponent(c.name)}`,
    discovery: { profilePattern: /^\/en\/(guide|guides)\/[\w-]+\/?$/i, maxProfilesPerPage: 60 },
    paging: { template: "{url}&page={n}", maxPages: 20 },
    sourceType: "directory",
  },
];

// ---------------------------------------------------------------------------------------------
// Search discovery templates — this is where independent operators with WhatsApp numbers live.
// ---------------------------------------------------------------------------------------------

function searchQueries(c: CountryInfo): Array<{ q: string; type: SourceType; kind: TargetKind }> {
  const out: Array<{ q: string; type: SourceType; kind: TargetKind }> = [];
  const topCities = c.cities.slice(0, 4);

  out.push({ q: `"driver guide" ${c.name} WhatsApp`, type: "search", kind: "search" });
  out.push({ q: `private driver guide ${c.name} Indian families WhatsApp`, type: "search", kind: "search" });
  out.push({ q: `independent tour guide ${c.name} "Indian" clients contact WhatsApp`, type: "search", kind: "search" });
  out.push({ q: `${c.name} chauffeur guide minivan "Indian" OR "American" OR "Chinese" groups`, type: "search", kind: "search" });
  out.push({ q: `freelance tour manager ${c.name} small groups private car contact`, type: "search", kind: "search" });
  for (const city of topCities) out.push({ q: `private driver guide ${city} WhatsApp`, type: "search", kind: "search" });
  for (const term of c.localTerms) out.push({ q: `${term} WhatsApp`, type: "search", kind: "search" });

  // Forums where travellers post recommended drivers with phone numbers.
  out.push({ q: `site:indiamike.com ${c.name} driver guide recommend WhatsApp`, type: "forum", kind: "forum" });
  out.push({ q: `site:tripadvisor.com ${c.name} private driver guide recommendation phone`, type: "forum", kind: "forum" });
  out.push({ q: `site:reddit.com private driver guide ${c.name} recommendation`, type: "forum", kind: "forum" });

  return out;
}

const CLASSIFIED_SITES: Partial<Record<CountryCode, string[]>> = {
  DE: ["kleinanzeigen.de"],
  AT: ["willhaben.at"],
  CH: ["anibis.ch", "tutti.ch"],
  IT: ["subito.it", "bakeca.it"],
  ES: ["milanuncios.com"],
  PT: ["olx.pt"],
  FR: ["leboncoin.fr"],
  NL: ["marktplaats.nl"],
  BE: ["2dehands.be"],
  PL: ["olx.pl"],
  CZ: ["bazos.cz"],
  SK: ["bazos.sk"],
  HU: ["jofogas.hu"],
  RO: ["olx.ro"],
  BG: ["olx.bg"],
  GR: ["xe.gr"],
  TR: ["sahibinden.com"],
  HR: ["njuskalo.hr"],
  RS: ["kupujemprodajem.com"],
  JP: ["jmty.jp"],
  KR: ["daangn.com"],
  TH: ["kaidee.com"],
  VN: ["chotot.com"],
  ID: ["olx.co.id"],
  EG: ["olx.com.eg"],
  GE: ["mymarket.ge"],
  AZ: ["tap.az"],
  AM: ["list.am"],
};

// ---------------------------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------------------------

export interface TargetFilter {
  countries?: CountryCode[];
  regions?: RegionKey[];
  kinds?: TargetKind[];
  /** only these directory template ids */
  directories?: string[];
  /** cap search queries per country */
  maxSearchPerCountry?: number;
}

export function buildTargets(filter: TargetFilter = {}): ScrapeTarget[] {
  const countries = COUNTRIES.filter((c) => {
    if (filter.countries?.length && !filter.countries.includes(c.code)) return false;
    if (filter.regions?.length && !filter.regions.includes(c.region)) return false;
    return true;
  });
  const kinds = new Set<TargetKind>(filter.kinds ?? ["directory", "search", "forum", "classified"]);
  const targets: ScrapeTarget[] = [];

  for (const c of countries) {
    if (kinds.has("directory")) {
      for (const t of DIRECTORY_TEMPLATES) {
        if (filter.directories?.length && !filter.directories.includes(t.id)) continue;
        const url = t.build(c);
        if (!url) continue;
        targets.push({
          id: `${t.id}:${c.code}`,
          kind: "directory",
          sourceType: t.sourceType,
          countryCode: c.code,
          url,
          discovery: t.discovery,
          paging: t.paging,
          followProfiles: true,
          extractListing: false,
          scrapeOptions: { location: { country: c.code, languages: c.languages }, ...t.scrapeOptions },
          priority: 10,
        });
      }
    }

    const queries = searchQueries(c).filter((q) => kinds.has(q.kind));
    const capped = filter.maxSearchPerCountry ? queries.slice(0, filter.maxSearchPerCountry) : queries;
    capped.forEach((q, i) => {
      targets.push({
        id: `search:${c.code}:${i}`,
        kind: q.kind,
        sourceType: q.type,
        countryCode: c.code,
        query: q.q,
        searchLocation: c.name,
        searchLimit: 8,
        extractListing: true,
        followProfiles: false,
        scrapeOptions: { location: { country: c.code, languages: c.languages } },
        priority: q.kind === "search" ? 20 : 30,
      });
    });

    if (kinds.has("classified")) {
      for (const site of CLASSIFIED_SITES[c.code] ?? []) {
        targets.push({
          id: `classified:${c.code}:${site}`,
          kind: "classified",
          sourceType: "classified",
          countryCode: c.code,
          query: `site:${site} ${c.localTerms[0] ?? "driver guide"}`,
          searchLocation: c.name,
          searchLimit: 8,
          extractListing: true,
          followProfiles: false,
          scrapeOptions: { location: { country: c.code, languages: c.languages } },
          priority: 40,
        });
      }
    }
  }

  return targets.sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));
}

/** Wrap arbitrary URLs supplied on the command line into directory targets. */
export function targetsFromUrls(urls: string[], countryCode?: CountryCode, opts: Partial<ScrapeTarget> = {}): ScrapeTarget[] {
  return urls.map((url, i) => ({
    id: `url:${i}`,
    kind: "directory",
    sourceType: "directory",
    countryCode: countryCode ?? ("DE" as CountryCode),
    url,
    followProfiles: true,
    extractListing: true,
    paging: { maxPages: 10 },
    ...opts,
  }));
}

export { COUNTRIES, REGIONS };
export type { RegionKey };
