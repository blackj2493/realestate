'use client';

/**
 * The nearby carousels + bridges for the renovation-upside result. Reuses the app's
 * canonical comp cards (ForSaleCompCard / SoldCompCard) so they read identically to
 * the "Comparable Properties" carousels elsewhere.
 *   • "Sold near you" — the GATED hook. Server route gates structurally; the client
 *     renders real SoldCompCards for consumers and the site's locked cards for anon.
 *   • "For sale near you" — the FREE (IDX) bridge; each card links into the listing.
 *   • Bridge band — doorways into the map + market trends.
 *
 * Point-based, so it renders only once we have geocoded coordinates.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Lock, Home, Tag, Map as MapIcon, MapPinned } from 'lucide-react';
import { ForSaleCompCard } from '@/components/Property/ForSaleCompCard';
import { SoldCompCard } from '@/components/Property/SoldCompCard';
import type { SimilarForSaleCard, SimilarSoldCard } from '@/app/api/properties/[id]/similar/route';
import type { NearbyListing } from '@/lib/address/nearbyForSale';

type SoldResp =
  | { locked: true; count30: number; count90: number }
  | { locked: false; cards: SimilarSoldCard[]; count90: number; medianClose90: number | null };

/** Adapt a nearby active listing to the canonical for-sale comp card. No `deltas`
 *  (there's no single subject to diff against); `why` carries a light area context. */
function toForSaleCard(l: NearbyListing, where: string): SimilarForSaleCard {
  return {
    id: l.id,
    address: l.address,
    city: null,
    price: l.price,
    beds: l.beds ?? 0,
    bedsAbove: l.beds ?? 0,
    bedsBelow: 0,
    baths: l.baths ?? 0,
    propertySubType: l.subType,
    brokerage: l.brokerage,
    thumb: l.imageUrl,
    daysOnMarket: l.dom,
    why: where ? `Nearby in ${where}` : 'Nearby',
    deltas: [],
  };
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">{children}</div>;
}

export default function RenoCarousels({
  lat,
  lng,
  type,
  where,
}: {
  lat: number;
  lng: number;
  type: string;
  where: string;
}) {
  const [forSale, setForSale] = useState<NearbyListing[] | null>(null);
  const [sold, setSold] = useState<SoldResp | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setForSale(null);
      setSold(null);
      const [fs, sd] = await Promise.all([
        fetch(`/api/reno/for-sale?lat=${lat}&lng=${lng}&type=${encodeURIComponent(type)}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch(`/api/reno/sold-near?lat=${lat}&lng=${lng}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);
      if (cancelled) return;
      setForSale(fs?.listings ?? []);
      setSold((sd as SoldResp) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [lat, lng, type]);

  const soldLockedCount = sold && sold.locked ? Math.max(1, Math.min(4, sold.count90)) : 0;
  const showSold = sold && (sold.locked ? sold.count90 > 0 : sold.cards.length > 0);

  // Where "see all" goes: the map's SOLD COMPS view centred on this point — every sale
  // in the radius as pins plus the full ledger list, which is the only surface that can
  // actually hold 85 of them. ?comps=1 is the URL entry to that mode.
  const compsHref = `/properties?lat=${lat}&lng=${lng}&z=14&comps=1${where ? `&pin=${encodeURIComponent(where)}` : ''}`;
  const shownSold = sold && !sold.locked ? sold.cards.length : 0;
  const moreSold = sold && !sold.locked ? Math.max(0, sold.count90 - shownSold) : 0;

  return (
    <div className="space-y-6">
      {/* SOLD — the gated hook */}
      {showSold && sold && (
        <section>
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Home className="h-4 w-4 text-rose-600 dark:text-rose-400" aria-hidden /> Sold near you
            </h2>
            {sold.locked ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-500">
                <Lock className="h-3.5 w-3.5" aria-hidden /> {sold.count90} sold within 2&nbsp;km · sign in
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">{sold.count90} sold within 2&nbsp;km (90 days)</span>
            )}
          </div>
          <Row>
            {sold.locked
              ? Array.from({ length: soldLockedCount }).map((_, i) => (
                  <SoldCompCard key={i} locked card={{} as SimilarSoldCard} />
                ))
              : sold.cards.map((c) => (
                  <SoldCompCard key={c.id} card={{ ...c, why: c.why || (where ? `Nearby in ${where}` : '') }} />
                ))}
          </Row>
          {!sold.locked && moreSold > 0 && (
            <Link
              href={compsHref}
              className="mt-1 flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-rose-500/50 [touch-action:manipulation]"
            >
              <MapPinned className="h-4 w-4 text-rose-600 dark:text-rose-400" aria-hidden />
              See all {sold.count90} sold near here on the map
            </Link>
          )}
        </section>
      )}

      {/* FOR SALE — the free bridge */}
      {forSale && forSale.length > 0 && (
        <section>
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Tag className="h-4 w-4 text-cyan-700 dark:text-cyan-400" aria-hidden /> For sale near {where}
            </h2>
            <Link href="/properties" className="text-[11px] font-semibold text-cyan-700 hover:underline dark:text-cyan-400">
              See all on the map →
            </Link>
          </div>
          <Row>
            {forSale.map((l) => (
              <ForSaleCompCard key={l.id} card={toForSaleCard(l, where)} />
            ))}
          </Row>
        </section>
      )}

      {/* BRIDGE — doorway into the live map (the region Market Trends bridge sits above). */}
      <Link
        href="/properties"
        className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-cyan-500/50"
      >
        <MapIcon className="mt-0.5 h-5 w-5 shrink-0 text-cyan-700 dark:text-cyan-400" aria-hidden />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-foreground">Browse the live map</span>
          <span className="text-xs text-muted-foreground">Every home for sale near {where} →</span>
        </span>
      </Link>
    </div>
  );
}
