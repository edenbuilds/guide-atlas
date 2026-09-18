#!/usr/bin/env tsx
/**
 * Self-verification: proves that what the scraper emits maps cleanly onto the Prisma schema.
 *
 *   npm run verify                       # schema contract + multilingual fixtures + DB round-trip
 *   npm run verify -- --file out/x.jsonl # additionally validate a real scraper output file
 *   npm run verify -- --live <url>       # additionally scrape one URL with Firecrawl and verify it
 *
 * Checks performed:
 *   1. Contract: every field of `GuideRecordSchema` has a matching `TourGuide` column with a
 *      compatible type, and every non-system column is produced by the scraper.
 *   2. Fixtures: multilingual synthetic pages run through the normaliser and must yield the
 *      expected contact / vehicle / client-experience classifications.
 *   3. Round-trip: normalised records are merged via `mergeInto` and written to the database inside
 *      a transaction that is rolled back — a real INSERT against the real schema, no side effects.
 *   4. (optional) A JSONL file and/or a live Firecrawl extraction are validated the same way.
 *
 * Exit code is non-zero on any failure so it can gate CI.
 */

import "dotenv/config";
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { GuideRecordSchema, type GuideRecord, type GuideRecordInput } from "../src/lib/guide-schema";
import { mergeInto } from "../src/lib/guide-merge";
import { fingerprintFor, normalizePage, normalizePageRegex } from "../scraper/lib/normalize";
import { countryByCode } from "../scraper/lib/countries";
import { createFirecrawlClient } from "../scraper/lib/firecrawl";
import { EXTRACTION_PROMPT, PAGE_EXTRACTION_JSON_SCHEMA } from "../scraper/lib/extract-schema";
import type { RawPageExtraction } from "../scraper/lib/normalize";

const { values } = parseArgs({
  options: { file: { type: "string" }, live: { type: "string" }, country: { type: "string", default: "DE" } },
});

let failures = 0;
function check(ok: boolean, message: string, detail?: unknown) {
  const mark = ok ? "PASS" : "FAIL";
  if (!ok) failures++;
  process.stdout.write(`${mark}  ${message}${!ok && detail !== undefined ? `\n      ${JSON.stringify(detail)}` : ""}\n`);
}

// ---------------------------------------------------------------------------------------------
// 1. Contract: zod schema ↔ Prisma model
// ---------------------------------------------------------------------------------------------

/** Fields that are JSON-encoded into a String column at the persistence boundary. */
const JSON_ENCODED = new Set(["services", "languages", "clientExperience", "evidence", "rawJson"]);
/** Columns Prisma manages on its own. */
const SYSTEM_COLUMNS = new Set(["id", "createdAt", "updatedAt"]);

function zodBaseType(schema: z.ZodType): string {
  // unwrap optional/nullable/default/pipe/transform wrappers
  let s: z.ZodType = schema;
  for (let i = 0; i < 10; i++) {
    const def = (s as unknown as { def: { type: string; innerType?: z.ZodType; in?: z.ZodType; schema?: z.ZodType } }).def;
    if (["optional", "nullable", "default", "nonoptional", "readonly", "catch"].includes(def.type) && def.innerType) s = def.innerType;
    else if (def.type === "pipe" && def.in) s = def.in;
    else break;
  }
  return (s as unknown as { def: { type: string } }).def.type;
}

