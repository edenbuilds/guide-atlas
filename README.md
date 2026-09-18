# Guide Atlas

End-to-end scraping service and outreach directory for **independent driver-guides** across 50 non-English-speaking countries (Europe, Japan, South Korea, plus Taiwan, SE Asia and MENA). The pipeline finds guides who run small-group / couple tours with their own vehicle, verifies which of them have worked with Indian, American or Chinese clients, and captures **direct contact channels — WhatsApp first** — so outreach can happen without a marketplace in the middle.

| Layer | Stack |
| --- | --- |
| Scraper | Node.js / TypeScript CLI (`scraper/`) on the **Firecrawl v2 API**, with an **Apify** fallback engine for bot-walled domains |
| API | Next.js 16 App Router route handlers (`src/app/api/guides/*`) |
| DB | **Prisma 6** — SQLite for prototyping, provider-portable schema for PostgreSQL |
| UI | Next.js + Tailwind CSS 4 + shadcn/ui data-table dashboard |

---

## Quick start

```bash
git clone https://github.com/edenbuilds/guide-atlas && cd guide-atlas
npm install                      # runs `prisma generate` via postinstall
cp .env.example .env             # add FIRECRAWL_API_KEY
npx prisma migrate dev           # creates prisma/dev.db
npm run dev                      # dashboard + ingest API on http://localhost:3000
```

In a second terminal:

```bash
# scrape one directory listing into the running API
npm run scrape -- --urls https://www.tourhq.com/japan/tour-guides --country JP --max-profiles 20

# or run a whole regional catalogue
npm run scrape -- --region japan,korea --kinds directory,search --max-credits 2000 --out out/jp-kr.jsonl

# self-verify the Firecrawl -> Prisma mapping
npm run verify
```

---

## Phase 1 — Scraper architecture (`scraper/`)

```
scraper/
├── scraper.ts          CLI: run | list | replay | credits
├── workers.ts          parallel dispatcher — one worker process per region/country
├── targets/index.ts    50-country catalogue -> concrete directory / search / forum / classified targets
└── lib/
    ├── firecrawl.ts    typed Firecrawl v2 client: scrape / search / map / crawl / batch, auto-tuned concurrency
    ├── rate-limit.ts   Semaphore + TokenBucket + withRetry (429/5xx exponential back-off with jitter)
    ├── apify.ts        ScrapeEngine fallback (website-content-crawler, google-search-scraper) + circuit breaker
    ├── pipeline.ts     orchestration: listing pagination -> profile discovery -> extraction -> ingest
    ├── discover.ts     profile-link and "next page" detection across 30+ languages
    ├── extract-schema.ts  JSON schema + prompt for Firecrawl's LLM `json` format (evidence-required)
    ├── normalize.ts    re-verifies every LLM claim against the page markdown; emits GuideRecord
    ├── dictionaries.ts multilingual keyword rules: nationalities, vehicles, services, independence
    ├── countries.ts    50 target countries: ISO codes, languages, aliases, localised search terms
    ├── ingest.ts       batched POST to /api/guides/ingest with retry + JSONL replay log
    └── logger.ts
```

### Input: an array of regional directory URLs

`scraper.ts run` accepts explicit URLs (`--urls a,b` or `--file urls.txt`) **and/or** generates targets from the built-in catalogue (`--region`, `--country`, `--kinds`, `--directories`). Every target carries a `countryHint` so phone numbers parse to the right E.164 prefix and self-referential nationalities (a Japanese guide writing 日本人) are not counted as client experience.

| Target kind | Source | Example |
| --- | --- | --- |
| `directory` | tourhq, GoWithGuide (cars + guides), ToursByLocals, PrivateGuideWorld — one template × 50 countries | `https://www.tourhq.com/japan/tour-guides` |
| `search` | Firecrawl `/v2/search` with English + localised queries per country and top cities (`chauffeur guide privé WhatsApp`, `ドライバーガイド 貸切 WhatsApp`, `기사 가이드 프라이빗 투어 WhatsApp` …) | ~10–15 queries per country |
| `forum` | `site:` searches over travel forums where travellers post recommended drivers with numbers | IndiaMike, Tripadvisor forums, Reddit |
| `classified` | One local classifieds site per country (28 mapped) | kleinanzeigen.de, subito.it, leboncoin.fr, jmty.jp, daangn.com, … |

### Rate limiting & pagination

- `FirecrawlClient` reads `/v2/concurrency-check` on first use and sizes its `Semaphore` to the plan's cap (override with `FIRECRAWL_MAX_CONCURRENCY`). A `TokenBucket` keeps requests under `FIRECRAWL_RPM` (default 10/min) so 429s are rare; when they happen `withRetry` honours `Retry-After` and backs off exponentially with jitter.
- Every run has a `--max-credits` budget; the pipeline stops cleanly when it is reached and records credits in `ScrapeRun`.
- Listing pages paginate via `discoverNextPage` (rel=next, `?page=`, `/page/2/`, and "next/weiter/suivant/次へ/다음" anchors) up to `--max-pages`; profile links are discovered with `discoverProfileLinks` and scraped concurrently up to `--max-profiles`.
- **Adaptive listing extraction**: if a listing page yields no profile links (forum thread, classified board, single-page directory) the pipeline extracts guides from the listing itself and segments the markdown per guide / per phone number.

### Extraction: LLM + regex, evidence-required

Firecrawl's `json` format is driven by `PAGE_EXTRACTION_JSON_SCHEMA`, which asks the model for **quoted evidence** for every non-trivial claim (vehicle, client nationalities, WhatsApp). `normalize.ts` then treats the model as a witness, not an oracle:

