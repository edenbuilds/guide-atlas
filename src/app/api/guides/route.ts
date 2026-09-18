import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildOrderBy, buildWhere, parseGuideFilters, toGuideView } from "@/lib/guides-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/guides?country=Japan&vehicle=Minivan&client=Indian&whatsapp=confirmed&page=1 */
export async function GET(req: NextRequest) {
  const filters = parseGuideFilters(req.nextUrl.searchParams);
  const where = buildWhere(filters);
  const [total, rows] = await Promise.all([
    prisma.tourGuide.count({ where }),
    prisma.tourGuide.findMany({
      where,
      orderBy: buildOrderBy(filters),
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
  ]);
  return NextResponse.json({
    total,
    page: filters.page,
    pageSize: filters.pageSize,
    pages: Math.max(1, Math.ceil(total / filters.pageSize)),
    filters,
    data: rows.map(toGuideView),
  });
}
