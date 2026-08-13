import Image from "next/image";
import { Lock } from "lucide-react";
import { UnlockCta } from "@/components/Property/teaserPrimitives";
import type { VowActive } from "@/lib/vow/activeByAddress";

/**
 * "This home IS on the market" — for listings that reach us only on the VOW datafeed.
 *
 * Server component on purpose: the two shapes returned by getVowActiveByAddress differ
 * in what they CONTAIN, not in what they display. The anonymous shape has no price, no
 * brokerage and no photo URL as fields, so this file cannot render them for an anon
 * visitor even by mistake — there is nothing to render. Keeping it server-side means
 * the consumer payload never ships to a browser that isn't entitled to it.
 *
 * The anonymous state deliberately mirrors what a VOW competitor shows: that a listing
 * exists, its transaction kind, its property type, and a blurred photo. Everything that
 * makes it actionable — price, address specifics, brokerage, MLS number — is behind the
 * sign-in, because the PROPTX VOW agreement permits display of Listing Information
 * "solely for the purpose of use by Consumers".
 */
export default function VowActiveCard({ listing }: { listing: VowActive }) {
  const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;

  if (listing.locked) {
    return (
      <section className="rounded-xl border border-cyan-500/30 bg-cyan-500/[0.04] p-5">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-400">
          On the market now
        </p>

        <div className="mt-3 flex items-start gap-4">
          {listing.hasPhoto && listing.blurHash && (
            // A 24px server-blurred colour field. The real photo URL is never in the DOM,
            // so this cannot be undone by deleting a CSS rule.
            <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-lg bg-muted">
              <Image
                src={`/api/vow-active/${listing.blurHash}/photo-blur`}
                alt=""
                fill
                unoptimized
                className="object-cover"
                aria-hidden
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <Lock className="h-4 w-4 text-white/80 drop-shadow" />
              </div>
            </div>
          )}

          <div className="min-w-0">
            <p className="text-lg font-bold text-foreground">
              This home is listed {listing.kind.toLowerCase().startsWith("for") ? listing.kind.toLowerCase() : `as ${listing.kind}`}
            </p>
            {listing.propertySubType && (
              <p className="mt-0.5 text-sm text-muted-foreground">{listing.propertySubType}</p>
            )}
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              The asking price, photos and listing details are available to registered members.
            </p>
          </div>
        </div>

        <UnlockCta
          label="Sign in to see the asking price"
          note="Free account. This listing is not shown on public search."
        />
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.04] p-5">
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400">
        On the market now &middot; {listing.kind}
      </p>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-3xl font-extrabold text-foreground">
          {listing.listPrice != null ? money(listing.listPrice) : "Price on request"}
        </span>
        {listing.mlsStatus && (
          <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
            {listing.mlsStatus}
          </span>
        )}
      </div>

      {listing.address && <p className="mt-1 text-sm text-muted-foreground">{listing.address}</p>}
      {listing.propertySubType && (
        <p className="mt-0.5 text-sm text-muted-foreground">{listing.propertySubType}</p>
      )}

      {listing.photos.length > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          {listing.photos.slice(0, 3).map((src) => (
            <div key={src} className="relative aspect-[4/3] overflow-hidden rounded-lg bg-muted">
              {/* unoptimized: never re-encode an MLS photo — it carries the brokerage
                  watermark §6.3(f) requires, and Vercel optimization would strip/reflow it. */}
              <Image src={src} alt="" fill unoptimized className="object-cover" />
            </div>
          ))}
        </div>
      )}

      {/* TRREB §6.3(c): the brokerage shows on every listing display, same size as the
          rest of the detail, with no visual separation. */}
      <p className="mt-3 text-sm text-muted-foreground">
        {listing.brokerage || "Brokerage unavailable"}
      </p>

      <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
        This listing is distributed on the VOW feed and is shown to signed-in members only.
        Listing information is deemed reliable but is not guaranteed accurate by PROPTX.
      </p>
    </section>
  );
}
