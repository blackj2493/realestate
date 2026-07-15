/**
 * CampaignHistorySection — full per-property campaign timeline table (HouseSigma-parity).
 * Renders every campaign event (Listed / Price Changed / Terminated / Expired / Sold / Leased)
 * from the gated CampaignHistoryView. VOW data (CLAUDE.md §4): anon sees a blurred
 * teaser + the surviving campaignCount, never the rows (events arrive as [] for anon).
 */
"use client";

import { useState } from "react";
import { History } from "lucide-react";
import { cn, formatPrice } from "@/lib/utils";
import type { CampaignHistoryView } from "@/lib/campaignHistory/view";
import { buildEventRows, type TimelineRow, type TimelineEventKind } from "@/lib/campaignHistory/timeline";
import { Redact, UnlockCta } from "@/components/Property/teaserPrimitives";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  // Date-ONLY strings parse as UTC midnight; without timeZone:'UTC' every UTC− viewer
  // (all of Ontario) sees the previous day (audit MEDIUM-18).
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

const KIND_COLOR: Record<TimelineEventKind, string> = {
  "Listed for Sale": "text-emerald-700 dark:text-emerald-400",
  "Listed for Lease": "text-sky-700 dark:text-sky-400",
  "Price Changed": "text-amber-700 dark:text-amber-400",
  Terminated: "text-rose-700 dark:text-rose-400",
  Expired: "text-muted-foreground",
  Suspended: "text-muted-foreground",
  Sold: "text-amber-700 dark:text-amber-300",
  // Leased uses the sky/lease tone — same family as "Listed for Lease"
  Leased: "text-sky-700 dark:text-sky-300",
};

function Row({ r }: { r: TimelineRow }) {
  return (
    <tr className="border-b border-border/50 font-mono text-xs">
      <td className="py-2 text-left text-muted-foreground">{fmtDate(r.date)}</td>
      <td className={cn("py-2 text-left font-medium", KIND_COLOR[r.kind])}>{r.kind}</td>
      <td className="py-2 text-right text-foreground">{r.price ? formatPrice(r.price) : "—"}</td>
      <td className="py-2 text-right">
        {r.deltaPct != null && Number.isFinite(r.deltaPct) ? (
          <span className={r.deltaPct < 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}>
            {r.deltaPct > 0 ? "+" : ""}{Math.round(r.deltaPct * 100)}%
          </span>
        ) : ("—")}
      </td>
      <td className="py-2 text-right text-muted-foreground">{r.listingKey}</td>
      <td className="py-2 text-right text-muted-foreground">
        <span className="ml-auto block max-w-[140px] truncate" title={r.brokerage ?? undefined}>{r.brokerage ?? "—"}</span>
      </td>
    </tr>
  );
}

export default function CampaignHistorySection({
  campaignHistory, isAuthed, className,
}: { campaignHistory: CampaignHistoryView; isAuthed: boolean; className?: string }) {
  const { campaignCount, firstSeenDate, events } = campaignHistory;
  const [expanded, setExpanded] = useState(false);
  const Title = (
    <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-foreground">
      <History className="h-4 w-4 text-amber-700 dark:text-amber-400" />
      Listing History
      {campaignCount > 0 && (
        <span className="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {campaignCount}×
        </span>
      )}
    </h3>
  );

  if (campaignCount === 0) {
    return (
      <div className={cn("rounded-lg border border-border bg-card p-4", className)}>
        {Title}
        <p className="text-xs text-muted-foreground">No prior listing campaigns on record for this address.</p>
      </div>
    );
  }

  if (!isAuthed) {
    // Redacted frame: the real table shape (Date · Event · Price · Δ%) with values
    // withheld — matches the rest of the anon page's unlock language. The surviving
    // campaignCount/firstSeenDate teaser rides in the CTA note.
    const n = Math.min(campaignCount, 5);
    return (
      <div className={cn("rounded-lg border border-cyan-500/40 bg-card p-4", className)}>
        {Title}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 text-left font-medium">Date</th>
                <th className="py-2 text-left font-medium">Event</th>
                <th className="py-2 text-right font-medium">Price</th>
                <th className="py-2 text-right font-medium">Δ%</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: n }).map((_, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="py-2 text-left"><Redact className="h-3 w-20" /></td>
                  <td className="py-2 text-left"><Redact className="h-3 w-16" /></td>
                  <td className="py-2 text-right"><Redact className="h-3 w-16" /></td>
                  <td className="py-2 text-right"><Redact className="h-3 w-8" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <UnlockCta
          label="Sign in to view the full history — free"
          note={`Listed ${campaignCount}×${
            firstSeenDate ? ` since ${new Date(firstSeenDate).getFullYear()}` : ""
          } · Listing history via TRREB VOW, for personal, non-commercial use.`}
        />
      </div>
    );
  }

  const rows = buildEventRows(events);
  const COLLAPSED = 4;
  const hasMore = rows.length > COLLAPSED;
  const shown = expanded ? rows : rows.slice(0, COLLAPSED);
  return (
    <div className={cn("rounded-lg border border-border bg-card p-4", className)}>
      {Title}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="py-2 text-left font-medium">Date</th>
              <th className="py-2 text-left font-medium">Event</th>
              <th className="py-2 text-right font-medium">Price</th>
              <th className="py-2 text-right font-medium">Δ%</th>
              <th className="py-2 text-right font-medium">MLS#</th>
              <th className="py-2 text-right font-medium">Brokerage</th>
            </tr>
          </thead>
          <tbody>{shown.map((r, i) => <Row key={`${r.listingKey}-${r.kind}-${i}`} r={r} />)}</tbody>
        </table>
      </div>
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs font-medium text-cyan-700 dark:text-cyan-400 transition-colors hover:text-cyan-300"
        >
          {expanded ? "Show less ▴" : `Show all ${rows.length} events ▾`}
        </button>
      )}
      <p className="mt-3 text-[10px] leading-snug text-muted-foreground">
        Listing history via TRREB VOW — for your personal, non-commercial use.
      </p>
    </div>
  );
}
