import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";
import { GLOSSARY, type GlossaryEntry } from "@/lib/glossary";

export const metadata: Metadata = {
  title: "Glossary — Real Estate & Investing Terms · PureProperty.ca",
  description:
    "Plain-language definitions of the real-estate and investing terms used across PureProperty.ca — cap rate, carry cost, yield, cash flow, NOI, DSCR, days on market and more.",
  robots: { index: true, follow: true },
};

// Alphabetical, so the page reads like a reference rather than UI order.
const ENTRIES: GlossaryEntry[] = Object.values(GLOSSARY)
  .slice()
  .sort((a, b) => a.term.localeCompare(b.term));

export default function GlossaryPage() {
  return (
    <div className="min-h-app flex flex-col bg-background text-foreground">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="border-b border-border px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link href="/" aria-label="PureProperty.ca home" className="inline-flex items-center">
            <Logo size="md" theme="dark" />
          </Link>
          <nav className="flex gap-1 text-xs uppercase tracking-wider text-muted-foreground">
            <Link
              href="/terms"
              className="px-2 py-3 text-foreground transition-colors hover:text-cyan-300 active:text-cyan-400"
            >
              Terms
            </Link>
            <Link
              href="/privacy"
              className="px-2 py-3 text-foreground transition-colors hover:text-cyan-300 active:text-cyan-400"
            >
              Privacy
            </Link>
          </nav>
        </div>
      </header>

      {/* ── Main content ────────────────────────────────────────────── */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <h1 className="text-2xl font-bold text-foreground">Glossary</h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Plain-language definitions of the terms you&apos;ll see across PureProperty — what they
          mean, how they&apos;re calculated, and what a typical number looks like. These are general
          explanations for research only, not financial advice.
        </p>

        <dl className="mt-8 space-y-6">
          {ENTRIES.map((e) => (
            <div key={e.term} className="border-l-2 border-cyan-700 pl-3">
              <dt className="text-lg font-semibold text-foreground">{e.term}</dt>
              <dd className="mt-1 space-y-1.5">
                <p className="text-sm leading-relaxed text-foreground">{e.short}</p>
                {e.formula && (
                  <p className="font-mono text-xs leading-relaxed text-cyan-300/90">{e.formula}</p>
                )}
                {e.context && (
                  <p className="text-xs leading-relaxed text-muted-foreground">{e.context}</p>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </main>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <footer className="border-t border-border pb-safe pt-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} PureProperty.ca · Powered by PROPTX MLS®
      </footer>
    </div>
  );
}