function contractChecks() {
  process.stdout.write("\n# 1. Schema contract (GuideRecordSchema ↔ prisma.TourGuide)\n");
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === "TourGuide");
  check(Boolean(model), "TourGuide model exists in Prisma DMMF");
  if (!model) return;

  const columns = new Map(model.fields.filter((f) => f.kind === "scalar").map((f) => [f.name, f]));
  const shape = GuideRecordSchema.shape as Record<string, z.ZodType>;

  const typeMap: Record<string, string[]> = {
    string: ["String"],
    number: ["Int", "Float"],
    int: ["Int"],
    boolean: ["Boolean"],
    date: ["DateTime"],
    enum: ["String"],
    array: ["String"],
    record: ["String"],
    unknown: ["String"],
    literal: ["String"],
  };

  for (const [key, schema] of Object.entries(shape)) {
    const col = columns.get(key);
    check(Boolean(col), `record field "${key}" has a column`);
    if (!col) continue;
    const base = zodBaseType(schema);
    const expected = JSON_ENCODED.has(key) ? ["String"] : (typeMap[base] ?? []);
    check(expected.includes(col.type), `column "${key}" type ${col.type} is compatible with zod ${base}`, { expected });
    // nullability: a column that is required in Prisma must be required (or defaulted) in zod
    if (col.isRequired && !col.hasDefaultValue) {
      const t = (schema as unknown as { def: { type: string } }).def.type;
      const optionalish = ["optional", "nullable", "default"].includes(t);
      check(!optionalish || key === "fingerprint", `required column "${key}" is required by the record schema`);
    }
  }

  for (const [name, col] of columns) {
    if (SYSTEM_COLUMNS.has(name)) continue;
    check(name in shape, `column "${name}" is produced by the scraper`, { type: col.type });
  }

  // Semantic guards the structural diff cannot see.
  const base = { fullName: "Contract Test", country: "Japan", sourceUrl: "https://example.jp/guide", sourceDomain: "example.jp", fingerprint: "0123456789abcdef" };
  check(!GuideRecordSchema.safeParse({ ...base, phone: "+81 90 3333 4444" }).success, "schema rejects non-E.164 phone");
  check(GuideRecordSchema.safeParse({ ...base, phone: "+819033334444" }).success, "schema accepts E.164 phone");
  check(!GuideRecordSchema.safeParse({ ...base, whatsappConfirmed: true }).success, "schema rejects whatsappConfirmed without a number");
  check(!GuideRecordSchema.safeParse({ ...base, countryCode: "12" }).success, "schema rejects numeric countryCode");
  check(!GuideRecordSchema.safeParse({ ...base, sourceDomain: "other.example" }).success, "schema rejects sourceDomain that differs from sourceUrl host");
  check(GuideRecordSchema.safeParse({ ...base, email: " Foo@Example.JP " }).data?.email === "foo@example.jp", "schema trims + lowercases email before validating");
  check(
    fingerprintFor({ whatsapp: "+819033334444", name: "A", country: "Japan", sourceDomain: "a.jp" }) === fingerprintFor({ phone: "+819033334444", name: "B", country: "Japan", sourceDomain: "b.jp" }),
    "same number yields the same fingerprint whether labelled WhatsApp or not",
  );
  const merged = mergeInto(
    { fullName: "Existing Name", confidence: 0.9, scrapedAt: new Date("2026-09-01"), yearsExperience: 0 } as unknown as Parameters<typeof mergeInto>[0],
    GuideRecordSchema.parse({ ...base, confidence: 0.4, scrapedAt: "2025-01-01T00:00:00Z", yearsExperience: 0 }),
  );
  check(merged.fullName === "Existing Name", "merge keeps the more confident name");
  check(new Date(merged.scrapedAt as Date).getTime() === new Date("2026-09-01").getTime(), "merge never moves scrapedAt backwards");
  check(merged.yearsExperience === 0, "merge preserves yearsExperience = 0");
}

// ---------------------------------------------------------------------------------------------
// 2. Multilingual fixtures
// ---------------------------------------------------------------------------------------------

interface Fixture {
  name: string;
  countryCode: string;
  url: string;
  markdown: string;
  mode?: "llm" | "regex";
  llm?: RawPageExtraction;
  expect: Partial<Record<keyof GuideRecord, unknown>> & { count?: number };
}

