/**
 * /data/child-care/toronto — licensed child care spaces per 100 children under 5, for each of
 * Toronto's 158 neighbourhoods. Every sentence comes from buildChildCareFacts
 * (src/lib/childcare/childCarePage.ts); the FAQ and the Dataset JSON-LD reuse them.
 *
 * Static: the figures live in data/toronto-child-care.json (rebuilt weekly by
 * refresh-child-care.yml), so a page view runs no function and no query. Toronto only:
 * no other city publishes centre locations with spaces by age group.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Baby, Home } from "lucide-react";
import HubFaq from "@/components/seo/HubFaq";
import { CiteBox, HeaderCard, LinkCard, PriceOpinionCard, StatCard } from "@/components/dataPage/parts";
import ChildCareMap from "@/components/childCare/ChildCareMap";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import {
  CHILD_CARE_PATH,
  CHILD_CARE_SOURCE_LINE,
  STEP_LABELS,
  buildChildCareFacts,
  getChildCareData,
  mapShapes,
} from "@/lib/childcare/childCarePage";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { metaDescription } from "@/lib/seo/metaDescription";
import { DATA_PUBLISHER } from "@/lib/seo/publisher";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
const CANONICAL = `${SITE_URL}${CHILD_CARE_PATH}`;

export function generateMetadata(): Metadata {
  const facts = buildChildCareFacts(getChildCareData());
  return {
    metadataBase: new URL(SITE_URL),
    title: `${facts.title} | PureProperty`,
    description: metaDescription(facts.summary),
    alternates: { canonical: CANONICAL },
    openGraph: {
      title: facts.title,
      description: metaDescription(facts.summary),
      url: CANONICAL,
      siteName: "PureProperty",
      type: "article",
      images: [ogImageUrl({ eyebrow: "Child care · Toronto", title: "Child care spaces per child, by neighbourhood", subtitle: "All 158 Toronto neighbourhoods." })],
    },
  };
}

function Dot() {
  return <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-600 dark:bg-teal-400" />;
}

function Row({ i, n }: { i: number; n: { name: string; children: number; infant: number; youngSpaces: number; per100: number } }) {
  return (
    <tr className="border-t border-border">
      <td className="py-2 pr-3 tabular-nums text-muted-foreground">{i}</td>
      <td className="py-2 pr-3 text-foreground">{n.name}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{n.children.toLocaleString("en-CA")}</td>
      <td className="hidden py-2 pr-3 text-right tabular-nums sm:table-cell">{n.youngSpaces.toLocaleString("en-CA")}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{n.infant}</td>
      <td className="py-2 text-right font-semibold tabular-nums">{Math.round(n.per100)}</td>
    </tr>
  );
}

function Head() {
  return (
    <thead>
      <tr className="text-left text-xs text-muted-foreground">
        <th className="pb-2 pr-3" />
        <th className="pb-2 pr-3 font-medium">Neighbourhood</th>
        <th className="pb-2 pr-3 text-right font-medium">Children under 5</th>
        <th className="hidden pb-2 pr-3 text-right font-medium sm:table-cell">Spaces</th>
        <th className="pb-2 pr-3 text-right font-medium">Infant</th>
        <th className="pb-2 text-right font-medium">Per 100</th>
      </tr>
    </thead>
  );
}

export default function TorontoChildCarePage() {
  const file = getChildCareData();
  const facts = buildChildCareFacts(file);
  const map = mapShapes(file);
  const c = file.city;
  const updatedLabel = new Date(`${file.updated}T12:00:00Z`).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "America/Toronto" });
  const citation = `PureProperty, "${facts.title}", updated ${updatedLabel}, ${CANONICAL.replace(/^https?:\/\/(www\.)?/, "")}`;

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Data", item: `${SITE_URL}/data` },
      { "@type": "ListItem", position: 3, name: "Child care in Toronto", item: CANONICAL },
    ],
  };
  const dataset = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: facts.title,
    description: facts.facts.map((f) => f.text).join(" "),
    url: CANONICAL,
    dateModified: file.updated,
    isAccessibleForFree: true,
    creator: DATA_PUBLISHER,
    publisher: DATA_PUBLISHER,
    spatialCoverage: { "@type": "Place", name: "Toronto, Ontario, Canada" },
    measurementTechnique: "Licensed infant, toddler and preschool spaces of each centre, summed by the neighbourhood that contains it, divided by children aged 0 to 4 (2021 Census). " + CHILD_CARE_SOURCE_LINE,
    variableMeasured: [
      { "@type": "PropertyValue", name: "Child care spaces per 100 children under 5, Toronto", value: c.per100 },
      { "@type": "PropertyValue", name: "Infant spaces per 100 children under 5, Toronto", value: c.infantPer100 },
    ],
  };

  return (
    <main className="min-h-app bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(dataset) }} />
      <div className="mx-auto max-w-4xl px-4 py-8">
        <nav className="mb-5 text-sm text-muted-foreground">
          <Link href="/data" className="hover:text-foreground">Data</Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">Child care in Toronto</span>
        </nav>

        <HeaderCard
          Icon={Baby}
          eyebrow="Child care · Toronto"
          title={facts.title}
          lede={
            <>
              <p>{facts.summary}</p>
              <p className="mt-2 text-sm">
                Updated <time dateTime={file.updated}>{updatedLabel}</time> · City of Toronto licensed centres, refreshed weekly
              </p>
            </>
          }
          hero={String(Math.round(c.per100))}
          heroSub="spaces per 100 children under 5"
        />

        <section className="mt-4 grid gap-3 sm:grid-cols-3" aria-label="Key figures">
          <StatCard label="Infant spaces" value={c.infantPer100.toFixed(1)} sub={`per 100 children under 5. ${c.infant.toLocaleString("en-CA")} spaces for babies under 18 months, in the whole city.`} />
          <StatCard label="No infant care" value={`${facts.zeroInfant} of 158`} sub="neighbourhoods have no licensed infant space." />
          <StatCard label="$10-a-day centres" value={`${facts.cwelccPct}%`} sub={`of the ${file.centres.length.toLocaleString("en-CA")} licensed centres are in the program.`} />
        </section>

        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="shows">
          <h2 id="shows" className="text-lg font-semibold">What the data shows</h2>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed">
            {facts.facts.map((f) => (
              <li key={f.id} className="flex gap-2">
                <Dot />
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="map">
          <h2 id="map" className="text-lg font-semibold">Spaces per 100 children under 5, by neighbourhood</h2>
          <p className="mt-1 text-sm text-muted-foreground">Darker means more spaces per child.</p>
          <div className="mt-4">
            <ChildCareMap width={map.width} height={map.height} shapes={map.shapes} labels={STEP_LABELS} cityPer100={c.per100} />
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-border bg-card/40 p-5 sm:p-6" aria-labelledby="fewest">
          <h2 id="fewest" className="text-lg font-semibold">The 10 neighbourhoods with the fewest spaces per child</h2>
          <p className="mt-1 text-sm text-muted-foreground">Spaces = licensed infant, toddler and preschool spaces. Per 100 = spaces per 100 children under 5.</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <Head />
              <tbody>
                {facts.lowest.map((n, i) => <Row key={n.name} i={i + 1} n={n} />)}
              </tbody>
            </table>
          </div>
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-medium text-teal-700 dark:text-teal-400">Show all 158 neighbourhoods</summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <Head />
                <tbody>
                  {facts.ranked.map((n, i) => <Row key={n.name} i={i + 1} n={n} />)}
                </tbody>
              </table>
            </div>
          </details>
        </section>

        <section className="mt-8 grid gap-3 sm:grid-cols-2">
          <LinkCard
            href="/property/on/toronto"
            Icon={Home}
            title="Child care near a home for sale"
            text="Every Toronto listing shows the licensed centres within 1 km, their infant spaces and the $10-a-day centres."
          />
          <PriceOpinionCard citySlug="toronto" />
        </section>

        <div className="mx-auto max-w-3xl">
          <section className="mt-10" aria-labelledby="how">
            <h2 id="how" className="text-lg font-semibold">How we measured it</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              We took every licensed child care centre in the City of Toronto list ({file.centres.length.toLocaleString("en-CA")} centres) and
              added up its infant, toddler and preschool spaces. Each centre counts in the neighbourhood that contains it. We divided the total
              by the number of children aged 0 to 4 in that neighbourhood in the 2021 Census, and show it per 100 children. Kindergarten and
              school-age spaces are left out, because they serve older children.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Limits: a licensed space is capacity, not an open spot, and most centres have wait lists. Parents often use a centre near
              work, so a neighbourhood with many offices can show many spaces per child. Home child care agencies are not in the list. The
              child counts are from 2021; neighbourhoods that have grown since then show more spaces per child than they really have.
            </p>
          </section>

          <div className="mt-10">
            <HubFaq faqs={facts.faqs} heading="Child care in Toronto: common questions" />
          </div>

          <CiteBox citation={citation} />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{CHILD_CARE_SOURCE_LINE}</p>

          <div className="mt-8">
            <ListingComplianceNotice />
          </div>
        </div>
      </div>
    </main>
  );
}
