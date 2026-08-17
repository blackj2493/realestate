/**
 * One finding: /data/findings/<slug>.
 *
 * Content components are registered explicitly in CONTENT rather than resolved by a
 * dynamic import from the slug. A findings desk publishes a handful of pieces a year,
 * so the map costs nothing, and it means a slug with no content fails at build rather
 * than 404-ing in production after a rename — which is the failure that matters, since
 * these URLs get cited and a cited URL must not die quietly.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FindingShell } from "@/components/data/FindingShell";
import { FINDINGS, LIVE_FINDINGS, findingBySlug } from "@/lib/data/findings";
import { ogImageUrl } from "@/lib/og/ogImageUrl";
import OntarioOverAskingConvergence from "../_content/ontario-over-asking-convergence";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.pureproperty.ca").replace(/\/$/, "");
export const revalidate = 3600;
export const dynamicParams = false;

const CONTENT: Record<string, () => React.ReactElement> = {
  "ontario-over-asking-convergence": OntarioOverAskingConvergence,
};

export function generateStaticParams() {
  return LIVE_FINDINGS.map((f) => ({ slug: f.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const finding = findingBySlug(slug);
  if (!finding) return {};

  const url = `${SITE_URL}/data/findings/${finding.slug}`;
  return {
    metadataBase: new URL(SITE_URL),
    title: `${finding.seoTitle} | PureProperty`,
    description: finding.description,
    alternates: { canonical: url },
    openGraph: {
      title: finding.seoTitle,
      description: finding.description,
      url,
      siteName: "PureProperty",
      // "article" so the published date and author travel with the share card — this
      // page exists to be picked up by people who write things.
      type: "article",
      publishedTime: finding.published,
      modifiedTime: finding.updated ?? finding.published,
      images: [
        ogImageUrl({
          eyebrow: finding.eyebrow,
          title: finding.title,
          subtitle: finding.coverage,
        }),
      ],
    },
  };
}

export default async function FindingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const finding = findingBySlug(slug);
  // A draft in the registry must not be reachable by guessing its URL.
  if (!finding || finding.status !== "live") notFound();

  const Content = CONTENT[finding.slug];
  if (!Content) notFound();

  return (
    <FindingShell finding={finding}>
      <Content />
    </FindingShell>
  );
}

// Build-time assertion: every live finding has a body. Cheap, and it turns a broken
// cited URL into a failed deploy.
if (process.env.NODE_ENV !== "production") {
  for (const f of FINDINGS) {
    if (f.status === "live" && !CONTENT[f.slug]) {
      throw new Error(`findings: "${f.slug}" is live but has no content component registered`);
    }
  }
}
