/**
 * Shared parts of the public data pages (2026-11 design pass): stat card, page header card,
 * request cards, cite box. Server components; every figure they show is plain HTML text.
 * The Power of Sale Index (PosIndexView) was the first page in this style.
 */
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Home, Quote, Search } from "lucide-react";
import CopyCitation from "./CopyCitation";

export function StatCard({ label, value, sub, children }: { label: string; value: string; sub: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card/60 p-4">
      <p className="terminal-font text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{sub}</p>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

export function HeaderCard({
  Icon,
  eyebrow,
  title,
  lede,
  hero,
  heroSub,
  heroExtra,
}: {
  Icon: LucideIcon;
  eyebrow: string;
  title: string;
  lede: React.ReactNode;
  hero: string | null;
  heroSub?: string;
  heroExtra?: React.ReactNode;
}) {
  return (
    <header className="overflow-hidden rounded-2xl border border-border bg-card/60">
      <div className="border-b border-border px-5 py-3 sm:px-7">
        <p className="terminal-font flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-teal-700 dark:text-teal-400">
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          {eyebrow}
        </p>
      </div>
      <div className="grid gap-6 px-5 py-6 sm:px-7 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{title}</h1>
          <div className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">{lede}</div>
        </div>
        {hero && (
          <div className="md:text-right">
            <p className="text-5xl font-bold tabular-nums tracking-tight text-foreground sm:text-6xl">{hero}</p>
            {heroSub && <p className="mt-1 text-sm text-muted-foreground">{heroSub}</p>}
            {heroExtra && <div className="mt-2">{heroExtra}</div>}
          </div>
        )}
      </div>
    </header>
  );
}

/** The two request cards: homes for sale in the city, and a free price opinion. */
export function RequestCards({ city, citySlug }: { city: string; citySlug: string }) {
  return (
    <section className="mt-8 grid gap-3 sm:grid-cols-2">
      <LinkCard
        href={`/property/on/${citySlug}`}
        Icon={Search}
        title={`Homes for sale in ${city}`}
        text="Every listing with its true days on market, price cuts and sold history."
      />
      <Link href={`/home-value/${citySlug}`} className="flex items-start gap-3 rounded-2xl border border-emerald-600/40 bg-emerald-600/5 p-5 transition-colors hover:border-emerald-600/70">
        <Home className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
        <span>
          <span className="block font-semibold">Selling? Get a free price opinion</span>
          <span className="mt-1 block text-sm text-muted-foreground">A licensed Ontario REALTOR® reads the recent sales near your home and writes one for you.</span>
        </span>
      </Link>
    </section>
  );
}

export function LinkCard({ href, Icon, title, text }: { href: string; Icon: LucideIcon; title: string; text: string }) {
  return (
    <Link href={href} className="flex items-start gap-3 rounded-2xl border border-border bg-card/60 p-5 transition-colors hover:border-teal-600/50">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-teal-700 dark:text-teal-400" aria-hidden="true" />
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="mt-1 block text-sm text-muted-foreground">{text}</span>
      </span>
    </Link>
  );
}

export function CiteBox({ citation }: { citation: string }) {
  return (
    <section className="mt-8 rounded-xl border border-border bg-card/60 p-4" aria-label="Cite this page">
      <div className="flex items-start gap-3">
        <Quote className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Free to quote with attribution</p>
          <p className="mt-1 break-words text-xs text-muted-foreground">{citation}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <CopyCitation text={citation} />
            <Link href="/data/for-journalists" className="text-xs underline hover:text-foreground">For journalists: custom city figures</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
