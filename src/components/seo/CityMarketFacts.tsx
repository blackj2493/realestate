/**
 * "{City} housing market facts" — the citable block on a city hub. Server component.
 *
 * Built for quotation: each fact is one self-contained sentence (place, number, period),
 * followed by the source, the update date and a ready "cite as" line. The same facts are
 * emitted as a schema.org Dataset so search engines and AI assistants read the numbers,
 * the date and the publisher without parsing prose. Text comes from buildCityFacts, the
 * one builder the FAQ and the meta description also use.
 *
 * Aggregate statistics only (no listing rows), same category as the /data trackers.
 */
import Link from "next/link";
import { SOURCE_LINE, type CityFacts } from "@/lib/data/cityFacts";

export default function CityMarketFacts({ facts, canonical, outlookHref }: { facts: CityFacts; canonical: string; outlookHref?: string }) {
  const title = `${facts.city} housing market facts`;
  const dataset = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: title,
    description: facts.facts.map((f) => f.text).join(" "),
    url: `${canonical}#market-facts`,
    dateModified: facts.updatedIso,
    isAccessibleForFree: true,
    creator: { "@type": "Organization", name: "PureProperty", url: "https://www.pureproperty.ca" },
    spatialCoverage: { "@type": "Place", name: `${facts.city}, Ontario, Canada` },
    measurementTechnique: SOURCE_LINE,
    variableMeasured: facts.facts.map((f) => ({ "@type": "PropertyValue", ...f.measure })),
  };
  const host = canonical.replace(/^https?:\/\/(www\.)?/, "");

  return (
    <section id="market-facts" className="mb-8 rounded-lg border border-border bg-card/40 p-5" aria-labelledby="market-facts-heading">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(dataset) }} />
      <h2 id="market-facts-heading" className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Updated <time dateTime={facts.updatedIso}>{facts.updatedLabel}</time>
      </p>
      <ul className="mt-3 space-y-2 text-sm leading-relaxed text-foreground">
        {facts.facts.map((f) => (
          <li key={f.id} className="flex gap-2">
            <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600 dark:bg-emerald-400" />
            <span>{f.text}</span>
          </li>
        ))}
      </ul>
      {outlookHref && (
        <p className="mt-3 text-sm">
          <Link href={outlookHref} className="underline hover:text-foreground">
            Prices and sales against a year earlier, and when homes sell in {facts.city} →
          </Link>
        </p>
      )}
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        {SOURCE_LINE} How each figure is measured:{" "}
        <Link href="/data/days-on-market" className="underline hover:text-foreground">days on market</Link>,{" "}
        <Link href="/data/price-cuts" className="underline hover:text-foreground">price cuts</Link>,{" "}
        <Link href="/data/over-asking" className="underline hover:text-foreground">sale vs asking price</Link>.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Cite as: PureProperty, &ldquo;{title}&rdquo;, updated {facts.updatedLabel}, {host}
      </p>
    </section>
  );
}
