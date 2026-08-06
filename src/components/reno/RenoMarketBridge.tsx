'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LineChart, ArrowRight, TrendingUp, TrendingDown, Timer, Scissors, Lock, Gavel } from 'lucide-react';
import { typeKeyForSubType } from '@/lib/dashboard/propertyTypes';
import {
  snapshotHeadline,
  snapshotPressure,
  type RenoMarketSnapshotResp,
} from '@/lib/reno/marketSnapshot';

/**
 * The PERSONALIZED market-trends doorway — the page's second primary action.
 *
 * It carries the AREA read only — direction and pressure (YoY, days to sell, price cuts),
 * scoped to the property type so a detached owner isn't shown a direction diluted by
 * condo sales. Per-home price levels deliberately live ABOVE this card, in the beds × type
 * grid (MarketGrids), because we don't know whether the owner's home is 3, 4 or 5 bed —
 * the table lets them find their own row instead of us asserting one median for them.
 *
 * The button then deep-links /analytics?region=<raw region>&types=<key> so Market Trends
 * opens on the same scope the caller just read. All figures are deterministic aggregates
 * from the cached region RPCs and the shared beds × type grid (§4 — no LLM).
 */

const CARD =
  'block rounded-2xl border border-cyan-600/30 bg-gradient-to-br from-cyan-500/[0.08] to-transparent p-5';

function Stat({
  icon: Icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
  tone?: 'up' | 'down' | 'neutral';
}) {
  const toneClass =
    tone === 'up'
      ? 'text-emerald-700 dark:text-emerald-400'
      : tone === 'down'
        ? 'text-amber-700 dark:text-amber-500'
        : 'text-foreground';
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        {label}
      </div>
      <div className={`mt-1 font-mono text-[19px] font-bold leading-none ${toneClass}`}>{value}</div>
    </div>
  );
}

export default function RenoMarketBridge({
  where,
  region,
  city,
  typeLabel,
}: {
  /** Display name of the area the result is about. */
  where: string;
  /** RAW region value (city_region) — what the market RPCs and /analytics match on. */
  region: string;
  /** The city, used as the fallback scope when the neighbourhood is thin. */
  city: string;
  /** PropertySubType being modelled, e.g. "Detached". */
  typeLabel: string;
}) {
  // Scope the area read to the property type — a detached owner should not be shown a
  // direction diluted by condo sales. Null (unknown type) = no filter, as before.
  const typeKey = typeKeyForSubType(typeLabel);

  // Keyed by the scope it was fetched for, so a stale response can never be painted
  // against a new region (and no reset-setState is needed inside the effect).
  const scopeKey = `${region}|${city}|${typeKey ?? ''}`;
  const [loaded, setLoaded] = useState<{ key: string; data: RenoMarketSnapshotResp | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams();
    if (region) qs.set('region', region);
    if (city) qs.set('city', city);
    if (typeKey) qs.set('types', typeKey);
    if (!qs.toString()) return;
    const key = `${region}|${city}|${typeKey ?? ''}`;
    fetch(`/api/reno/market-snapshot?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled) setLoaded({ key, data: (j as RenoMarketSnapshotResp) ?? null });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [region, city, typeKey]);

  const settled = loaded?.key === scopeKey;
  const snap = settled ? loaded!.data : null;

  // Deep-link to the scope we actually managed to read (community, or the city fallback).
  const linkRegion = snap && !snap.locked ? snap.region : region || city;
  const href = `/analytics?region=${encodeURIComponent(linkRegion)}${typeKey ? `&types=${typeKey}` : ''}`;
  const areaLabel = snap && !snap.locked ? snap.label : where;

  const hasData = !!snap && !snap.locked;
  const headline = hasData ? snapshotHeadline(snap, typeLabel) : null;
  const pressure = hasData ? snapshotPressure(snap) : null;

  return (
    <section className={CARD} aria-labelledby="reno-market-heading">
      <div className="flex items-center gap-2">
        <LineChart className="h-[18px] w-[18px] shrink-0 text-cyan-700 dark:text-cyan-400" strokeWidth={1.75} aria-hidden />
        <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-400">
          {areaLabel} market
        </span>
        {hasData && snap.scope === 'city' && (
          <span className="rounded-full border border-border px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
            city-wide
          </span>
        )}
      </div>

      <h2 id="reno-market-heading" className="mt-2 text-xl font-bold leading-snug text-foreground">
        {headline ?? `Is now the moment to renovate in ${where}?`}
      </h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
        {pressure ??
          'The same sold data behind these estimates — read as the story of your market, not a spreadsheet.'}
      </p>

      {/* ── THE AREA — direction + pressure, scoped to this property type ── */}
      {hasData ? (
        <div className="mt-4">
          <div className="mb-2 text-[12px] font-semibold text-foreground">
            {typeLabel} across {areaLabel}
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <Stat
              icon={snap.yoyPct != null && snap.yoyPct < 0 ? TrendingDown : TrendingUp}
              label="Vs last year"
              value={snap.yoyPct != null ? `${snap.yoyPct > 0 ? '+' : ''}${snap.yoyPct.toFixed(1)}%` : '—'}
              tone={snap.yoyPct == null ? 'neutral' : snap.yoyPct >= 0 ? 'up' : 'down'}
            />
            <Stat
              icon={Timer}
              label="Days to sell"
              value={snap.medianDom != null ? `${Math.round(snap.medianDom)}d` : '—'}
            />
            <Stat
              icon={snap.cutShare != null ? Scissors : Gavel}
              label={snap.cutShare != null ? 'Cutting price' : 'Of asking'}
              value={
                snap.cutShare != null
                  ? `${Math.round(snap.cutShare * 100)}%`
                  : snap.soldToListPct != null
                    ? `${snap.soldToListPct.toFixed(1)}%`
                    : '—'
              }
              tone={snap.cutShare != null && snap.cutShare >= 0.25 ? 'down' : 'neutral'}
            />
          </div>
        </div>
      ) : snap?.locked ? (
        <p className="mt-3 flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
          Sold prices, days to sell and price-cut pressure for {where} — free with one sign-in.
        </p>
      ) : settled ? null /* fetch failed — the CTA still works, just without the teaser */ : (
        <div className="mt-4 grid grid-cols-3 gap-2.5" aria-hidden>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-[62px] animate-pulse rounded-xl bg-black/5 dark:bg-white/10" />
          ))}
        </div>
      )}

      {/* THE BUTTON — the page's second primary action, sized like it. */}
      <Link
        href={href}
        className="group mt-4 flex min-h-[54px] w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 py-3.5 text-[15px] font-bold text-white transition-colors hover:bg-cyan-500 active:bg-cyan-700 [touch-action:manipulation]"
      >
        <LineChart className="h-[18px] w-[18px] shrink-0" aria-hidden />
        See the full {areaLabel} market trends
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
      <p className="mt-2 text-center text-[12px] text-muted-foreground">
        Opens Market Trends already set to {areaLabel}
        {typeKey ? ` and ${typeLabel.toLowerCase()}` : ''} — 24 months of sold prices, true days on
        market and where sellers are cutting.
      </p>
    </section>
  );
}
