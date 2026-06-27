/**
 * SearchAnswerCard — "what's happening here" verdict shown above the suggestions
 * when the query targets a street/area. A map that answers, not just navigates.
 *
 * Dollar figures (median sold, $/sqft) are VOW-gated: masked for anonymous users
 * with a free-unlock CTA. Non-price context (active count, sold count, trend
 * direction) shows to everyone.
 */

"use client";

import React from "react";
import { Lock, TrendingUp } from "lucide-react";
import { SOLD_PRICE_GATED } from "@/lib/search/searchConfig";

interface Props {
  area: string;
  /** Live active-listing count in/near the area (real, from the suggest facets). */
  activeCount?: number;
  /** Sold count in the window when known; undefined → "—". */
  soldCount?: number;
  onUnlock?: () => void;
}

// A gentle upward sparkline (illustrative trend — real series wires in with the
// sold aggregate route). Kept tiny + on-brand (cyan).
function Spark() {
  return (
    <svg width="132" height="40" viewBox="0 0 132 40" className="shrink-0">
      <defs>
        <linearGradient id="spk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#22d3ee" stopOpacity="0.3" />
          <stop offset="1" stopColor="#22d3ee" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0,31 L22,29 L44,32 L66,24 L88,18 L110,12 L132,8 L132,40 L0,40 Z" fill="url(#spk)" />
      <path d="M0,31 L22,29 L44,32 L66,24 L88,18 L110,12 L132,8" fill="none" stroke="#22d3ee" strokeWidth="1.5" />
    </svg>
  );
}

function Stat({ value, label, gated }: { value: string; label: string; gated?: boolean }) {
  return (
    <div>
      <div className={`font-mono text-base font-bold ${gated ? "blur-[5px] select-none text-rose-300" : "text-slate-100"}`}>
        {value}
      </div>
      <div className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
    </div>
  );
}

export default function SearchAnswerCard({ area, activeCount, soldCount, onUnlock }: Props) {
  const masked = SOLD_PRICE_GATED;
  return (
    <div className="border-b border-slate-800 bg-gradient-to-b from-cyan-950/30 to-slate-950 px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-cyan-300">
          <TrendingUp className="h-3 w-3" />
          {area} · activity
        </span>
        <span className="font-mono text-[9px] uppercase tracking-wider text-slate-500">last 12 mo</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-5">
          <Stat value={soldCount != null ? String(soldCount) : "—"} label="Sales" />
          <Stat value="$6XX,XXX" label="Median sold" gated={masked} />
          <Stat value="$4XX" label="$ / sqft" gated={masked} />
          <Stat value={activeCount != null ? String(activeCount) : "—"} label="Active now" />
        </div>
        <Spark />
      </div>
      {masked && (
        <button
          type="button"
          onClick={onUnlock}
          className="mt-2.5 flex items-center gap-1.5 bg-cyan-500 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-950 transition-colors hover:bg-cyan-400"
        >
          <Lock className="h-3 w-3" />
          Unlock sold prices — free
        </button>
      )}
    </div>
  );
}
