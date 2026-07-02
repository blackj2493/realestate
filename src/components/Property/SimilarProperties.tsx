// src/components/Property/SimilarProperties.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ForSaleCompCard } from "@/components/Property/ForSaleCompCard";
import { SoldCompCard } from "@/components/Property/SoldCompCard";
import type {
  SimilarForSaleCard,
  SimilarSoldCard,
} from "@/app/api/properties/[id]/similar/route";
import type { MatchTier } from "@/lib/property/similarListings";

interface SimilarResponse {
  forSale: SimilarForSaleCard[];
  sold: SimilarSoldCard[];
  soldLocked: boolean;
  soldCount: number;
  matchQuality: { forSale: MatchTier; sold: MatchTier };
  area: { cityRegion: string | null; city: string | null };
}

interface Props {
  subjectId: string;
  cityRegion: string | null;
  city: string | null;
  subType: string | null;
  beds: number;
  bedsAbove: number;
  bedsBelow: number;
  garage: number | null;
  baths: number;
  listPrice: number;
  area: number;
}

const TIER_BADGE: Record<MatchTier, { label: string; cls: string } | null> = {
  close: { label: "Close comparables", cls: "text-emerald-600 dark:text-emerald-400 bg-emerald-400/10 border-emerald-400/20" },
  partial: { label: "Few exact matches", cls: "text-amber-600 dark:text-amber-400 bg-amber-400/10 border-amber-400/20" },
  sparse: { label: "Limited activity", cls: "text-muted-foreground bg-muted/30 border-border" },
  none: null,
};

function Badge({ tier }: { tier: MatchTier }) {
  const b = TIER_BADGE[tier];
  if (!b) return null;
  return (
    <span className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${b.cls}`}>
      {b.label}
    </span>
  );
}

function Row({ title, children, badge, action }: {
  title: string;
  badge: MatchTier;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground">{title}</h3>
        <Badge tier={badge} />
        <span className="ml-auto">{action}</span>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2">{children}</div>
    </div>
  );
}

export default function SimilarProperties(props: Props) {
  const { subjectId, cityRegion, city, subType, beds, bedsAbove, bedsBelow, garage, baths, listPrice, area } = props;
  const [data, setData] = useState<SimilarResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const qs = new URLSearchParams({
      cityRegion: cityRegion ?? "",
      city: city ?? "",
      subType: subType ?? "",
      beds: String(beds),
      bedsAbove: String(bedsAbove),
      bedsBelow: String(bedsBelow),
      // Omit when unknown so the route treats it as neutral (not "0 garage").
      ...(garage != null ? { garage: String(garage) } : {}),
      baths: String(baths),
      listPrice: String(listPrice),
      area: String(area),
    });
    setLoading(true);
    fetch(`/api/properties/${subjectId}/similar?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive) setData(j);
      })
      .catch(() => {
        if (alive) setData(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [subjectId, cityRegion, city, subType, beds, bedsAbove, bedsBelow, garage, baths, listPrice, area]);

  if (loading) {
    return (
      <section className="mt-8">
        <div className="mb-3 h-4 w-48 rounded bg-muted" />
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-64 w-[260px] shrink-0 animate-pulse rounded-lg bg-card/60" />
          ))}
        </div>
      </section>
    );
  }

  if (!data) return null;

  const areaName = data.area.cityRegion || data.area.city || "this area";
  const cityName = data.area.city;
  const hasSold = data.sold.length > 0 || (data.soldLocked && data.soldCount > 0);
  const hasForSale = data.forSale.length > 0;
  if (!hasForSale && !hasSold) return null;

  const seeAll = cityName ? (
    <Link href={`/properties?city=${encodeURIComponent(cityName)}`} className="text-xs text-cyan-600 dark:text-cyan-400 hover:text-cyan-300">
      See all in {cityName} →
    </Link>
  ) : null;

  return (
    <section className="mt-8 border-t border-border pt-6">
      <h2 className="mb-4 text-lg font-bold text-foreground">Comparable Properties</h2>

      {/* For Sale */}
      {hasForSale ? (
        <Row title={`For Sale in ${areaName}`} badge={data.matchQuality.forSale} action={seeAll}>
          {data.forSale.map((c) => (
            <ForSaleCompCard key={c.id} card={c} />
          ))}
        </Row>
      ) : (
        <p className="mb-6 text-sm text-muted-foreground">No comparable active listings in {areaName} right now.</p>
      )}

      {/* Recently Sold */}
      {hasSold && (
        <Row
          title={`Recently Sold in ${areaName}`}
          badge={data.soldLocked ? "none" : data.matchQuality.sold}
          action={
            data.soldLocked ? (
              <span className="text-xs text-muted-foreground">{data.soldCount} sold · sign in to view</span>
            ) : (
              seeAll
            )
          }
        >
          {data.soldLocked
            ? Array.from({ length: Math.min(4, data.soldCount) }).map((_, i) => (
                <SoldCompCard
                  key={i}
                  locked
                  card={{} as SimilarSoldCard}
                />
              ))
            : data.sold.map((c) => <SoldCompCard key={c.id} card={c} />)}
        </Row>
      )}

      {data.matchQuality.forSale === "sparse" && (
        <p className="text-xs text-muted-foreground">Limited comparable activity in {areaName}.</p>
      )}
    </section>
  );
}
