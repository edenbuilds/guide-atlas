"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MultiSelect, type MultiSelectOption } from "./multi-select";
import { CLIENT_NATIONALITIES, SERVICE_TYPES, VEHICLE_TYPES } from "@/lib/guide-schema";
import type { GuideFilters } from "@/lib/guides-query";

export interface FilterFacets {
  countries: MultiSelectOption[];
  vehicles: MultiSelectOption[];
  clients: MultiSelectOption[];
  services: MultiSelectOption[];
}

interface Props {
  filters: GuideFilters;
  facets: FilterFacets;
}

export function GuideFiltersBar({ filters, facets }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [q, setQ] = React.useState(filters.q ?? "");
  const [pending, startTransition] = React.useTransition();

  const update = React.useCallback(
    (mutate: (sp: URLSearchParams) => void) => {
      const sp = new URLSearchParams(searchParams.toString());
      mutate(sp);
      sp.delete("page"); // any filter change resets pagination
      startTransition(() => router.push(`${pathname}?${sp.toString()}`, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  const setList = (key: string, values: string[]) =>
    update((sp) => {
      sp.delete(key);
      for (const v of values) sp.append(key, v);
    });

  const setOne = (key: string, value: string | undefined, defaultValue?: string) =>
    update((sp) => {
      if (!value || value === defaultValue) sp.delete(key);
      else sp.set(key, value);
    });

  // Debounced free-text search.
  React.useEffect(() => {
    if (q === (filters.q ?? "")) return;
    const t = setTimeout(() => setOne("q", q.trim() || undefined), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const activeCount =
    filters.country.length +
    filters.vehicle.length +
    filters.client.length +
    filters.service.length +
    (filters.whatsapp !== "any" ? 1 : 0) +
    (filters.contact !== "any" ? 1 : 0) +
    (filters.independent !== "any" ? 1 : 0) +
    (filters.minConfidence > 0 ? 1 : 0) +
    (filters.q ? 1 : 0);

  const vehicleOptions: MultiSelectOption[] = VEHICLE_TYPES.map((v) => ({
    value: v,
    label: v,
    count: facets.vehicles.find((f) => f.value === v)?.count ?? 0,
  }));
  const clientOptions: MultiSelectOption[] = CLIENT_NATIONALITIES.map((c) => ({
    value: c,
    label: c,
    count: facets.clients.find((f) => f.value === c)?.count ?? 0,
  }));
  const serviceOptions: MultiSelectOption[] = SERVICE_TYPES.map((s) => ({
    value: s,
    label: s,
    count: facets.services.find((f) => f.value === s)?.count ?? 0,
  }));

  return (
    <div className="flex flex-col gap-3" data-pending={pending || undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, city, phone, language…"
            className="h-8 pl-8"
            aria-label="Search guides"
          />
        </div>
        <MultiSelect label="Country" options={facets.countries} value={filters.country} onChange={(v) => setList("country", v)} />
        <MultiSelect label="Vehicle" options={vehicleOptions} value={filters.vehicle} onChange={(v) => setList("vehicle", v)} />
        <MultiSelect label="Client experience" options={clientOptions} value={filters.client} onChange={(v) => setList("client", v)} />
        <MultiSelect label="Services" options={serviceOptions} value={filters.service} onChange={(v) => setList("service", v)} />

        <Select value={filters.whatsapp} onValueChange={(v) => setOne("whatsapp", v, "any")}>
          <SelectTrigger className="h-8 w-[170px]" aria-label="WhatsApp filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">WhatsApp: any</SelectItem>
            <SelectItem value="confirmed">WhatsApp confirmed</SelectItem>
            <SelectItem value="has">Has WhatsApp number</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filters.contact} onValueChange={(v) => setOne("contact", v, "any")}>
          <SelectTrigger className="h-8 w-[150px]" aria-label="Contact filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Contact: any</SelectItem>
            <SelectItem value="direct">Direct contact only</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filters.independent} onValueChange={(v) => setOne("independent", v, "any")}>
          <SelectTrigger className="h-8 w-[160px]" aria-label="Independence filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Independent: any</SelectItem>
            <SelectItem value="yes">Independent only</SelectItem>
            <SelectItem value="no">Companies only</SelectItem>
          </SelectContent>
        </Select>

        <Select value={String(filters.minConfidence)} onValueChange={(v) => setOne("minConfidence", v, "0")}>
          <SelectTrigger className="h-8 w-[160px]" aria-label="Minimum confidence">
            <SlidersHorizontal className="size-3.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Any confidence</SelectItem>
            <SelectItem value="0.4">Confidence ≥ 0.4</SelectItem>
            <SelectItem value="0.6">Confidence ≥ 0.6</SelectItem>
            <SelectItem value="0.8">Confidence ≥ 0.8</SelectItem>
          </SelectContent>
        </Select>

        {activeCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ("");
              startTransition(() => router.push(pathname, { scroll: false }));
            }}
          >
            <X className="size-3.5" />
            Clear {activeCount}
          </Button>
        )}
      </div>
    </div>
  );
}
