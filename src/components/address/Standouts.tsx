/**
 * Standouts — three concrete superlatives from the live inventory around this home
 * (dashboard-style highlights, address-profile edition): biggest price cut, freshest
 * listing, closest listing. All IDX/asking-side — fully anonymous-safe.
 *
 * Deduped in priority order (cut → freshest → closest) so one listing never fills
 * two cards; renders nothing with fewer than 2 distinct standouts (a single card
 * reads as filler).
 */
import Link from "next/link";
import type { NearbyForSale, NearbyListing } from "@/lib/address/nearbyForSale";

function fmtK(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  return `$${Math.round(n / 1000)}k`;
}

function fmtPrice(n: number): string {
  return `$${Math.round(n).toLocaleString("en-CA")}`;
}

function fmtDist(m: number | null): string {
  if (m === null) return "";
  return m < 1000 ? `${Math.max(50, Math.round(m / 50) * 50)} m` : `${(m / 1000).toFixed(1)} km`;
}

function relDays(ms: number): string {
  const d = Math.floor((Date.now() - ms) / 86_400_000);
  return d <= 0 ? "listed today" : `listed ${d}d ago`;
}

interface Standout {
  key: string;
  label: string;
  value: string;
  accent: "amber" | "cyan" | "emerald";
  listing: NearbyListing;
  caption: string;
}

const ACCENT: Record<Standout["accent"], string> = {
  amber: "text-amber-700 dark:text-amber-400",
  cyan: "text-cyan-700 dark:text-cyan-400",
  emerald: "text-emerald-700 dark:text-emerald-400",
};

export default function Standouts({ nearby }: { nearby: NearbyForSale }) {
  // Rebuild the full candidate pool from events + carousel listings (both are
  // subsets of the same distance-sorted fetch; listings[0] is the closest active).
  const pool = new Map<string, NearbyListing>();
  for (const e of nearby.events) pool.set(e.listing.id, e.listing);
  for (const l of nearby.listings) pool.set(l.id, l);
  const all = [...pool.values()];
  if (all.length === 0) return null;

  const used = new Set<string>();
  const standouts: Standout[] = [];

  const biggestCut = all.filter((l) => l.dropAmount > 0).sort((a, b) => b.dropAmount - a.dropAmount)[0];
  if (biggestCut) {
    used.add(biggestCut.id);
    standouts.push({
      key: "cut",
      label: "Biggest cut nearby",
      value: `−${fmtK(biggestCut.dropAmount)}`,
      accent: "amber",
      listing: biggestCut,
      caption: `now ${fmtPrice(biggestCut.price)}`,
    });
  }

  const freshest = all
    .filter((l) => l.entryMs !== null && !used.has(l.id))
    .sort((a, b) => (b.entryMs ?? 0) - (a.entryMs ?? 0))[0];
  if (freshest) {
    used.add(freshest.id);
    standouts.push({
      key: "fresh",
      label: "Freshest listing",
      value: relDays(freshest.entryMs as number),
      accent: "cyan",
      listing: freshest,
      caption: `asking ${fmtPrice(freshest.price)}`,
    });
  }

  const closest = nearby.listings.find((l) => l.distanceM !== null && !used.has(l.id));
  if (closest) {
    standouts.push({
      key: "close",
      label: "Closest to this home",
      value: fmtDist(closest.distanceM),
      accent: "emerald",
      listing: closest,
      caption: `asking ${fmtPrice(closest.price)}`,
    });
  }

  if (standouts.length < 2) return null;

  return (
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
      {standouts.map((s) => (
        <Link
          key={s.key}
          href={`/properties/${s.listing.id}`}
          className="group rounded-lg border border-border bg-card/40 p-3.5 transition-colors hover:border-cyan-500/40"
        >
          <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {s.label}
          </p>
          <p className={`mt-1 font-mono text-xl font-bold tabular-nums ${ACCENT[s.accent]}`}>{s.value}</p>
          <p className="mt-1 truncate text-xs font-medium text-foreground group-hover:text-cyan-700 dark:group-hover:text-cyan-400">
            {s.listing.address}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {s.caption}
            {s.key !== "close" && s.listing.distanceM !== null ? ` · ${fmtDist(s.listing.distanceM)}` : ""}
          </p>
        </Link>
      ))}
    </div>
  );
}