const FIXTURES: Fixture[] = [
  {
    name: "German owner-operator with WhatsApp and V-Class",
    countryCode: "DE",
    url: "https://www.muenchen-fahrer-guide.de/kontakt",
    markdown: `# Thomas Müller – Fahrer und Reiseleiter in München

Ich bin selbstständiger Fahrer-Guide mit eigenem Mercedes V-Klasse (7 Sitzer) und begleite seit 2009 kleine Gruppen, Paare und Familien durch Bayern.
Ich habe viel Erfahrung mit indischen Gästen und amerikanischen Touristen.

Kontakt: WhatsApp +49 171 4827361 · E-Mail: thomas@muenchen-fahrer-guide.de`,
    expect: { fullName: "Thomas Müller", whatsapp: "+491714827361", whatsappConfirmed: true, email: "thomas@muenchen-fahrer-guide.de", vehicleType: "Minivan", vehicleCapacity: 7, clientExperience: ["Indian", "American"], isIndependent: true, worksWithCouples: true, countryCode: "DE" },
  },
  {
    name: "Japanese driver-guide (ja) with Alphard",
    countryCode: "JP",
    url: "https://kyoto-driverguide.jp/",
    markdown: `# 京都ドライバーガイド 佐藤健一

全国通訳案内士の資格を持つフリーランスのドライバーガイドです。トヨタ アルファード（6人乗り）で京都・奈良をご案内します。
インドからのお客様や中国のお客様の受け入れ経験が豊富です。ご夫婦や少人数のご家族に最適です。

お問い合わせ: WhatsApp 090-4816-2735 / メール sato@kyoto-driverguide.jp`,
    expect: { fullName: "佐藤健一", whatsapp: "+819048162735", whatsappConfirmed: true, vehicleType: "Minivan", vehicleCapacity: 6, clientExperience: ["Indian", "Chinese"], licensed: true, countryCode: "JP" },
  },
  {
    name: "Korean guide (ko) with wa.me link and Carnival",
    countryCode: "KR",
    url: "https://seoulprivateguide.kr/about",
    markdown: `# 서울 프라이빗 가이드 김민수

관광통역안내사 자격증 보유. 기사 겸 가이드로 카니발 (9인승) 차량으로 서울, 부산을 안내합니다.
인도 고객과 미국 관광객 경험 다수. 커플 및 가족 소그룹 환영.

[WhatsApp으로 연락](https://wa.me/821047382915)`,
    expect: { fullName: "김민수", whatsapp: "+821047382915", whatsappConfirmed: true, vehicleType: "Minivan", vehicleCapacity: 9, clientExperience: ["Indian", "American"], countryCode: "KR" },
  },
  {
    name: "Spanish chófer guía using 'hindúes' for Indian clients",
    countryCode: "ES",
    url: "https://chofer-guia-madrid.es/contacto",
    markdown: `# Chófer guía privado en Madrid – Javier López

Guía oficial de turismo y conductor autónomo. Dispongo de un monovolumen Mercedes Vito de 7 plazas.
Experiencia con turistas hindúes, familias americanas y grupos chinos. Ideal para parejas y grupos pequeños.

Contacto: +34 612 847 391 (WhatsApp) · javier@chofer-guia-madrid.es`,
    expect: { fullName: "Javier López", whatsapp: "+34612847391", whatsappConfirmed: true, vehicleType: "Minivan", clientExperience: ["Indian", "American", "Chinese"], isIndependent: true, countryCode: "ES" },
  },
  {
    name: "Marketplace boilerplate must not fabricate nationalities or vehicles",
    countryCode: "DE",
    url: "https://www.tourhq.com/guide/DE1/some-guide",
    markdown: `# Some Guide
Choose a currency $ AUD - Australian Dollar $ CAD - Canadian Dollar £ GBP - British Pound ¥ JPY - Japanese Yen
Private Tour Guide in Berlin. Licensed. Let me be also your personal city coach in Berlin.
##### Reviews
I got into a cab randomly and asked the driver to bring me to the Berlin Wall Memorial. Great guide.`,
    llm: { pageType: "profile", guides: [{ fullName: "Some Guide", vehicleType: "Sedan", vehicleEvidence: null, clientExperience: ["Indian", "American"], clientExperienceEvidence: ["Indian families love him", "American"], services: ["Guide"], languages: ["English"] }] },
    expect: { clientExperience: [], vehicleType: null, whatsapp: null },
  },
  {
    name: "LLM claims are kept only when quoted evidence exists on the page",
    countryCode: "IT",
    url: "https://example-guide.it/",
    markdown: `# Marco Rossi
Guida turistica e autista privato a Roma con Mercedes Classe V. Ho lavorato con molti clienti indiani e americani.
Telefono: +39 333 481 7265`,
    llm: { pageType: "profile", guides: [{ fullName: "Marco Rossi", phone: "+39 333 481 7265", whatsapp: "+39 333 481 7265", vehicleType: "Minivan", vehicleEvidence: "Mercedes Classe V", clientExperience: ["Indian", "American", "Chinese"], clientExperienceEvidence: ["clienti indiani", "americani", "clienti cinesi"], services: ["Driver-Guide"], languages: ["Italian", "English"] }] },
    // no WhatsApp label on page → number kept as phone, whatsapp unconfirmed; "Chinese" has no page evidence → dropped
    expect: { phone: "+393334817265", whatsappConfirmed: false, vehicleType: "Minivan", clientExperience: ["Indian", "American"], services: ["Driver-Guide", "Driver", "Guide"] },
  },
  {
    name: "Forum thread splits into one record per phone (regex mode)",
    countryCode: "CH",
    url: "https://www.indiamike.com/india/europe-f45/switzerland-driver-t12345/",
    mode: "regex",
    markdown: `# Switzerland driver recommendation

We used Peter Schmid for 3 days in Interlaken, he has a 7 seater Mercedes van, perfect for our family of 5 from Mumbai. WhatsApp: +41 79 318 42 67.

Another option is Luca Bianchi in Lugano, sedan only, contact +41 76 987 65 43, speaks Hindi a little.`,
    expect: { count: 2 },
  },
  {
    name: "Non-target country named by the model is not relabelled with the scrape hint",
    countryCode: "CH",
    url: "https://www.indiaworldwidetravel.example/switzerland-tours",
    markdown: `# India Worldwide Travel
Rajasthan and Kerala packages for Swiss residents. Office Jaipur, India. Call/WhatsApp +91 94139 01196`,
    llm: { pageType: "company", guides: [{ fullName: "India Worldwide Travel", country: "India", city: "Jaipur", whatsapp: "+91 94139 01196", services: ["Driver"] }] },
    expect: { count: 0 },
  },
  {
    name: "Model-only WhatsApp number is never confirmed by an unrelated WhatsApp mention",
    countryCode: "JP",
    url: "https://marketplace.example/guides/tokyo",
    markdown: `# Tokyo private guides
[Chat on WhatsApp](https://marketplace.example/chat)

## Taro Yamada
Licensed guide, Toyota Alphard 7 seats. Tel 03-5428-7316`,
    llm: { pageType: "listing", guides: [{ fullName: "Taro Yamada", whatsapp: "+81 90 1111 2222", vehicleType: "Minivan", vehicleEvidence: "Toyota Alphard 7 seats" }] },
    expect: { whatsapp: null, whatsappConfirmed: false, phone: "+81354287316", vehicleType: "Minivan" },
  },
  {
    name: "Placeholder phone numbers are rejected instead of becoming the dedupe key",
    countryCode: "CH",
    url: "https://template-site.example/kontakt",
    markdown: `# Chauffeur Zürich
Rufen Sie uns an: +41 12 345 67 89 · info@template-site.example`,
    llm: { pageType: "profile", guides: [{ fullName: "Chauffeur Zürich", phone: "+41 12 345 67 89", email: "info@template-site.example" }] },
    expect: { phone: null, email: "info@template-site.example" },
  },
];

