import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const required = process.env.INGEST_API_KEY;
  if (!required) return true;
  return (req.headers.get("authorization") ?? "") === `Bearer ${required}`;
}

/** GET /api/guides/runs — recent scrape runs */
export async function GET() {
  const runs = await prisma.scrapeRun.findMany({ orderBy: { startedAt: "desc" }, take: 50 });
  return NextResponse.json({ data: runs.map((r) => ({ ...r, targetUrls: JSON.parse(r.targetUrls) as string[] })) });
}

const PatchSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["running", "completed", "failed"]).optional(),
  pagesScraped: z.number().int().min(0).optional(),
  creditsUsed: z.number().int().min(0).optional(),
  error: z.string().max(4000).nullable().optional(),
});

/** PATCH /api/guides/runs — close or update a run started by the ingest endpoint */
export async function PATCH(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "validation failed", issues: parsed.error.issues }, { status: 422 });
  const { id, ...data } = parsed.data;
  try {
    const run = await prisma.scrapeRun.update({
      where: { id },
      data: {
        ...data,
        finishedAt: data.status && data.status !== "running" ? new Date() : undefined,
      },
    });
    return NextResponse.json({ data: run });
  } catch {
    return NextResponse.json({ error: "run not found" }, { status: 404 });
  }
}
