"use client";

/**
 * ActionFeed — band ① of the dashboard: the personalized "what changed since you
 * last visited" surface that gives the terminal its zero-time-to-value payoff.
 * Renders nothing when there's no activity (no clutter), mirroring WatchlistSection.
 */

import { Activity } from "lucide-react";
import { useActionFeed } from "./useActionFeed";
import ActionFeedItem from "./ActionFeedItem";
import type { MarketActivityLens } from "@/lib/dashboard/config";
import type { PersonaType } from "@/lib/personas/personaConfig";

export default function ActionFeed({
  regions,
  lens,
  persona,
  sinceMs,
}: {
  regions: string[];
  lens: MarketActivityLens;
  persona: PersonaType;
  sinceMs: number | null;
}) {
  const { items, loading } = useActionFeed({ regions, lens, persona, sinceMs });

  // Hide entirely until we know there's something to act on.
  if (loading && items.length === 0) return null;
  if (items.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <Activity className="h-4 w-4 text-cyan-400" />
        <h2 className="terminal-font text-sm font-bold uppercase tracking-widest text-slate-100">
          Since your last visit
        </h2>
        <span className="terminal-font text-sm text-slate-500">· {items.length}</span>
      </div>

      <div className="border border-slate-800 bg-slate-900/40">
        {items.map((item) => (
          <ActionFeedItem key={`${item.kind}:${item.listingKey}`} item={item} />
        ))}
      </div>
    </section>
  );
}
