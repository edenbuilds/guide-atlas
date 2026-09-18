import Link from "next/link";
import { Compass } from "lucide-react";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Compass className="size-4" />
          </span>
          <span>Guide Atlas</span>
          <span className="hidden text-xs font-normal text-muted-foreground sm:inline">independent driver-guide directory</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/" className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            Directory
          </Link>
          <Link href="/runs" className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            Scrape runs
          </Link>
          <a
            href="https://github.com/edenbuilds/guide-atlas"
            target="_blank"
            rel="noreferrer"
            className="rounded-md px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
