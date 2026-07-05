"use client";

/**
 * ActionFeed — band ① of the dashboard: the personalized "what changed since you
 * last visited" surface that gives the terminal its zero-time-to-value payoff.
 * Renders nothing when there's no activity (no clutter), mirroring WatchlistSection.
 */

import { useState } from "react";
import { Activity } from "lucide-react";
import { useActionFeed } from "./useActionFeed";
import ActionFeedItem from "./ActionFeedItem";
import ShowMoreButton from "@/components/dashboard/ShowMoreButton";
import { ModuleHead, Panel } from "@/components/daylight/primitives";
import type { MarketActivityLens } from "@/lib/dashboard/config";
import type { PersonaType } from "@/lib/personas/personaConfig";

const LIMIT = 6;

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
  const [expanded, setExpanded] = useState(false);

  // Hide entirely until we know there's something to act on.
  if (loading && items.length === 0) return null;
  if (items.length === 0) return null;

  const visible = expanded ? items : items.slice(0, LIMIT);

  return (
    <section data-tour="dashboard-action-feed" className="space-y-2">
      <ModuleHead
        title="Since your last visit"
        count={items.length}
        icon={<Activity className="h-4 w-4" />}
      />

      <Panel>
        {visible.map((item) => (
          <ActionFeedItem key={`${item.kind}:${item.listingKey}`} item={item} />
        ))}
      </Panel>

      {items.length > LIMIT && (
        <ShowMoreButton
          expanded={expanded}
          hiddenCount={items.length - LIMIT}
          onToggle={() => setExpanded((v) => !v)}
        />
      )}
    </section>
  );
}
