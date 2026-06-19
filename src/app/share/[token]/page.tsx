/**
 * /share/[token] — public, read-only view of a shared property selection.
 *
 * Re-hydrates listings live by listing_key (we stored keys only) so the recipient
 * always sees current data with the brokerage shown — TRREB-compliant. No auth.
 */

import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";
import { notFound } from "next/navigation";
import { getServiceRoleClient } from "@/lib/supabase/client";
import { PropertyCard, type PropertyCardData } from "@/components/PropertyCard";

export const dynamic = "force-dynamic";

interface ListingRow {
  listing_key: string;
  full_payload: Record<string, unknown> | null;
  media_urls: string[] | null;
  city: string | null;
  property_sub_type: string | null;
}

function num(v: unknown): number | undefined {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function toCardData(row: ListingRow): PropertyCardData {
  const p = row.full_payload ?? {};
  return {
    id: row.listing_key,
    listingId: row.listing_key,
    address: (p.UnparsedAddress as string) || "Address unavailable",
    city: (p.City as string) || row.city || "",
    province: p.StateOrProvince as string | undefined,
    price: num(p.ListPrice) ?? 0,
    propertyType:
      (p.PropertySubType as string) || row.property_sub_type || (p.PropertyType as string) || "Residential",
    bedrooms: num(p.BedroomsTotal) ?? 0,
    bathrooms: num(p.BathroomsTotalInteger) ?? 0,
    squareFeet: num(p.BuildingAreaTotal),
    daysOnMarket: num(p.DaysOnMarket),
    brokerage: (p.ListOfficeName as string) || "Unknown",
    photoUrl: row.media_urls?.[0] ?? null,
    maintenance: num(p.AssociationFee),
  };
}

/**
 * Single source of truth for both the page body and generateMetadata.
 * Wrapped in React cache() so the two Supabase lookups run ONCE per request
 * even though both the metadata pass and the render pass call it.
 *
 * Returns null when the collection is missing OR expired (caller decides how
 * to react: notFound() in the page body, safe minimal metadata otherwise).
 */
const getShareData = cache(
  async (token: string): Promise<{ note: string | null; cards: PropertyCardData[] } | null> => {
    const supabase = getServiceRoleClient();

    const { data: collection } = await supabase
      .from("shared_collections")
      .select("listing_keys, expires_at, note")
      .eq("token", token)
      .maybeSingle();

    if (!collection) return null;
    if (collection.expires_at && new Date(collection.expires_at as string) < new Date()) return null;

    const keys: string[] = (collection.listing_keys as string[]) ?? [];

    let cards: PropertyCardData[] = [];
    if (keys.length > 0) {
      const { data: rows } = await supabase
        .from("listings")
        .select("listing_key, full_payload, media_urls, city, property_sub_type")
        .in("listing_key", keys);

      // Preserve the order the sharer selected; drop any listing that's no longer available.
      const byKey = new Map((rows as ListingRow[] | null)?.map((r) => [r.listing_key, r]) ?? []);
      cards = keys.map((k) => byKey.get(k)).filter((r): r is ListingRow => Boolean(r)).map(toCardData);
    }

    return { note: (collection.note as string | null) ?? null, cards };
  },
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const data = await getShareData(token);

  if (!data) {
    return {
      title: "Shared property selection · PureProperty",
      robots: { index: false },
    };
  }

  const { note, cards } = data;
  const n = cards.length;
  // Raw MLS media URL used DIRECTLY (no /_next/image) — preserves the TRREB
  // watermark and avoids next/image remote-domain config for unfurl previews.
  const firstImage = cards[0]?.photoUrl ?? undefined;
  const title = `${n} ${n === 1 ? "property" : "properties"} shared with you · PureProperty`;
  const description =
    note || "A curated property selection on PureProperty.ca — live MLS data with brokerage shown.";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: firstImage ? [{ url: firstImage }] : [],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: firstImage ? [firstImage] : [],
    },
  };
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await getShareData(token);

  if (!data) notFound();

  const { note, cards } = data;

  return (
    <div className="min-h-app bg-background">
      {/* pt-safe: safe-area inset for notched phones on sticky header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 pt-safe backdrop-blur">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <Link href="/" className="flex items-center" aria-label="PureProperty.ca home">
            <Logo size="md" theme="dark" />
          </Link>
          {/* ≥44px tap target + active state */}
          <Link
            href="/properties"
            className="inline-flex min-h-[44px] items-center px-3 text-sm font-medium transition-colors hover:text-primary active:bg-muted"
          >
            Explore the terminal →
          </Link>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Shared property selection</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {cards.length} {cards.length === 1 ? "property" : "properties"} shared with you
            {note ? ` — "${note}"` : ""}
          </p>
        </div>

        {cards.length === 0 ? (
          <div className="rounded-xl border bg-card p-12 text-center">
            <h3 className="mb-2 text-lg font-semibold">These listings are no longer available</h3>
            <p className="mb-4 text-muted-foreground">
              The shared properties may have sold or been removed.
            </p>
            <Link href="/properties" className="text-primary underline">
              Browse current listings
            </Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {cards.map((property) => (
                <PropertyCard key={property.id} property={property} showSaveButton={false} />
              ))}
            </div>

            {/* Full-width end-of-list CTA */}
            <div className="mt-8">
              <Link
                href="/properties"
                className="flex w-full items-center justify-center rounded-lg border border-primary/40 bg-primary/10 px-4 py-4 text-sm font-semibold text-primary transition-colors hover:bg-primary/20 active:bg-primary/30"
              >
                See all properties on PureProperty →
              </Link>
            </div>
          </>
        )}
      </div>

      {/* pb-safe: safe-area inset so MLS attribution clears home-indicator */}
      <footer className="mt-8 border-t pb-safe pt-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} PureProperty. All rights reserved.</p>
          <p className="mt-2 text-xs">
            Listing data provided by PROPTX MLS®. The information provided herein must only be used by
            consumers that have a bona fide interest in the purchase, sale, or lease of real estate.
          </p>
        </div>
      </footer>
    </div>
  );
}
