/**
 * Route-scoped not-found for /share/[token].
 * Shown when notFound() is called (expired / missing collection).
 * Dark branded shell — no auth required.
 */

import Link from "next/link";
import Logo from "@/components/Logo";

export default function ShareNotFound() {
  return (
    <div className="min-h-app flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border px-4 pt-safe">
        <div className="mx-auto flex h-16 max-w-3xl items-center">
          <Link href="/" aria-label="PureProperty.ca home" className="inline-flex items-center">
            <Logo size="md" theme="dark" />
          </Link>
        </div>
      </header>

      {/* Body */}
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-cyan-500">
          404
        </p>
        <h1 className="mb-4 text-2xl font-bold text-foreground">
          This shared selection has expired or moved
        </h1>
        <p className="mb-8 max-w-sm text-sm leading-relaxed text-muted-foreground">
          The link may have expired, or the properties it referenced are no longer available.
        </p>
        <Link
          href="/properties"
          className="inline-flex min-h-[44px] items-center rounded bg-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400 active:bg-cyan-600"
        >
          Browse current listings →
        </Link>
      </main>

      {/* Footer */}
      <footer className="border-t border-border pb-safe pt-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} PureProperty.ca · Powered by PROPTX MLS®
      </footer>
    </div>
  );
}
