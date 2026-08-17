/**
 * /data/findings — the index of dated analysis.
 *
 * Its job is not traffic. It is the page an outreach email points at when the pitch is
 * "here is the kind of work we do" rather than a single story, and the page a reporter
 * lands on to check whether the last piece was a one-off. So it leads with what each
 * finding actually found, in the numbers, rather than a list of headlines.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import ListingComplianceNotice from "@/components/legal/ListingComplianceNotice";
import { LIVE_FINDINGS } from "@/lib/data/findings";
import { trackerBySlug } from "@/lib/data/trackers";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import { DESK_EMAIL } from "@/components/data/FindingShell";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;

const TITLE = "Findings — Ontario Housing Market Analysis";
const DESCRIPTION =
  "Dated analysis of Ontario housing data from the PureProperty data desk: what the numbers changed, at neighbourhood grain, with the method and the caveats stated. Free to quote with credit.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: `${TITLE} | PureProperty`,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/data/findings` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}/data/findings`,
    siteName: "PureProperty",
    type: "website",
    images: [
      ogImageUrl({
        eyebrow: "Data Desk",
        title: "Findings",
        subtitle: "Dated analysis of Ontario housing data.",
      }),
    ],
  },
};

function fmtDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function FindingsIndexPage() {
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Data", item: `${SITE_URL}/data` },
      { "@type": "ListItem", position: 3, name: "Findings", item: `${SITE_URL}/data/findings` },
    ],
  };

  return (
    <main className="min-h-app bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />

      <div className="mx-auto max-w-[900px] px-4 py-8">
        <nav className="mb-4 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-cyan-600 dark:hover:text-cyan-400">
            Home
          </Link>
          <span className="mx-2">/</span>
          <Link href="/data" className="hover:text-cyan-600 dark:hover:text-cyan-400">
            Data
          </Link>
          <span className="mx-2">/</span>
          <span className="text-foreground">Findings</span>
        </nav>

        <header className="mb-8">
          <p className="terminal-font text-xs font-bold uppercase tracking-[0.14em] text-cyan-700 dark:text-cyan-400">
            Data Desk
          </p>
          <h1 className="mt-1 text-2xl font-bold text-foreground sm:text-3xl">
            Findings from Ontario housing data
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            The{" "}
            <Link href="/data" className="text-cyan-700 underline underline-offset-2 dark:text-cyan-400">
              trackers
            </Link>{" "}
            hold the current numbers and update nightly. These are the moments the numbers said something
            worth arguing — each one dated, each one showing its method and its limits. Free to quote with
            credit.
          </p>
        </header>

        {LIVE_FINDINGS.length === 0 ? (
          <p className="text-sm text-muted-foreground">The first finding publishes shortly.</p>
        ) : (
          <ul className="space-y-4">
            {LIVE_FINDINGS.map((f) => {
              const tracker = trackerBySlug(f.trackerSlug);
              return (
                <li key={f.slug}>
                  <Link
                    href={`/data/findings/${f.slug}`}
                    className="group block rounded-lg border border-border bg-card/40 p-5 transition-colors hover:border-cyan-600/60 dark:hover:border-cyan-500/60"
                  >
                    <p className="terminal-font text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                      {fmtDate(f.published)}
                      {tracker && <> · from the {tracker.title} tracker</>}
                    </p>
                    <h2 className="mt-2 text-xl font-bold leading-snug text-foreground group-hover:text-cyan-700 dark:group-hover:text-cyan-400">
                      {f.title}
                    </h2>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.standfirst}</p>
                    <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{f.basis}</span>
                      <span aria-hidden>·</span>
                      <span>{f.coverage}</span>
                      <ArrowRight
                        className="ml-1 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <section className="mt-10 rounded-md border border-border bg-card/40 p-5">
          <p className="terminal-font text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-700 dark:text-cyan-400">
            For reporters
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Every figure in these pieces is free to quote, chart and embed with a credit and a link. If
            you need a cut we have not published — one city, a bedroom count, a longer series — email{" "}
            <a
              href={`mailto:${DESK_EMAIL}`}
              className="text-cyan-700 underline underline-offset-2 dark:text-cyan-400"
            >
              {DESK_EMAIL}
            </a>{" "}
            and you will have it within one business day. More at the{" "}
            <Link
              href="/data/for-journalists"
              className="text-cyan-700 underline underline-offset-2 dark:text-cyan-400"
            >
              press desk
            </Link>
            .
          </p>
        </section>

        <div className="mt-8">
          <ListingComplianceNotice />
        </div>
      </div>
    </main>
  );
}
