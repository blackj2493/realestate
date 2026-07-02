/**
 * Hub FAQ — renders a visible Q&A list AND the matching FAQPage JSON-LD, so the same
 * answers serve users, Google (rich result eligibility), and AI answer engines (which
 * favour Q&A-formatted, factual content). Server component.
 *
 * Compliance: answers are deterministic template text (no LLM processing of listing data,
 * §4) and never expose gated/VOW metrics — they describe and point, they don't reveal.
 * The visible text MUST match the schema text (Google requirement), so both come from the
 * same `faqs` array.
 */

export interface Faq {
  q: string;
  a: string;
}

export default function HubFaq({
  faqs,
  heading = "Frequently asked questions",
}: {
  faqs: Faq[];
  heading?: string;
}) {
  if (!faqs.length) return null;

  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <section className="mt-10" aria-labelledby="faq-heading">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <h2 id="faq-heading" className="mb-3 text-sm font-semibold uppercase tracking-wider text-foreground">
        {heading}
      </h2>
      <dl className="space-y-3">
        {faqs.map((f) => (
          <div key={f.q} className="rounded-lg border border-border bg-card/40 p-4">
            <dt className="text-sm font-semibold text-foreground">{f.q}</dt>
            <dd className="mt-1 text-sm leading-relaxed text-muted-foreground">{f.a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
