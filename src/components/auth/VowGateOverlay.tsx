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
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export default function VowGateOverlay({
  message,
  ctaLabel = "Login Required",
  next,
  className,
}: {
  /** Short teaser line above the CTA (e.g. "12 recent sales — sign in to view"). */
  message?: string;
  ctaLabel?: string;
  /** Relative path to return to after sign-in (open-redirect-safe; ignored unless it starts with "/"). */
  next?: string;
  className?: string;
}) {
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
  const href = safeNext ? `/login?next=${encodeURIComponent(safeNext)}` : "/login";

  return (
    <div
      className={cn(
        "absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded bg-slate-950/40 backdrop-blur-[2px]",
        className
      )}
    >
      <Lock className="h-5 w-5 text-cyan-300" />
      {message && <p className="px-3 text-center text-xs text-slate-200">{message}</p>}
      <Link
        href={href}
        className="rounded-md border border-cyan-400/50 bg-cyan-500/20 px-4 py-1.5 text-xs font-semibold text-cyan-100 shadow-sm transition-colors hover:bg-cyan-500/30"
      >
        {ctaLabel}
      </Link>
    </div>
  );
}
