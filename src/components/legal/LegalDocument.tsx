/**
 * LegalDocument — shared presentational layout for the /terms and /privacy pages.
 * Server component: renders a title + intro + numbered sections (heading + paragraphs)
 * in the site's dark theme, with a header (home + Terms/Privacy nav) and footer.
 */

import Link from "next/link";
import Logo from "@/components/Logo";

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export default function LegalDocument({
  title,
  intro,
  sections,
}: {
  title: string;
  intro: string;
  sections: LegalSection[];
}) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-200">
      <header className="border-b border-slate-800 px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link href="/" aria-label="PureProperty.ca home" className="inline-flex items-center">
            <Logo size="md" theme="dark" />
          </Link>
          <nav className="flex gap-4 text-xs uppercase tracking-wider text-slate-400">
            <Link href="/terms" className="transition-colors hover:text-cyan-300">
              Terms
            </Link>
            <Link href="/privacy" className="transition-colors hover:text-cyan-300">
              Privacy
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <h1 className="text-2xl font-bold text-slate-100">{title}</h1>
        <p className="mt-4 text-sm leading-relaxed text-slate-400">{intro}</p>

        <div className="mt-8 space-y-8">
          {sections.map((s) => (
            <section key={s.heading}>
              <h2 className="text-base font-semibold text-slate-100">{s.heading}</h2>
              <div className="mt-2 space-y-3">
                {s.paragraphs.map((p, i) => (
                  <p key={i} className="text-sm leading-relaxed text-slate-400">
                    {p}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>

      <footer className="border-t border-slate-800 py-6 text-center text-[11px] text-slate-600">
        © {new Date().getFullYear()} PureProperty.ca · Powered by PROPTX MLS®
      </footer>
    </div>
  );
}
