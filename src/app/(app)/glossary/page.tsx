import type { Metadata } from "next";
import { GLOSSARY_GROUPS, termsByGroup, NOT_MLS_LINE } from "@/lib/glossary/terms";

/**
 * Public glossary — renders the Term Registry (single source of truth) as a
 * statically-renderable, SEO-friendly page. Server component (the registry is
 * static), so it indexes cleanly. TermTip "Full definition →" links deep-link
 * here via per-term `#<id>` anchors. Lives in the (app) group for the unified
 * AppHeader; the /properties terminal links here with a plain <a>.
 */

export const metadata: Metadata = {
  title: "Glossary — PureProperty",
  description:
    "Plain-language definitions of PureProperty's real-estate investment metrics: True DOM, Cap Rate, Carry Cost, Deal Score, Suite Potential, and more.",
};

export default function GlossaryPage() {
  const grouped = termsByGroup();
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 text-slate-200">
      <h1 className="text-2xl font-bold">Glossary</h1>
      <p className="mt-2 text-sm text-slate-400">
        What every metric on PureProperty means — and how we derive it.
      </p>

      {GLOSSARY_GROUPS.map((g) => {
        const rows = grouped[g.id];
        if (!rows || rows.length === 0) return null;
        return (
          <section key={g.id} className="mt-10">
            <h2 className="border-b border-slate-800 pb-1 text-lg font-semibold text-slate-100">
              {g.title}
            </h2>
            <dl className="mt-4 space-y-6">
              {rows.map((t) => (
                <div key={t.id} id={t.id} className="scroll-mt-24">
                  <dt className="font-semibold text-slate-100">
                    {t.name}
                    {t.aka && t.aka.length > 0 && (
                      <span className="ml-2 text-xs font-normal text-slate-500">
                        also: {t.aka.join(", ")}
                      </span>
                    )}
                  </dt>
                  <dd className="mt-1 text-sm text-slate-400">{t.definition}</dd>
                  {t.methodology && (
                    <dd className="mt-1 text-sm text-slate-500">{t.methodology}</dd>
                  )}
                  {t.notMls && (
                    <dd className="mt-1 text-xs text-slate-500">{NOT_MLS_LINE}</dd>
                  )}
                </div>
              ))}
            </dl>
          </section>
        );
      })}
    </main>
  );
}
