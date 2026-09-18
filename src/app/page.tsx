import { Suspense } from "react";
import { MessageCircle, Users, Globe2, Car, Sparkles } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { buildOrderBy, buildWhere, parseGuideFilters, toGuideView } from "@/lib/guides-query";
import { CLIENT_NATIONALITIES, SERVICE_TYPES } from "@/lib/guide-schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { GuideFiltersBar, type FilterFacets } from "@/components/dashboard/guide-filters";
import { GuidesTable } from "@/components/dashboard/guides-table";

export const dynamic = "force-dynamic";

async function loadFacets(): Promise<FilterFacets> {
  const [countries, vehicles, clientCounts, serviceCounts] = await Promise.all([
    prisma.tourGuide.groupBy({ by: ["country"], _count: { _all: true }, orderBy: { _count: { country: "desc" } } }),
    prisma.tourGuide.groupBy({ by: ["vehicleType"], _count: { _all: true } }),
    Promise.all(CLIENT_NATIONALITIES.map(async (c) => ({ value: c, label: c, count: await prisma.tourGuide.count({ where: { clientExperience: { contains: `"${c}"` } } }) }))),
    Promise.all(SERVICE_TYPES.map(async (s) => ({ value: s, label: s, count: await prisma.tourGuide.count({ where: { services: { contains: `"${s}"` } } }) }))),
  ]);
  return {
    countries: countries.map((c) => ({ value: c.country, label: c.country, count: c._count._all })),
    vehicles: vehicles.filter((v) => v.vehicleType).map((v) => ({ value: v.vehicleType!, label: v.vehicleType!, count: v._count._all })),
    clients: clientCounts,
    services: serviceCounts,
  };
}

async function loadStats() {
  const [total, whatsappConfirmed, directContact, countries, indian, driverGuides] = await Promise.all([
    prisma.tourGuide.count(),
    prisma.tourGuide.count({ where: { whatsappConfirmed: true } }),
    prisma.tourGuide.count({ where: { OR: [{ whatsapp: { not: null } }, { phone: { not: null } }, { email: { not: null } }] } }),
    prisma.tourGuide.groupBy({ by: ["country"] }).then((r) => r.length),
    prisma.tourGuide.count({ where: { clientExperience: { contains: '"Indian"' } } }),
    prisma.tourGuide.count({ where: { services: { contains: '"Driver-Guide"' } } }),
  ]);
  return { total, whatsappConfirmed, directContact, countries, indian, driverGuides };
}

function StatCard({ title, value, hint, icon: Icon }: { title: string; value: string; hint?: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="flex flex-row items-center justify-between px-4 py-0">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="px-4">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default async function DirectoryPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const filters = parseGuideFilters(sp);
  const where = buildWhere(filters);

  const [stats, facets, total, rows] = await Promise.all([
    loadStats(),
    loadFacets(),
    prisma.tourGuide.count({ where }),
    prisma.tourGuide.findMany({
      where,
      orderBy: buildOrderBy(filters),
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
  ]);

  const pct = (n: number) => (stats.total ? `${Math.round((n / stats.total) * 100)}% of directory` : undefined);

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 sm:px-6">
      <section className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Directory</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Independent driver-guides and tour managers across 50 non-English-speaking markets, scraped with Firecrawl and verified against the source page.
          Filter, select, and export to CSV for WhatsApp or e-mail outreach.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard title="Guides" value={stats.total.toLocaleString()} hint={`${stats.countries} countries`} icon={Users} />
        <StatCard title="WhatsApp confirmed" value={stats.whatsappConfirmed.toLocaleString()} hint={pct(stats.whatsappConfirmed)} icon={MessageCircle} />
        <StatCard title="Direct contact" value={stats.directContact.toLocaleString()} hint="phone, WhatsApp or e-mail" icon={Globe2} />
        <StatCard title="Driver-guides" value={stats.driverGuides.toLocaleString()} hint="drive and guide" icon={Car} />
        <StatCard title="Indian-client experience" value={stats.indian.toLocaleString()} hint="explicit mention on page" icon={Sparkles} />
      </section>

      <section className="flex flex-col gap-4">
        <Suspense fallback={<Skeleton className="h-8 w-full" />}>
          <GuideFiltersBar filters={filters} facets={facets} />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <GuidesTable rows={rows.map(toGuideView)} total={total} filters={filters} />
        </Suspense>
      </section>
    </div>
  );
}