- phones/WhatsApp are re-extracted from the markdown with `libphonenumber-js` (`isValid()`), snapped to page-verified numbers by suffix, and `whatsappConfirmed` is only `true` for `wa.me` / `api.whatsapp.com` links or an explicit "WhatsApp" label within a short window of the number;
- vehicle type, services and client nationalities are re-matched with the multilingual `dictionaries.ts` rules (`requiresContext` rules for labels that are also place names, `NATIONALITY_NOISE` to ignore currency pickers / cuisine / embassies, review text split out so guests' reviews count for client experience but not for services);
- names are cleaned of role words in 30+ languages incl. CJK (`ドライバーガイド`, `기사`, `司機導遊`), and fall back to page title, URL slug or first heading;
- `confidence` (0–1) is scored from contact completeness, evidence and independence signals; `fingerprint` (sha1 of whatsapp | phone | email | name+country) is the upsert key.

`--mode regex` runs the same normaliser without the LLM step (1 credit/page instead of 5) for cheap, wide sweeps.

### Parallel subagents / workers

`scraper/workers.ts` splits the catalogue into independent work units (per region or `--per-country`), divides the team-wide Firecrawl concurrency cap and credit budget between them, and spawns one `scraper.ts run` per unit. `--print` emits the exact command lines so units can be handed to separate subagents or machines; each writes its own `out/<unit>.jsonl` which can be `replay`ed into any ingest API.

```bash
npm run scrape:workers -- --regions europe-west,europe-south,japan,korea --max-credits 20000
npm run scrape:workers -- --per-country --country IT,ES,FR --mode regex --print
```

### Apify fallback

`createFallbackEngine()` wraps Firecrawl in a `ScrapeEngine` that, when `APIFY_TOKEN` is set, routes bot-walled hosts (social networks, sites that return 403/anti-bot pages) to Apify actors. A per-domain circuit breaker trips after repeated Firecrawl failures so the rest of the run keeps moving.

---

## Phase 2 — Database & API

`prisma/schema.prisma` defines `TourGuide` (identity, contact channels, location, vehicle, capabilities, provenance, `fingerprint @unique`) and `ScrapeRun`. List fields are JSON-encoded strings so the schema works unchanged on SQLite and PostgreSQL.

**Switching to PostgreSQL**: change `provider = "postgresql"` in `prisma/schema.prisma`, point `DATABASE_URL` at Postgres, run `npx prisma migrate dev --name init-postgres`.

| Route | Purpose |
| --- | --- |
| `POST /api/guides/ingest` | Validates `{ records: GuideRecord[], run? }` with Zod, merges with existing rows by `fingerprint` (never downgrades a confirmed WhatsApp, unions list fields, keeps the higher confidence), upserts in a transaction with per-row fallback so one bad record can't fail a batch. Optional `Authorization: Bearer $INGEST_API_KEY`. |
| `GET /api/guides` | Paginated, filterable (`country`, `vehicle`, `client`, `service`, `whatsapp`, `contact`, `independent`, `minConfidence`, `search`, `sort`) |
| `GET /api/guides/export` | Streams the same filtered set as UTF-8 CSV (BOM for Excel, formula-injection neutralised, E.164 numbers preserved) |
| `GET /api/guides/runs`, `PATCH` | Recent scrape runs / status updates from the scraper |

---

## Phase 3 — Dashboard

`src/app/page.tsx` renders stats (guides & countries, WhatsApp-confirmed, direct-contact, driver-guides, Indian-client experience), a filter bar (Country · Vehicle type · Client experience · Service · WhatsApp / contact / independence toggles · free-text search) and a sortable, paginated data table with row selection and a detail sheet showing evidence snippets and source links. **Export CSV** exports either the current filter set or the selected rows for WhatsApp/email outreach campaigns. `/runs` lists scrape runs with pages, guides and credits.

---

## Self-verification

`npm run verify` (`scripts/verify-mapping.ts`) is the project's own contract test:

1. **Schema contract** — every Zod `GuideRecord` field ↔ Prisma `TourGuide` column, enum drift between dictionaries and Zod.
2. **Normalisation fixtures** — Japanese, Korean, German, Spanish, Italian, marketplace-boilerplate and forum-thread fixtures; asserts names, E.164 numbers, `whatsappConfirmed`, vehicle, client labels and that nothing is hallucinated from boilerplate.
3. **Database round-trip** — inserts fixtures (and `--file out/x.jsonl` / `--live <url> --country XX`) inside a transaction and rolls back.

Additionally a fresh-context verifier subagent audited the Firecrawl → Zod → Prisma mapping and exercised the ingest API end-to-end before this repository was finalised (see the PR/commit history).

---

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run db:migrate` / `db:deploy` / `db:studio` / `db:reset` | Prisma |
| `npm run scrape -- …` | `scraper.ts run` |
| `npm run scrape:list -- …` | print targets without scraping |
| `npm run scrape:replay -- out/x.jsonl` | re-ingest a JSONL log |
| `npm run scrape:credits` | Firecrawl credit balance |
| `npm run scrape:workers -- …` | parallel regional dispatcher |
| `npm run verify` | mapping self-check |
| `npm run typecheck` / `lint` | tsc / eslint |

## Environment

See [`.env.example`](.env.example): `DATABASE_URL`, `FIRECRAWL_API_KEY`, optional `FIRECRAWL_MAX_CONCURRENCY`, `FIRECRAWL_RPM`, `APIFY_TOKEN`, `INGEST_API_URL`, `INGEST_API_KEY`, `SCRAPER_MODE`, `SCRAPER_MAX_CREDITS`.

## Compliance note

Only publicly listed business contact details are collected. Respect each source's terms, keep an opt-out list, and comply with GDPR / local direct-marketing rules when running outreach.
