/**
 * Link discovery: finds profile pages and pagination links inside a listing page.
 *
 * Works from the `links` array Firecrawl returns (absolute URLs) plus the markdown, so it is
 * DOM-structure agnostic and survives non-English sites: "next page" is recognised via URL
 * patterns (?page=2, /page/2, ?p=2, ?offset=, &start=) and via multilingual anchor text.
 */

export interface DiscoveryConfig {
  /** regex tested against the pathname+search of same-site links; matches become profile pages */
  profilePattern?: RegExp;
  /** substrings that disqualify a URL (login, terms, images…) */
  excludePattern?: RegExp;
  /** allow profile links on other hosts (e.g. directories that link out to personal sites) */
  allowExternal?: boolean;
  maxProfilesPerPage?: number;
}

const DEFAULT_PROFILE_PATTERN =
  /\/(guide|guides|tour-?guide|tourguide|profile|profiles|member|members|user|users|local|locals|driver|drivers|chauffeur|people|person|guia|guias|guida|guide|fuehrer|fremdenfuehrer|reiseleiter|przewodnik|pruvodce|gid|gids|rehber|ksenagos|ガイド|가이드)[/-]|\/(g|u|p)\/[\w-]+|[?&](guide|user|member|profile|id)=\w+/i;

const DEFAULT_EXCLUDE =
  /\.(png|jpe?g|gif|svg|webp|css|js|pdf|zip)(\?|$)|\/(login|signin|signup|register|logout|password|cart|checkout|terms|privacy|policy|cookie|legal|imprint|impressum|faq|help|support|about|contact-us|careers|jobs|press|blog|news|sitemap|search|tag|category|wp-json|feed|rss|xmlrpc|share|print)\b|#|mailto:|tel:|javascript:/i;

const NEXT_TEXT =
  /^(next|next page|older|more|show more|load more|weiter|nächste|suivant|page suivante|siguiente|próxima|proxima|seguinte|successiv[ao]|avanti|volgende|następna|dalej|další|následující|következő|următoarea|следующая|напред|следваща|επόμενη|sonraki|ileri|sljedeća|naprijed|nästa|neste|næste|seuraava|järgmine|nākamā|kitas|tjetra|შემდეგი|次へ|次のページ|次|다음|다음 페이지|»|›|>|→)$/iu;

const PAGE_PARAM_RE = /([?&])(page|p|pg|pagina|seite|strona|stranka|oldal|sayfa|страница|ページ|페이지|start|offset|from|skip)=(\d+)/i;
const PAGE_PATH_RE = /\/(page|p|pagina|seite|strona|stranka|oldal|sayfa|str)[/-](\d+)\/?$/i;

export function sameSite(a: string, b: string): boolean {
  try {
    const ha = new URL(a).hostname.replace(/^www\./, "");
    const hb = new URL(b).hostname.replace(/^www\./, "");
    return ha === hb || ha.endsWith(`.${hb}`) || hb.endsWith(`.${ha}`);
  } catch {
    return false;
  }
}

export function normalizeUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = "";
    // strip common tracking params
    for (const k of Array.from(url.searchParams.keys())) if (/^(utm_|fbclid|gclid|ref$|source$|_ga)/i.test(k)) url.searchParams.delete(k);
    let s = url.toString();
    if (s.endsWith("/") && url.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return u;
  }
}

export function discoverProfileLinks(listingUrl: string, links: string[], markdown: string, cfg: DiscoveryConfig = {}): string[] {
  const profile = cfg.profilePattern ?? DEFAULT_PROFILE_PATTERN;
  const exclude = cfg.excludePattern ?? DEFAULT_EXCLUDE;
  const max = cfg.maxProfilesPerPage ?? 200;
  const listing = normalizeUrl(listingUrl);

  const candidates = new Set<string>();
  const consider = (raw: string) => {
    let abs: string;
    try {
      abs = new URL(raw, listingUrl).toString();
    } catch {
      return;
    }
    const norm = normalizeUrl(abs);
    if (norm === listing) return;
    if (exclude.test(norm)) return;
    if (!cfg.allowExternal && !sameSite(norm, listingUrl)) return;
    let pathAndQuery: string;
    try {
      const u = new URL(norm);
      pathAndQuery = u.pathname + u.search;
    } catch {
      return;
    }
    if (profile.test(pathAndQuery)) candidates.add(norm);
  };

  for (const l of links) consider(l);
  // Markdown links catch relative hrefs Firecrawl occasionally omits from `links`.
  for (const m of markdown.matchAll(/\]\(([^)\s]+)\)/g)) consider(m[1]);

  return Array.from(candidates).slice(0, max);
}

/**
 * Returns the URL of the next listing page, or null when the current page is the last one.
 * Strategy order: rel-next style anchor text → URL parameter increment → path increment.
 */
export function discoverNextPage(currentUrl: string, links: string[], markdown: string, visited: Set<string>): string | null {
  const current = normalizeUrl(currentUrl);
  const currentPage = pageNumberOf(current) ?? 1;

  // 1. anchor text like "Next", "Weiter", "次へ", "다음"
  for (const m of markdown.matchAll(/\[([^\]]{1,40})]\(([^)\s]+)\)/g)) {
    const text = m[1].replace(/[*_`\s]+/g, " ").trim();
    if (!NEXT_TEXT.test(text)) continue;
    try {
      const abs = normalizeUrl(new URL(m[2], currentUrl).toString());
      if (abs !== current && sameSite(abs, currentUrl) && !visited.has(abs)) return abs;
    } catch {
      /* ignore */
    }
  }

  // 2. links whose page number is exactly currentPage + 1 and share the listing's base path
  const base = stripPaging(current);
  const numbered = links
    .map((l) => {
      try {
        return normalizeUrl(new URL(l, currentUrl).toString());
      } catch {
        return null;
      }
    })
    .filter((l): l is string => Boolean(l) && sameSite(l!, currentUrl) && stripPaging(l!) === base)
    .map((l) => ({ url: l, page: pageNumberOf(l) }))
    .filter((x) => x.page !== null && x.page > currentPage && !visited.has(x.url))
    .sort((a, b) => a.page! - b.page!);
  if (numbered.length > 0 && numbered[0].page! <= currentPage + 1) return numbered[0].url;

  // 3. synthesise: bump ?page= / /page/N if the current URL already carries one
  const synthesized = incrementPage(current);
  if (synthesized && !visited.has(synthesized) && links.some((l) => normalizeUrl(l) === synthesized)) return synthesized;

  return null;
}

export function pageNumberOf(url: string): number | null {
  const q = PAGE_PARAM_RE.exec(url);
  if (q) return Number(q[3]);
  const p = PAGE_PATH_RE.exec(url);
  if (p) return Number(p[2]);
  return null;
}

function stripPaging(url: string): string {
  return url.replace(PAGE_PARAM_RE, "$1").replace(PAGE_PATH_RE, "").replace(/[?&]$/, "");
}

export function incrementPage(url: string): string | null {
  if (PAGE_PARAM_RE.test(url)) return url.replace(PAGE_PARAM_RE, (_, sep, key, n) => `${sep}${key}=${Number(n) + 1}`);
  if (PAGE_PATH_RE.test(url)) return url.replace(PAGE_PATH_RE, (_, key, n) => `/${key}/${Number(n) + 1}`);
  return null;
}

/** Build the URL for a given page using the target's paging template, e.g. "{url}?page={n}". */
export function pageUrlFromTemplate(template: string, baseUrl: string, n: number): string {
  return template.replace("{url}", baseUrl).replace("{n}", String(n)).replace("{offset}", String((n - 1) * 20));
}
