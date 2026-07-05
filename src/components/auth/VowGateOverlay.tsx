"use client";

/**
 * VowGateOverlay — the shared "Login Required" lock that sits over a blurred
 * placeholder on any VOW-gated surface (sold comps, sold-price trends, region
 * stats, AVM, sale history).
 *
 * Compliance note: the real VOW values are NEVER in the DOM for anonymous users —
 * the server strips them (getConsumer → `locked` payload / gateSaleHistory). This
 * renders only the blurred teaser + a one-tap sign-in that returns the user exactly
 * where they were (`?next=`). Place it inside a `relative` container that holds the
 * blurred placeholder content.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export default function VowGateOverlay({
  headline,
  message,
  ctaLabel = "Login Required",
  next,
  className,
}: {
  /** Bold, specific value line (e.g. "See what this home should sell for"). Renders above `message`. */
  headline?: string;
  /** Short teaser line above the CTA (e.g. "12 recent sales — sign in to view"). */
  message?: string;
  ctaLabel?: string;
  /** Relative path to return to after sign-in (open-redirect-safe; ignored unless it starts with "/"). */
  next?: string;
  className?: string;
}) {
  // Default to the current path so sign-in returns the user exactly where they were.
  const pathname = usePathname();
  const target = next ?? pathname ?? undefined;
  const safeNext = target && target.startsWith("/") && !target.startsWith("//") ? target : null;
  const href = safeNext ? `/login?next=${encodeURIComponent(safeNext)}` : "/login";

  return (
    <div
      className={cn(
        "absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 rounded bg-background/40 px-4 text-center backdrop-blur-[2px]",
        className
      )}
    >
      <Lock className="h-5 w-5 text-cyan-700 dark:text-cyan-300" />
      {headline && <p className="text-sm font-semibold leading-snug text-foreground">{headline}</p>}
      {message && <p className="max-w-[44ch] text-xs leading-snug text-muted-foreground">{message}</p>}
      <Link
        href={href}
        className="mt-1 rounded-md border border-cyan-600 bg-cyan-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-cyan-700 dark:border-cyan-400/50 dark:bg-cyan-500/20 dark:text-cyan-100 dark:hover:bg-cyan-500/30"
      >
        {ctaLabel}
      </Link>
    </div>
  );
}
