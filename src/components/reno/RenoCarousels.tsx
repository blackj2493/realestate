'use client';

/**
 * The nearby carousels + bridges for the renovation-upside result.
 *   • "Sold near you" — the GATED hook. Server route gates structurally, so the
 *     client just renders what it gets: consumers → real SoldCompCards; anon →
 *     the site's standard locked cards (never a VOW number reaches the anon DOM).
 *   • "For sale near you" — the FREE (IDX) bridge; each card links into the live
 *     listing page, i.e. into the real product.
 *   • Bridge band — explicit doorways into the map + market trends.
 *
 * Point-based, so it renders only once we have geocoded coordinates.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bed, Bath, Lock } from 'lucide-react';
import { formatPrice } from '@/lib/utils';
import { ListingThumbnail } from '@/components/listing/ListingThumbnail';
import { SoldCompCard } from '@/components/Property/SoldCompCard';
import type { SimilarSoldCard } from '@/app/api/properties/[id]/similar/route';
import type { NearbyListing } from '@/lib/address/nearbyForSale';

type SoldResp =
  | { locked: true; count30: number; count90: number }
  | { locked: false; cards: SimilarSoldCard[]; count90: number; medianClose90: number | null };

function ForSaleCard({ l }: { l: NearbyListing }) {
  return (
    <Link
      href={`/properties/${l.id}`}
      className="group block w-[260px] shrink-0 overflow-hidden rounded-lg border border-l-2 border-border border-l-cyan-500/40 bg-card/50 transition-colors hover:border-l-cyan-400"
    >
      <div className="relative aspect-[4/3]">
        <ListingThumbnail
          src={l.imageUrl}
          alt={l.address}
          className="absolute inset-0"
          imgClassName="group-hover:scale-105 transition-transform duration-300"
          sizes="260px"
        />
        <span className="absolute left-2 top-2 rounded bg-cyan-600/90 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-white">
          FOR SALE
        </span>
      </div>
      <div className="p-3">
        <div className="font-mono text-lg font-bold text-foreground">{formatPrice(l.price)}</div>
        <p className="mt-1 line-clamp-1 text-sm font-medium text-foreground">{l.address}</p>
        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
          {l.beds != null && (
            <span className="flex items-center gap-1"><Bed className="h-3 w-3" />{l.beds}</span>
          )}
          {l.baths != null && l.baths > 0 && (
            <span className="flex items-center gap-1"><Bath className="h-3 w-3" />{l.baths}</span>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Listed by {l.brokerage || 'Unknown'}</p>
      </div>
    </Link>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">{children}</div>;
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

  return (
    <div className="space-y-6">
      {/* SOLD — the gated hook */}
      {showSold && sold && (
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-foreground">🏘️ Sold near you</h2>
            {sold.locked ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
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
              : sold.cards.map((c) => <SoldCompCard key={c.id} card={c} />)}
          </Row>
        </section>
      )}

      {/* FOR SALE — the free bridge */}
      {forSale && forSale.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-foreground">🏡 For sale near {where}</h2>
            <Link href="/properties" className="text-[11px] font-semibold text-cyan-700 hover:underline dark:text-cyan-400">
              See all on the map →
            </Link>
          </div>
          <Row>
            {forSale.map((l) => (
              <ForSaleCard key={l.id} l={l} />
            ))}
          </Row>
        </section>
      )}

      {/* BRIDGE band — doorways into the real product */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link
          href="/properties"
          className="flex flex-col gap-0.5 rounded-xl border border-border bg-card p-4 transition-colors hover:border-cyan-500/50"
        >
          <span className="text-sm font-bold text-foreground">🗺️ Browse the live map</span>
          <span className="text-xs text-muted-foreground">Every home for sale near you →</span>
        </Link>
        <Link
          href="/analytics"
          className="flex flex-col gap-0.5 rounded-xl border border-border bg-card p-4 transition-colors hover:border-cyan-500/50"
        >
          <span className="text-sm font-bold text-foreground">📈 Market trends</span>
          <span className="text-xs text-muted-foreground">What prices are doing near you →</span>
        </Link>
      </div>
    </div>
  );
}
