"use client";

/**
 * IfListedToday — the "what would this home list for" hook on the address profile.
 *
 * VOW/AVM-SAFE BY WORDING AND BY DATA: the band is the p25–p75 of LIVE ASKING prices
 * of nearby same-type listings (IDX, public), labelled "asking range" — never an
 * estimate/valuation of the subject (no AVM licensing exposure, see memory:
 * address-profiles-feature "value panel licensing"). The nearest same-type live
 * listing anchors the band with a concrete, public comp.
 *
 * Client component only for the type toggle; every prop is anonymous-safe.
 */
import { useState } from "react";
import Link from "next/link";
import { pickDefaultBandIndex } from "./listedTodayDefault";

export interface ListedTodayAnchor {
  id: string;
  address: string;
  price: number;
  beds: number | null;
  baths: number | null;
  subType: string | null;
  distanceM: number | null;
  imageUrl: string | null;
  brokerage: string | null;
}

export interface ListedTodayBand {
  label: string;
  count: number;
  p25: number;
  p75: number;
  nearest: ListedTodayAnchor | null;
}

export interface ListedTodayHistogram {
  min: number;
  max: number;
  buckets: number[];
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 2)}M`;
  return `$${Math.round(n / 1000)}k`;
}

function fmtPrice(n: number): string {
  return `$${Math.round(n).toLocaleString("en-CA")}`;
}

function fmtDist(m: number | null): string {
  if (m === null) return "";
  return m < 1000 ? `${Math.max(50, Math.round(m / 50) * 50)} m` : `${(m / 1000).toFixed(1)} km`;
}

export default function IfListedToday({
  address,
  bands,
  histogram,
  medianAsking,
  radiusKm,
  isConsumer,
  defaultType,
}: {
  address: string;
  bands: ListedTodayBand[];
  histogram: ListedTodayHistogram | null;
  medianAsking: number | null;
  radiusKm: number;
  isConsumer: boolean;
  /** The subject street's likely type (audit #16) — opens the band on that type
   *  instead of the raw nearby count-leader. Null → prefer the non-condo band. */
  defaultType?: string | null;
}) {
  // Open on the subject's likely type, not whatever's most common nearby (a condo-
  // dense pocket used to force "Condo Apartment" onto a detached-house address).
  const [active, setActive] = useState(() => pickDefaultBandIndex(bands.map((b) => b.label), defaultType));
  if (bands.length === 0) return null;
  const band = bands[Math.min(active, bands.length - 1)];
  const peak = histogram ? Math.max(...histogram.buckets, 1) : 1;

  // Band marker position on the histogram axis (clamped; ≥6% wide so it stays visible).
  let markerLeft = 0;
  let markerWidth = 0;
  if (histogram && histogram.max > histogram.min) {
    const span = histogram.max - histogram.min;
    markerLeft = Math.min(94, Math.max(0, ((band.p25 - histogram.min) / span) * 100));
    markerWidth = Math.max(6, Math.min(100 - markerLeft, ((band.p75 - band.p25) / span) * 100));
  }

  return (
    <section className="rounded-lg border border-border bg-card/40 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-foreground">
          If {address} listed today
        </h2>
        {bands.length > 1 && (
          <div className="inline-flex overflow-hidden rounded-md border border-border" role="tablist" aria-label="Property type">
            {bands.map((b, i) => (
              <button
                key={b.label}
                role="tab"
                aria-selected={i === active}
                onClick={() => setActive(i)}
                className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide transition-colors ${
                  i === active
                    ? "bg-cyan-500/15 font-bold text-cyan-700 dark:text-cyan-400"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-3xl font-bold tabular-nums tracking-tight text-foreground">
          {fmtK(band.p25)} – {fmtK(band.p75)}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          asking range · {band.count} live {band.label.toLowerCase()} listing{band.count === 1 ? "" : "s"} within {radiusKm} km
        </span>
      </div>

      {histogram && (
        <div className="mt-5">
          <div className="relative flex h-24 items-end gap-[3px] pt-5" role="img" aria-label={`Asking-price distribution, ${fmtK(histogram.min)} to ${fmtK(histogram.max)}; ${band.label} listings cluster between ${fmtK(band.p25)} and ${fmtK(band.p75)}`}>
            {markerWidth > 0 && (
              <div
                className="pointer-events-none absolute -top-0 bottom-[-4px] rounded-sm border border-dashed border-cyan-500/60 bg-cyan-500/[0.07]"
                style={{ left: `${markerLeft}%`, width: `${markerWidth}%` }}
                aria-hidden="true"
              >
                <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap pb-0.5 font-mono text-[9px] tracking-[0.12em] text-cyan-700 dark:text-cyan-400">
                  HOMES LIKE THIS
                </span>
              </div>
            )}
            {histogram.buckets.map((c, i) => (
              <div key={i} className="flex h-full flex-1 items-end">
                <div
                  className={`pp-grow w-full rounded-t-sm ${c > 0 ? "bg-emerald-500/75" : "bg-muted"}`}
                  style={{ height: c > 0 ? `${Math.max(8, (c / peak) * 100)}%` : "2px" }}
                  title={`${c} listing${c === 1 ? "" : "s"}`}
                />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-[10px] text-muted-foreground">
            <span>{fmtK(histogram.min)}</span>
            {medianAsking !== null && (
              <span className="text-emerald-700 dark:text-emerald-400">median {fmtK(medianAsking)}</span>
            )}
            <span>{fmtK(histogram.max)}</span>
          </div>
        </div>
      )}

      {band.nearest && (
        <Link
          href={`/properties/${band.nearest.id}`}
          className="mt-5 flex items-center gap-4 rounded-md border border-border bg-card/60 p-3 transition-colors hover:border-cyan-500/40"
        >
          <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded bg-muted">
            {band.nearest.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- MLS photos are never optimized (cost + TRREB watermark)
              <img src={band.nearest.imageUrl} alt={band.nearest.address} loading="lazy" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">No photo</div>
            )}
            {band.nearest.distanceM !== null && (
              <span className="absolute bottom-1 right-1 rounded bg-background/85 px-1 py-px font-mono text-[9px] text-cyan-700 dark:text-cyan-400">
                {fmtDist(band.nearest.distanceM)}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-foreground">Your closest live comp</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {[
                band.nearest.address,
                band.nearest.beds ? `${band.nearest.beds} bd` : null,
                band.nearest.baths ? `${band.nearest.baths} ba` : null,
                band.nearest.subType,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {/* Brokerage at the same type tier as the details — TRREB §6.3(c). */}
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{band.nearest.brokerage ?? "Brokerage unavailable"}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
              {fmtPrice(band.nearest.price)}
            </p>
            <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">asking now</p>
          </div>
        </Link>
      )}

      {!isConsumer && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            <b className="font-semibold text-foreground">Asking is half the story.</b> Members see what homes here
            actually close for — and how far off ask this street really deals.
          </p>
          <Link
            href="/register"
            className="inline-flex h-9 shrink-0 items-center rounded-md bg-emerald-500 px-4 text-xs font-bold uppercase tracking-wider text-slate-950 transition-colors hover:bg-emerald-400"
          >
            See sold-side · free
          </Link>
        </div>
      )}

      <p className="mt-3 text-[10px] leading-snug text-muted-foreground">
        Range = middle half of live MLS® asking prices for this property type nearby — not an appraisal or
        automated valuation of this home.
      </p>
    </section>
  );
}
