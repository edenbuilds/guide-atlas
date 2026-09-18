"use client";

import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

export interface MultiSelectOption {
  value: string;
  label: string;
  count?: number;
}

interface MultiSelectProps {
  label: string;
  options: MultiSelectOption[];
  value: string[];
  onChange: (next: string[]) => void;
  searchPlaceholder?: string;
  className?: string;
}

export function MultiSelect({ label, options, value, onChange, searchPlaceholder, className }: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const selected = new Set(value);

  const toggle = (v: string) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(Array.from(next));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className={cn("h-8 justify-between gap-2 font-normal", className)}>
          <span className="flex items-center gap-1.5 truncate">
            <span className="text-muted-foreground">{label}</span>
            {value.length > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 font-mono text-[11px]">
                {value.length}
              </Badge>
            )}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder ?? `Search ${label.toLowerCase()}…`} />
          <CommandList className="max-h-72">
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => {
                const active = selected.has(opt.value);
                return (
                  <CommandItem key={opt.value} value={opt.label} onSelect={() => toggle(opt.value)} className="justify-between">
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "flex size-4 items-center justify-center rounded-sm border border-primary",
                          active ? "bg-primary text-primary-foreground" : "opacity-40 [&_svg]:invisible",
                        )}
                      >
                        <Check className="size-3" />
                      </span>
                      {opt.label}
                    </span>
                    {opt.count !== undefined && <span className="font-mono text-xs text-muted-foreground">{opt.count}</span>}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
          {value.length > 0 && (
            <div className="border-t p-1">
              <Button variant="ghost" size="sm" className="w-full justify-center" onClick={() => onChange([])}>
                <X className="size-3.5" /> Clear
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
