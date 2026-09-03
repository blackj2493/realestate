/**
 * Crawlable links into the /address tree.
 *
 * The address pages had ZERO server-rendered inbound links before 2026-09-02 — grep for
 * an /address/ href in src and the only hits were the page's own canonical strings and a
 * client-side search handler. /addresses/sitemap.xml was the sole way in, so 45,000 pages
 * sat at crawl depth infinity receiving no internal link equity, linking outward to the
 * hubs and getting nothing back. This block is the return path.
 *
 * Public by construction: it renders the street address and nothing else. The address is
 * public record (the same 45,000 the sitemap already publishes); every VOW value — price,
 * date, beds, photos, brokerage — stays behind the login on the page each link points at.
 * Server component, no auth branch: anonymous visitors and Googlebot see exactly this.
 */

import Link from "next/link";
import { MapPin } from "lucide-react";
import { buildAddressPath } from "@/lib/listings/listingPath";
import type { SoldPublicLink } from "@/lib/sold/soldByKey";

export interface SoldAddressLinksProps {
  items: SoldPublicLink[];
  /** Visible section heading — must describe what the links ARE ("Recently sold in X"). */
  heading: string;
  /** Unique id for aria-labelledby; a page may render more than one of these. */
  headingId: string;
  /** Optional sentence under the heading, for context Google can read. */
  blurb?: string;
}

export default function SoldAddressLinks({ items, heading, headingId, blurb }: SoldAddressLinksProps) {
  // Build first, THEN cap: a record with no usable city slug yields no path, and dropping
  // it after the slice would silently shorten the block.
  const links = items
    .map((it) => ({ ...it, href: buildAddressPath(it) }))
    .filter((it): it is SoldPublicLink & { href: string } => it.href !== null);

  if (links.length === 0) return null;

  return (
    <section className="mt-10" aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-1 text-sm font-semibold uppercase tracking-wider text-foreground">
        {heading}
      </h2>
      {blurb && <p className="mb-3 text-sm text-muted-foreground">{blurb}</p>}
      <ul className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((it) => (
          <li key={it.id}>
            <Link
              href={it.href}
              className="group flex items-baseline gap-1.5 py-1 text-sm text-foreground transition-colors hover:text-cyan-600 dark:hover:text-cyan-300"
            >
              <MapPin className="h-3.5 w-3.5 shrink-0 translate-y-0.5 text-muted-foreground transition-colors group-hover:text-cyan-600 dark:group-hover:text-cyan-300" />
              <span className="line-clamp-1">{it.address}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
