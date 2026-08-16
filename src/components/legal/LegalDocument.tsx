/**
 * LegalDocument — shared presentational layout for the /terms and /privacy pages.
 * Server component: renders a title + intro + numbered sections (heading + paragraphs)
 * in the site's dark theme, with a header (home + Terms/Privacy nav) and footer.
 */

import React from "react";
import Link from "next/link";
import Logo from "@/components/Logo";

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

/**
 * Split `text` on email addresses and wrap each match in a mailto anchor.
 * A fresh regex is created each call to avoid `g`-flag lastIndex statefulness.
 */
function renderText(text: string): React.ReactNode {
  const re = /([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g;
  const parts = text.split(re);
  const emailRe = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    emailRe.test(part) ? (
      <a
        key={i}
        href={`mailto:${part}`}
        className="break-words text-cyan-700 dark:text-cyan-400 underline"
      >
        {part}
      </a>
    ) : (
      part
    ),
  );
}

export default function LegalDocument({
  title,
  intro,
  sections,
}: {
  title: string;
  /** Pass string[] to split the intro into paragraphs; a plain string is also accepted. */
  intro: string | string[];
  sections: LegalSection[];
}) {
  const introParagraphs = Array.isArray(intro) ? intro : [intro];

  return (
    <div className="min-h-app flex flex-col bg-background text-foreground">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="border-b border-border px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link href="/" aria-label="PureProperty.ca home" className="inline-flex items-center">
            <Logo size="md" theme="auto" />
          </Link>
          {/* Task 2: nav links ≥44px tap target + hover/active colour */}
          <nav className="flex gap-1 text-xs uppercase tracking-wider text-muted-foreground">
            <Link
              href="/terms"
              className="px-2 py-3 text-foreground transition-colors hover:text-cyan-600 dark:hover:text-cyan-300 active:text-cyan-600 dark:active:text-cyan-400"
            >
              Terms
            </Link>
            <Link
              href="/privacy"
              className="px-2 py-3 text-foreground transition-colors hover:text-cyan-600 dark:hover:text-cyan-300 active:text-cyan-600 dark:active:text-cyan-400"
            >
              Privacy
            </Link>
            <Link
              href="/glossary"
              className="px-2 py-3 text-foreground transition-colors hover:text-cyan-600 dark:hover:text-cyan-300 active:text-cyan-600 dark:active:text-cyan-400"
            >
              Glossary
            </Link>
          </nav>
        </div>
      </header>

      {/* ── Main content ────────────────────────────────────────────── */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>

        {/* Task 3: intro rendered as paragraphs with space-y-3 */}
        <div className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
          {introParagraphs.map((p, i) => (
            <p key={i}>{renderText(p)}</p>
          ))}
        </div>

        <div className="mt-8 space-y-8">
          {sections.map((s) => (
            <section key={s.heading}>
              {/* Task 4: h2 text-lg + left accent bar */}
              <h2 className="border-l-2 border-cyan-700 pl-3 text-lg font-semibold text-foreground">
                {s.heading}
              </h2>
              <div className="mt-2 space-y-3">
                {s.paragraphs.map((p, i) => (
                  <p key={i} className="text-sm leading-relaxed text-muted-foreground">
                    {renderText(p)}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Task 7: Bottom CTA — ≥44px */}
        <div className="mt-12 border-t border-border pt-8 text-center">
          <Link
            href="/apply"
            className="inline-flex min-h-[44px] items-center rounded bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400 active:bg-cyan-600"
          >
            Apply for Terminal Access
          </Link>
        </div>
      </main>

      {/* Task 5: footer — text-xs text-muted-foreground + pb-safe */}
      {/* Task 6 (min-h-app) is applied to the root div above */}
      <footer className="border-t border-border pb-safe pt-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} PureProperty.ca · Powered by PROPTX MLS® ·{" "}
        <Link href="/operated-by" className="underline underline-offset-2 hover:text-foreground">
          Operated under licence
        </Link>
      </footer>
    </div>
  );
}