function sameSet(a: unknown, b: unknown) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  return a.length === b.length && a.every((x) => b.includes(x));
}

function fixtureChecks(): GuideRecordInput[] {
  process.stdout.write("\n# 2. Multilingual extraction fixtures\n");
  const all: GuideRecordInput[] = [];
  for (const f of FIXTURES) {
    const ctx = { sourceUrl: f.url, markdown: f.markdown, countryHint: countryByCode(f.countryCode), sourceType: "personal-site" as const };
    const records = f.mode === "regex" ? normalizePageRegex(ctx) : normalizePage(f.llm, ctx);
    all.push(...records);
    const { count, ...fields } = f.expect;
    if (count !== undefined) check(records.length === count, `${f.name}: yields ${count} records`, { got: records.length });
    if (count === 0) continue;
    const rec = records[0];
    check(Boolean(rec), `${f.name}: yields a record`);
    if (!rec) continue;
    for (const [key, expected] of Object.entries(fields)) {
      const actual = (rec as unknown as Record<string, unknown>)[key];
      const ok = Array.isArray(expected) ? sameSet(actual, expected) : actual === expected;
      check(ok, `${f.name}: ${key}`, { expected, actual });
    }
    const parsed = GuideRecordSchema.safeParse(rec);
    check(parsed.success, `${f.name}: validates against GuideRecordSchema`, parsed.success ? undefined : parsed.error.issues);
  }
  return all;
}

// ---------------------------------------------------------------------------------------------
// 3. Database round-trip (rolled back)
// ---------------------------------------------------------------------------------------------

class Rollback extends Error {}

