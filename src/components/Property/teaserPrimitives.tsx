"use client";

/**
 * Shared teaser primitives — the ONE "redacted frame" vocabulary every locked
 * (anonymous) card on the listing page speaks, so the whole gated surface reads as
 * a single system rather than a patchwork of blurs.
 *
 * COMPLIANCE (CLAUDE.md §4; VOW §6.2(f)): a <Redact> is a pure placeholder — it never
 * contains the real value. The server already ships anon a de-VOWed ListingDetail
 * (gateVowDerived → EMPTY_DEAL_SCORE / null estimate / null valueAdd / gated sold),
 * so these cards render structure ONLY: labels, axes and legends with the numbers
 * withheld. Nothing gated reaches the DOM.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";

/**
 * A withheld value: signals "a real number lives here, revealed on sign-in" without
 * ever carrying it. Size it with Tailwind width/height via `className` (e.g.
 * "h-6 w-24") so it matches the value it stands in for.
 */
export function Redact({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`redact-skeleton inline-block rounded align-middle ${className}`}
    />
  );
}

/**
 * The shared unlock call-to-action closing every locked teaser. Cyan is the page's
 * single "unlock" colour. Returns the visitor to exactly where they were after
 * sign-in (open-redirect-safe `next`).
 */
export function UnlockCta({ label, note }: { label: string; note?: string }) {
  const pathname = usePathname();
  const safeNext =
    pathname && pathname.startsWith("/") && !pathname.startsWith("//") ? pathname : null;
  const href = safeNext ? `/login?next=${encodeURIComponent(safeNext)}` : "/login";
  return (
    <div className="mt-3">
      <Link
        href={href}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-cyan-600 bg-cyan-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-cyan-700 dark:border-cyan-400/50 dark:bg-cyan-500/20 dark:text-cyan-100 dark:hover:bg-cyan-500/30"
      >
        <Lock className="h-3.5 w-3.5" />
        {label}
      </Link>
      {note && (
        <p className="mt-2 text-center text-[10px] leading-snug text-muted-foreground">{note}</p>
      )}
    </div>
  );
}
