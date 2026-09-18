/**
 * JSON schema + prompt handed to Firecrawl's `json` format (LLM extraction).
 *
 * Design notes:
 *  - The page-level object is `{ guides: [...] }` because forums, classifieds and listing pages
 *    routinely contain several independent operators on one page.
 *  - Every subjective classification (vehicle, client experience, services) has a sibling
 *    `*Evidence` field that must quote the source text verbatim. `normalize.ts` re-validates each
 *    claim against the markdown with multilingual dictionaries and drops anything unsupported —
 *    this is what neutralises LLM hallucination on non-English pages.
 *  - Enum values are fixed English labels so downstream code never has to translate.
 */

import { CLIENT_NATIONALITIES, SERVICE_TYPES, VEHICLE_TYPES } from "../../src/lib/guide-schema";

const nullable = (type: string) => ({ type: [type, "null"] });

export const RAW_GUIDE_JSON_SCHEMA = {
  type: "object",
  properties: {
    fullName: { type: "string", description: "Person's full name as written on the page. If only a business name exists, use it here as well." },
    companyName: nullable("string"),
    email: nullable("string"),
    phone: { ...nullable("string"), description: "Primary phone number exactly as written, including country code if shown." },
    whatsapp: { ...nullable("string"), description: "Number explicitly labelled WhatsApp, or the number inside a wa.me / api.whatsapp.com link. Otherwise null." },
    website: nullable("string"),
    country: { ...nullable("string"), description: "Country where the guide operates, in English." },
    city: nullable("string"),
    region: { ...nullable("string"), description: "Sub-national region, prefecture, province or island." },
    languages: { type: "array", items: { type: "string" }, description: "Languages the guide speaks, in English (e.g. 'Japanese', 'Hindi')." },
    vehicleType: { type: ["string", "null"], enum: [...VEHICLE_TYPES, null] },
    vehicleDetails: { ...nullable("string"), description: "Make/model/seat count if stated, e.g. 'Toyota Alphard, 6 passengers'." },
    vehicleCapacity: { ...nullable("integer"), description: "Max passengers the vehicle carries, if stated." },
    vehicleEvidence: { ...nullable("string"), description: "Verbatim quote from the page supporting vehicleType. Null if no vehicle is mentioned." },
    services: { type: "array", items: { type: "string", enum: [...SERVICE_TYPES] } },
    clientExperience: {
      type: "array",
      items: { type: "string", enum: [...CLIENT_NATIONALITIES] },
      description: "Nationalities of past/target clients EXPLICITLY mentioned on the page (in any language). Empty array if none are mentioned.",
    },
    clientExperienceEvidence: { type: "array", items: { type: "string" }, description: "One verbatim quote per clientExperience entry." },
    isIndependent: { ...nullable("boolean"), description: "true for a freelancer / owner-operator; false for an agency or company with staff." },
    worksWithCouples: nullable("boolean"),
    smallGroupCapable: { ...nullable("boolean"), description: "true if the guide mentions families, small groups or private tours." },
    isTourManager: { ...nullable("boolean"), description: "true if the guide offers multi-day / round-trip escorting as a tour manager or tour leader." },
    licensed: nullable("boolean"),
    yearsExperience: nullable("integer"),
    bio: { ...nullable("string"), description: "Short profile summary in the original language, max 600 characters." },
  },
  required: ["fullName", "languages", "services", "clientExperience"],
} as const;

export const PAGE_EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    pageType: {
      type: "string",
      enum: ["profile", "listing", "forum", "classified", "company", "article", "other"],
      description: "profile = one operator's own page; listing = directory of many; forum = discussion thread; classified = ad board; company = agency with staff; article = blog/news.",
    },
    guides: { type: "array", items: RAW_GUIDE_JSON_SCHEMA },
  },
  required: ["pageType", "guides"],
} as const;

export const EXTRACTION_PROMPT = `You are extracting a directory of INDEPENDENT tour guides and driver-guides from a web page that may be written in any language (German, French, Italian, Spanish, Japanese, Korean, Polish, Greek, Turkish, etc.).

Return every individual tour guide, driver-guide, private driver or tour manager who can be contacted directly. One object per person. If the page is a company/agency page with no named individual, return a single object using the company name as fullName and isIndependent=false.

STRICT RULES — violating them is worse than returning null:
1. Never invent data. Every non-null field must be supported by text on the page. Unknown => null (or [] for arrays).
2. phone / whatsapp: copy digits exactly as written (keep leading + or 00 and the country code). Only fill whatsapp if the page says WhatsApp / WA / wa.me / api.whatsapp.com next to the number; otherwise put the number in phone and leave whatsapp null.
3. vehicleType must come from an explicit mention of a car, van, minibus, bus, model name (V-Class, Alphard, Hiace, Sprinter, Vito, Carnival, Staria...) or seat count. Quote it in vehicleEvidence. If nothing is mentioned, vehicleType=null and vehicleEvidence=null. Do NOT guess "Sedan" for a guide who merely offers a "private tour".
4. clientExperience: include a nationality ONLY if the page literally mentions clients/guests/travellers of that nationality in any language (e.g. "Indian families", "clientes indios", "indische Gäste", "インドからのお客様", "인도 고객", "American tourists", "chinesische Gruppen"). Quote each mention in clientExperienceEvidence. Reviews written by named travellers count only if their nationality is stated. An empty array is the correct answer for most pages.
5. services: "Driver-Guide" when one person both drives and guides; "Driver" for chauffeur-only; "Guide" for guiding without driving; "Tour Manager" for multi-day group escorting; "Transfer" for airport/station transfers; "Interpreter" for interpreting.
6. languages spoken must be translated to English names.
7. country / city: translate to English (Deutschland -> Germany, 東京 -> Tokyo).
8. Ignore site navigation, footer boilerplate, cookie banners, other guides' ads, and the marketplace operator's own contact details.`;
