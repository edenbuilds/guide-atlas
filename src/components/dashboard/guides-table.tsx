"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, BadgeCheck, Car, Download, ExternalLink, Mail, MessageCircle, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { GuideFilters, GuideView } from "@/lib/guides-query";
import { GuideDetailSheet } from "./guide-detail-sheet";

interface Props {
  rows: GuideView[];
  total: number;
  filters: GuideFilters;
}

const SORTABLE: Array<{ key: GuideFilters["sort"]; label: string; className?: string }> = [
  { key: "fullName", label: "Guide" },
  { key: "country", label: "Location" },
];

export function waLink(number: string) {
  return `https://wa.me/${number.replace(/\D/g, "")}`;
}

export function GuidesTable({ rows, total, filters }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [detail, setDetail] = React.useState<GuideView | null>(null);

  // Selection is page-scoped: it is keyed by the identity of the current row set so a new page,
  // sort or filter starts with an empty selection without an effect.
  const rowsKey = React.useMemo(() => rows.map((r) => r.id).join("|"), [rows]);
  const [selection, setSelection] = React.useState<{ key: string; ids: Set<string> }>({ key: rowsKey, ids: new Set() });
  const selected = selection.key === rowsKey ? selection.ids : new Set<string>();
  const setSelected = React.useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) =>
      setSelection((prev) => {
        const base = prev.key === rowsKey ? prev.ids : new Set<string>();
        return { key: rowsKey, ids: typeof updater === "function" ? updater(base) : updater };
      }),
    [rowsKey],
  );

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = rows.some((r) => selected.has(r.id));

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const setParam = (key: string, value: string | null) => {
    const sp = new URLSearchParams(searchParams.toString());
    if (value === null) sp.delete(key);
    else sp.set(key, value);
    router.push(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  const setSort = (key: GuideFilters["sort"]) => {
    const sp = new URLSearchParams(searchParams.toString());
    if (filters.sort === key) sp.set("dir", filters.dir === "asc" ? "desc" : "asc");
    else {
      sp.set("sort", key);
      sp.set("dir", key === "fullName" || key === "country" ? "asc" : "desc");
    }
    sp.delete("page");
    router.push(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  const exportHref = (() => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("page");
    sp.delete("pageSize");
    if (someSelected) sp.set("ids", Array.from(selected).join(","));
    return `/api/guides/export?${sp.toString()}`;
  })();

  const pages = Math.max(1, Math.ceil(total / filters.pageSize));
  const from = total === 0 ? 0 : (filters.page - 1) * filters.pageSize + 1;
  const to = Math.min(total, filters.page * filters.pageSize);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {total === 0 ? "No guides match these filters." : (
            <>
              Showing <span className="font-medium text-foreground">{from.toLocaleString()}–{to.toLocaleString()}</span> of{" "}
              <span className="font-medium text-foreground">{total.toLocaleString()}</span> guides
              {someSelected && <> · <span className="font-medium text-foreground">{selected.size}</span> selected</>}
            </>
          )}
        </p>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant={someSelected ? "default" : "outline"} disabled={total === 0}>
            <a href={exportHref} download>
              <Download className="size-3.5" />
              {someSelected ? `Export ${selected.size} selected` : `Export ${total.toLocaleString()} to CSV`}
            </a>
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">
                <Checkbox checked={allSelected ? true : someSelected ? "indeterminate" : false} onCheckedChange={toggleAll} aria-label="Select all rows on this page" />
              </TableHead>
              {SORTABLE.map((c) => (
                <TableHead key={c.key} className={c.className}>
                  <button type="button" onClick={() => setSort(c.key)} className="inline-flex items-center gap-1 hover:text-foreground">
                    {c.label} <SortIcon k={c.key} sort={filters.sort} dir={filters.dir} />
                  </button>
                </TableHead>
              ))}
              <TableHead>Contact</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead>Services</TableHead>
              <TableHead>Client experience</TableHead>
              <TableHead>Languages</TableHead>
              <TableHead className="text-right">
                <button type="button" onClick={() => setSort("confidence")} className="inline-flex items-center gap-1 hover:text-foreground">
                  Score <SortIcon k="confidence" sort={filters.sort} dir={filters.dir} />
                </button>
              </TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="h-32 text-center text-muted-foreground">
                  Nothing here yet. Run the scraper (<code className="rounded bg-muted px-1 py-0.5 text-xs">npm run scrape -- --region japan</code>) or loosen the filters.
                </TableCell>
              </TableRow>
            )}
            {rows.map((g) => (
              <TableRow key={g.id} data-state={selected.has(g.id) ? "selected" : undefined} className="cursor-pointer" onClick={() => setDetail(g)}>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={selected.has(g.id)} onCheckedChange={() => toggle(g.id)} aria-label={`Select ${g.fullName}`} />
                </TableCell>
                <TableCell className="max-w-[240px]">
                  <div className="flex flex-col">
                    <span className="flex items-center gap-1.5 truncate font-medium">
                      {g.fullName}
                      {g.licensed && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <BadgeCheck className="size-3.5 shrink-0 text-emerald-600" />
                          </TooltipTrigger>
                          <TooltipContent>Licensed / certified</TooltipContent>
                        </Tooltip>
                      )}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {g.companyName ? `${g.companyName} · ` : ""}
                      {g.isIndependent ? "Independent" : "Company"}
                      {g.yearsExperience ? ` · ${g.yearsExperience} yrs` : ""}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{g.country}</span>
                    <span className="text-xs text-muted-foreground">{[g.city, g.region].filter(Boolean).join(", ") || "—"}</span>
                  </div>
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <ContactCell g={g} />
                </TableCell>
                <TableCell>
                  {g.vehicleType && g.vehicleType !== "None" ? (
                    <div className="flex flex-col">
                      <span className="flex items-center gap-1 text-sm">
                        <Car className="size-3.5 text-muted-foreground" />
                        {g.vehicleType}
                        {g.vehicleCapacity ? <span className="text-xs text-muted-foreground">· {g.vehicleCapacity} pax</span> : null}
                      </span>
                      {g.vehicleDetails && <span className="max-w-[180px] truncate text-xs text-muted-foreground">{g.vehicleDetails}</span>}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">{g.vehicleType === "None" ? "On foot" : "—"}</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex max-w-[200px] flex-wrap gap-1">
                    {g.services.map((s) => (
                      <Badge key={s} variant={s === "Driver-Guide" ? "default" : "secondary"} className="text-[11px]">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex max-w-[200px] flex-wrap gap-1">
                    {g.clientExperience.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                    {g.clientExperience.map((c) => (
                      <Badge key={c} variant="outline" className={cn("text-[11px]", c === "Indian" && "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-400")}>
                        {c}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="max-w-[160px] truncate text-xs text-muted-foreground">{g.languages.join(", ") || "—"}</TableCell>
                <TableCell className="text-right">
                  <ConfidencePill value={g.confidence} />
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <a href={g.sourceUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                        <ExternalLink className="size-3.5" />
                      </a>
                    </TooltipTrigger>
                    <TooltipContent>{g.sourceDomain}</TooltipContent>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          Rows per page
          <Select value={String(filters.pageSize)} onValueChange={(v) => setParam("pageSize", v === "50" ? null : v)}>
            <SelectTrigger className="h-8 w-[80px]" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[25, 50, 100, 200].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1">
          <PageLink page={1} current={filters.page} disabled={filters.page <= 1} label="First" />
          <PageLink page={filters.page - 1} current={filters.page} disabled={filters.page <= 1} label="Prev" />
          <span className="px-2 text-sm text-muted-foreground">
            Page <span className="font-medium text-foreground">{filters.page}</span> of {pages}
          </span>
          <PageLink page={filters.page + 1} current={filters.page} disabled={filters.page >= pages} label="Next" />
          <PageLink page={pages} current={filters.page} disabled={filters.page >= pages} label="Last" />
        </div>
      </div>

      <GuideDetailSheet guide={detail} onOpenChange={(open) => !open && setDetail(null)} />
    </div>
  );
}

function SortIcon({ k, sort, dir }: { k: GuideFilters["sort"]; sort: GuideFilters["sort"]; dir: GuideFilters["dir"] }) {
  if (sort !== k) return <ArrowUpDown className="size-3 opacity-40" />;
  return dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />;
}

function PageLink({ page, disabled, label }: { page: number; current: number; disabled: boolean; label: string }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const sp = new URLSearchParams(searchParams.toString());
  if (page <= 1) sp.delete("page");
  else sp.set("page", String(page));
  const href = `${pathname}?${sp.toString()}`;
  if (disabled)
    return (
      <Button size="sm" variant="outline" disabled>
        {label}
      </Button>
    );
  return (
    <Button asChild size="sm" variant="outline">
      <Link href={href} scroll={false}>
        {label}
      </Link>
    </Button>
  );
}

function ContactCell({ g }: { g: GuideView }) {
  const items: React.ReactNode[] = [];
  if (g.whatsapp) {
    items.push(
      <Tooltip key="wa">
        <TooltipTrigger asChild>
          <a
            href={waLink(g.whatsapp)}
            target="_blank"
            rel="noreferrer"
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-xs",
              g.whatsappConfirmed ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "border-border text-foreground",
            )}
          >
            <MessageCircle className="size-3" />
            {g.whatsapp}
          </a>
        </TooltipTrigger>
        <TooltipContent>{g.whatsappConfirmed ? "WhatsApp confirmed on source page" : "Number found; WhatsApp not confirmed"}</TooltipContent>
      </Tooltip>,
    );
  }
  if (g.phone && g.phone !== g.whatsapp) {
    items.push(
      <a key="tel" href={`tel:${g.phone}`} className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground">
        <Phone className="size-3" />
        {g.phone}
      </a>,
    );
  }
  if (g.email) {
    items.push(
      <a key="mail" href={`mailto:${g.email}`} className="inline-flex max-w-[200px] items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground">
        <Mail className="size-3 shrink-0" />
        <span className="truncate">{g.email}</span>
      </a>,
    );
  }
  if (items.length === 0)
    return (
      <a href={g.contactPageUrl ?? g.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground underline-offset-2 hover:underline">
        via {g.sourceDomain}
      </a>
    );
  return <div className="flex flex-col items-start gap-1">{items}</div>;
}

export function ConfidencePill({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = value >= 0.7 ? "bg-emerald-500" : value >= 0.45 ? "bg-amber-500" : "bg-neutral-400";
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs tabular-nums">
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
        <span className={cn("block h-full", tone)} style={{ width: `${pct}%` }} />
      </span>
      {pct}
    </span>
  );
}