async function roundTrip(prisma: PrismaClient, inputs: GuideRecordInput[], label: string) {
  process.stdout.write(`\n# 3. Database round-trip — ${label} (${inputs.length} records, rolled back)\n`);
  const records: GuideRecord[] = [];
  for (const r of inputs) {
    const parsed = GuideRecordSchema.safeParse(r);
    if (!parsed.success) {
      check(false, `record from ${r.sourceUrl} validates`, parsed.error.issues.slice(0, 3));
      continue;
    }
    records.push(parsed.data);
  }
  if (records.length === 0) return;

  try {
    await prisma.$transaction(async (tx) => {
      let written = 0;
      for (const rec of records) {
        const data = mergeInto(undefined, rec);
        const row = await tx.tourGuide.upsert({ where: { fingerprint: rec.fingerprint }, create: data, update: data });
        // Verify the JSON list columns survive the round trip.
        const back = JSON.parse(row.clientExperience) as string[];
        if (!sameSet(back, rec.clientExperience)) throw new Error(`clientExperience mismatch for ${rec.fullName}`);
        // Second upsert with the same record must merge, not duplicate.
        const merged = mergeInto(row, rec);
        await tx.tourGuide.update({ where: { fingerprint: rec.fingerprint }, data: merged });
        written++;
      }
      const count = await tx.tourGuide.count({ where: { fingerprint: { in: records.map((r) => r.fingerprint) } } });
      check(count === new Set(records.map((r) => r.fingerprint)).size, `${written} records inserted, no duplicates`, { count });
      throw new Rollback("rollback");
    });
  } catch (error) {
    if (!(error instanceof Rollback)) {
      check(false, `database write failed: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
  }
  const leaked = await prisma.tourGuide.count({ where: { fingerprint: { in: records.map((r) => r.fingerprint) } } });
  // Fixtures should never persist; real JSONL records may legitimately exist from earlier runs.
  if (label.startsWith("fixtures")) check(leaked === 0, "transaction rolled back (no fixture rows persisted)", { leaked });
  else process.stdout.write(`INFO  ${leaked} of these fingerprints already exist in the database\n`);
}

// ---------------------------------------------------------------------------------------------
// 4. Optional real data
// ---------------------------------------------------------------------------------------------

async function loadJsonl(path: string): Promise<GuideRecordInput[]> {
  const text = await readFile(path, "utf8");
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l) as GuideRecordInput);
}

async function liveExtraction(url: string, countryCode: string): Promise<GuideRecordInput[]> {
  process.stdout.write(`\n# 4. Live Firecrawl extraction — ${url}\n`);
  const fc = createFirecrawlClient();
  const page = await fc.scrape(url, {
    formats: ["markdown", { type: "json", schema: PAGE_EXTRACTION_JSON_SCHEMA as unknown as Record<string, unknown>, prompt: EXTRACTION_PROMPT }],
    onlyMainContent: true,
  });
  check(Boolean(page.markdown && page.markdown.length > 100), "page returned markdown", { length: page.markdown?.length });
  check(typeof page.json === "object" && page.json !== null, "page returned structured json");
  const extraction = page.json as RawPageExtraction;
  check(Array.isArray(extraction?.guides), "json payload has guides[]", extraction);
  const records = normalizePage(extraction, {
    sourceUrl: url,
    markdown: page.markdown ?? "",
    pageTitle: page.metadata?.title,
    countryHint: countryByCode(countryCode),
    sourceType: "directory",
  });
  process.stdout.write(`INFO  normalised ${records.length} record(s), ${fc.creditsUsed} credits used\n`);
  for (const r of records)
    process.stdout.write(`      - ${r.fullName} | ${r.country} | wa=${r.whatsapp ?? "-"}${r.whatsappConfirmed ? "✓" : ""} tel=${r.phone ?? "-"} | ${r.vehicleType ?? "-"} | ${(r.services ?? []).join("/")} | ${(r.clientExperience ?? []).join(",") || "-"} | conf ${r.confidence}\n`);
  return records;
}

// ---------------------------------------------------------------------------------------------

(async () => {
  contractChecks();
  const fixtureRecords = fixtureChecks();

  const prisma = new PrismaClient();
  try {
    await roundTrip(prisma, fixtureRecords, "fixtures");
    if (values.file) await roundTrip(prisma, await loadJsonl(values.file), `jsonl ${values.file}`);
    if (values.live) await roundTrip(prisma, await liveExtraction(values.live, values.country!), `live ${values.live}`);
  } finally {
    await prisma.$disconnect();
  }

  process.stdout.write(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((error) => {
  process.stderr.write(`verify failed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
