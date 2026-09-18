import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildWhere, parseGuideFilters } from "@/lib/guides-query";
import { decodeList } from "@/lib/guide-schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/guides/export?...same filters as /api/guides
 *
 * Streams a UTF-8 CSV (with BOM so Excel opens non-Latin names correctly) of every guide matching
 * the current filters — the payload for WhatsApp / e-mail outreach tools. Optional `ids=a,b,c`
 * restricts the export to a hand-picked selection from the table.
 */

const COLUMNS = [
  "fullName",
  "companyName",
  "whatsapp",
  "whatsappConfirmed",
  "whatsappLink",
  "phone",
  "email",
  "website",
  "country",
  "countryCode",
  "city",
  "region",
  "vehicleType",
  "vehicleDetails",
  "vehicleCapacity",
  "services",
  "languages",
  "clientExperience",
  "isIndependent",
  "worksWithCouples",
  "smallGroupCapable",
  "isTourManager",
  "licensed",
  "yearsExperience",
  "confidence",
  "sourceUrl",
  "sourceDomain",
  "sourceType",
  "scrapedAt",
  "bio",
] as const;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (Array.isArray(value)) s = value.join("; ");
  else if (value instanceof Date) s = value.toISOString();
  else if (typeof value === "boolean") s = value ? "yes" : "no";
  else s = String(value);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const filters = parseGuideFilters(sp);
  const ids = (sp.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const where = ids.length ? { id: { in: ids } } : buildWhere(filters);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`\uFEFF${COLUMNS.join(",")}\r\n`));
      const BATCH = 500;
      let cursor: string | undefined;
      for (;;) {
        const rows = await prisma.tourGuide.findMany({
          where,
          orderBy: [{ id: "asc" }],
          take: BATCH,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        if (rows.length === 0) break;
        const lines = rows.map((g) => {
          const view: Record<string, unknown> = {
            ...g,
            whatsappLink: g.whatsapp ? `https://wa.me/${g.whatsapp.replace(/\D/g, "")}` : "",
            services: decodeList(g.services),
            languages: decodeList(g.languages),
            clientExperience: decodeList(g.clientExperience),
            bio: g.bio?.replace(/\s+/g, " ").slice(0, 1000) ?? "",
          };
          return COLUMNS.map((c) => csvCell(view[c])).join(",");
        });
        controller.enqueue(encoder.encode(`${lines.join("\r\n")}\r\n`));
        cursor = rows[rows.length - 1].id;
        if (rows.length < BATCH) break;
      }
      controller.close();
    },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const scope = filters.country.length ? `-${filters.country.map((c) => c.toLowerCase().replace(/\s+/g, "-")).join("_")}` : "";
  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="guide-atlas${scope}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
