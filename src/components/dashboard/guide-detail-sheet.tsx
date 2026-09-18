"use client";

import { ExternalLink, Mail, MessageCircle, Phone, Globe } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { GuideView } from "@/lib/guides-query";
import { cn } from "@/lib/utils";

interface Props {
  guide: GuideView | null;
  onOpenChange: (open: boolean) => void;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return null;
  return (
    <div className="grid grid-cols-[130px_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}

function yesNo(v: boolean | null) {
  return v === null ? null : v ? "Yes" : "No";
}

export function GuideDetailSheet({ guide, onOpenChange }: Props) {
  const g = guide;
  return (
    <Sheet open={Boolean(g)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {g && (
          <>
            <SheetHeader>
              <SheetTitle className="text-xl">{g.fullName}</SheetTitle>
              <SheetDescription>
                {[g.companyName, g.city, g.region, g.country].filter(Boolean).join(" · ")}
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-wrap gap-2 px-4">
              {g.whatsapp && (
                <Button asChild size="sm" className={cn(g.whatsappConfirmed && "bg-emerald-600 hover:bg-emerald-600/90")}>
                  <a href={`https://wa.me/${g.whatsapp.replace(/\D/g, "")}`} target="_blank" rel="noreferrer">
                    <MessageCircle className="size-3.5" /> WhatsApp {g.whatsapp}
                  </a>
                </Button>
              )}
              {g.phone && g.phone !== g.whatsapp && (
                <Button asChild size="sm" variant="outline">
                  <a href={`tel:${g.phone}`}>
                    <Phone className="size-3.5" /> {g.phone}
                  </a>
                </Button>
              )}
              {g.email && (
                <Button asChild size="sm" variant="outline">
                  <a href={`mailto:${g.email}`}>
                    <Mail className="size-3.5" /> {g.email}
                  </a>
                </Button>
              )}
              {g.website && (
                <Button asChild size="sm" variant="outline">
                  <a href={g.website} target="_blank" rel="noreferrer">
                    <Globe className="size-3.5" /> Website
                  </a>
                </Button>
              )}
              <Button asChild size="sm" variant="ghost">
                <a href={g.sourceUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5" /> Source ({g.sourceDomain})
                </a>
              </Button>
            </div>

            <Separator className="my-4" />

            <dl className="px-4">
              <Field label="Services" value={<div className="flex flex-wrap gap-1">{g.services.map((s) => <Badge key={s} variant="secondary">{s}</Badge>)}</div>} />
              <Field label="Vehicle" value={g.vehicleType ? `${g.vehicleType}${g.vehicleCapacity ? ` · ${g.vehicleCapacity} pax` : ""}` : null} />
              <Field label="Vehicle details" value={g.vehicleDetails} />
              <Field label="Client experience" value={<div className="flex flex-wrap gap-1">{g.clientExperience.map((c) => <Badge key={c} variant="outline">{c}</Badge>)}</div>} />
              <Field label="Languages" value={g.languages.join(", ")} />
              <Field label="Independent" value={yesNo(g.isIndependent)} />
              <Field label="Couples" value={yesNo(g.worksWithCouples)} />
              <Field label="Small groups" value={yesNo(g.smallGroupCapable)} />
              <Field label="Tour manager" value={yesNo(g.isTourManager)} />
              <Field label="Licensed" value={yesNo(g.licensed)} />
              <Field label="Experience" value={g.yearsExperience ? `${g.yearsExperience} years` : null} />
              <Field label="WhatsApp status" value={g.whatsapp ? (g.whatsappConfirmed ? "Confirmed on source page" : "Number present, not labelled WhatsApp") : "No number"} />
              <Field label="Confidence" value={`${Math.round(g.confidence * 100)} / 100`} />
              <Field label="Source type" value={g.sourceType} />
              <Field label="Scraped" value={new Date(g.scrapedAt).toLocaleString()} />
            </dl>

            {g.bio && (
              <>
                <Separator className="my-4" />
                <div className="px-4">
                  <h4 className="mb-1 text-sm font-medium">Profile</h4>
                  <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{g.bio}</p>
                </div>
              </>
            )}

            {g.evidence && Object.keys(g.evidence).length > 0 && (
              <>
                <Separator className="my-4" />
                <div className="px-4 pb-6">
                  <h4 className="mb-2 text-sm font-medium">Evidence from source page</h4>
                  <div className="flex flex-col gap-3">
                    {Object.entries(g.evidence).map(([key, snippets]) => (
                      <div key={key}>
                        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{key}</p>
                        <ul className="flex flex-col gap-1">
                          {snippets.map((s, i) => (
                            <li key={i} className="rounded-md border bg-muted/40 px-2 py-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
                              …{s}…
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
