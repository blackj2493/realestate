"use client";

import { Info } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { getGlossaryEntry, type GlossaryKey } from "@/lib/glossary";

/**
 * A small ⓘ icon placed next to a term (cap rate, carry, yield, …). Tapping it
 * opens the plain-language glossary definition in the shared Popover — which is
 * portaled, viewport-aware and closes on outside-click/Escape, so it works inside
 * scrollable tables and on touch. Click/tap based (not hover) so it's reachable on
 * mobile and by keyboard.
 *
 * Renders nothing if the term key is unknown, so call sites can pass a key
 * unconditionally without guarding.
 */
export default function InfoDot({
  term,
  className,
  align = "left",
}: {
  term: GlossaryKey;
  /** Extra classes on the icon (e.g. sizing/colour overrides). */
  className?: string;
  align?: "left" | "right";
}) {
  const entry = getGlossaryEntry(term);
  if (!entry) return null;

  return (
    <Popover
      align={align}
      className="w-64 rounded-lg"
      trigger={
        <button
          type="button"
          aria-label={`What is ${entry.term}?`}
          // No stopPropagation here: the Popover toggles via an onClick on the div
          // that WRAPS this trigger, so the click must be allowed to bubble up to it.
          // (None of the ⓘ host elements are themselves clickable, so bubbling on is safe.)
          className={cn(
            "inline-flex items-center justify-center text-slate-500 transition-colors hover:text-slate-200 focus:text-slate-200 focus:outline-none",
            className
          )}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      }
    >
      <div className="space-y-1.5">
        <p className="text-xs font-semibold text-slate-100">{entry.term}</p>
        <p className="text-xs leading-snug text-slate-300">{entry.short}</p>
        {entry.formula && (
          <p className="font-mono text-[11px] leading-snug text-cyan-300/90">{entry.formula}</p>
        )}
        {entry.context && (
          <p className="text-[11px] leading-snug text-slate-500">{entry.context}</p>
        )}
      </div>
    </Popover>
  );
}
