"use client";

import * as React from "react";
import Link from "next/link";
import { Info } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { buildTipContent, type TermId } from "@/lib/glossary/terms";
import { cn } from "@/lib/utils";

interface TermTipProps {
  id: TermId;
  /** Visible label before the ⓘ. Defaults to the term's canonical name. */
  children?: React.ReactNode;
  /** Render only the ⓘ trigger — place it beside an existing title. */
  iconOnly?: boolean;
  className?: string;
}

/**
 * Branded term + an ⓘ that reveals a plain-language definition on click/tap
 * (the Popover primitive is click-to-open, which is the reliable touch gesture).
 * Use `iconOnly` to drop just the ⓘ beside a heading you don't want to wrap.
 */
export function TermTip({ id, children, iconOnly, className }: TermTipProps) {
  const tip = buildTipContent(id);
  const trigger = (
    <button
      type="button"
      aria-label={`What is ${tip.name}?`}
      className={cn(
        "inline-flex items-center gap-1 text-left align-middle",
        "text-slate-400 hover:text-slate-200 transition-colors",
        className
      )}
    >
      {!iconOnly && <span>{children ?? tip.name}</span>}
      <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    </button>
  );

  return (
    <Popover trigger={trigger} className="max-w-xs">
      <p className="text-sm font-semibold text-slate-100">{tip.subtitle}</p>
      <p className="mt-1 text-sm text-slate-300">{tip.definition}</p>
      {tip.notMlsLine && (
        <p className="mt-2 text-xs text-slate-500">{tip.notMlsLine}</p>
      )}
      <Link
        href={tip.href}
        className="mt-2 inline-block text-xs text-cyan-400 hover:underline"
      >
        Full definition →
      </Link>
    </Popover>
  );
}
