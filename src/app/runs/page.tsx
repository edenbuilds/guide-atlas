import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

function duration(start: Date, end: Date | null) {
  const ms = (end ?? new Date()).getTime() - start.getTime();
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 120) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

export default async function RunsPage() {
  const runs = await prisma.scrapeRun.findMany({ orderBy: { startedAt: "desc" }, take: 100 });
  const totals = runs.reduce(
    (acc, r) => ({ pages: acc.pages + r.pagesScraped, guides: acc.guides + r.guidesUpserted, credits: acc.credits + r.creditsUsed }),
    { pages: 0, guides: 0, credits: 0 },
  );

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 sm:px-6">
      <section className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Scrape runs</h1>
        <p className="text-sm text-muted-foreground">
          Every invocation of <code className="rounded bg-muted px-1 py-0.5 text-xs">scraper.ts run</code> that reached the ingest API. Totals: {totals.pages.toLocaleString()} pages,{" "}
          {totals.guides.toLocaleString()} upserts, {totals.credits.toLocaleString()} Firecrawl credits.
        </p>
      </section>

      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableHead>Started</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Pages</TableHead>
              <TableHead className="text-right">Found</TableHead>
              <TableHead className="text-right">Upserted</TableHead>
              <TableHead className="text-right">Credits</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead>Targets</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="h-24 text-center text-muted-foreground">
                  No runs recorded yet.
                </TableCell>
              </TableRow>
            )}
            {runs.map((r) => {
              const targets = JSON.parse(r.targetUrls) as string[];
              return (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-sm">{r.startedAt.toLocaleString()}</TableCell>
                  <TableCell className="text-sm">{r.region ?? "custom"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{r.mode}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.status === "completed" ? "secondary" : r.status === "failed" ? "destructive" : "default"}>{r.status}</Badge>
                    {r.error && <p className="mt-1 max-w-[240px] truncate text-xs text-destructive">{r.error}</p>}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">{r.pagesScraped}</TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">{r.guidesFound}</TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">{r.guidesUpserted}</TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">{r.creditsUsed}</TableCell>
                  <TableCell className="text-right font-mono text-sm tabular-nums">{duration(r.startedAt, r.finishedAt)}</TableCell>
                  <TableCell className="max-w-[360px] truncate text-xs text-muted-foreground" title={targets.join("\n")}>
                    {targets.length} target{targets.length === 1 ? "" : "s"}: {targets.slice(0, 2).join(", ")}
                    {targets.length > 2 ? "…" : ""}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
