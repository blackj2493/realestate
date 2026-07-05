/**
 * BubbleSections — dashboard band that lists each saved Market Bubble as a
 * full per-region section. Replaces the deprecated BubblesSection preview that
 * showed three stat tiles per bubble (the user found that too thin compared to
 * what configured cities like Brampton get).
 *
 * Sign-in gated: bubbles only exist for authenticated users (RLS / migration
 * 025), so the entire band hides for signed-out visitors.
 *
 * Deep-link support: `?bubble=<id>` scrolls to the matching section and adds a
 * brief cyan ring flash, so a freshly-saved bubble (SaveBubbleDialog redirects
 * here with this query param) is obvious without a toast.
 */

"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Bookmark, Plus } from "lucide-react";
import { useBubblesStore } from "@/lib/bubbles/useBubbles";
import type { BoardDef } from "@/lib/dashboard/boards";
import type { MarketActivityLens } from "@/lib/dashboard/config";
import BubbleMarketSection from "./BubbleMarketSection";

const HIGHLIGHT_MS = 2400;

interface Props {
  lens: MarketActivityLens;
  enabledBoards: BoardDef[];
}

export default function BubbleSections({ lens, enabledBoards }: Props) {
  const init = useBubblesStore((s) => s.init);
  const items = useBubblesStore((s) => s.items);
  const signedIn = useBubblesStore((s) => s.signedIn);
  const loaded = useBubblesStore((s) => s.loaded);

  const searchParams = useSearchParams();
  const focusId = searchParams.get("bubble");

  const [flashId, setFlashId] = useState<string | null>(null);
  const [lastTrigger, setLastTrigger] = useState<string | null>(null);

  useEffect(() => {
    void init();
  }, [init]);

  // Sort newest first — matches /api/bubbles GET order.
  const bubbles = useMemo(
    () =>
      Object.values(items).sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ),
    [items]
  );

  // Derive the trigger during render so the side-effect (scrollIntoView + flash
  // clear) lives in its own single-purpose effect — avoids the React 19
  // set-state-in-effect lint rule.
  const trigger = focusId && loaded && items[focusId] ? focusId : null;
  if (trigger && trigger !== lastTrigger) {
    setLastTrigger(trigger);
    setFlashId(trigger);
  }

  useEffect(() => {
    if (!flashId) return;
    const el = document.getElementById(`bubble-section-${flashId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    const t = setTimeout(() => setFlashId(null), HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [flashId]);

  if (!signedIn) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <h2 className="terminal-font flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-foreground">
          <Bookmark className="h-4 w-4 text-cyan-700 dark:text-cyan-400" />
          Market Bubbles
        </h2>
        <Link
          href="/properties"
          className="terminal-font flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground hover:text-cyan-700 dark:hover:text-cyan-300"
        >
          <Plus className="h-3 w-3" /> Save new
        </Link>
      </div>

      {!loaded ? (
        <div className="h-40 animate-pulse border border-border bg-card/30" />
      ) : bubbles.length === 0 ? (
        <div className="border border-dashed border-border bg-card/30 px-6 py-10 text-center">
          <p className="terminal-font text-xs uppercase tracking-widest text-foreground">
            No bubbles saved yet
          </p>
          <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
            Save a draw, commute, or school area from the terminal to track its
            live inventory, new listings, and top deals right here.
          </p>
          <Link
            href="/properties"
            className="terminal-font mt-5 inline-flex items-center gap-2 border border-cyan-600/50 bg-cyan-600/10 px-3 py-2 text-xs uppercase tracking-wider text-cyan-700 hover:bg-cyan-600/20 dark:border-cyan-500/50 dark:bg-cyan-500/10 dark:text-cyan-200 dark:hover:bg-cyan-500/20"
          >
            <Plus className="h-3 w-3" /> Open the terminal
          </Link>
        </div>
      ) : (
        bubbles.map((b) => (
          <BubbleMarketSection
            key={b.id}
            bubble={b}
            lens={lens}
            enabledBoards={enabledBoards}
            highlight={flashId === b.id}
          />
        ))
      )}
    </div>
  );
}
