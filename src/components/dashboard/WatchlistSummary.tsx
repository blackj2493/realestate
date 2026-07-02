"use client";

import type { WatchlistRollup } from "@/lib/watchlist/useWatchlistSnapshot";
import InfoDot from "@/components/ui/InfoDot";
import type { GlossaryKey } from "@/lib/glossary";
import { cn } from "@/lib/utils";
import { Bookmark, Wallet, Percent, Award, type LucideIcon } from "lucide-react";

/**
 * Multi-hue stat tiles — each KPI owns a colour so the row reads as a set of
 * distinct metrics at a glance (blue = count, violet = price, emerald = yield,
 * amber = grade). Tints work in both themes (hue-50 on light, hue-500/10 on dark).
 */
type Tone = "blue" | "violet" | "emerald" | "amber";

const TONE: Record<Tone, { card: string; icon: string; value: string }> = {
  blue: {
    card: "border-blue-200 bg-blue-50 dark:border-blue-400/25 dark:bg-blue-500/10",
    icon: "text-blue-500 dark:text-blue-400",
    value: "text-blue-700 dark:text-blue-300",
  },
  violet: {
    card: "border-violet-200 bg-violet-50 dark:border-violet-400/25 dark:bg-violet-500/10",
    icon: "text-violet-500 dark:text-violet-400",
    value: "text-violet-700 dark:text-violet-300",
  },
  emerald: {
    card: "border-emerald-200 bg-emerald-50 dark:border-emerald-400/25 dark:bg-emerald-500/10",
    icon: "text-emerald-500 dark:text-emerald-400",
    value: "text-emerald-700 dark:text-emerald-300",
  },
  amber: {
    card: "border-amber-200 bg-amber-50 dark:border-amber-400/25 dark:bg-amber-500/10",
    icon: "text-amber-500 dark:text-amber-400",
    value: "text-amber-700 dark:text-amber-300",
  },
};

function Tile({
  label,
  value,
  tone,
  icon: Icon,
  term,
}: {
  label: string;
  value: string;
  tone: Tone;
  icon: LucideIcon;
  term?: GlossaryKey;
}) {
  const t = TONE[tone];
  return (
    <div className={cn("rounded-lg border px-3 py-2.5 transition-shadow hover:shadow-sm", t.card)}>
      <div className="terminal-font flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className={cn("h-3.5 w-3.5", t.icon)} strokeWidth={2.25} />
        {label}
        {term && <InfoDot term={term} />}
      </div>
      <div className={cn("terminal-font mt-0.5 truncate text-lg font-bold", t.value)} title={value}>
        {value}
      </div>
    </div>
  );
}

function compactPrice(n: number): string {
  if (n >= 1_000_000) return `$${(Math.round((n / 1_000_000) * 100) / 100).toString()}M`;
  if (n >= 1_000) return `$${Math.round(n / 1000)}K`;
  return `$${Math.round(n)}`;
}

/**
 * At-a-glance characterization of the SAVED set — what you're watching, not a
 * portfolio of holdings. No sum metrics (you're not buying all of them).
 */
export default function WatchlistSummary({ rollup }: { rollup: WatchlistRollup }) {
  if (rollup.count === 0) return null;

  const dash = "—";
  const range =
    rollup.minPrice == null || rollup.maxPrice == null
      ? dash
      : rollup.minPrice === rollup.maxPrice
        ? compactPrice(rollup.minPrice)
        : `${compactPrice(rollup.minPrice)}–${compactPrice(rollup.maxPrice)}`;
  const cap = rollup.avgCapRate != null ? `${rollup.avgCapRate.toFixed(1)}%` : dash;
  const best = rollup.bestDeal ? `${rollup.bestDeal.grade} · ${rollup.bestDeal.score}` : dash;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Tile label="Saved" value={rollup.count.toLocaleString()} tone="blue" icon={Bookmark} />
      <Tile label="Price Range" value={range} tone="violet" icon={Wallet} />
      <Tile label="Avg Cap Rate" value={cap} tone="emerald" icon={Percent} term="capRate" />
      <Tile label="Best Deal Score" value={best} tone="amber" icon={Award} />
    </div>
  );
}
